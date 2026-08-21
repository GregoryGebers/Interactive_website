'use strict';

// Boot a real server on an ephemeral port and hand out connected Socket.IO
// clients. The existing unit tests only cover pure functions; these helpers
// exist so the SOCKET HANDLERS — where every server-authoritative rule about
// coins, prices, cosmetics and hit detection actually lives — can be tested
// against a genuine connection rather than by calling internals directly.

// Must be set BEFORE anything pulls in the crypto/config modules, which read it
// at require time and disable persistence when it is missing.
process.env.PLAYER_STATE_SECRET =
  process.env.PLAYER_STATE_SECRET || 'test-secret-of-at-least-thirty-two-characters-long';

const { io: ioClient } = require('socket.io-client');

const { createApp, createServer } = require('../../src/server/app');
const {
  registerSocketHandlers,
  stopBackgroundLoops,
} = require('../../src/server/socket/registerSocketHandlers');
const gameState = require('../../src/server/state/gameState');

let server = null;
let ioServer = null;
let baseUrl = '';
const openClients = new Set();

/** Start the server once for the whole test file. */
async function startTestServer() {
  if (server) return baseUrl;
  const app = createApp();
  const created = createServer(app);
  server = created.server;
  ioServer = created.io;
  registerSocketHandlers(ioServer);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  return baseUrl;
}

async function stopTestServer() {
  for (const c of openClients) c.close();
  openClients.clear();
  stopBackgroundLoops();
  if (ioServer) await new Promise((r) => ioServer.close(r));
  if (server && server.listening) await new Promise((r) => server.close(r));
  server = null;
  ioServer = null;
}

/** Connect a client and resolve once it is actually connected. */
function connectClient(opts = {}) {
  const client = ioClient(baseUrl, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    ...opts,
  });
  openClients.add(client);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('connect timed out')), 4000);
    client.on('connect', () => {
      clearTimeout(timer);
      resolve(client);
    });
    client.on('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/** Emit `join` and wait for the server's authoritative player_state reply. */
async function joinAs(client, username = 'Tester') {
  const state = once(client, 'player_state');
  client.emit('join', { username, color: '#112233' });
  return state;
}

/** Resolve with the next payload for `event`, or reject on timeout. */
function once(client, event, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off(event, handler);
      reject(new Error(`timed out waiting for "${event}"`));
    }, timeoutMs);
    function handler(payload) {
      clearTimeout(timer);
      client.off(event, handler);
      resolve(payload);
    }
    client.on(event, handler);
  });
}

/**
 * Assert that `event` does NOT arrive within `windowMs`.
 * Resolves true if nothing arrived, false (with the payload) otherwise.
 */
function neverFires(client, event, windowMs = 400) {
  return new Promise((resolve) => {
    let fired = null;
    const handler = (payload) => { fired = payload === undefined ? true : payload; };
    client.on(event, handler);
    setTimeout(() => {
      client.off(event, handler);
      resolve(fired);
    }, windowMs);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Give a joined socket a known coin balance. Score is server-owned and there is
 * deliberately no client path to set it, so tests reach into game state — the
 * same thing the coin handler does.
 */
function setScore(socketId, score) {
  gameState.players[socketId].score = score;
}

module.exports = {
  startTestServer,
  stopTestServer,
  connectClient,
  joinAs,
  once,
  neverFires,
  sleep,
  setScore,
  gameState,
  getBaseUrl: () => baseUrl,
};
