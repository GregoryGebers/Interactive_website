'use strict';

const gameState = require('../state/gameState');
const { AFK_TIMEOUT_MS, AFK_SWEEP_INTERVAL_MS } = require('../config/gameConfig');
const { pickRandomCoin } = require('../services/scene.service');
const { readPersistentCookie } = require('../utils/crypto');
const { normalizePersistentState } = require('../services/playerState.service');

const { registerPlayerHandlers } = require('./player.handlers');
const { registerMovementHandlers } = require('./movement.handlers');
const { registerCoinHandlers } = require('./coin.handlers');
const { registerShopHandlers } = require('./shop.handlers');
const { registerChatHandlers } = require('./chat.handlers');
const { registerCombatHandlers } = require('./combat.handlers');
const { registerEffectsHandlers } = require('./effects.handlers');

// ---- AFK sweep --------------------------------------------------------------
// Every few seconds, remove any player whose last real activity is older than
// the timeout. Removal reuses the same 'remove-player' event a disconnect does,
// so viewer.html and overlay.html both clear the character with zero extra
// client logic. The kicked player also gets a private 'afk-removed' so their
// own screen can show the rejoin prompt.
function startAfkSweep(io) {
  setInterval(() => {
    const now = Date.now();
    for (const id in gameState.players) {
      const last = gameState.lastActivityAt[id] || 0;
      if (now - last > AFK_TIMEOUT_MS) {
        delete gameState.players[id];
        delete gameState.playerUpgrades[id];
        delete gameState.playerCosmetics[id];
        delete gameState.lastActivityAt[id];
        delete gameState.lastMoveAt[id];
        delete gameState.lastChatAt[id];
        delete gameState.lastSwingAt[id];
        io.emit('remove-player', id);
        io.to(id).emit('afk-removed');
        console.log(`[afk] removed ${id} after ${Math.round((now - last) / 1000)}s of inactivity`);
      }
    }
  }, AFK_SWEEP_INTERVAL_MS);
}

/**
 * Wire every Socket.IO connection: load its signed save, (re)send world state,
 * and register the per-domain event handlers. Also starts the AFK sweep.
 */
function registerSocketHandlers(io) {
  // Single source of truth for the current coin: a new player just gets told
  // where it currently is, instead of the server re-rolling a fresh coin (and
  // moving it) for every already-playing client.
  if (gameState.currentCoin === null) {
    gameState.currentCoin = pickRandomCoin();
  }

  const context = { io };

  io.on('connection', (socket) => {
    console.log(`[connect] ${socket.id} recovered=${socket.recovered}`);

    // Load the signed save carried by this browser. A recovered Socket.IO
    // connection keeps socket.data; a fresh connection gets the latest HttpOnly
    // cookie from the handshake headers.
    const cookieState = readPersistentCookie(
      socket.handshake && socket.handshake.headers && socket.handshake.headers.cookie
    );
    socket.data.persistentState = normalizePersistentState(cookieState);

    // Cancel any pending removal for this id — they're back.
    if (gameState.pendingRemoval[socket.id]) {
      clearTimeout(gameState.pendingRemoval[socket.id]);
      delete gameState.pendingRemoval[socket.id];
    }

    // Every connection gets the current world state, but does NOT become a
    // player just by connecting. overlay.html connects purely to watch (it
    // never sends "join"), so it should never spawn a character.
    socket.emit('init', gameState.players);
    socket.emit('coin', gameState.currentCoin);

    registerPlayerHandlers(socket, context);
    registerMovementHandlers(socket, context);
    registerCoinHandlers(socket, context);
    registerShopHandlers(socket, context);
    registerChatHandlers(socket, context);
    registerCombatHandlers(socket, context);
    registerEffectsHandlers(socket, context);
  });

  startAfkSweep(io);
}

module.exports = { registerSocketHandlers };
