  // ---- Chat bubbles ----------------------------------------------------------
  // The server broadcasts already-filtered messages as {id, message}.
  // Attach the message to the matching player and let draw() render it as a
  // pixel speech bubble until it expires.
  const CHAT_DURATION_MS = 6000;

  socket.on('chat', data => {
    if (!data || typeof data.message !== 'string' || !data.message) return;
    const p = players[data.id];
    if (!p) return;
    p.chatMessage = data.message;
    p.chatExpiresAt = now0() + CHAT_DURATION_MS;
  });

  // ---- Bat swings --------------------------------------------------------
  // The server broadcasts 'player-swing' {id, dir} whenever someone presses
  // space in viewer.html. The overlay just plays the same 250ms bottom-to-
  // top swipe animation viewer.html uses, anchored to that player's sprite.
  // (The knockback itself needs no overlay logic — the launched player's
  // own client applies the velocity, and their normal position updates
  // carry the flight here like any other movement.)
  const SWING_DURATION_MS = 250;

  socket.on('player-swing', data => {
    if (!data) return;
    const p = players[data.id];
    if (!p) return;
    p.swingStartAt = now0();
    p.swingDir = Number(data.dir) === -1 ? -1 : 1;
  });

  const CHAT_FONT = '8px "Press Start 2P", monospace';
  const CHAT_LINE_HEIGHT = 12;
  const CHAT_PAD = 6;
  const CHAT_MAX_LINE_CHARS = 18;

  function wrapChatLines(text, maxChars) {
    const lines = [];
    let line = '';
    for (let word of text.split(' ')) {
      // Hard-break words longer than a whole line so they can't blow the
      // bubble out sideways.
      while (word.length > maxChars) {
        if (line) { lines.push(line); line = ''; }
        lines.push(word.slice(0, maxChars));
        word = word.slice(maxChars);
      }
      if (!word) continue;
      if (!line) {
        line = word;
      } else if (line.length + 1 + word.length <= maxChars) {
        line += ' ' + word;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  // Same pixel look as viewer.html: hard-edged box, offset shadow, blocky
  // stepped tail, no rounded corners or blur.
  function drawChatBubble(context, text, cx, bottomY) {
    const lines = wrapChatLines(text, CHAT_MAX_LINE_CHARS);
    context.font = CHAT_FONT;
    let maxW = 0;
    for (const l of lines) maxW = Math.max(maxW, context.measureText(l).width);
    const w = Math.ceil(maxW) + CHAT_PAD * 2;
    const h = lines.length * CHAT_LINE_HEIGHT + CHAT_PAD * 2 - 3;
    const x = Math.round(cx - w / 2);
    const y = Math.round(bottomY - h - 8); // leave room for the tail

    // Offset shadow, then body, then border.
    context.fillStyle = '#16241a';
    context.fillRect(x + 2, y + 2, w, h);
    context.fillStyle = '#f3f7ee';
    context.fillRect(x, y, w, h);
    context.lineWidth = 2;
    context.strokeStyle = '#16241a';
    context.strokeRect(x, y, w, h);

    // Pixel-step tail (two shrinking blocks) pointing at the character.
    context.fillStyle = '#16241a';
    context.fillRect(cx - 5, y + h, 10, 5);
    context.fillRect(cx - 3, y + h + 3, 6, 5);
    context.fillStyle = '#f3f7ee';
    context.fillRect(cx - 3, y + h - 1, 6, 4);
    context.fillRect(cx - 1, y + h + 3, 2, 3);

    context.fillStyle = '#16241a';
    context.textAlign = 'left';
    context.textBaseline = 'top';
    let ty = y + CHAT_PAD;
    for (const l of lines) {
      context.fillText(l, x + CHAT_PAD, ty);
      ty += CHAT_LINE_HEIGHT;
    }
  }

  const idleimg = new Image();
  idleimg.src = '/assets/characters/craftpix-net-879657-free-slime-mobs-pixel-art-top-down-sprite-pack/PNG/Slime1/Idle/Slime1_Idle_body.png';
  
  idleimg.onload = () => { if (typeof startOverlayLoop === "function") startOverlayLoop(); };

  const walkimg = new Image();
  walkimg.src = '/assets/characters/craftpix-net-879657-free-slime-mobs-pixel-art-top-down-sprite-pack/PNG/Slime1/Run/Slime1_Run_body.png';
  walkimg.onload = () => { if (typeof startOverlayLoop === "function") startOverlayLoop(); };
