const express = require('express');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// Initialize Socket.IO with CORS settings
const io = new Server(server, {
  cors: {
    origin: '*', // Adjust this as needed for security
    methods: ['GET', 'POST']
  }
});

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Optional: Define a route for the root URL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'viewer.html'));
});

// Object to track connected players
let players = {};

// Handle Socket.IO connections
io.on('connection', (socket) => {
  console.log(`New client connected: ${socket.id}`);

  // Initialize new player
  players[socket.id] = { x: 100, y: 100, emote: 'idle' };

  // Send current players to the new client
  socket.emit('init', players);

  // Notify others about the new player
  socket.broadcast.emit('new-player', { id: socket.id, ...players[socket.id] });

  // Handle player movement
   socket.on("move", (data) => {
    players[socket.id] = { 
      x: data.x,
      y: data.y,
      frameCount: data.frameCount,
      frameIndex: data.frameIndex,
      frameRow: data.frameRow,
      username: data.username,
      emote: data.emote

    };
    socket.broadcast.emit("player-move", { id: socket.id, ...players[socket.id] });
  });

  // Handle client disconnection
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    delete players[socket.id];
    io.emit('remove-player', socket.id);
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
