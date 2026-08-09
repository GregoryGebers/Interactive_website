'use strict';

const gameState = require('../state/gameState');
const { pickRandomCoin } = require('../services/scene.service');
const { pushPersistentState } = require('../services/playerState.service');

// Coin collection. Score is server-owned; only this handler increments it.
function registerCoinHandlers(socket, { io }) {
  socket.on('coin_taken', () => {
    try {
      const taker = gameState.players[socket.id];
      if (!taker) return; // spectator connections cannot take coins
      if (gameState.currentCoin === null) return; // already taken by someone else

      // Keep score server-side so regular movement packets cannot reset it and
      // edited clients cannot lower/overwrite it.
      const currentScore = Number(taker.score);
      taker.score = (Number.isFinite(currentScore) ? currentScore : 0) + 1;

      // Preserve the authoritative pickup position before clearing the coin.
      // The collector already plays this effect locally; everyone else,
      // including overlay.html, receives the same world-space pickup pop.
      const pickedCoin = gameState.currentCoin;
      gameState.currentCoin = null;
      socket.broadcast.emit('coin_taken');
      if (pickedCoin && Number.isFinite(Number(pickedCoin.x)) && Number.isFinite(Number(pickedCoin.y))) {
        socket.broadcast.emit('coin-fx', {
          id: socket.id,
          x: Number(pickedCoin.x),
          y: Number(pickedCoin.y),
        });
      }

      // Immediately broadcast the updated score so overlay.html does not wait
      // for the next movement packet before showing the new value.
      io.emit('player-move', { id: socket.id, ...taker });
      pushPersistentState(socket); // coins survive refresh/reconnect/server restart

      setTimeout(() => {
        gameState.currentCoin = pickRandomCoin();
        io.emit('coin', gameState.currentCoin);
      }, 3000);
    } catch (err) {
      console.error(`[coin_taken] error from ${socket.id}:`, err);
    }
  });
}

module.exports = { registerCoinHandlers };
