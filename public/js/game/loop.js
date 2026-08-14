    // ---- Pixel speech bubble rendering (canvas, world space) ----
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

    // Hard-edged box + offset shadow + blocky stepped tail: same visual
    // language as the login panel and HUD chip, no rounded corners, no blur.
    function drawChatBubble(ctx, text, cx, bottomY) {
      const lines = wrapChatLines(text, CHAT_MAX_LINE_CHARS);
      ctx.font = CHAT_FONT;
      let maxW = 0;
      for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
      const w = Math.ceil(maxW) + CHAT_PAD * 2;
      const h = lines.length * CHAT_LINE_HEIGHT + CHAT_PAD * 2 - 3;
      const x = Math.round(cx - w / 2);
      const y = Math.round(bottomY - h - 8); // leave room for the tail

      // Offset shadow, then body, then border.
      ctx.fillStyle = '#16241a';
      ctx.fillRect(x + 2, y + 2, w, h);
      ctx.fillStyle = '#f3f7ee';
      ctx.fillRect(x, y, w, h);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#16241a';
      ctx.strokeRect(x, y, w, h);

      // Pixel-step tail (two shrinking blocks) pointing at the character.
      ctx.fillStyle = '#16241a';
      ctx.fillRect(cx - 5, y + h, 10, 5);
      ctx.fillRect(cx - 3, y + h + 3, 6, 5);
      ctx.fillStyle = '#f3f7ee';
      ctx.fillRect(cx - 3, y + h - 1, 6, 4);
      ctx.fillRect(cx - 1, y + h + 3, 2, 3);

      ctx.fillStyle = '#16241a';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      let ty = y + CHAT_PAD;
      for (const l of lines) {
        ctx.fillText(l, x + CHAT_PAD, ty);
        ty += CHAT_LINE_HEIGHT;
      }
    }

    // The server removes characters that haven't actually moved (or chatted)
    // in a while, so idle slimes don't clutter the stream/overlay. When that
    // happens to US, bring the join screen back with a note — one click on
    // GO re-joins with the same name and color.
    socket.on('afk-removed', () => {
      hasJoined = false;
      if (chatOpen) closeChat();
      player.chatMessage = null;
      const overlay = document.getElementById('loginOverlay');
      const msg = document.getElementById('loginMessage');
      msg.textContent = 'Removed after 2 minutes of inactivity — jump back in!';
      msg.style.display = 'block';
      overlay.style.display = 'flex';
    });

    // Only sent once a username has actually been chosen — this is what the
    // server uses to decide whether a socket should get a visible character
    // at all, so a spectator-only connection (like overlay.html) never spawns
    // a ghost player just by connecting.
    let hasJoined = false;
    function sendJoin() {
      if (!hasJoined) return;
      // Coins/inventory/upgrades/equipped skin come from the signed server
      // cookie; the browser only supplies presentation identity.
      socket.emit('join', { username: player.username, color: player.color, beakColor: player.beakColor });
    }
    // Re-join automatically after a reconnect (fires on first connect too,
    // when it's a harmless no-op since hasJoined is still false then).
    socket.on('connect', sendJoin);

    let lastTime = performance.now();

    // Enter the world with a chosen identity, hide the login overlay and hand
    // focus back to the canvas. Exposed on window so the account/guest login UI
    // (auth.js) can start play from any of its buttons — guest GO, or the
    // signed-in PLAY button that reuses the account's saved name and color.
    function beginPlay(name, color, beakColor) {
      player.username = (name && String(name).trim()) || 'Player1';
      player.color = color || '#1e3fff';
      if (beakColor) player.beakColor = beakColor;
      hasJoined = true;
      sendJoin();
      document.getElementById('loginMessage').style.display = 'none';
      document.getElementById('loginOverlay').style.display = 'none';
      canvas.focus(); // Return focus to canvas for key events
    }
    window.beginPlay = beginPlay;

    usernameprompt();
    function usernameprompt(){
      const input = document.getElementById('usernameInput');
      const button = document.getElementById('usernameBtn');
      const colorInput = document.getElementById('usernameColor');
      const beakInput = document.getElementById('usernameBeakColor');

      button.addEventListener('click', () => {
        beginPlay(
          input.value.trim() || 'Player1',
          colorInput.value || '#1e3fff',
          beakInput ? beakInput.value : undefined
        );
      });
    }

    function gameLoop(currentTime) {
      const deltaTime = (currentTime - lastTime)/1000;
      lastTime = currentTime;

      update(deltaTime);
      draw();

      requestAnimationFrame(gameLoop);
    }


    // draw() runs every animation frame (~60/sec). Broadcasting "move" that
    // often per player adds up fast with several people connected. Capping
    // it to ~30/sec is still smooth and roughly halves the socket traffic.
    let lastMoveEmit = 0;
    const MOVE_EMIT_INTERVAL_MS = 33;
    let coin = null;
    socket.on("coin", data => {
      coin = data;
      if (data) console.log("Coin received:", data.x, data.y);
    });
    socket.on("coin_taken", () => {
      coin = null;
    });
    function update(deltaTime) {

      // Controller input (if enabled) is translated into synthetic key events
      // before we read the input flags below.
      if (typeof pollGamepad === 'function') pollGamepad();

      updateOtherPlayersInterpolation(deltaTime);
      updateOtherPlayersAnimation(deltaTime);
      updateVisualEffects(deltaTime);

      // Freeze only the local player's animation/physics for the tiny hit-stop.
      // Other players and particles keep animating, which makes the pause read
      // as impact rather than a browser hitch.
      if (hitStopTimer > 0) {
        hitStopTimer = Math.max(0, hitStopTimer - deltaTime);
        clearCombatInputs();
        if (hitStopTimer <= 0) applyPendingKnockback();
        updatePlayerCamera(deltaTime);
        return;
      }

      // Advance the local duck animation (per-clip fps; loops or clamps by clip).
      tickPlayerAnim(deltaTime);

      // ---- Hit-stun / movement (uses last frame's onGround result) ----
      if (controlLockTimer > 0) {
        controlLockTimer = Math.max(0, controlLockTimer - deltaTime);
        clearCombatInputs();
      }
      const controlsEnabled = controlLockTimer <= 0;
      // Punch pose / movement lock. The HIT itself is emitted once per key-press
      // (input.js); this only governs the visual pose and the root-in-place.
      // Holding Space (ground only) keeps refreshing the pose up to PUNCH_MAX_MS;
      // the pose — and the movement lock — linger SWING_DURATION_MS after each
      // press/refresh, so even a single tap roots you for its punch.
      const nowPunch = performance.now();
      const holdingPunch = spaceHeld && controlsEnabled && player.onGround &&
        (nowPunch - punchHoldStartedAt) < PUNCH_MAX_MS;
      if (holdingPunch) player.swingStartAt = nowPunch;
      const punchPoseActive = player.onGround && (nowPunch - (player.swingStartAt || 0)) < SWING_DURATION_MS;
      const moveDir = (controlsEnabled && !punchPoseActive) ? ((inputRight ? 1 : 0) - (inputLeft ? 1 : 0)) : 0;
      const grounded = player.onGround;

      // Coyote time, dash refresh, and mid-air jumps all reset while we still
      // hold the grounded flag; tick the buffer/cooldown timers down.
      if (grounded) { coyoteTimer = COYOTE_TIME; canDash = true; airJumps = upgrades.doubleJump ? 1 : 0; }
      else { coyoteTimer = Math.max(0, coyoteTimer - deltaTime); }
      if (jumpBufferTimer > 0) jumpBufferTimer -= deltaTime;
      if (dashCooldownTimer > 0) dashCooldownTimer -= deltaTime;

      if (isDashing) {
        // A dash is a short, fixed-speed horizontal burst; it holds top speed
        // then eases back to normal running speed when it ends.
        dashTimer -= deltaTime;
        player.Xv = dashDir * dashSpeed();
        if (dashTimer <= 0) { isDashing = false; player.Xv = dashDir * MOVE_SPEED; }
      } else if (moveDir !== 0) {
        // Accelerate toward the target speed (works on the ground AND in air).
        const accel = (grounded ? ACCEL_GROUND : ACCEL_AIR) * deltaTime;
        const target = moveDir * MOVE_SPEED;
        if (player.Xv < target) player.Xv = Math.min(target, player.Xv + accel);
        else if (player.Xv > target) player.Xv = Math.max(target, player.Xv - accel);
      } else {
        // No input: strong friction on the ground, light drag in the air.
        const decel = (grounded ? FRICTION_GROUND : AIR_DRAG) * deltaTime;
        if (player.Xv > 0) player.Xv = Math.max(0, player.Xv - decel);
        else if (player.Xv < 0) player.Xv = Math.min(0, player.Xv + decel);
      }

      // Punching hard-stops horizontal motion (and cancels any dash) so you're
      // rooted in place while throwing punches.
      if (punchPoseActive) { player.Xv = 0; isDashing = false; }

      // ---- Jump: immediate press-to-jump, gated by coyote time + buffer.
      // With the double-jump upgrade, a second press in mid-air jumps again. ----
      if (controlsEnabled && !isDashing && jumpBufferTimer > 0) {
        if (coyoteTimer > 0) {
          player.Yv = -jumpVelocity();
          player.onGround = false;
          coyoteTimer = 0;
          jumpBufferTimer = 0;
          triggerJumpFx(false);
        } else if (airJumps > 0) {
          player.Yv = -jumpVelocity();
          airJumps--;
          jumpBufferTimer = 0;
          triggerJumpFx(true);
        }
      }

      // ---- Facing from actual horizontal motion (idle keeps last facing) ----
      if (Math.abs(player.Xv) > 12) {
        player.facing = player.Xv > 0 ? 1 : -1;
      }
      // ---- Pick the duck animation clip from live game state ----
      updatePlayerClip();

      // ---- Invisibility: count down, and break the instant you move ----
      if (invisCooldown > 0) invisCooldown = Math.max(0, invisCooldown - deltaTime);
      if (player.invisible) {
        invisTimer -= deltaTime;
        const movedOrTried = inputLeft || inputRight || jumpHeld || isDashing ||
          Math.abs(player.Xv) > 3 || !player.onGround;
        if (invisTimer <= 0 || movedOrTried) endInvisible();
      }

      // =====================================================================
      // Collision, rewritten to be clip-proof. The old code checked all four
      // sides of a box in one pass and, on side hits, only ever adjusted
      // VELOCITY — never position. Push into a box for a couple of frames
      // (or clip a corner during a fast fall) and you could end a frame
      // genuinely inside it, where none of the side checks made sense any
      // more, and you'd slide through.
      //
      // New approach, the standard platformer fix:
      //   1. Move ONE AXIS AT A TIME (X fully resolved, then Y).
      //   2. Detect hits by SWEPT checks — "was I on this side of the face
      //      before the move, and past it after?" — which can't tunnel at
      //      high speed the way pure overlap checks can.
      //   3. On a hit, CLAMP POSITION to the face that was crossed, so a
      //      frame can never end inside a box.
      //   4. Keep a depenetration fallback that pushes out through the
      //      nearest face if some weird prior state left us overlapping.
      // =====================================================================

      // ---- X axis: integrate, then resolve against box left/right faces ----
      const prevX = player.x;
      player.x += player.Xv * deltaTime;

      // `player.x` is the sprite/physics anchor. The actual horizontal
      // collision rectangle is shifted slightly right so its visible left and
      // right contacts line up evenly with the slime art.
      const hitboxLeftAt = (x) => x + PLAYER_HITBOX_OFFSET_X;
      const hitboxRightAt = (x) => x + PLAYER_HITBOX_OFFSET_X + player.width;

      // Resolving against one box can push you into an adjacent one that
      // the loop already passed, so repeat a few times until stable.
      for (let resolvePass = 0; resolvePass < 3; resolvePass++) {
        let movedX = false;
        for (const box of boxes) {
          // Standing exactly on top (y+height === box.y) is NOT vertical
          // overlap, so walking across adjacent platform seams does not snag.
          const verticalOverlap =
            player.y + player.height > box.y &&
            player.y < box.y + box.height;
          if (!verticalOverlap) continue;

          const nowLeft = hitboxLeftAt(player.x);
          const nowRight = hitboxRightAt(player.x);
          const nowIntersectsX =
            nowRight > box.x &&
            nowLeft < box.x + box.width;
          if (!nowIntersectsX) continue;

          const prevLeft = hitboxLeftAt(prevX);
          const prevRight = hitboxRightAt(prevX);
          const wasLeftOf = prevRight <= box.x;
          const wasRightOf = prevLeft >= box.x + box.width;

          if (wasLeftOf) {
            // Hit the box while moving right. Clamp the HITBOX right edge
            // exactly to the box's left edge. No rebound: rebound velocity was
            // creating a visible post-collision gap.
            player.x = box.x - PLAYER_HITBOX_OFFSET_X - player.width;
            player.Xv = 0;
          } else if (wasRightOf) {
            // Hit the box while moving left. Clamp the HITBOX left edge
            // exactly to the box's right edge.
            player.x = box.x + box.width - PLAYER_HITBOX_OFFSET_X;
            player.Xv = 0;
          } else {
            // Already overlapping from a prior correction: leave through the
            // nearest horizontal face, using the shifted hitbox edges.
            const left = hitboxLeftAt(player.x);
            const right = hitboxRightAt(player.x);
            const pushLeft = right - box.x;
            const pushRight = (box.x + box.width) - left;
            if (pushLeft <= pushRight) {
              player.x = box.x - PLAYER_HITBOX_OFFSET_X - player.width;
            } else {
              player.x = box.x + box.width - PLAYER_HITBOX_OFFSET_X;
            }
            player.Xv = 0;
          }
          movedX = true;
        }
        if (!movedX) break;
      }

      // World bounds use the same shifted collision rectangle.
      if (hitboxLeftAt(player.x) <= 0) {
        player.x = -PLAYER_HITBOX_OFFSET_X;
        player.Xv = 0;
      } else if (hitboxRightAt(player.x) >= WORLD_WIDTH) {
        player.x = WORLD_WIDTH - PLAYER_HITBOX_OFFSET_X - player.width;
        player.Xv = 0;
      }

      // ---- Y axis: integrate gravity, then resolve tops/undersides ----
      const prevY = player.y;
      if (isDashing) {
        player.Yv = 0; // vertical is frozen for the dash's duration
      } else if (!player.onGround) {
        // Asymmetric gravity — floaty on the rise, snappier on the fall — is
        // the core of the Mario/Hollow-Knight arc. A jump released early is
        // cut short in keyup, which shortens the rise here.
        player.Yv += (player.Yv < 0 ? GRAVITY_UP : GRAVITY_DOWN) * deltaTime;
        if (player.Yv > MAX_FALL) player.Yv = MAX_FALL;
      }
      const downwardImpactSpeed = Math.max(0, player.Yv);
      player.y += player.Yv*deltaTime;

      player.onGround = false; // recomputed below from actual contacts

      for (let resolvePass = 0; resolvePass < 3; resolvePass++) {
        let movedY = false;
        for (const box of boxes) {
          const horizontalOverlap =
            player.x + PLAYER_HITBOX_OFFSET_X + player.width > box.x &&
            player.x + PLAYER_HITBOX_OFFSET_X < box.x + box.width;
          if (!horizontalOverlap) continue;

          const wasAbove = prevY + player.height <= box.y;
          const wasBelow = prevY >= box.y + box.height;

          if (player.Yv >= 0 && wasAbove && player.y + player.height >= box.y) {
            // Landed on top. Swept: we were above the top face and are now at
            // or past it — even if a fast fall carried us clear past the whole
            // box in one frame, this still catches it (no tunneling). The >=
            // comparisons also hold true while standing still, which is what
            // keeps a stationary player grounded frame after frame.
            if (player.y !== box.y - player.height) movedY = true;
            player.y = box.y - player.height;
            player.Yv = 0;
            player.onGround = true;
          } else if (player.Yv < 0 && wasBelow && player.y < box.y + box.height) {
            // Bonked the underside mid-jump.
            player.y = box.y + box.height;
            player.Yv = 10;
            movedY = true;
          } else if (
            player.y + player.height > box.y &&
            player.y < box.y + box.height
          ) {
            // Depenetration fallback for ANY leftover intersection the swept
            // branches didn't claim. This genuinely happens: bonking the
            // underside of one box can clamp you into a diagonally adjacent
            // box whose "was I above/below it?" answers don't match either
            // swept branch. Exit via the nearest face; on a tie, exit in the
            // direction you're already moving so the correction doesn't
            // fight the motion.
            const pushUp = (player.y + player.height) - box.y;
            const pushDown = (box.y + box.height) - player.y;
            const preferUp = pushUp < pushDown || (pushUp === pushDown && player.Yv <= 0);
            if (preferUp) {
              player.y = box.y - player.height;
              if (player.Yv > 0) player.Yv = 0;
              player.onGround = true;
            } else {
              player.y = box.y + box.height;
              if (player.Yv < 0) player.Yv = 10;
            }
            movedY = true;
          }
        }
        if (!movedY) break;
      }

      // World floor.
      if (player.y + player.height >= WORLD_HEIGHT) {
        player.y = WORLD_HEIGHT - player.height;
        player.Yv = 0;
        player.onGround = true;
      }

      // Landing edge (any touchdown) briefly plays the duck's land clip.
      if (!grounded && player.onGround) {
        landClipUntil = performance.now() + LAND_CLIP_MS;
      }
      // Only significant airborne impacts get the landing treatment; ordinary
      // hops stay quiet so the effect doesn't become visual noise.
      if (!grounded && player.onGround && downwardImpactSpeed >= BIG_LAND_MIN_SPEED) {
        triggerBigLanding(downwardImpactSpeed);
      }

      // ---- Dynamic player camera ------------------------------------------
      // Blend between base zoom and the active rectangular scene zone.
      updatePlayerCamera(deltaTime);

      // ---- Coin pickup (position is final for this frame at this point) ----
      if (coin != null) {
        const hitboxLeft = player.x + PLAYER_HITBOX_OFFSET_X;
        const hitboxRight = hitboxLeft + player.width;
        let coin_touching = 
          hitboxLeft < coin.x + 10 &&
          hitboxRight > coin.x &&
          player.y < coin.y + 10 &&
          player.y + player.height > coin.y

        if (coin_touching) {
          console.log("recieved a coin");
          triggerCoinPickupFx(coin.x, coin.y);
          coin = null;
          // Server owns the balance and replies with `player_state`.
          socket.emit("coin_taken");
        }
      }
    }

    let GROUND_GRASS_HEIGHT = 14;
    let GROUND_TILE_WIDTH = 40;
