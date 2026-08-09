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

  lastMoveAt: {},
  lastChatAt: {},
  lastSwingAt: {},
  lastPlayerFxAt: {},
  lastActivityAt: {},
  pendingRemoval: {},
};

module.exports = gameState;
