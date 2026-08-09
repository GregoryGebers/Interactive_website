  let lastFrameTime = performance.now();

  function updatePlayerInterpolation(deltaTime) {
    const factor = 1 - Math.exp(-deltaTime / OTHER_PLAYER_SMOOTHING_TAU);
    for (const id in players) {
      const p = players[id];
      p.renderX += (p.x - p.renderX) * factor;
      p.renderY += (p.y - p.renderY) * factor;
    }
  }

  // The sprite's walk/idle cycle used to just play whatever frameIndex the
  // player's own browser tab last reported. When that tab is backgrounded
  // (viewer switches away, minimizes, etc.), browsers throttle its
  // requestAnimationFrame loop way down, so it stops sending fresh frames —
  // and the overlay, which keeps redrawing at full rate, just kept painting
  // that one stale frame forever, looking frozen.
  //
  // Fix: animate every player's sprite locally on a free-running timer here,
  // independent of the network. We only take "emote" (idle/run) and
  // "frameRow" (facing direction) from the network, and fall back to idle if
  // we haven't heard from them in a while (covers the edge case of someone
  // backgrounding their tab mid-run — otherwise they'd run in place forever).
  const FRAME_INTERVAL = 0.1; // seconds per animation frame, matches viewer.html
  const STALE_MS = 600; // no update in this long -> treat as idle

  function updatePlayerAnimation(p, deltaTime) {
    const stale = (performance.now() - (p.lastUpdateAt || 0)) > STALE_MS;
    const emote = stale ? 'idle' : (p.emote || 'idle');
    const frameCount = emote === 'run' ? 8 : 6;
    const frameRow = emote === 'run' ? (p.frameRow ?? 3) : 0;

    const visuallyFrozen = now0() < (p.hitStopUntil || 0);
    if (!visuallyFrozen) {
      p.localFrameTimer = (p.localFrameTimer || 0) + deltaTime;
      if (p.localFrameTimer >= FRAME_INTERVAL) {
        p.localFrameTimer -= FRAME_INTERVAL;
        p.localFrameIndex = ((p.localFrameIndex || 0) + 1) % frameCount;
      }
    }
    if (!(p.localFrameIndex < frameCount)) p.localFrameIndex = 0; // guard if frameCount just shrank

    return { emote, frameRow, frameIndex: p.localFrameIndex };
  }

  // ---- Bat swing rendering -------------------------------------------------
  // Identical animation math to viewer.html: the bat pivots around the
  // character's center (the grip), sweeping from low-forward to up-forward
  // with an ease-out, mirrored for left-facing swings. Drawn in WORLD space
  // (inside the scaled transform), so it shrinks with the sprites exactly
  // like everything else on the overlay.
  const BAT_DRAW_W = 9;
  const BAT_DRAW_H = 26;
  const SWING_START_ANGLE = 2.4;   // radians clockwise from straight-up (~137deg, low)
  const SWING_END_ANGLE = -0.35;   // slightly past vertical (~-20deg, high)

  function drawBatSwing(context, cx, cy, dir, progress) {
    if (!batImg.complete || !batImg.naturalWidth) return; // image not loaded yet
    const t = Math.min(Math.max(progress, 0), 1);
    // Ease-out so the swipe starts fast and finishes soft, like a real swing.
    const eased = 1 - (1 - t) * (1 - t);
    const angle = SWING_START_ANGLE + (SWING_END_ANGLE - SWING_START_ANGLE) * eased;
    context.save();
    context.translate(cx, cy);
    context.scale(dir, 1);
    context.rotate(angle);
    // Grip at the pivot, barrel extending "up" in local space.
    context.drawImage(batImg, -BAT_DRAW_W / 2, -BAT_DRAW_H, BAT_DRAW_W, BAT_DRAW_H);
    context.restore();
  }
