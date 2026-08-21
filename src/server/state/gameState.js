'use strict';

// ---- Runtime game state -----------------------------------------------------
// The single, shared home for all mutable multiplayer state. Every socket
// handler reads and writes through this object rather than through scattered
// module-level globals, so state ownership is discoverable in one place.
//
// Server-authoritative state (never trusted from the client):
//   players           socket.id -> movement/render snapshot (incl. score, skin)
//   playerUpgrades    socket.id -> owned upgrade tiers (kept OUTSIDE `players`
//                     so movement sanitization cannot accidentally erase it)
//   playerCosmetics   socket.id -> Set of owned cosmetic ids
//   currentCoin       the one live coin everyone shares, or null while respawning
//
// Bookkeeping used for rate limiting, AFK detection and reconnect grace:
//   lastMoveAt / lastChatAt / lastSwingAt   socket.id -> timestamp
//   lastPlayerFxAt                          socket.id -> { [fxType]: timestamp }
//   lastActivityAt                          socket.id -> timestamp of real activity
//   pendingRemoval                          socket.id -> disconnect grace timer

const gameState = {
  players: {},
  playerUpgrades: {},
  playerCosmetics: {},

  // `currentCoin` is reassigned as coins are taken/respawned. Mutate it as a
  // property (gameState.currentCoin = ...) so importers always see the latest.
  currentCoin: null,

  // The single live combat mob everyone shares (server-authoritative, like the
  // coin but it moves). null while none is alive; `mobRespawnAt` is the epoch ms
  // the next one should appear after a death.
  currentMob: null,
  mobRespawnAt: 0,

  lastMoveAt: {},
  lastChatAt: {},
  lastSwingAt: {},
  // Per-target invulnerability: a player who was just hit can't be hit again
  // until this timestamp, so a single hit lands once per target no matter how
  // fast the attacker swings.
  invulnerableUntil: {},
  lastPlayerFxAt: {},
  lastActivityAt: {},
  pendingRemoval: {},

  // When each socket actually joined the world. The Twitch relay uses this to
  // refuse sockets that connect, join and immediately start spamming — see
  // RELAY_MIN_ACCOUNT_AGE_MS. Cleared with the rest of a player's bookkeeping.
  joinedAt: {},
  // socket.id -> array of epoch-ms timestamps of relayed messages, trimmed to
  // the rolling budget window in chat.handlers.js.
  relayHistory: {},

  // ---- Counters for /health --------------------------------------------------
  // Render's free tier discards logs, so without these there is no way to answer
  // "how busy was it" or "did someone abuse the Twitch relay" after the fact.
  stats: {
    peakPlayers: 0,
    totalJoins: 0,
    chatMessages: 0,
    relaysSent: 0,
    purchases: 0,
    authFailures: 0,
    afkRemovals: 0,
    rejectedOrigins: 0,
  },
};

module.exports = gameState;
