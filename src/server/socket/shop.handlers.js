'use strict';

const gameState = require('../state/gameState');
const { priceOf, loadShopConfig } = require('../services/shop.service');
const { freshUpgradeState, pushPersistentState } = require('../services/playerState.service');

// ---- Shop purchase + equip -------------------------------------------------
// The shop (press P in viewer.html) sells cosmetic skins AND gameplay upgrades.
// Score is the currency and is server-owned, so the DEDUCTION and the PRICE
// both live here — a client can only say WHICH item it wants, never how much it
// costs or that it can afford it. What an upgrade DOES is applied client-side
// (except invisibility, broadcast via the move packet's `invisible` flag).
function registerShopHandlers(socket, { io }) {
  socket.on('buy', (data) => {
    try {
      const buyer = gameState.players[socket.id];
      if (!buyer) return; // spectators can't buy

      const item = data && typeof data.item === 'string' ? data.item : null;
      const tier = data && data.tier;
      const skinId = data && typeof data.skinId === 'string' ? data.skinId : null;
      const price = priceOf(item, tier, skinId);
      const score = Number(buyer.score) || 0;

      if (price === null) {
        socket.emit('buy_result', { ok: false, score, item, tier, skinId, reason: 'invalid' });
        return;
      }
      if (score < price) {
        socket.emit('buy_result', { ok: false, score, item, tier, skinId, reason: 'poor' });
        return;
      }

      if (item === 'skin') {
        const owned = gameState.playerCosmetics[socket.id] || (gameState.playerCosmetics[socket.id] = new Set(['classic']));
        if (owned.has(skinId)) {
          socket.emit('buy_result', { ok: false, score, item, tier, skinId, reason: 'owned' });
          return;
        }
        owned.add(skinId);
        buyer.skin = skinId; // a newly purchased cosmetic auto-equips
      } else {
        // Upgrades must be purchased in order. This matters especially for
        // knockback because the server itself uses this tier during hit checks.
        const state = gameState.playerUpgrades[socket.id] || (gameState.playerUpgrades[socket.id] = freshUpgradeState());
        const requestedTier = Number(tier);
        const currentTier = Number(state[item]) || 0;
        if (!Number.isInteger(requestedTier) || requestedTier !== currentTier + 1) {
          socket.emit('buy_result', { ok: false, score, item, tier, skinId, reason: 'invalid' });
          return;
        }
        state[item] = requestedTier;
      }

      buyer.score = score - price;
      gameState.lastActivityAt[socket.id] = Date.now(); // buying counts as activity

      socket.emit('buy_result', { ok: true, score: buyer.score, item, tier, skinId });
      io.emit('player-move', { id: socket.id, ...buyer });
      pushPersistentState(socket); // persist balance + ownership/tier immediately
    } catch (err) {
      console.error(`[buy] error from ${socket.id}:`, err);
    }
  });

  // Equipping is server-authoritative too: the browser can request an owned
  // skin, but it cannot simply put an arbitrary skin id in a movement packet.
  socket.on('equip_skin', (data) => {
    try {
      const player = gameState.players[socket.id];
      if (!player) return;
      const skinId = data && typeof data.skinId === 'string' ? data.skinId : '';
      const owned = gameState.playerCosmetics[socket.id] || new Set(['classic']);
      const cfg = loadShopConfig();
      const skinCfg = cfg.cosmetics.items[skinId];

      if (!owned.has(skinId) || !skinCfg || (skinId !== 'classic' && skinCfg.enabled === false)) {
        socket.emit('equip_result', { ok: false, skinId, reason: 'invalid' });
        return;
      }

      player.skin = skinId;
      socket.emit('equip_result', { ok: true, skinId });
      io.emit('player-move', { id: socket.id, ...player });
      pushPersistentState(socket);
    } catch (err) {
      console.error(`[equip_skin] error from ${socket.id}:`, err);
    }
  });
}

module.exports = { registerShopHandlers };
