    const normKey = (key) => (key.length === 1 ? key.toLowerCase() : key);

    canvas.addEventListener('keydown', e => {
      const key = normKey(e.key);

      // P toggles the slime shop. While it's open, gameplay keys are swallowed
      // (Escape also closes it) so you can't run around behind the menu.
      if (key === 'p' && hasJoined && !chatOpen) { e.preventDefault(); toggleShop(); return; }
      if (shopOpen) { if (key === 'Escape') closeShop(); e.preventDefault(); return; }

      // T opens the chat composer. preventDefault so the "t" keystroke that
      // opened it doesn't also get typed into the freshly-focused input.
      if (key === 't' && hasJoined && !chatOpen) {
        e.preventDefault();
        openChat();
        return;
      }

      // Being hit temporarily disables gameplay controls. Menu/chat keys above
      // remain available, but movement, jump, dash, vanish and attack are ignored.
      if (controlLockTimer > 0) {
        if (RIGHT_KEYS.has(key) || LEFT_KEYS.has(key) || JUMP_KEYS.has(key) ||
            key === 'Shift' || key === 'Control' || key === ' ') e.preventDefault();
        return;
      }

      // Space swings the bat (2s cooldown, enforced in trySwing and again
      // server-side). preventDefault stops the browser's default
      // space-scrolls-the-page behavior.
      if (key === ' ' && hasJoined) {
        e.preventDefault();
        trySwing();
        return;
      }

      if (RIGHT_KEYS.has(key)) inputRight = true;
      if (LEFT_KEYS.has(key)) inputLeft = true;
      if (JUMP_KEYS.has(key)) {
        // Buffer only on the initial press, not on the OS key-repeat, so
        // holding jump doesn't auto-bounce the instant you land.
        if (!jumpHeld) jumpBufferTimer = JUMP_BUFFER;
        jumpHeld = true;
      }
      if (key === 'Shift') {
        if (!shiftHeld) tryDash(); // dash on the press, not on key-repeat
        shiftHeld = true;
      }
      if (key === 'Control') {
        if (!ctrlHeld) tryInvisible(); // vanish on the press, not on key-repeat
        ctrlHeld = true;
      }

      socket.emit("move", { x: player.x , y: player.y , frameCount: animations.frameCount, frameIndex: animations.currentFrame, frameRow:animations.frameRow, username:player.username, color:player.color, emote: player.action, skin: player.skin, invisible: player.invisible });
      draw();
    });

    canvas.addEventListener('keyup', e => {
      const key = normKey(e.key);
      if (RIGHT_KEYS.has(key)) inputRight = false;
      if (LEFT_KEYS.has(key)) inputLeft = false;

      if (JUMP_KEYS.has(key)) {
        jumpHeld = false;
        // Variable jump height: releasing while still rising cuts the rise, so
        // a tap is a small hop and holding gives the full jump.
        if (player.Yv < 0) player.Yv *= JUMP_CUT;
      }
      if (key === 'Shift') shiftHeld = false;
      if (key === 'Control') ctrlHeld = false;

      socket.emit("move", { x: player.x , y: player.y , frameCount: animations.frameCount, frameIndex: animations.currentFrame, frameRow:animations.frameRow, username:player.username, color:player.color, emote: player.action, skin: player.skin, invisible: player.invisible });
      draw();
    });

    requestAnimationFrame(gameLoop);
