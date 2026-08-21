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
const { registerSocketHandlers, stopBackgroundLoops } = require('./src/server/socket/registerSocketHandlers');
const { PORT } = require('./src/server/config/environment');

logStartupBanner();

const app = createApp();
const { server, io } = createServer(app);
registerSocketHandlers(io);

// ---- Graceful shutdown ------------------------------------------------------
let shuttingDown = false;

function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down gracefully...`);

  // Stop the AFK sweep and mob tick first: they hold the event loop open and
  // would otherwise keep mutating state (and emitting) during teardown.
  stopBackgroundLoops();

  io.close(() => {
    server.close(() => {
      process.exit(exitCode);
    });
  });
  // Force-exit if it hangs.
  setTimeout(() => process.exit(exitCode || 1), 10000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ---- Process-level safety nets ----------------------------------------------
// An unhandled REJECTION is usually benign here — most come from the
// fire-and-forget Supabase writes — so log it and carry on.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection (server kept alive):', reason);
});

// An uncaught EXCEPTION is different. This used to be swallowed to avoid
// disconnecting everyone, but after an uncaught throw the process state is
// undefined by definition: the game may keep running on a half-mutated
// gameState and silently persist corrupted balances/cosmetics for every player.
// Losing a few seconds is recoverable; corrupting saves is not.
//
// The client reconnects forever with backoff (public/js/game/socket.js), so a
// restart is a ~2s blip. connectionStateRecovery does not survive a process
// restart either way, so staying up buys nothing there.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception — restarting rather than continuing in an undefined state:', err);
  try {
    io.emit('server-restarting');
  } catch (_) { /* emitting is best-effort during a crash */ }
  shutdown('uncaughtException', 1);
  // Don't wait the full graceful window when we already know state is suspect.
  setTimeout(() => process.exit(1), 3000).unref();
});

// ---- Listen ------------------------------------------------------------------
// Bind failures are a STARTUP problem, not a corrupted-state problem: nothing
// has run yet, so the uncaughtException path above (which talks about undefined
// state and tries a graceful drain) is both wrong and confusing here. Handle
// them explicitly, say what to do about it, and exit.
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `\n✖ Port ${PORT} is already in use — another copy of this server is probably ` +
      `still running.\n` +
      `  Find it:  npx kill-port ${PORT}      (or: netstat -ano | findstr :${PORT})\n` +
      `  Or run on a different port:  PORT=3001 npm start\n`
    );
  } else if (err && err.code === 'EACCES') {
    console.error(`\n✖ Not allowed to bind port ${PORT}. Try a port above 1024.\n`);
  } else {
    console.error('✖ Server failed to start:', err);
  }
  process.exit(1);
});

server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
