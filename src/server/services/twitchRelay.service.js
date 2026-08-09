'use strict';

// ---- StreamElements bot relay ----------------------------------------------
// A player who toggled "Say in Twitch chat?" on gets their (already-filtered)
// message echoed into the real Twitch channel chat by the host's StreamElements
// bot. This uses ONE credential — the host's — so no player ever has to log in
// to Twitch. Everything the bot says is prefixed with the player's in-game name
// so chat knows who it came from.
//
// The credentials come from the active host (see config/hosts.js), so nothing
// here changes when hosts are switched. Requires Node's built-in fetch
// (Node 18+); to support older Node, `npm install node-fetch` and import it.

const { activeHost } = require('../config/hosts');

const SE_JWT_TOKEN = activeHost.seJwtToken;
const SE_CHANNEL_ID = activeHost.seChannelId;
const SE_SAY_URL = SE_CHANNEL_ID
  ? `https://api.streamelements.com/kappa/v2/bot/${SE_CHANNEL_ID}/say`
  : null;

// Twitch caps a single non-mod account near 20 messages / 30s. Since every
// relayed message rides on one bot account, funnel them through a small queue
// so a burst of players can't trip that limit and get the bot blocked.
const TWITCH_RELAY_MIN_INTERVAL_MS = 1600; // ~18 msgs / 30s, safely under
const twitchRelayQueue = [];
let twitchRelayTimer = null;

function pumpTwitchRelay() {
  if (twitchRelayTimer) return;
  const next = twitchRelayQueue.shift();
  if (!next) return;
  sendToStreamElements(next).finally(() => {
    twitchRelayTimer = setTimeout(() => {
      twitchRelayTimer = null;
      pumpTwitchRelay();
    }, TWITCH_RELAY_MIN_INTERVAL_MS);
  });
}

async function sendToStreamElements(message) {
  if (!SE_SAY_URL || !SE_JWT_TOKEN) {
    console.warn('[twitch-relay] SE_JWT_TOKEN / SE_CHANNEL_ID not set — skipping relay.');
    return;
  }
  try {
    const res = await fetch(SE_SAY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SE_JWT_TOKEN}`,
      },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      console.error(`[twitch-relay] SE say failed: ${res.status} ${await res.text().catch(() => '')}`);
    }
  } catch (err) {
    console.error('[twitch-relay] SE say error:', err);
  }
}

/**
 * Queue an (already-censored) chat line for relay into the host's Twitch chat,
 * prefixed with the player's name. Twitch messages cap at 500 chars; game
 * messages are already <=100, but the prefix + safety margin keeps us clear.
 */
function relayToTwitch(username, cleanMessage) {
  const name = (username && username.trim()) ? username.trim() : 'anon';
  const line = `${name}: ${cleanMessage}`.slice(0, 480);
  twitchRelayQueue.push(line);
  pumpTwitchRelay();
}

module.exports = { relayToTwitch };
