const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// ---- Socket.IO server ----------------------------------------------------
const io = new Server(server, {
  cors: {
    origin: '*', // Adjust this as needed for security
    methods: ['GET', 'POST']
  },
  // Lets a client that has a brief network drop (mobile network blip, laptop
  // sleep, Render free-tier idling, etc.) rejoin with the SAME socket.id and
  // have any buffered events replayed, instead of being treated as a brand
  // new connection. Requires socket.io >= 4.6.0 on both server and client
  // (the client CDN script already pulls a recent version).
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  },
  // Guards against absurdly large payloads from a misbehaving/malicious client.
  maxHttpBufferSize: 1e5, // 100 KB
});

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// ---- Host selection --------------------------------------------------------
// Two people can run this game over their own stream: eberhex and izu_kora.
// A SINGLE Render env var, isEberhex, flips EVERYTHING to the right host at
// once — no code edits, no per-host files:
//   - which StreamElements bot (JWT + channel id) relays chat, and
//   - which Twitch channel viewer.html shows as the background.
//
// Set BOTH hosts' credentials once (see the env var names below), then just
// toggle isEberhex between deploys to switch who's hosting.
//
// Render env vars are always strings, so "true" (any capitalization) counts
// as true; anything else — including unset — falls back to izu_kora.
const IS_EBERHEX = String(process.env.isEberhex).toLowerCase() === 'true';

const HOSTS = {
  eberhex: {
    twitchChannel: 'eberhex',
    seJwtToken: process.env.SE_JWT_TOKEN_EBERHEX || '',
    seChannelId: process.env.SE_CHANNEL_ID_EBERHEX || '',
  },
  izu_kora: {
    twitchChannel: 'izu_kora',
    seJwtToken: process.env.SE_JWT_TOKEN_IZU || '',
    seChannelId: process.env.SE_CHANNEL_ID_IZU || '',
  },
};

const activeHost = IS_EBERHEX ? HOSTS.eberhex : HOSTS.izu_kora;
console.log(`[host] active host: ${activeHost.twitchChannel} (isEberhex=${IS_EBERHEX})`);

// Optional: Define a route for the root URL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
});

// Tells viewer.html which Twitch channel to embed as the background. The
// choice is made SERVER-SIDE by the isEberhex env var, because the browser
// can't read Render env vars itself. Only the PUBLIC channel name is exposed
// here — never the JWT.
app.get('/config', (req, res) => {
  res.json({ twitchChannel: activeHost.twitchChannel });
});

// Lightweight endpoint you can point an uptime monitor (e.g. UptimeRobot,
// cron-job.org — both have free tiers) at every 5-10 minutes. Render's free
// tier spins a service down after ~15 min with no traffic, and the first
// request after that takes 30-50s to wake back up. A periodic ping to this
// endpoint keeps the server warm so players don't hit that cold-start delay.
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', players: Object.keys(players).length, uptime: process.uptime() });
});

// ---- Chat filtering ---------------------------------------------------------
// The filter runs SERVER-SIDE so it can't be bypassed by editing client code.
// Primary list: the `leo-profanity` package (covers common English swear
// words and slurs, and is community-maintained). Install it with:
//
//     npm install leo-profanity
//
// If it isn't installed yet, we fall back to a small built-in list so chat
// still gets basic filtering instead of none at all.
let profanityFilter = null;
try {
  profanityFilter = require('leo-profanity');
} catch (e) {
  console.warn('[chat] leo-profanity not installed — using minimal fallback list. Run: npm install leo-profanity');
}

const FALLBACK_BAD_WORDS = [
  'fuck', 'shit', 'bitch', 'asshole', 'cunt', 'dick', 'bastard',
  'slut', 'whore', 'pussy', 'douche', 'wanker'
];

// Merge the fallback words INTO leo-profanity too (its default list has a
// few surprising gaps, e.g. "whore"), so both its clean() pass and our
// evasion pass below see the same complete list.
if (profanityFilter) {
  try { profanityFilter.add(FALLBACK_BAD_WORDS); } catch (e) {}
}

