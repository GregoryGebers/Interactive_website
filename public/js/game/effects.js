    // ---- Game-feel / juice effects ----------------------------------------
    // Visual effects are shared through the server so other players and the
    // stream overlay can see them too. Camera shake remains deliberately local
    // to this browser so one player's impact never shakes everybody's screen.
    const fxParticles = [];
    const fxRings = [];
    // Animated sprite effects (dash smoke, double-jump ring, landing dust,
    // invisibility flash). Each entry is a short-lived sprite sequence — see
    // spawnFxSprite() below and drawFxSprites() in the render pass.
    const fxSprites = [];
    const cameraShakes = [];
    let coinPickupFx = null;
    let hudCoinPulseUntil = 0;
    let localHitFlashUntil = 0;
    let localHitSquashUntil = 0;
    let landingSquashStartedAt = 0;
    let jumpStretchStartedAt = 0;
    let hitStopTimer = 0;
    let pendingKnockback = null;
    let lastHitVisualAt = -Infinity;

    // ---- Sprite-based effect assets ----
    // Each effect is either a list of individual PNG frames or a single
    // horizontal sprite sheet. `frames` are Image objects preloaded here; the
    // draw pass just picks one by elapsed/duration ratio. Dimensions match the
    // actual assets under public/assets/effects/*.
    function loadFrames(paths) {
      return paths.map(src => { const im = new Image(); im.src = src; return im; });
    }
    const EFFECT_DASH = {
      // Horisontal_smoke1..12 — tuned to 100x100, aligned behind the dash.
      frames: loadFrames(Array.from({length:12}, (_,i)=>`/assets/effects/Horisontal_smoke/Horisontal_smoke${i+1}.png`)),
      w: 100, h: 100, duration: 0.26,
    };
    const EFFECT_DOUBLE_JUMP = {
      // Smoke_ring1_1..7 — 64x64 expanding ring at the player's feet.
      frames: loadFrames(Array.from({length:7}, (_,i)=>`/assets/effects/Smoke_ring1/Smoke_ring1_${i+1}.png`)),
      w: 64, h: 64, duration: 0.30,
    };
    const EFFECT_LAND = {
      // Falling_smoke6..16 (odd numbering, but that's the shipped set) —
      // Tuned to 117x48 wide dust plume for a hard landing.
      frames: loadFrames(Array.from({length:11}, (_,i)=>`/assets/effects/Falling_smoke/Falling_smoke${i+6}.png`)),
      w: 117, h: 48, duration: 0.35,
    };
    const EFFECT_INVIS = {
      // Single 576x72 sprite sheet -> 8 frames of 72x72. Drawn from a source
      // rect (see drawFxSprites) rather than one image per frame.
      sheet: (() => { const im = new Image(); im.src = '/assets/effects/invisibility/9.png'; return im; })(),
      cols: 8, w: 72, h: 72, duration: 0.5,
    };

    const HIT_STOP_SEC = 0.065;
    const BIG_LAND_MIN_SPEED = 360;
    const BIG_LAND_MAX_SPEED = 760;

    function rand(min, max) { return min + Math.random() * (max - min); }
    function lerp(a, b, t) { return a + (b - a) * Math.max(0, Math.min(1, t)); }

    function addCameraShake(strength, durationMs, dirX = 0, dirY = 0) {
      const s = Math.max(0, Number(strength) || 0);
      if (!s) return;
      cameraShakes.push({
        start: performance.now(),
        duration: Math.max(1, Number(durationMs) || 1),
        strength: s,
        dirX: Math.max(-1, Math.min(1, Number(dirX) || 0)),
        dirY: Math.max(-1, Math.min(1, Number(dirY) || 0)),
        phase: Math.random() * Math.PI * 2,
      });
    }

    function cameraShakeOffset(now = performance.now()) {
      let x = 0, y = 0;
      for (let i = cameraShakes.length - 1; i >= 0; i--) {
        const s = cameraShakes[i];
        const t = (now - s.start) / s.duration;
        if (t >= 1) { cameraShakes.splice(i, 1); continue; }
        const decay = 1 - Math.max(0, t);
        const waveA = Math.sin(s.phase + t * Math.PI * 9);
        const waveB = Math.cos(s.phase * 0.7 + t * Math.PI * 11);
        // About 55% of the impulse follows the requested direction; the rest
        // is a decaying oscillation so it reads as impact rather than a pan.
        x += s.strength * decay * (s.dirX * 0.55 + waveA * 0.45);
        y += s.strength * decay * (s.dirY * 0.55 + waveB * 0.45);
      }
      return { x, y };
    }

    function pushParticle(p) {
      p.life = Number(p.life) || 0.2;
      p.maxLife = p.life;
      fxParticles.push(p);
    }

    // Spawn one animated sprite effect. `effect` is one of the EFFECT_* defs
    // above. Position (x, y) is the TOP-LEFT of the drawn frame in world space;
    // callers use the helpers below (which center on the player) rather than
    // computing this raw. `flipX` mirrors the frame (for direction-aware puffs
    // like dash smoke).
    function spawnFxSprite(effect, x, y, opts = {}) {
      fxSprites.push({
        effect, x, y,
        flipX: !!opts.flipX,
        flipY: !!opts.flipY,
        elapsed: 0,
        duration: Number(opts.duration) || effect.duration || 0.3,
      });
    }

    // Tell the server about a visual-only action. The server validates and
    // rate-limits these before broadcasting them to everyone ELSE. We render
    // our own effect immediately for responsiveness, so the sender is excluded
    // from the rebroadcast and never sees a duplicate.
    function emitSharedFx(type, extra = {}) {
      if (!socket.connected || !hasJoined) return;
      socket.emit('player-fx', { type, x: player.x, y: player.y, ...extra });
    }

    function spawnImpactParticles(x, y, dir, tier = 0, maxTier = 3) {
      const count = Math.round(lerp(3, 6, maxTier > 0 ? tier / maxTier : 0));
      for (let i = 0; i < count; i++) {
        pushParticle({
          type: 'square', x: x + rand(-4, 4), y: y + rand(-6, 6),
          // Fly mostly opposite the direction the victim is launched.
          vx: -dir * rand(85, 155) + rand(-24, 24), vy: rand(-105, 45), gravity: 210,
          size: rand(2.5, 5.5), color: i % 3 === 0 ? '#ffc145' : '#f3f7ee', life: rand(0.18, 0.3),
        });
      }
    }

    function spawnRing(x, y, startRadius, endRadius, life, color = '#f3f7ee', lineWidth = 2) {
      fxRings.push({ x, y, startRadius, endRadius, life, maxLife: life, color, lineWidth });
    }

    // ---- Sprite-effect spawns (position centered on player) ----------------
    // Each of these places one animated sprite effect where it makes sense for
    // the action. The old ad-hoc particle bursts / speed lines / afterimages
    // for dash / jump / landing are gone — these sprite animations replace them.
    function triggerJumpFx(doubleJump) {
      jumpStretchStartedAt = performance.now();
      if (doubleJump) {
        // Expanding smoke ring at the player's feet on the second jump.
        const cx = player.x + player.width / 2, feet = player.y + player.height;
        spawnFxSprite(EFFECT_DOUBLE_JUMP,
          cx - EFFECT_DOUBLE_JUMP.w / 2,
          feet - EFFECT_DOUBLE_JUMP.h / 2);
        emitSharedFx('double-jump');
      } else {
        // Regular jump has only the squash/stretch, but that visual is shared
        // too so other players see the same motion language.
        emitSharedFx('jump');
      }
    }

    function triggerDashFx() {
      // Horizontal smoke puff BEHIND the dash direction, centered on the
      // player. Flip so the smoke tail points back the way you came.
      const cx = player.x + player.width / 2, cy = player.y + player.height / 2;
      spawnFxSprite(EFFECT_DASH,
        cx - EFFECT_DASH.w / 2 - dashDir * 18,
        cy - EFFECT_DASH.h / 2,
        { flipX: dashDir > 0 });
      emitSharedFx('dash', { dir: dashDir });
      // Shake is LOCAL ONLY. It is intentionally never sent over the socket.
      addCameraShake(1.5, 90, dashDir, 0);
    }

    function triggerBigLanding(speed) {
      const t = Math.max(0, Math.min(1, (speed - BIG_LAND_MIN_SPEED) / (BIG_LAND_MAX_SPEED - BIG_LAND_MIN_SPEED)));
      addCameraShake(lerp(2, 4, t), 100, 0, 1);
      // Wide dust plume at the feet, flipped vertically and nudged up a touch
      // so it reads as dust kicking up from the ground rather than falling.
      const cx = player.x + player.width / 2, feet = player.y + player.height;
      spawnFxSprite(EFFECT_LAND,
        cx - EFFECT_LAND.w / 2,
        feet - EFFECT_LAND.h + 0,
        { flipY: false });
      landingSquashStartedAt = performance.now();
      emitSharedFx('land', { speed });
    }

    function triggerInvisibilityFx(phase = 'toggle') {
      // Brief shimmer centered on the player when vanishing/reappearing.
      const cx = player.x + player.width / 2, cy = player.y + player.height / 2;
      spawnFxSprite(EFFECT_INVIS,
        cx - EFFECT_INVIS.w / 2 + 5,
        cy - EFFECT_INVIS.h + 10);
      emitSharedFx('invisibility', { phase });
    }

    function triggerCoinPickupFx(x, y, pulseHud = true) {
      coinPickupFx = { x, y, start: performance.now(), duration: 120 };
      if (pulseHud) hudCoinPulseUntil = performance.now() + 190;
      for (let i = 0; i < 4; i++) {
        pushParticle({ type:'square', x:x + 10, y:y + 10, vx:rand(-70,70), vy:rand(-115,-45), gravity:250,
          size:rand(2.5,4.5), color:'#ffc145', life:rand(.2,.32) });
      }
      // One tiny white sparkle gives the pickup a crisp final glint.
      pushParticle({ type:'spark', x:x + 10, y:y + 6, vx:0, vy:-18, gravity:0, size:6, color:'#fff7cf', life:.16 });
    }

    function triggerHitVisuals(targetId, dir, tier, maxTier) {
      const now = performance.now();
      const isLocalTarget = targetId === socket.id;
      const target = isLocalTarget ? player : otherPlayers[targetId];
      if (!target) return;
      const tx = (isLocalTarget ? target.x : (target.renderX ?? target.x)) + 10;
      const ty = (isLocalTarget ? target.y : (target.renderY ?? target.y)) + 10;
      const safeMax = Math.max(1, Number(maxTier) || 1);
      const safeTier = Math.max(0, Math.min(safeMax, Number(tier) || 0));

      spawnImpactParticles(tx, ty, dir, safeTier, safeMax);
      if (isLocalTarget) localHitFlashUntil = now + 90;
      else target.hitFlashUntil = now + 90;

      if (safeTier >= safeMax) {
        spawnRing(tx, ty, 7, 48, 0.28, '#ffc145', 3);
        if (isLocalTarget) localHitSquashUntil = now + 80;
        else target.hitSquashUntil = now + 80;
      }
    }

    function localSpriteScale(now = performance.now()) {
      if (now < localHitSquashUntil) return { x: 0.72, y: 1.18 };
      const landAge = now - landingSquashStartedAt;
      if (landingSquashStartedAt && landAge >= 0 && landAge < 180) {
        if (landAge < 80) {
          const t = landAge / 80;
          return { x: lerp(1.15, 0.95, t), y: lerp(0.85, 1.05, t) };
        }
        const t = (landAge - 80) / 100;
        return { x: lerp(0.95, 1, t), y: lerp(1.05, 1, t) };
      }
      const jumpAge = now - jumpStretchStartedAt;
      if (jumpStretchStartedAt && jumpAge >= 0 && jumpAge < 80) {
        const t = jumpAge / 80;
        return { x: lerp(0.9, 1, t), y: lerp(1.1, 1, t) };
      }
      return { x: 1, y: 1 };
    }

    function remoteSpriteScale(p, now = performance.now()) {
      if (now < (p.hitSquashUntil || 0)) return { x: 0.72, y: 1.18 };
      const landAge = now - (p.landingSquashStartedAt || 0);
      if (p.landingSquashStartedAt && landAge >= 0 && landAge < 180) {
        if (landAge < 80) {
          const t = landAge / 80;
          return { x: lerp(1.15, 0.95, t), y: lerp(0.85, 1.05, t) };
        }
        const t = (landAge - 80) / 100;
        return { x: lerp(0.95, 1, t), y: lerp(1.05, 1, t) };
      }
      const jumpAge = now - (p.jumpStretchStartedAt || 0);
      if (p.jumpStretchStartedAt && jumpAge >= 0 && jumpAge < 80) {
        const t = jumpAge / 80;
        return { x: lerp(0.9, 1, t), y: lerp(1.1, 1, t) };
      }
      return { x: 1, y: 1 };
    }

    function updateVisualEffects(dt) {
      const step = Math.max(0, Math.min(Number(dt) || 0, 0.05));
      for (let i = fxParticles.length - 1; i >= 0; i--) {
        const p = fxParticles[i];
        p.life -= step;
        if (p.life <= 0) { fxParticles.splice(i, 1); continue; }
        p.vy += (p.gravity || 0) * step;
        p.x += (p.vx || 0) * step;
        p.y += (p.vy || 0) * step;
      }
      for (let i = fxRings.length - 1; i >= 0; i--) {
        fxRings[i].life -= step;
        if (fxRings[i].life <= 0) fxRings.splice(i, 1);
      }
      // Animated sprite effects: advance elapsed time; drawFxSprites picks the
      // right frame from the ratio and removes them here when finished.
      for (let i = fxSprites.length - 1; i >= 0; i--) {
        fxSprites[i].elapsed += step;
        if (fxSprites[i].elapsed >= fxSprites[i].duration) fxSprites.splice(i, 1);
      }
    }

    function applyPendingKnockback() {
      if (!pendingKnockback) return;
      player.Xv = pendingKnockback.vx;
      player.Yv = pendingKnockback.vy;
      player.onGround = false;
      pendingKnockback = null;
    }
