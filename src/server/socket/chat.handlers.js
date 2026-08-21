'use strict';

const gameState = require('../state/gameState');
const {
  MAX_CHAT_LENGTH,
  MIN_CHAT_INTERVAL_MS,
  RELAY_MIN_ACCOUNT_AGE_MS,
  RELAY_BUDGET_WINDOW_MS,
  RELAY_BUDGET_PER_WINDOW,
} = require('../config/gameConfig');
const { censorChatMessage } = require('../services/profanity.service');
const { relayToTwitch } = require('../services/twitchRelay.service');

/**
 * May this socket relay a message into the host's REAL Twitch chat right now?
 *
 * The in-game chat limit (1 msg/sec) is about readability; this is about not
 * getting the streamer's Twitch account banned, so it is much stricter:
 *   - the socket must have been playing for a while (a drive-by bot that
 *     connects, joins and immediately spams gets nothing), and
 *   - each player gets a small budget per rolling window.
 */
function canRelay(socketId, now) {
  const joinedAt = gameState.joinedAt[socketId] || 0;
  if (!joinedAt || now - joinedAt < RELAY_MIN_ACCOUNT_AGE_MS) return false;

  const history = gameState.relayHistory[socketId] || (gameState.relayHistory[socketId] = []);
  // Drop timestamps that have aged out of the window.
  while (history.length && now - history[0] > RELAY_BUDGET_WINDOW_MS) history.shift();
  return history.length < RELAY_BUDGET_PER_WINDOW;
}

function chargeRelay(socketId, now) {
  const history = gameState.relayHistory[socketId] || (gameState.relayHistory[socketId] = []);
  history.push(now);
}

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
      gameState.stats.chatMessages++;

      // If the player toggled "Say in Twitch chat?" on, relay the SAME censored
      // text into the real channel chat via the StreamElements bot — but only
      // within this player's relay budget. Failing this check is silent: the
      // in-game bubble still shows, so nothing appears broken, and telling a
      // spammer exactly which limit they hit only helps them tune around it.
      if (data.toTwitch === true && canRelay(socket.id, now)) {
        const player = gameState.players[socket.id];
        // relayToTwitch returns false when the relay is disabled or its queue is
        // saturated; don't spend the player's budget on a message never sent.
        if (relayToTwitch(player.username, message)) {
          chargeRelay(socket.id, now);
          gameState.stats.relaysSent++;
        }
      }
    } catch (err) {
      console.error(`[chat] error from ${socket.id}:`, err);
    }
  });
}

module.exports = { registerChatHandlers, canRelay };