// One lowercase Set for fast whole-word lookups in the evasion check below.
const badWordSet = new Set(
  (profanityFilter ? profanityFilter.list() : FALLBACK_BAD_WORDS)
    .map(w => String(w).toLowerCase())
);

// Common letter->symbol substitutions people use to sneak words past filters
// ("f4ck", "sh!t", "b1tch"). Mapped back to letters before checking.
const LEET_MAP = {
  '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's',
  '6': 'g', '7': 't', '8': 'b', '@': 'a', '$': 's',
  '!': 'i', '+': 't', '€': 'e', '£': 'l'
};

// Reduce a token to bare lowercase letters: map leetspeak, drop everything
// that isn't a-z (so "f.u.c.k" collapses too).
function lettersOnly(token) {
  let out = '';
  for (const ch of String(token).toLowerCase()) {
    const mapped = LEET_MAP[ch] || ch;
    if (mapped >= 'a' && mapped <= 'z') out += mapped;
  }
  return out;
}

// Collapse repeated letters ("fuuuuck" -> "fuck"). Checked as a SECOND form
// alongside the plain one — never instead of it — because collapsing can
// also mangle innocent words (e.g. "assess"), and we only ever compare
// whole tokens against the list (no substring matching), which avoids
// false-positives on words that merely contain a bad word.
function collapseRepeats(s) {
  return s.replace(/(.)\1+/g, '$1');
}

// A symbol or digit stuck inside a word ("f4ck", "sh!t", "a$$hole") is
// really being used as a wildcard for whatever letter it replaced — the
// writer isn't being phonetic, they're dodging the filter. So build a regex
// from the token where each non-letter matches any single optional letter,
// and test it against the word list. Only kicks in for tokens that actually
// contain non-letters, so ordinary words never take this path.
function wildcardRegexFor(token) {
  const lower = String(token).toLowerCase();
  let pattern = '';
  let hasWildcard = false;
  let letterCount = 0;
  for (const ch of lower) {
    if (ch >= 'a' && ch <= 'z') {
      pattern += ch;
      letterCount++;
    } else {
      pattern += '[a-z]?';
      hasWildcard = true;
    }
  }
  // Need at least a couple of real letters, or something like "!!" would
  // match half the list.
  if (!hasWildcard || letterCount < 2) return null;
  return new RegExp('^' + pattern + '$');
}

function isBadToken(token) {
  const plain = lettersOnly(token);
  if (!plain) return false;
  if (badWordSet.has(plain) || badWordSet.has(collapseRepeats(plain))) return true;

  const re = wildcardRegexFor(token);
  if (re) {
    for (const bad of badWordSet) {
      if (re.test(bad)) return true;
    }
  }
  return false;
}

function censorChatMessage(message) {
  let msg = message;

  // Pass 1: the library's own cleaner (replaces listed words with ****).
  if (profanityFilter) {
    try {
      msg = profanityFilter.clean(msg);
    } catch (e) {
      console.error('[chat] profanity filter error:', e);
    }
  }

  // Pass 2: leetspeak/spacing-evasion check, token by token. Anything that
  // normalizes into a listed word gets fully starred out.
  return msg
    .split(' ')
    .map(word => (isBadToken(word) ? '*'.repeat(word.length) : word))
    .join(' ');
}

// ---- StreamElements bot relay ----------------------------------------------
// A player who toggled "Say in Twitch chat?" on gets their (already-filtered)
// message echoed into the real Twitch channel chat by your StreamElements
// bot. This uses ONE credential — yours — so no player ever has to log into
// Twitch. Everything the bot says is prefixed with the player's in-game name
// so chat knows who it came from.
//
// The credentials come from the active host chosen above (isEberhex), so
// nothing here changes when you switch hosts. Set these on Render (Settings
// -> Environment); treat every JWT like a password — they live ONLY on the
// server. For EACH host, grab both values from "Show secrets" at
// https://streamelements.com/dashboard/account/channels:
//   SE_JWT_TOKEN_EBERHEX  / SE_CHANNEL_ID_EBERHEX
//   SE_JWT_TOKEN_IZU      / SE_CHANNEL_ID_IZU
//
// Requires Node's built-in fetch (Node 18+). If your service pins an older
// Node, `npm install node-fetch` and import it here instead.
const SE_JWT_TOKEN = activeHost.seJwtToken;
const SE_CHANNEL_ID = activeHost.seChannelId;
const SE_SAY_URL = SE_CHANNEL_ID
  ? `https://api.streamelements.com/kappa/v2/bot/${SE_CHANNEL_ID}/say`
  : null;

