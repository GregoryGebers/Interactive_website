'use strict';

// ---- StreamElements bot relay ----------------------------------------------
// A player who toggled "Say in Twitch chat?" on gets their (already-filtered)
// message echoed into the real Twitch channel chat by the host's StreamElements
// bot. This uses ONE credential — the host's — so no player ever has to log in
// to Twitch. Everything the bot says is prefixed with the player's in-game name
// so chat knows who it came from.
//
// The credentials come from the active host (see config/hosts.js), so nothing
// here changes when hosts are switched. Requires Node's built-in fetch
// (Node 18+); to support older Node, `npm install node-fetch` and import it.
//
// ---- Why this file is defensive --------------------------------------------
// Everything sent here is spoken by the STREAMER'S OWN Twitch account. Abuse
// does not just degrade this server, it can get the host's account banned. The
// per-socket chat rate limit (1 msg/sec) alone was not enough: many sockets
// each sending 1/sec filled an UNBOUNDED queue far faster than it drained at
// ~1 per 1.6s, so a burst became unbounded memory growth plus hours of
// attacker-chosen text still being spoken long after the attack stopped.
//
// Three limits now apply, in order of how much they matter:
//   1. TWITCH_RELAY_ENABLED  — env kill switch, no deploy needed.
//   2. MAX_QUEUE_DEPTH       — the backlog can never outlive the burst.
//   3. per-player budget     — enforced by the caller (chat.handlers.js).

const { TWITCH_RELAY_ENABLED } = require('../config/environment');
const { activeHost } = require('../config/hosts');

const SE_JWT_TOKEN = activeHost.seJwtToken;
const SE_CHANNEL_ID = activeHost.seChannelId;
const SE_SAY_URL = SE_CHANNEL_ID
  ? `https://api.streamelements.com/kappa/v2/bot/${SE_CHANNEL_ID}/say`
  : null;

// Twitch caps a single non-mod account near 20 messages / 30s. Since every
// relayed message rides on one bot account, funnel them through a small queue
// so a burst of players can't trip that limit and get the bot blocked.
const TWITCH_RELAY_MIN_INTERVAL_MS = 1600; // ~18 msgs / 30s, safely under

// At 1.6s per message this is ~80 seconds of backlog — enough to smooth a
// legitimate burst from a busy room, short enough that an attacker cannot
// leave the bot talking for hours. Beyond this, new messages are DROPPED
// (oldest are kept: they are the ones real players are still waiting on).
const MAX_QUEUE_DEPTH = 50;

const twitchRelayQueue = [];
let twitchRelayTimer = null;

// Observability: without these, relay abuse is invisible until Twitch acts.
const stats = { queued: 0, sent: 0, dropped: 0, failed: 0 };
let lastDropLogAt = 0;
const DROP_LOG_INTERVAL_MS = 10000;

function pumpTwitchRelay() {
  if (twitchRelayTimer) return;
  const next = twitchRelayQueue.shift();
  if (!next) return;
  sendToStreamElements(next).finally(() => {
    twitchRelayTimer = setTimeout(() => {
      twitchRelayTimer = null;
      pumpTwitchRelay();
    }, TWITCH_RELAY_MIN_INTERVAL_MS);
    // Don't let a pending relay delay a graceful shutdown.
    if (twitchRelayTimer.unref) twitchRelayTimer.unref();
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
      stats.failed++;
      console.error(`[twitch-relay] SE say failed: ${res.status} ${await res.text().catch(() => '')}`);
    } else {
      stats.sent++;
    }
  } catch (err) {
    stats.failed++;
    console.error('[twitch-relay] SE say error:', err);
  }
}

/**
 * Queue an (already-censored) chat line for relay into the host's Twitch chat,
 * prefixed with the player's name. Twitch messages cap at 500 chars; game
 * messages are already <=100, but the prefix + safety margin keeps us clear.
 *
 * @returns {boolean} false if the message was dropped (relay disabled or the
 *   queue is saturated), so the caller can avoid charging a player's budget.
 */
function relayToTwitch(username, cleanMessage) {
  if (!TWITCH_RELAY_ENABLED) return false;

  if (twitchRelayQueue.length >= MAX_QUEUE_DEPTH) {
    stats.dropped++;
    const now = Date.now();
    if (now - lastDropLogAt > DROP_LOG_INTERVAL_MS) {
      lastDropLogAt = now;
      console.warn(
        `[twitch-relay] queue saturated at ${MAX_QUEUE_DEPTH}; dropping messages ` +
        `(${stats.dropped} dropped total). Possible relay abuse.`
      );
    }
    return false;
  }

  const name = (username && username.trim()) ? username.trim() : 'anon';
  const line = `${name}: ${cleanMessage}`.slice(0, 480);
  twitchRelayQueue.push(line);
  stats.queued++;
  pumpTwitchRelay();
  return true;
}

// Snapshot for /health, so relay abuse is visible without reading logs.
function relayStats() {
  return { ...stats, queueDepth: twitchRelayQueue.length, enabled: TWITCH_RELAY_ENABLED };
}

module.exports = { relayToTwitch, relayStats, MAX_QUEUE_DEPTH };
