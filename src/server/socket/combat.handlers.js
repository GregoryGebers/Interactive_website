'use strict';

const gameState = require('../state/gameState');
const {
  SWING_COOLDOWN_MS,
  SWING_COOLDOWN_TOLERANCE_MS,
  PLAYER_INVULN_MS,
  SWING_RADIUS,
  SWING_REACH_OFFSET,
  KNOCKBACK_COMPONENT,
} = require('../config/gameConfig');
const { loadShopConfig, finiteNumber } = require('../services/shop.service');
const { damageMobFromSwing } = require('./mob.handlers');

// ---- Bat swing --------------------------------------------------------------
// Space swings a bat. HIT DETECTION and the cooldown both run here on the
// server (using the positions it already tracks) rather than trusting the
// attacker's client, so a modified client can't claim hits across the map. The
// client's own 2s cooldown is just UX; the server gate is authoritative.
function registerCombatHandlers(socket, { io }) {
  socket.on('swing', (data) => {
    try {
      const attacker = gameState.players[socket.id];
      if (!attacker) return; // spectators can't swing

      const now = Date.now();
      if (
        gameState.lastSwingAt[socket.id] &&
        now - gameState.lastSwingAt[socket.id] < SWING_COOLDOWN_MS - SWING_COOLDOWN_TOLERANCE_MS
      ) {
        return; // still on cooldown — drop silently
      }
      gameState.lastSwingAt[socket.id] = now;
      gameState.lastActivityAt[socket.id] = now; // swinging counts as activity

      // Facing direction: only ±1 is trusted, anything else becomes right.
      const dir = (data && Number(data.dir) === -1) ? -1 : 1;

      // Everyone else needs to SEE the swing animation on this character.
      socket.broadcast.emit('player-swing', { id: socket.id, dir });

      // The shared combat mob is server-authoritative too: a swing that reaches
      // it deals damage / kills it here, and the death picks the next mob.
      damageMobFromSwing(io, socket.id, dir, attacker);

      // Hit check against the server's own record of player positions: a circle
      // centered slightly in front of the swinger, on the facing side.
      const cx = attacker.x + dir * SWING_REACH_OFFSET;
      const cy = attacker.y;
      for (const id in gameState.players) {
        if (id === socket.id) continue; // can't hit yourself
        // Per-target invulnerability: a player just hit (by anyone) can't be hit
        // again until their window expires. This is what stops a held/mashed
        // punch from stringing hits on the same person, while still letting one
        // swing hit every OTHER player in range this frame.
        if ((gameState.invulnerableUntil[id] || 0) > now) continue;
        const target = gameState.players[id];
        const dx = target.x - cx;
        const dy = target.y - cy;
        if (dx * dx + dy * dy <= SWING_RADIUS * SWING_RADIUS) {
          gameState.invulnerableUntil[id] = now + PLAYER_INVULN_MS;
          // Tier 0 is the exact old/base knockback. Each purchased knockback
          // tier adds the configured percentage (15% by default), additively:
          // T1=115%, T2=130%, T3=145% with the default shop.json.
          const cfg = loadShopConfig();
          const kbCfg = cfg.upgrades.knockback;
          const maxTier = Math.max(1, kbCfg.costs.length);
          const ownedTier = Number(gameState.playerUpgrades[socket.id] && gameState.playerUpgrades[socket.id].knockback) || 0;
          const knockTier = kbCfg.enabled ? Math.min(ownedTier, maxTier) : 0;
          const multiplier = 1 + knockTier * (finiteNumber(kbCfg.pct, 15, 0) / 100);
          const component = Math.round(KNOCKBACK_COMPONENT * multiplier);

          // A hit always locks controls for at least the base duration. The
          // attacker's knockback tier linearly scales that to the configured
          // max (0.5s -> 1.5s across three tiers by default).
          const stunBaseMs = finiteNumber(kbCfg.stunBaseMs, 500, 0);
          const stunMaxMs = Math.max(stunBaseMs, finiteNumber(kbCfg.stunMaxMs, 1500, 0));
          const stunMs = Math.round(stunBaseMs + (stunMaxMs - stunBaseMs) * (knockTier / maxTier));

          // Server-confirmed hit visual. Game viewers and overlay.html receive
          // the flash/particles; camera shake is still created only inside each
          // participating viewer, so the stream overlay itself never shakes.
          io.emit('player-hit', {
            attackerId: socket.id,
            targetId: id,
            dir,
            tier: knockTier,
            maxTier,
          });

          io.to(id).emit('knockback', {
            vx: dir * component,
            vy: -component,
            stunMs,
            tier: knockTier,
            maxTier,
            dir,
            attackerId: socket.id,
          });
        }
      }
    } catch (err) {
      console.error(`[swing] error from ${socket.id}:`, err);
    }
  });
}

module.exports = { registerCombatHandlers };