// Twitch caps a single non-mod account near 20 messages / 30s. Since every
// relayed message rides on your one bot account, funnel them through a small
// queue so a burst of players can't trip that limit and get the bot blocked.
const TWITCH_RELAY_MIN_INTERVAL_MS = 1600; // ~18 msgs / 30s, safely under
const twitchRelayQueue = [];
let twitchRelayTimer = null;

function pumpTwitchRelay() {
  if (twitchRelayTimer) return;
  const next = twitchRelayQueue.shift();
  if (!next) return;
  sendToStreamElements(next).finally(() => {
    twitchRelayTimer = setTimeout(() => {
      twitchRelayTimer = null;
      pumpTwitchRelay();
    }, TWITCH_RELAY_MIN_INTERVAL_MS);
  });
}

async function sendToStreamElements(message) {
  if (!SE_SAY_URL || !SE_JWT_TOKEN) {
    console.warn('[twitch-relay] SE_JWT_TOKEN / SE_CHANNEL_ID not set — skipping relay.');
    return;
  }
  try {
    const res = await fetch(SE_SAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SE_JWT_TOKEN}`,
      },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      console.error(`[twitch-relay] SE say failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
  } catch (err) {
    console.error('[twitch-relay] SE say error:', err);
  }
}

// Twitch messages cap at 500 chars; our game messages are already <=100, but
// the name prefix + a little safety margin keeps us well clear.
function relayToTwitch(username, cleanMessage) {
  const name = (username && username.trim()) ? username.trim() : 'anon';
  const line = `${name}: ${cleanMessage}`.slice(0, 480);
  twitchRelayQueue.push(line);
  pumpTwitchRelay();
}

// ---- Game state ------------------------------------------------------------
let players = {};

// Matches the box layout in viewer.html / overlay.html. Keep these three in
// sync if you ever change the level.
const coins = [
  { x: 500, y: 480 },
  { x: 0, y: 380 },
  { x: 100, y: 330 },
  { x: 100, y: 430 },
  { x: 300, y: 460 },
  { x: 300, y: 330 },
  { x: 550, y: 360 },
  { x: 500, y: 480 },
  { x: 645, y: 340 },
  { x: 815, y: 380 },
  { x: 980, y: 360 },

  // ---- Extended world: second screen (1000-2000) ----
  { x: 1070, y: 420 },
  { x: 1160, y: 380 },
  { x: 1250, y: 340 },
  { x: 1390, y: 320 },
  { x: 1510, y: 380 },
  { x: 1600, y: 320 },
  { x: 1780, y: 400 },
  { x: 1870, y: 380 },
  { x: 1960, y: 340 },

  // ---- Extended world: third screen (2000-3000) ----
  { x: 2050, y: 420 },
  { x: 2140, y: 380 },
  { x: 2230, y: 340 },
  { x: 2420, y: 420 },
  { x: 2540, y: 380 },
  { x: 2630, y: 340 },
  { x: 2730, y: 400 },
  { x: 2840, y: 360 },
  { x: 2910, y: 420 },
  { x: 2980, y: 380 },
];

function pickRandomCoin() {
  return coins[Math.floor(Math.random() * coins.length)];
}

// Single source of truth for the current coin, so a new player joining just
// gets told where it currently is instead of the server re-rolling a fresh
// coin (and moving it) for every already-playing client.
let currentCoin = pickRandomCoin();

