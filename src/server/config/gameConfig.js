'use strict';

// Server-authoritative gameplay + protocol constants.
//
// NOTE ON DUPLICATION: WORLD_WIDTH / WORLD_HEIGHT and the knockback impulse
// math intentionally also exist on the client (viewer.html / overlay.html).
// The server must remain authoritative, so it cannot trust client values; it
// keeps its own copy and clamps to it. If the client world size changes, THIS
// value must change too — otherwise players walking past the old edge get
// silently pinned there on everyone else's screen. See docs/ARCHITECTURE.md
// ("Source of truth") for the full list of intentionally-duplicated values.

// ---- World bounds -----------------------------------------------------------
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 500;

// ---- Identity validation ----------------------------------------------------
const MAX_USERNAME_LENGTH = 20;
const DEFAULT_USERNAME_COLOR = '#1e3fff';
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

// ---- Persistence cookie -----------------------------------------------------
const PLAYER_STATE_COOKIE = 'slime_player_state';
const PLAYER_STATE_MAX_AGE_SEC = 60 * 60 * 24 * 365; // 1 year

// ---- Disconnect grace -------------------------------------------------------
// Sockets that disconnected recently are kept around briefly before actual
// removal, so a quick reconnect doesn't flash "player left" to everyone.
const DISCONNECT_GRACE_MS = 20000; // 20 seconds

// ---- Rate limits ------------------------------------------------------------
// "move" cap: a runaway client (buggy loop, or someone poking the socket
// directly) can't flood the server. Generous, well above normal ~60fps emit.
const MIN_MOVE_INTERVAL_MS = 15;

// Chat: cap message length and how often one socket can talk.
const MAX_CHAT_LENGTH = 100;
const MIN_CHAT_INTERVAL_MS = 1000; // at most 1 message/second/player

// Player FX: rate-limit each effect type independently so a legitimate dash
// followed immediately by a jump/land is not dropped, while a modified client
// still cannot spam one animation every frame.
const PLAYER_FX_TYPES = new Set(['jump', 'double-jump', 'dash', 'land', 'invisibility']);
const PLAYER_FX_MIN_INTERVAL_MS = {
  jump: 60,
  'double-jump': 80,
  dash: 80,
  land: 80,
  invisibility: 80,
};

// ---- Punch / combat ---------------------------------------------------------
// Hit detection and cooldown run on the SERVER using the positions it already
// tracks, so a modified client can't claim hits across the map. This cooldown
// is the real gate: after landing a hit, an attacker can't land another for
// this long, which is what makes a freshly-hit target briefly "invulnerable".
// Kept short so continuous punching lands rapid (but not every-frame) hits.
// Small attacker-side gate, mostly anti-spam. The real "you can't be hit again
// right away" rule is PLAYER_INVULN_MS below, applied per target.
const SWING_COOLDOWN_MS = 150;
const SWING_COOLDOWN_TOLERANCE_MS = 50;
// After a player is hit, they can't be hit again for this long. One press lands
// one hit per target; hitting the same player again needs a fresh press AFTER
// this window elapses.
const PLAYER_INVULN_MS = 500;
const SWING_RADIUS = 60;        // world units around the sweet spot
const SWING_REACH_OFFSET = 20;  // sweet spot sits slightly in front of the swinger
// Max jump impulse in viewer.html is Yforce(0.5)*180 + 200 = 290. The knock is
// 3/4 of that, launched at 45 degrees, so each axis gets that magnitude / √2.
const MAX_JUMP_IMPULSE = 290;
const KNOCKBACK_COMPONENT = Math.round((MAX_JUMP_IMPULSE * 0.75) / Math.SQRT2); // ~154

// ---- AFK timeout ------------------------------------------------------------
// Clients emit "move" ~30x/sec even while standing perfectly still, so
// receiving move events is NOT a sign of life. Activity means the position
// genuinely changed (beyond AFK_MOVE_EPSILON) or the player chatted/acted.
const AFK_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const AFK_SWEEP_INTERVAL_MS = 10 * 1000; // how often we check
const AFK_MOVE_EPSILON = 0.5; // world units — ignores float jitter

module.exports = {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  MAX_USERNAME_LENGTH,
  DEFAULT_USERNAME_COLOR,
  HEX_COLOR_RE,
  PLAYER_STATE_COOKIE,
  PLAYER_STATE_MAX_AGE_SEC,
  DISCONNECT_GRACE_MS,
  MIN_MOVE_INTERVAL_MS,
  MAX_CHAT_LENGTH,
  MIN_CHAT_INTERVAL_MS,
  PLAYER_FX_TYPES,
  PLAYER_FX_MIN_INTERVAL_MS,
  SWING_COOLDOWN_MS,
  SWING_COOLDOWN_TOLERANCE_MS,
  PLAYER_INVULN_MS,
  SWING_RADIUS,
  SWING_REACH_OFFSET,
  MAX_JUMP_IMPULSE,
  KNOCKBACK_COMPONENT,
  AFK_TIMEOUT_MS,
  AFK_SWEEP_INTERVAL_MS,
  AFK_MOVE_EPSILON,
};
