'use strict';

const gameState = require('../state/gameState');
const { MIN_MOVE_INTERVAL_MS, AFK_MOVE_EPSILON } = require('../config/gameConfig');
const { sanitizeMoveData } = require('../utils/validation');

// Position updates. Rate-limited, validated, and clamped to world bounds.
function registerMovementHandlers(socket) {
  socket.on('move', (data) => {
    try {
      if (!gameState.players[socket.id]) return; // hasn't joined (e.g. a spectator)

      const now = Date.now();
      if (gameState.lastMoveAt[socket.id] && now - gameState.lastMoveAt[socket.id] < MIN_MOVE_INTERVAL_MS) {
        return; // drop, too frequent
      }
      gameState.lastMoveAt[socket.id] = now;

      const clean = sanitizeMoveData(data, gameState.players[socket.id]);
      if (!clean) {
        console.warn(`[move] dropped malformed payload from ${socket.id}`);
        return;
      }

      // Only a real position change counts as activity — idle clients keep
      // streaming identical coordinates and must NOT reset the AFK clock.
      const prev = gameState.players[socket.id];
      if (
        Math.abs(clean.x - prev.x) > AFK_MOVE_EPSILON ||
        Math.abs(clean.y - prev.y) > AFK_MOVE_EPSILON
      ) {
        gameState.lastActivityAt[socket.id] = now;
      }

      gameState.players[socket.id] = clean;
      socket.broadcast.emit('player-move', { id: socket.id, ...clean });
    } catch (err) {
      console.error(`[move] error from ${socket.id}:`, err);
    }
  });
}

module.exports = { registerMovementHandlers };