// Must match viewer.html/overlay.html. CRITICAL: sanitizeMoveData clamps
// every reported position to these bounds — if this lags behind the client
// world size, players walking past the old edge get silently pinned there
// on everyone else's screen.
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 500;
const MAX_USERNAME_LENGTH = 20;
const DEFAULT_USERNAME_COLOR = '#1e3fff';
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

// Sockets that disconnected recently are kept around for a grace period
// before we actually remove them, so a quick reconnect doesn't flash a
// "player left" to everyone watching.
const DISCONNECT_GRACE_MS = 20000; // 20 seconds
const pendingRemoval = {};

// A player can only be told apart from garbage/attack traffic if we validate
// what comes in on "move" before trusting it.
function sanitizeMoveData(data) {
  if (!data || typeof data !== 'object') return null;

  const x = Number(data.x);
  const y = Number(data.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const username = typeof data.username === 'string'
    ? data.username.slice(0, MAX_USERNAME_LENGTH)
    : '';

  const color = typeof data.color === 'string' && HEX_COLOR_RE.test(data.color)
    ? data.color
    : DEFAULT_USERNAME_COLOR;

  return {
    x: Math.min(Math.max(x, 0), WORLD_WIDTH),
    y: Math.min(Math.max(y, 0), WORLD_HEIGHT),
    frameCount: Number.isFinite(Number(data.frameCount)) ? Number(data.frameCount) : 0,
    frameIndex: Number.isFinite(Number(data.frameIndex)) ? Number(data.frameIndex) : 0,
    frameRow: Number.isFinite(Number(data.frameRow)) ? Number(data.frameRow) : 0,
    username,
    color,
    emote: typeof data.emote === 'string' ? data.emote : 'idle',
    score: Number.isFinite(Number(data.score)) ? Number(data.score) : 0,
  };
}

// Simple per-socket rate limit on "move" so a runaway client (buggy loop,
// or someone poking the socket directly) can't flood the server.
const MIN_MOVE_INTERVAL_MS = 15; // generous cap, well above normal ~60fps emit rate
const lastMoveAt = {};

// Chat limits: cap message length and how often one socket can talk, so a
// script can't spam the whole stream.
const MAX_CHAT_LENGTH = 100;
const MIN_CHAT_INTERVAL_MS = 1000; // at most 1 message per second per player
const lastChatAt = {};

// ---- Bat swing ---------------------------------------------------------------
// Space swings a bat. The HIT DETECTION runs here on the server (using the
// positions it already tracks) rather than trusting the attacker's client,
// so a modified client can't claim hits on people across the map. The
// cooldown is ALSO enforced here for the same reason — the client's own
// 2s cooldown is just UX; this one is the real gate.
const SWING_COOLDOWN_MS = 2000;
// Server-side check runs slightly under the client's 2000ms so a legit
// swing arriving a few ms "early" (timer drift, network jitter) isn't dropped.
const SWING_COOLDOWN_TOLERANCE_MS = 100;
const SWING_RADIUS = 60;        // world units around the sweet spot
const SWING_REACH_OFFSET = 20;  // sweet spot sits slightly in front of the swinger
// Max jump impulse in viewer.html is Yforce(0.5)*180 + 200 = 290. The knock
// is 3/4 of that, launched at 45 degrees, so each axis gets that magnitude
// divided by sqrt(2).
const MAX_JUMP_IMPULSE = 290;
const KNOCKBACK_COMPONENT = Math.round((MAX_JUMP_IMPULSE * 0.75) / Math.SQRT2); // ~154
const lastSwingAt = {};

// ---- AFK timeout -------------------------------------------------------------
// Characters that haven't ACTUALLY done anything for 2 minutes get removed
// from view everywhere (broadcast as a normal 'remove-player', which both
// viewer.html and overlay.html already handle).
//
// Important: clients emit "move" ~30x/sec even while standing perfectly
// still, so receiving move events is NOT a sign of life. Activity means the
// position genuinely changed (beyond a tiny epsilon) or the player chatted.
const AFK_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const AFK_SWEEP_INTERVAL_MS = 10 * 1000; // how often we check
const AFK_MOVE_EPSILON = 0.5; // world units — ignores float jitter
const lastActivityAt = {};

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id} recovered=${socket.recovered}`);

  // Cancel any pending removal for this id — they're back.
  if (pendingRemoval[socket.id]) {
    clearTimeout(pendingRemoval[socket.id]);
    delete pendingRemoval[socket.id];
  }

  // Every connection gets the current world state, but does NOT become a
  // player itself just by connecting. overlay.html connects purely to watch
  // (it never sends "join"), so it should never spawn a character — that was
  // the bug: previously any socket, including the overlay's own read-only
  // connection, was auto-registered as a player at (100,100) on connect.
  socket.emit('init', players);
  socket.emit('coin', currentCoin);

  socket.on('join', (data) => {
    try {
      if (players[socket.id]) return; // already joined (e.g. a recovered reconnect)

      const username = data && typeof data.username === 'string'
        ? data.username.slice(0, MAX_USERNAME_LENGTH)
        : '';
      const color = data && typeof data.color === 'string' && HEX_COLOR_RE.test(data.color)
        ? data.color
        : DEFAULT_USERNAME_COLOR;

      players[socket.id] = { x: 100, y: 100, emote: 'idle', score: 0, username, color };
      lastActivityAt[socket.id] = Date.now(); // joining counts as activity
      socket.broadcast.emit('new-player', { id: socket.id, ...players[socket.id] });
    } catch (err) {
      console.error(`[join] error from ${socket.id}:`, err);
    }
  });

  socket.on('coin_taken', () => {
    try {
      if (currentCoin === null) return; // already taken by someone else
      currentCoin = null;
      socket.broadcast.emit('coin_taken');
      setTimeout(() => {
        currentCoin = pickRandomCoin();
        io.emit('coin', currentCoin);
      }, 3000);
    } catch (err) {
      console.error(`[coin_taken] error from ${socket.id}:`, err);
    }
  });

  socket.on('chat', (data) => {
    try {
      if (!players[socket.id]) return; // spectator connections can't chat

      // Rate limit BEFORE any processing.
      const now = Date.now();
      if (lastChatAt[socket.id] && now - lastChatAt[socket.id] < MIN_CHAT_INTERVAL_MS) {
        return; // too fast, drop silently
      }

      if (!data || typeof data.message !== 'string') return;

      // Sanitize: strip control characters, collapse whitespace, cap length.
      let message = data.message
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_CHAT_LENGTH);
      if (!message) return;

      lastChatAt[socket.id] = now;
      lastActivityAt[socket.id] = now; // chatting counts as activity

      // Filter profanity/slurs, then broadcast the CLEAN version to everyone
      // — including the sender, so their own bubble shows exactly what the
      // rest of the room sees.
      message = censorChatMessage(message);
      io.emit('chat', { id: socket.id, message });

      // If the player toggled "Say in Twitch chat?" on, relay the SAME
      // censored text into the real channel chat via the StreamElements bot.
      if (data.toTwitch === true) {
        relayToTwitch(players[socket.id].username, message);
      }
    } catch (err) {
      console.error(`[chat] error from ${socket.id}:`, err);
    }
  });

  socket.on('swing', (data) => {
    try {
      const attacker = players[socket.id];
      if (!attacker) return; // spectators can't swing

      const now = Date.now();
      if (lastSwingAt[socket.id] &&
          now - lastSwingAt[socket.id] < SWING_COOLDOWN_MS - SWING_COOLDOWN_TOLERANCE_MS) {
        return; // still on cooldown — drop silently
      }
      lastSwingAt[socket.id] = now;
      lastActivityAt[socket.id] = now; // swinging counts as activity

      // Facing direction: only ±1 is trusted, anything else becomes right.
      const dir = (data && Number(data.dir) === -1) ? -1 : 1;

      // Everyone else needs to SEE the swing animation on this character.
      socket.broadcast.emit('player-swing', { id: socket.id, dir });

      // Hit check against the server's own record of player positions:
      // a circle centered slightly in front of the swinger, facing side.
      const cx = attacker.x + dir * SWING_REACH_OFFSET;
      const cy = attacker.y;
      for (const id in players) {
        if (id === socket.id) continue; // can't hit yourself
        const target = players[id];
        const dx = target.x - cx;
        const dy = target.y - cy;
        if (dx * dx + dy * dy <= SWING_RADIUS * SWING_RADIUS) {
          // 45-degree launch away from the swing, at 3/4 max-jump force.
          io.to(id).emit('knockback', {
            vx: dir * KNOCKBACK_COMPONENT,
            vy: -KNOCKBACK_COMPONENT,
          });
        }
      }
    } catch (err) {
      console.error(`[swing] error from ${socket.id}:`, err);
    }
  });

  socket.on('move', (data) => {
    try {
      if (!players[socket.id]) return; // hasn't joined as a player (e.g. a spectator connection)

      const now = Date.now();
      if (lastMoveAt[socket.id] && now - lastMoveAt[socket.id] < MIN_MOVE_INTERVAL_MS) {
        return; // drop, too frequent
      }
      lastMoveAt[socket.id] = now;

      const clean = sanitizeMoveData(data);
      if (!clean) {
        console.warn(`[move] dropped malformed payload from ${socket.id}`);
        return;
      }

      // Only a real position change counts as activity — idle clients keep
      // streaming identical coordinates and must NOT reset the AFK clock.
      const prev = players[socket.id];
      if (
        Math.abs(clean.x - prev.x) > AFK_MOVE_EPSILON ||
        Math.abs(clean.y - prev.y) > AFK_MOVE_EPSILON
      ) {
        lastActivityAt[socket.id] = now;
      }

      players[socket.id] = clean;
      socket.broadcast.emit('player-move', { id: socket.id, ...clean });
    } catch (err) {
      console.error(`[move] error from ${socket.id}:`, err);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[disconnect] ${socket.id} (${reason})`);
    delete lastMoveAt[socket.id];
    delete lastChatAt[socket.id];
    delete lastSwingAt[socket.id];

    if (!players[socket.id]) return; // never joined as a player — nothing to clean up

    // Don't remove immediately — give them a window to reconnect.
    // NOTE: lastActivityAt is deliberately NOT deleted here — the AFK sweep
    // would read a missing entry as "idle since forever" and kick them out
    // of the grace window within seconds, defeating its purpose.
    pendingRemoval[socket.id] = setTimeout(() => {
      delete players[socket.id];
      delete lastActivityAt[socket.id];
      delete pendingRemoval[socket.id];
      io.emit('remove-player', socket.id);
    }, DISCONNECT_GRACE_MS);
  });

  socket.on('error', (err) => {
    console.error(`[socket error] ${socket.id}:`, err);
  });
});

