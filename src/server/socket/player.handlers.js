'use strict';

const gameState = require('../state/gameState');
const {
  MAX_USERNAME_LENGTH,
  DEFAULT_USERNAME_COLOR,
  HEX_COLOR_RE,
  DISCONNECT_GRACE_MS,
} = require('../config/gameConfig');
const { loadShopConfig } = require('../services/shop.service');
const { normalizePersistentState, pushPersistentState } = require('../services/playerState.service');

/**
 * join / disconnect / error for a single connection.
 *
 * A socket does NOT become a player just by connecting: overlay.html connects
 * purely to watch (it never sends "join"), so it must never spawn a character.
 */
function registerPlayerHandlers(socket, { io }) {
  socket.on('join', (data) => {
    try {
      if (gameState.players[socket.id]) {
        // Recovered connection: resend the authoritative state in case the
        // browser page recreated its local UI while the socket survived.
        pushPersistentState(socket, { bumpRevision: false });
        return;
      }

      const username = data && typeof data.username === 'string'
        ? data.username.slice(0, MAX_USERNAME_LENGTH)
        : '';
      const color = data && typeof data.color === 'string' && HEX_COLOR_RE.test(data.color)
        ? data.color
        : DEFAULT_USERNAME_COLOR;
      const beakColor = data && typeof data.beakColor === 'string' && HEX_COLOR_RE.test(data.beakColor)
        ? data.beakColor
        : null;

      const saved = normalizePersistentState(socket.data.persistentState);
      const owned = new Set(saved.cosmetics);
      let skin = owned.has(saved.equippedSkin) ? saved.equippedSkin : 'classic';

      // If a designer disabled a cosmetic after this player bought it, keep
      // ownership in the cookie but temporarily fall back to Classic.
      const shopCfg = loadShopConfig();
      if (skin !== 'classic' && (!shopCfg.cosmetics.items[skin] || shopCfg.cosmetics.items[skin].enabled === false)) {
        skin = 'classic';
      }

      gameState.players[socket.id] = {
        x: 100, y: 100, emote: 'idle', facing: 1,
        score: saved.coins,
        username, color, beakColor, skin
      };
      gameState.playerUpgrades[socket.id] = { ...saved.upgrades };
      gameState.playerCosmetics[socket.id] = owned;
      socket.data.persistentState = { ...saved, equippedSkin: skin };

      gameState.lastActivityAt[socket.id] = Date.now(); // joining counts as activity
      socket.broadcast.emit('new-player', { id: socket.id, ...gameState.players[socket.id] });
      pushPersistentState(socket, { bumpRevision: false });
    } catch (err) {
      console.error(`[join] error from ${socket.id}:`, err);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[disconnect] ${socket.id} (${reason})`);
    delete gameState.lastMoveAt[socket.id];
    delete gameState.lastChatAt[socket.id];
    delete gameState.lastSwingAt[socket.id];
    delete gameState.invulnerableUntil[socket.id];
    delete gameState.lastPlayerFxAt[socket.id];

    if (!gameState.players[socket.id]) return; // never joined — nothing to clean up

    // Don't remove immediately — give them a window to reconnect.
    // NOTE: lastActivityAt is deliberately NOT deleted here — the AFK sweep
    // would read a missing entry as "idle since forever" and kick them out of
    // the grace window within seconds, defeating its purpose.
    gameState.pendingRemoval[socket.id] = setTimeout(() => {
      delete gameState.players[socket.id];
      delete gameState.playerUpgrades[socket.id];
      delete gameState.playerCosmetics[socket.id];
      delete gameState.lastActivityAt[socket.id];
      delete gameState.pendingRemoval[socket.id];
      io.emit('remove-player', socket.id);
    }, DISCONNECT_GRACE_MS);
  });

  socket.on('error', (err) => {
    console.error(`[socket error] ${socket.id}:`, err);
  });
}

module.exports = { registerPlayerHandlers };
