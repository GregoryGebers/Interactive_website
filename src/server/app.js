'use strict';

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const { PERSISTENCE_ENABLED } = require('./config/environment');
const { activeHost } = require('./config/hosts');
const { PUBLIC_DIR, TOOLS_DIR } = require('./config/paths');
const { registerRoutes } = require('./routes');

/**
 * Build the Express app: JSON body parsing (only used by the signed-cookie
 * persistence bridge), static hosting of public/, and all HTTP routes.
 * @returns {import('express').Express}
 */
function createApp() {
  const app = express();

  // Small JSON bodies are used only for the signed-cookie persistence bridge.
  app.use(express.json({ limit: '16kb' }));

  // Serve static files from the 'public' directory.
  app.use(express.static(PUBLIC_DIR));

  // The scene editor lives outside public/ (it is a dev tool, not part of the
  // deployed game). Serve its stylesheet/scripts read-only from /tools/... so
  // editor.html can load them. This exposes only the tools/ directory; there is
  // still NO write route for scene/shop online.
  app.use('/tools', express.static(TOOLS_DIR));

  registerRoutes(app);
  return app;
}

/**
 * Create the HTTP server + Socket.IO server for a given Express app.
 * @returns {{ server: http.Server, io: import('socket.io').Server }}
 */
function createServer(app) {
  const server = http.createServer(app);

  const io = new Server(server, {
    cors: {
      origin: '*', // Adjust this as needed for security
      methods: ['GET', 'POST'],
    },
    // Lets a client with a brief network drop (mobile blip, laptop sleep,
    // Render free-tier idling) rejoin with the SAME socket.id and have buffered
    // events replayed, instead of being treated as a brand new connection.
    // Requires socket.io >= 4.6.0 on both server and client.
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
      skipMiddlewares: true,
    },
    // Guards against absurdly large payloads from a misbehaving/malicious client.
    maxHttpBufferSize: 1e5, // 100 KB
  });

  return { server, io };
}

// One-line startup summary so logs show which host/persistence mode is active.
function logStartupBanner() {
  const { IS_EBERHEX } = require('./config/environment');
  console.log(`[host] active host: ${activeHost.twitchChannel} (isEberhex=${IS_EBERHEX})`);
  if (!PERSISTENCE_ENABLED) {
    console.warn(
      '[player-state] PLAYER_STATE_SECRET is missing/too short; persistent cookies are DISABLED. ' +
      'Set a random secret of at least 32 characters on Render.'
    );
  }
}

module.exports = { createApp, createServer, logStartupBanner };
