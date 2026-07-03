const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// ---- Socket.IO server ----------------------------------------------------
const io = new Server(server, {
  cors: {
    origin: '*', // Adjust this as needed for security
    methods: ['GET', 'POST']
  },
  // Lets a client that has a brief network drop (mobile network blip, laptop
  // sleep, Render free-tier idling, etc.) rejoin with the SAME socket.id and
  // have any buffered events replayed, instead of being treated as a brand
  // new connection. Requires socket.io >= 4.6.0 on both server and client
  // (the client CDN script already pulls a recent version).
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
    skipMiddlewares: true,
  },
  // Guards against absurdly large payloads from a misbehaving/malicious client.
  maxHttpBufferSize: 1e5, // 100 KB
});

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Optional: Define a route for the root URL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
});

// Lightweight endpoint you can point an uptime monitor (e.g. UptimeRobot,
// cron-job.org — both have free tiers) at every 5-10 minutes. Render's free
// tier spins a service down after ~15 min with no traffic, and the first
// request after that takes 30-50s to wake back up. A periodic ping to this
// endpoint keeps the server warm so players don't hit that cold-start delay.
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', players: Object.keys(players).length, uptime: process.uptime() });
});

// ---- Game state ------------------------------------------------------------
let players = {};

// Matches the box layout in viewer.html / overlay.html. Keep these three in
// sync if you ever change the level.
const coins = [
  { x: 500, y: 480 },
  { x: 0, y: 380 },
  { x: 100, y: 330 },
  { x: 100, y: 430 },
  { x: 300, y: 460 },
  { x: 300, y: 330 },
  { x: 550, y: 360 },
  { x: 500, y: 480 },
  { x: 645, y: 340 },
  { x: 815, y: 380 },
  { x: 980, y: 360 },
];

function pickRandomCoin() {
  return coins[Math.floor(Math.random() * coins.length)];
}

// Single source of truth for the current coin, so a new player joining just
// gets told where it currently is instead of the server re-rolling a fresh
// coin (and moving it) for every already-playing client.
let currentCoin = pickRandomCoin();

const WORLD_WIDTH = 1000;
const WORLD_HEIGHT = 500;
const MAX_USERNAME_LENGTH = 20;

// Sockets that disconnected recently are kept around for a grace period
// before we actually remove them, so a quick reconnect doesn't flash a
// "player left" to everyone watching.
const DISCONNECT_GRACE_MS = 20000; // 20 seconds
const pendingRemoval = {};

// A player can only be told apart from garbage/attack traffic if we validate
// what comes in on "move" before trusting it.
function sanitizeMoveData(data) {
  if (!data || typeof data !== 'object') return null;

  const x = Number(data.x);
  const y = Number(data.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const username = typeof data.username === 'string'
    ? data.username.slice(0, MAX_USERNAME_LENGTH)
    : '';

  return {
    x: Math.min(Math.max(x, 0), WORLD_WIDTH),
    y: Math.min(Math.max(y, 0), WORLD_HEIGHT),
    frameCount: Number.isFinite(Number(data.frameCount)) ? Number(data.frameCount) : 0,
    frameIndex: Number.isFinite(Number(data.frameIndex)) ? Number(data.frameIndex) : 0,
    frameRow: Number.isFinite(Number(data.frameRow)) ? Number(data.frameRow) : 0,
    username,
    emote: typeof data.emote === 'string' ? data.emote : 'idle',
    score: Number.isFinite(Number(data.score)) ? Number(data.score) : 0,
  };
}

// Simple per-socket rate limit on "move" so a runaway client (buggy loop,
// or someone poking the socket directly) can't flood the server.
const MIN_MOVE_INTERVAL_MS = 15; // generous cap, well above normal ~60fps emit rate
const lastMoveAt = {};

io.on('connection', (socket) => {
  console.log(`[connect] ${socket.id} recovered=${socket.recovered}`);

  // If this connection was recovered, don't stomp on the player's existing
  // state (position/score) with a fresh default.
  if (!socket.recovered || !players[socket.id]) {
    players[socket.id] = { x: 100, y: 100, emote: 'idle', score: 0 };
  }

  // Cancel any pending removal for this id — they're back.
  if (pendingRemoval[socket.id]) {
    clearTimeout(pendingRemoval[socket.id]);
    delete pendingRemoval[socket.id];
  }

  socket.emit('init', players);
  socket.emit('coin', currentCoin);
  socket.broadcast.emit('new-player', { id: socket.id, ...players[socket.id] });

  socket.on('coin_taken', () => {
    try {
      if (currentCoin === null) return; // already taken by someone else
      currentCoin = null;
      socket.broadcast.emit('coin_taken');
      setTimeout(() => {
        currentCoin = pickRandomCoin();
        io.emit('coin', currentCoin);
      }, 3000);
    } catch (err) {
      console.error(`[coin_taken] error from ${socket.id}:`, err);
    }
  });

  socket.on('move', (data) => {
    try {
      const now = Date.now();
      if (lastMoveAt[socket.id] && now - lastMoveAt[socket.id] < MIN_MOVE_INTERVAL_MS) {
        return; // drop, too frequent
      }
      lastMoveAt[socket.id] = now;

      const clean = sanitizeMoveData(data);
      if (!clean) {
        console.warn(`[move] dropped malformed payload from ${socket.id}`);
        return;
      }

      players[socket.id] = clean;
      socket.broadcast.emit('player-move', { id: socket.id, ...clean });
    } catch (err) {
      console.error(`[move] error from ${socket.id}:`, err);
    }
  });

  socket.on('disconnect', (reason) => {
    console.log(`[disconnect] ${socket.id} (${reason})`);
    delete lastMoveAt[socket.id];

    // Don't remove immediately — give them a window to reconnect.
    pendingRemoval[socket.id] = setTimeout(() => {
      delete players[socket.id];
      delete pendingRemoval[socket.id];
      io.emit('remove-player', socket.id);
    }, DISCONNECT_GRACE_MS);
  });

  socket.on('error', (err) => {
    console.error(`[socket error] ${socket.id}:`, err);
  });
});

// ---- Process-level safety nets ---------------------------------------------
// Without these, one unexpected error anywhere can crash the whole process
// and disconnect every player at once. Log it and keep the server alive.
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
  // Force-exit if it hangs
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});