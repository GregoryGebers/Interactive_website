'use strict';

// ---- Application bootstrap ---------------------------------------------------
// This file only COMPOSES the server; every feature's implementation lives in
// src/server/. See docs/ARCHITECTURE.md for the full map.
//
//   config/    environment, host selection, paths, gameplay/protocol constants
//   utils/     signed-cookie crypto, movement validation
//   state/     the shared runtime game state
//   services/  scene, shop+pricing, player persistence, profanity, twitch relay
//   routes/    the HTTP endpoints (/, /config, /health, /editor, /api/*)
//   socket/    Socket.IO event handlers, split by domain

const { createApp, createServer, logStartupBanner } = require('./src/server/app');
const { registerSocketHandlers } = require('./src/server/socket/registerSocketHandlers');
const { PORT } = require('./src/server/config/environment');

logStartupBanner();

const app = createApp();
const { server, io } = createServer(app);
registerSocketHandlers(io);

// ---- Process-level safety nets ----------------------------------------------
// Without these, one unexpected error anywhere can crash the whole process and
// disconnect every player at once. Log it and keep the server alive.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (server kept alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (server kept alive):', reason);
});

// ---- Graceful shutdown ------------------------------------------------------
function shutdown(signal) {
  console.log(`${signal} received, shutting down gracefully...`);
  io.close(() => {
    server.close(() => {
      process.exit(0);
    });
  });
  // Force-exit if it hangs.
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
