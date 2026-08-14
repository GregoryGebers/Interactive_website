    const normKey = (key) => (key.length === 1 ? key.toLowerCase() : key);

    canvas.addEventListener('keydown', e => {
      const key = normKey(e.key);

      // Shop toggle. While it's open, gameplay keys are swallowed (Escape also
      // closes it) so you can't run around behind the menu.
      if (bindingHasKey('shop', key) && hasJoined && !chatOpen) { e.preventDefault(); toggleShop(); return; }
      if (shopOpen) { if (key === 'Escape') closeShop(); e.preventDefault(); return; }

      // Chat composer. preventDefault so the keystroke that opened it doesn't
      // also get typed into the freshly-focused input.
      if (bindingHasKey('chat', key) && hasJoined && !chatOpen) {
        e.preventDefault();
        openChat();
        return;
      }

      // Being hit temporarily disables gameplay controls. Menu/chat keys above
      // remain available, but movement, jump, dash, vanish and attack are ignored.
      if (controlLockTimer > 0) {
        if (isGameplayKey(key)) e.preventDefault();
        return;
      }

      // Punch (ground only). ONE hit per press: the swing is emitted only on the
      // initial key-down, never on OS key-repeat, so holding can't string hits.
      if (bindingHasKey('punch', key) && hasJoined) {
        e.preventDefault();
        if (!spaceHeld) {
          punchHoldStartedAt = performance.now();
          if (player.onGround) trySwing();
        }
        spaceHeld = true;
        return;
      }

      if (bindingHasKey('moveRight', key)) inputRight = true;
      if (bindingHasKey('moveLeft', key)) inputLeft = true;
      if (bindingHasKey('jump', key)) {
        // Buffer only on the initial press, not on the OS key-repeat, so
        // holding jump doesn't auto-bounce the instant you land.
        if (!jumpHeld) jumpBufferTimer = JUMP_BUFFER;
        jumpHeld = true;
      }
      if (bindingHasKey('dash', key)) {
        if (!shiftHeld) tryDash(); // dash on the press, not on key-repeat
        shiftHeld = true;
      }
      if (bindingHasKey('vanish', key)) {
        if (!ctrlHeld) tryInvisible(); // vanish on the press, not on key-repeat
        ctrlHeld = true;
      }

      socket.emit("move", { x: player.x , y: player.y , frameCount: animations.frameCount, frameIndex: animations.currentFrame, frameRow:animations.frameRow, facing: player.facing, username:player.username, color:player.color, beakColor: player.beakColor, emote: player.action, skin: player.skin, invisible: player.invisible });
      draw();
    });

    canvas.addEventListener('keyup', e => {
      const key = normKey(e.key);
      if (bindingHasKey('moveRight', key)) inputRight = false;
      if (bindingHasKey('moveLeft', key)) inputLeft = false;

      if (bindingHasKey('jump', key)) {
        jumpHeld = false;
        // Variable jump height: releasing while still rising cuts the rise, so
        // a tap is a small hop and holding gives the full jump.
        if (player.Yv < 0) player.Yv *= JUMP_CUT;
      }
      if (bindingHasKey('dash', key)) shiftHeld = false;
      if (bindingHasKey('vanish', key)) ctrlHeld = false;
      if (bindingHasKey('punch', key)) spaceHeld = false;

      socket.emit("move", { x: player.x , y: player.y , frameCount: animations.frameCount, frameIndex: animations.currentFrame, frameRow:animations.frameRow, facing: player.facing, username:player.username, color:player.color, beakColor: player.beakColor, emote: player.action, skin: player.skin, invisible: player.invisible });
      draw();
    });

    requestAnimationFrame(gameLoop);
