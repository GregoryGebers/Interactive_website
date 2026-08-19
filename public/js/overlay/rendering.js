  function draw(currentTime) {
    const now = currentTime || performance.now();
    const deltaTime = Math.min((now - lastFrameTime) / 1000, 0.25); // clamp huge gaps (e.g. tab was backgrounded)
    lastFrameTime = now;

    updatePlayerInterpolation(deltaTime);
    updateSharedFx(deltaTime);
    if (typeof updateOverlayMobs === 'function') updateOverlayMobs(deltaTime);
    setObjects(); // leaves the world-scale transform active
    // Dash smoke, double-jump ring, landing dust and invisibility shimmer sit
    // behind sprites just like they do in viewer.html.
    drawFxSpritesOverlay();
    // Mobs render under the players, in the same scaled world space.
    if (typeof drawOverlayMobs === 'function') drawOverlayMobs(ctx);

    // ---- Pass 1: sprites, in scaled WORLD space ----
    let high_score = -1;
    let high_user = "";
    for (const id in players) {
      const p = players[id];
      // Guard against any malformed/incomplete entry (e.g. a stale server
      // version, or a mid-join race) ever hijacking the leaderboard display
      // with a blank name or bogus score.
      const validScore = typeof p.score === 'number' && Number.isFinite(p.score);
      const validName = typeof p.username === 'string' && p.username.length > 0;
      if (validScore && validName && p.score >= high_score) {
        high_score = p.score;
        high_user = p.username;
      }
      if (p.invisible) continue; // invisible players are hidden on the overlay too
      const anim = updatePlayerAnimation(p, deltaTime);
      const img = duckSprite(anim.clip, p.color, p.beakColor);
      const spriteScale = overlaySpriteScale(p, now0());
      // Duck faces RIGHT natively; flip for left. -27 y offset + feet pivot
      // seat the duck on the ground, matching viewer.html.
      const facingSign = (anim.facing === 1) ? 1 : -1;
      drawOverlaySpriteFrame(
        img, anim.frameIndex, 0,
        p.renderX - 20, p.renderY - 27,
        { whiteFlash: now0() < (p.hitFlashUntil || 0), scaleX: spriteScale.x * facingSign, scaleY: spriteScale.y, pivotY: 47 }
      );
    }

    // Attacks are a punch BODY pose (the 'punch' clip) now, not a separate bat
    // overlay, so there is nothing extra to draw here for swings.

    // Impact particles, max-tier shockwaves and coin pops sit over sprites
    // and weapons, but still in stable world space (no stream camera shake).
    drawWorldFxOverlay();

    // ---- Pass 2: text, in SCREEN space ----
    // Names and chat bubbles are drawn at scaled positions but full pixel
    // size — at WORLD_SCALE (0.64) a world-space 16px name would be ~10px
    // and bubble text ~5px, unreadable on stream.
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    for (const id in players) {
      const p = players[id];
      if (p.invisible) continue;
      ctx.font = '16px Arial';
      ctx.fillStyle = p.color || 'blue';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(p.username || '', (p.renderX + 10) * WORLD_SCALE, WORLD_OFFSET_Y + (p.renderY - 5) * WORLD_SCALE);
    }

    // Chat bubbles on top of every sprite/name, so they're never hidden
    // behind another player who happens to be standing in front.
    const nowMs = performance.now();
    for (const id in players) {
      const p = players[id];
      if (p.invisible) continue;
      if (p.chatMessage && nowMs < p.chatExpiresAt) {
        drawChatBubble(ctx, p.chatMessage, (p.renderX + 10) * WORLD_SCALE, WORLD_OFFSET_Y + (p.renderY - 22) * WORLD_SCALE);
      }
    }

    requestAnimationFrame(draw);
    if (high_user) {
      // Centered under the scaled world (which is WORLD_HEIGHT*WORLD_SCALE
      // pixels tall), instead of the old hardcoded spot tuned for the
      // unscaled 1000x500 layout.
      ctx.font = 'bold 20px Arial';
      ctx.fillStyle = 'white';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'black';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const hsX = canvas.width / 2;
      const hsY = WORLD_OFFSET_Y + WORLD_HEIGHT * WORLD_SCALE + 0;
      ctx.strokeText("High Score: " + high_user + " -- " + high_score, hsX, hsY);
      ctx.fillText("High Score: " + high_user + " -- " + high_score, hsX, hsY);
    }
  }

  function setObjects() {
    // Clear in raw pixel space, then switch into scaled world space so the
    // ENTIRE 3000-wide world maps onto the canvas — no cameraX here, the
    // overlay always shows everything.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(WORLD_SCALE, 0, 0, WORLD_SCALE, 0, WORLD_OFFSET_Y);

    for (let x = 0; x < WORLD_WIDTH; x += GROUND_TILE_WIDTH) {
      ctx.drawImage(grassImg, x, WORLD_HEIGHT - GROUND_GRASS_HEIGHT, GROUND_TILE_WIDTH, GROUND_GRASS_HEIGHT);
    }
    // Only decorations (props) are drawn. Hitboxes are invisible collision.
    for (const p of props) {
      const im = getPropImage(p.src);
      if (im.complete && im.naturalWidth) {
        ctx.drawImage(im, p.x, p.y, p.width, p.height);
      }
    }
    if (coin != null) {
        ctx.drawImage(coinImg, coin.x, coin.y, 20, 20);
      }
  }

  requestAnimationFrame(draw);
