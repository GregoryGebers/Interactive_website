  //"https://interactive-website-9620.onrender.com/socket.io/socket.io.js"
  const socket = io("https://interactive-website-9620.onrender.com");
  const canvas = document.getElementById('overlay');
  const ctx = canvas.getContext('2d');
  const players = {};

  const now0 = () => performance.now();

  // Canvas fillText silently falls back to the default font until the
  // webfont is actually loaded — force-load it up front so the first chat
  // bubble doesn't render in Times New Roman.
  if (document.fonts && document.fonts.load) {
    document.fonts.load('8px "Press Start 2P"');
  }

  socket.on("init", data => {
    for (const id in players) delete players[id];
    for (const id in data) {
      const p = data[id];
      players[id] = { ...p, renderX: p.x, renderY: p.y, lastUpdateAt: now0() };
    }
  });
  socket.on("new-player", data => {
    players[data.id] = { ...data, renderX: data.x, renderY: data.y, lastUpdateAt: now0() };
  });
  socket.on("player-move", data => {
    const existing = players[data.id];
    if (existing) {
      // Merge into the SAME object so renderX/renderY (the smoothed display
      // position) and the local animation state below survive — this is what
      // lets the interpolation keep easing toward the new target instead of
      // snapping straight to it.
      const previousScore = Number(existing.score);
      const incomingScore = Number(data.score);
      Object.assign(existing, data);
      // Scores only go up during a session. This prevents a bad/stale packet
      // from briefly drawing the high score as 0 on the overlay.
      existing.score = Math.max(
        Number.isFinite(previousScore) ? previousScore : 0,
        Number.isFinite(incomingScore) ? incomingScore : 0
      );
      existing.lastUpdateAt = now0();
    } else {
      players[data.id] = { ...data, renderX: data.x, renderY: data.y, lastUpdateAt: now0() };
    }
  });
  socket.on("remove-player", id => delete players[id]);
