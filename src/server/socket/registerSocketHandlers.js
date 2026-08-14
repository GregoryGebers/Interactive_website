'use strict';

const gameState = require('../state/gameState');
const { AFK_TIMEOUT_MS, AFK_SWEEP_INTERVAL_MS } = require('../config/gameConfig');
const { pickRandomCoin } = require('../services/scene.service');
const { readPersistentCookie } = require('../utils/crypto');
const { normalizePersistentState, pushPersistentState } = require('../services/playerState.service');
const { verifyAccessToken, loadPlayerState } = require('../services/supabase.service');

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
        delete gameState.invulnerableUntil[id];
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
    // cookie from the handshake headers. This is the guest/fallback state; if
    // this socket is authenticated, the async block below upgrades it to the DB
    // row before the player clicks GO (join happens only from the login screen).
    const cookieState = readPersistentCookie(
      socket.handshake && socket.handshake.headers && socket.handshake.headers.cookie
    );
    socket.data.persistentState = normalizePersistentState(cookieState);
    socket.data.userId = null;

    // Cancel any pending removal for this id — they're back.
    if (gameState.pendingRemoval[socket.id]) {
      clearTimeout(gameState.pendingRemoval[socket.id]);
      delete gameState.pendingRemoval[socket.id];
    }

    // Every connection gets the current world state, but does NOT become a
    // player just by connecting. overlay.html connects purely to watch (it
    // never sends "join"), so it should never spawn a character. Handlers are
    // registered SYNCHRONOUSLY here so no early event (e.g. a fast "join") is
    // lost while the async auth lookup below is still in flight.
    socket.emit('init', gameState.players);
    socket.emit('coin', gameState.currentCoin);

    registerPlayerHandlers(socket, context);
    registerMovementHandlers(socket, context);
    registerCoinHandlers(socket, context);
    registerShopHandlers(socket, context);
    registerChatHandlers(socket, context);
    registerCombatHandlers(socket, context);
    registerEffectsHandlers(socket, context);

    // If the browser handed us a Supabase access token, this connection belongs
    // to a real account: verify it, remember the user id, and prefer the row
    // stored in the database over the cookie. Done asynchronously (not blocking
    // handler registration). If the player has already joined by the time this
    // resolves, re-push so the authoritative DB balance/cosmetics take effect.
    const authToken = socket.handshake && socket.handshake.auth && socket.handshake.auth.token;
    if (authToken) {
      (async () => {
        try {
          const user = await verifyAccessToken(authToken);
          if (!user) {
            console.log(`[auth] ${socket.id} presented an invalid/expired token; treating as guest`);
            return;
          }
          socket.data.userId = user.id;
          const dbState = await loadPlayerState(user.id);
          if (dbState) socket.data.persistentState = normalizePersistentState(dbState);
          console.log(`[auth] ${socket.id} authenticated as ${user.id}`);
          if (gameState.players[socket.id]) {
            // Already joined as a guest before auth resolved — re-apply the
            // account's saved progression now.
            const owned = new Set(socket.data.persistentState.cosmetics);
            gameState.playerCosmetics[socket.id] = owned;
            gameState.playerUpgrades[socket.id] = { ...socket.data.persistentState.upgrades };
            gameState.players[socket.id].score = socket.data.persistentState.coins;
            pushPersistentState(socket, { bumpRevision: false });
          }
        } catch (err) {
          console.error(`[auth] token verification failed for ${socket.id}:`, err);
        }
      })();
    }
  });

  startAfkSweep(io);
}

module.exports = { registerSocketHandlers };
