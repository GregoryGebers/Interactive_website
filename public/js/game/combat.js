    // ---- Bat swing -------------------------------------------------------
    // Space swings a bat from low-behind to high-forward in the direction
    // you're facing, on a 2 second cooldown. The server does the real hit
    // detection: anyone in the swing radius gets launched upward at 45
    // degrees with ~3/4 of a max jump's force. The client cooldown here is
    // just responsiveness — the server enforces its own copy, so editing
    // this number locally doesn't let anyone spam hits.
    const SWING_COOLDOWN_MS = 2000;
    const SWING_DURATION_MS = 250; // how long the visual swipe takes
    let lastSwingTriedAt = -Infinity;

    function trySwing() {
      const now = performance.now();
      if (now - lastSwingTriedAt < SWING_COOLDOWN_MS) return; // still cooling down
      lastSwingTriedAt = now;
      player.swingStartAt = now;
      socket.emit('swing', { dir: player.facing });
    }

    // Other players' swings arrive as an event (the server broadcasts them)
    // and animate locally, exactly like their run/idle sprites do.
    socket.on('player-swing', (data) => {
      if (!data || data.id === socket.id) return;
      const p = otherPlayers[data.id];
      if (!p) return;
      p.swingStartAt = performance.now();
      p.swingDir = Number(data.dir) === -1 ? -1 : 1;
    });

    // Server-confirmed successful hit. All game viewers receive this so the
    // struck slime can flash/emit particles. Only the two participants shake:
    // the victim gets the stronger directional impact, the attacker gets a
    // tiny confirmation kick. overlay.html intentionally ignores this event.
    socket.on('player-hit', (data) => {
      if (!data) return;
      const dir = Number(data.dir) === -1 ? -1 : 1;
      const tier = Math.max(0, Number(data.tier) || 0);
      const maxTier = Math.max(1, Number(data.maxTier) || 1);
      const targetId = String(data.targetId || '');
      const attackerId = String(data.attackerId || '');

      triggerHitVisuals(targetId, dir, tier, maxTier);
      if (targetId !== socket.id && otherPlayers[targetId]) {
        otherPlayers[targetId].hitStopUntil = performance.now() + HIT_STOP_SEC * 1000;
      }
      if (targetId === socket.id) {
        const strength = lerp(4, 8, Math.min(1, tier / maxTier));
        const duration = Math.round(lerp(120, 180, Math.min(1, tier / maxTier)));
        addCameraShake(strength, duration, dir, -0.3);
        lastHitVisualAt = performance.now();
      }
      if (attackerId === socket.id) {
        addCameraShake(2.5, 80, dir, 0.15);
      }
    });

    // YOU got hit. Hold the launch for a tiny hit-stop so the impact flash is
    // readable, then apply the server-authoritative knockback velocity.
    socket.on('knockback', (data) => {
      if (!data) return;
      const vx = Number(data.vx);
      const vy = Number(data.vy);
      if (!Number.isFinite(vx) || !Number.isFinite(vy)) return;

      const stunMs = Number(data.stunMs);
      const safeStunMs = Number.isFinite(stunMs) ? Math.max(0, Math.min(5000, stunMs)) : 500;
      const tier = Math.max(0, Number(data.tier) || 0);
      const maxTier = Math.max(1, Number(data.maxTier) || 1);
      const dir = Number(data.dir) === -1 ? -1 : (vx < 0 ? -1 : 1);

      // Compatibility fallback if this viewer is briefly paired with an older
      // server that doesn't emit player-hit yet.
      if (performance.now() - lastHitVisualAt > 120) {
        triggerHitVisuals(socket.id, dir, tier, maxTier);
        addCameraShake(lerp(4, 8, Math.min(1, tier / maxTier)), lerp(120, 180, Math.min(1, tier / maxTier)), dir, -0.3);
      }

      pendingKnockback = { vx, vy };
      hitStopTimer = Math.max(hitStopTimer, HIT_STOP_SEC);
      isDashing = false;
      controlLockTimer = Math.max(controlLockTimer, safeStunMs / 1000);
      clearCombatInputs();
    });

    // Draws one bat mid-swing, rotated around the character's center (the
    // grip). progress 0 -> bat low behind-forward, progress 1 -> pointing
    // up-forward: a bottom-to-top swipe on the facing side. scale(dir, 1)
    // mirrors the whole arc for left-facing swings.
    const BAT_DRAW_W = 9;
    const BAT_DRAW_H = 26;
    const SWING_START_ANGLE = 2.4;   // radians clockwise from straight-up (~137deg, low)
    const SWING_END_ANGLE = -0.35;   // slightly past vertical (~-20deg, high)

    function drawBatSwing(ctx, cx, cy, dir, progress) {
      if (!batImg.complete || !batImg.naturalWidth) return; // image not loaded yet
      const t = Math.min(Math.max(progress, 0), 1);
      // Ease-out so the swipe starts fast and finishes soft, like a real swing.
      const eased = 1 - (1 - t) * (1 - t);
      const angle = SWING_START_ANGLE + (SWING_END_ANGLE - SWING_START_ANGLE) * eased;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(dir, 1);
      ctx.rotate(angle);
      // Grip at the pivot, barrel extending "up" in local space.
      ctx.drawImage(batImg, -BAT_DRAW_W / 2, -BAT_DRAW_H, BAT_DRAW_W, BAT_DRAW_H);
      ctx.restore();
    }
