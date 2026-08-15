'use strict';

const gameState = require('../state/gameState');
const { MAX_CHAT_LENGTH, MIN_CHAT_INTERVAL_MS } = require('../config/gameConfig');
const { censorChatMessage } = require('../services/profanity.service');
const { relayToTwitch } = require('../services/twitchRelay.service');

// Chat: rate-limited, sanitized, profanity-filtered server-side, then broadcast
// to everyone (including the sender, so their bubble matches the room).
function registerChatHandlers(socket, { io }) {
  socket.on('chat', (data) => {
    try {
      if (!gameState.players[socket.id]) return; // spectator connections can't chat

      // Rate limit BEFORE any processing.
      const now = Date.now();
      if (gameState.lastChatAt[socket.id] && now - gameState.lastChatAt[socket.id] < MIN_CHAT_INTERVAL_MS) {
        return; // too fast, drop silently
      }

      if (!data || typeof data.message !== 'string') return;

      // Sanitize: strip control characters, collapse whitespace, cap length.
      let message = data.message
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_CHAT_LENGTH);
      if (!message) return;

      gameState.lastChatAt[socket.id] = now;
      gameState.lastActivityAt[socket.id] = now; // chatting counts as activity

      // Filter profanity/slurs, then broadcast the CLEAN version to everyone.
      message = censorChatMessage(message);
      io.emit('chat', { id: socket.id, message });

      // If the player toggled "Say in Twitch chat?" on, relay the SAME censored
      // text into the real channel chat via the StreamElements bot.
      if (data.toTwitch === true) {
        relayToTwitch(gameState.players[socket.id].username, message);
      }
    } catch (err) {
      console.error(`[chat] error from ${socket.id}:`, err);
    }
  });
}

module.exports = { registerChatHandlers };
