'use strict';

const gameState = require('../state/gameState');
const { PLAYER_FX_TYPES, PLAYER_FX_MIN_INTERVAL_MS } = require('../config/gameConfig');

// ---- Shared visual effects --------------------------------------------------
// viewer.html renders its own effect immediately, then emits a tiny `player-fx`
// event so OTHER game viewers and overlay.html can reproduce the same visual.
// These events are visual-only: the server ignores the client-supplied position
// and anchors every effect to the authoritative player position it already has.
function registerEffectsHandlers(socket) {
  socket.on('player-fx', (data) => {
    try {
      const source = gameState.players[socket.id];
      if (!source) return; // spectators / not-yet-joined sockets cannot emit FX
      if (!data || typeof data !== 'object') return;

      const type = typeof data.type === 'string' ? data.type : '';
      if (!PLAYER_FX_TYPES.has(type)) return;

      const now = Date.now();
      const perSocket = gameState.lastPlayerFxAt[socket.id] || (gameState.lastPlayerFxAt[socket.id] = {});
      const previous = Number(perSocket[type]) || 0;
      const minInterval = PLAYER_FX_MIN_INTERVAL_MS[type] || 80;
      if (previous && now - previous < minInterval) return;
      perSocket[type] = now;

      // IMPORTANT: x/y come from the server's latest authoritative player state,
      // NOT from the browser payload. The event is purely cosmetic.
      const payload = {
        id: socket.id,
        type,
        x: Number(source.x) || 0,
        y: Number(source.y) || 0,
      };

      if (type === 'dash') {
        payload.dir = Number(data.dir) === -1 ? -1 : 1;
      } else if (type === 'land') {
        // Kept for future effect-strength tuning; current receivers only need
        // the type/position. Clamp so arbitrary values are never relayed.
        const speed = Number(data.speed);
        if (Number.isFinite(speed)) payload.speed = Math.max(0, Math.min(speed, 2000));
      } else if (type === 'invisibility') {
        payload.phase = data.phase === 'vanish' ? 'vanish'
          : data.phase === 'appear' ? 'appear'
          : 'toggle';
      }

      // Exclude the sender because it already rendered the effect immediately.
      // `socket.broadcast` DOES include spectator sockets such as overlay.html.
      socket.broadcast.emit('player-fx', payload);
    } catch (err) {
      console.error(`[player-fx] error from ${socket.id}:`, err);
    }
  });
}

module.exports = { registerEffectsHandlers };
