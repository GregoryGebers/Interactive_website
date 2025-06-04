const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

let players = {};

io.on('connection', (socket) => {
  players[socket.id] = { x: 100, y: 100, emote: "idle" };

  socket.emit("init", players);
  socket.broadcast.emit("new-player", { id: socket.id, ...players[socket.id] });

  socket.on("move", (data) => {
    players[socket.id] = data;
    socket.broadcast.emit("player-move", { id: socket.id, ...data });
  });

  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("remove-player", socket.id);
  });
});

server.listen(3000, () => console.log("✅ Server running on http://localhost:3000"));