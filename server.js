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

io.on('connection', (socket) => {
  const coins = [
      { x: 500, y: 480},
      { x: 0, y: 380},
      { x: 100, y:330},
      { x: 100, y:430},
      { x: 300, y:460},
      { x: 300, y:330},
      { x: 550, y:360},
      { x: 500, y:480},
      { x: 645, y:340},
      { x: 815, y:380},
      { x: 980, y:360},
      
    ];
  let index = Math.floor(Math.random() * (11- 1 + 1));
  io.emit("coin", coins[index]);

  players[socket.id] = { x: 100, y: 100, emote: "idle", score: 0 };
  socket.emit("init", players);
  socket.broadcast.emit("new-player", { id: socket.id, ...players[socket.id] });

  socket.on("coin_taken", (data) => {
    socket.broadcast.emit("coin_taken");
    setTimeout(() => {
    let index = Math.floor(Math.random() * (11- 1 + 1));
    io.emit("coin", coins[index]);
    }, 3000);
  })

//socket.emit("move", { x: player.x , y: player.y , image: img, frameCount: animations.frameCount, frameIndex: animations.currentFrame, frameRow:animations.frameRow, username:player.username, emote: "idle" });
  socket.on("move", (data) => {
    players[socket.id] = { 
      x: data.x,
      y: data.y,
      frameCount: data.frameCount,
      frameIndex: data.frameIndex,
      frameRow: data.frameRow,
      username: data.username,
      emote: data.emote,
      score: data.score

    };
    socket.broadcast.emit("player-move", { id: socket.id, ...players[socket.id] });
  });




  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("remove-player", socket.id);
  });
});

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
