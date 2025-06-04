const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow all origins (GitHub Pages, OBS, etc.)
    methods: ['GET', 'POST']
  }
});

// Serve static files from /public
app.use(express.static('public'));

let players = {};

// Handle socket connections
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  // Add new player
  players[socket.id] = { x: 100, y: 100, emote: 'idle' };

  // Send all current players to new client
  socket.emit('init', players);

  // Inform others about new player
  socket.broadcast.emit('new-player', { id: socket.id, ...players[socket.id] });

  // When player moves
  socket.on('move', (data) => {
    players[socket.id] = data;
    socket.broadcast.emit('player-move', { id: socket.id, ...data });
  });

  // When player disconnects
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    delete players[socket.id];
    io.emit('remove-player', socket.id);
  });
});

// Start server (use port from env or default to 3000)
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
