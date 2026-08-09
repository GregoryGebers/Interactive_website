'use strict';

// ---- Host selection --------------------------------------------------------
// Two people can run this game over their own stream: eberhex and izu_kora.
// A SINGLE env var, isEberhex, flips EVERYTHING to the right host at once — no
// code edits, no per-host files:
//   - which StreamElements bot (JWT + channel id) relays chat, and
//   - which Twitch channel viewer.html shows as the background.
//
// Set BOTH hosts' credentials once (see config/environment.js), then just
// toggle isEberhex between deploys to switch who's hosting.

const { IS_EBERHEX, SE_CREDENTIALS } = require('./environment');

const HOSTS = {
  eberhex: {
    twitchChannel: 'eberhex',
    ...SE_CREDENTIALS.eberhex,
  },
  izu_kora: {
    twitchChannel: 'izu_kora',
    ...SE_CREDENTIALS.izu_kora,
  },
};

const activeHost = IS_EBERHEX ? HOSTS.eberhex : HOSTS.izu_kora;

module.exports = { HOSTS, activeHost };