// ---- AFK sweep ----------------------------------------------------------------
// Every few seconds, remove any player whose last real activity is older
// than the timeout. Removal goes out as the same 'remove-player' event a
// disconnect uses, so viewer.html and overlay.html both clear the character
// with zero extra client logic. The kicked player also gets a private
// 'afk-removed' so their own screen can show the rejoin prompt.
setInterval(() => {
  const now = Date.now();
  for (const id in players) {
    const last = lastActivityAt[id] || 0;
    if (now - last > AFK_TIMEOUT_MS) {
      delete players[id];
      delete lastActivityAt[id];
      delete lastMoveAt[id];
      delete lastChatAt[id];
      delete lastSwingAt[id];
      io.emit('remove-player', id);
      io.to(id).emit('afk-removed');
      console.log(`[afk] removed ${id} after ${Math.round((now - last) / 1000)}s of inactivity`);
    }
  }
}, AFK_SWEEP_INTERVAL_MS);

// ---- Process-level safety nets ---------------------------------------------
// Without these, one unexpected error anywhere can crash the whole process
// and disconnect every player at once. Log it and keep the server alive.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (server kept alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (server kept alive):', reason);
});

// ---- Graceful shutdown ------------------------------------------------------
function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);
  io.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
  // Force-exit if it hangs
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
