    // ---- Other connected players, keyed by socket id ----
    // Each entry carries both the latest known true position (x/y, from the
    // server) and a smoothed render position (renderX/renderY) that eases
    // toward it every frame — see updateOtherPlayersInterpolation() below.
    // This is what removes the teleport/stutter look between network updates.
    const otherPlayers = {};

    socket.on("init", (data) => {
      // The server sends "init" on every connection, including reconnects.
      // Clear first so anyone who left while we were disconnected doesn't
      // linger as a ghost.
      for (const id in otherPlayers) {
        delete otherPlayers[id];
      }
      for (const id in data) {
        if (id !== socket.id) {
          const p = data[id];
          otherPlayers[id] = { ...p, renderX: p.x, renderY: p.y, lastUpdateAt: performance.now() };
        }
      }
    });

    socket.on("new-player", (data) => {
      if (data.id !== socket.id) {
        otherPlayers[data.id] = { ...data, renderX: data.x, renderY: data.y, lastUpdateAt: performance.now() };
      }
    });

    socket.on("player-move", (data) => {
      if (data.id !== socket.id) {
        const existing = otherPlayers[data.id];
        if (existing) {
          // Merge into the SAME object so renderX/renderY and the local
          // animation state below survive — this is what lets the
          // interpolation keep easing toward the new target instead of
          // snapping to it.
          Object.assign(existing, data);
          existing.lastUpdateAt = performance.now();
        } else {
          otherPlayers[data.id] = { ...data, renderX: data.x, renderY: data.y, lastUpdateAt: performance.now() };
        }
      }
    });

    socket.on("remove-player", (id) => {
      delete otherPlayers[id];
    });

    // Visual-only actions from OTHER players. These never call addCameraShake,
    // so remote activity cannot shake this player's camera.
    socket.on('player-fx', (data) => {
      if (!data || data.id === socket.id) return;
      const x = Number(data.x), y = Number(data.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const p = otherPlayers[data.id];
      const now = performance.now();
      const type = String(data.type || '');

      if (type === 'dash') {
        const dir = Number(data.dir) === -1 ? -1 : 1;
        const cx = x + 10, cy = y + 10;
        spawnFxSprite(EFFECT_DASH,
          cx - EFFECT_DASH.w / 2 - dir * 42,
          cy - EFFECT_DASH.h / 2,
          { flipX: dir > 0 });
      } else if (type === 'jump') {
        if (p) p.jumpStretchStartedAt = now;
      } else if (type === 'double-jump') {
        const cx = x + 10, feet = y + 20;
        spawnFxSprite(EFFECT_DOUBLE_JUMP,
          cx - EFFECT_DOUBLE_JUMP.w / 2,
          feet - EFFECT_DOUBLE_JUMP.h / 2);
        if (p) p.jumpStretchStartedAt = now;
      } else if (type === 'land') {
        const cx = x + 10, feet = y + 20;
        spawnFxSprite(EFFECT_LAND,
          cx - EFFECT_LAND.w / 2,
          feet - EFFECT_LAND.h,
          { flipY: false });
        if (p) p.landingSquashStartedAt = now;
      } else if (type === 'invisibility') {
        const cx = x + 10, cy = y + 10;
        spawnFxSprite(EFFECT_INVIS,
          cx - EFFECT_INVIS.w / 2 + 5,
          cy - EFFECT_INVIS.h + 10);
      }
    });

    // Coin pickup is server-authoritative. Other players see the world-space
    // pop/particles, but only the collector's own HUD gets the score pulse.
    socket.on('coin-fx', (data) => {
      if (!data || data.id === socket.id) return;
      const x = Number(data.x), y = Number(data.y);
      if (Number.isFinite(x) && Number.isFinite(y)) triggerCoinPickupFx(x, y, false);
    });

    // How quickly the rendered position catches up to the real one. Smaller
    // = snappier but more visible stutter; larger = smoother but more lag.
    const OTHER_PLAYER_SMOOTHING_TAU = 0.08; // seconds

    function updateOtherPlayersInterpolation(deltaTime) {
      const factor = 1 - Math.exp(-deltaTime / OTHER_PLAYER_SMOOTHING_TAU);
      for (const id in otherPlayers) {
        const p = otherPlayers[id];
        p.renderX += (p.x - p.renderX) * factor;
        p.renderY += (p.y - p.renderY) * factor;
      }
    }

    // Remote ducks: use the frameIndex the sender broadcasts (~30/s) while it's
    // fresh, and self-animate an idle loop if their tab is backgrounded and the
    // updates go stale. `emote` now carries the duck CLIP NAME; older clients
    // that still send 'run' are mapped to 'walk'. A recent swingStartAt forces
    // the punch clip so remote attacks read even between move packets.
    const OTHER_PLAYER_STALE_MS = 600;
    function mapRemoteClip(emote) {
      if (DUCK_ANIM[emote]) return emote;
      if (emote === 'run') return 'walk';
      return 'idle';
    }

    function updateOtherPlayersAnimation(deltaTime) {
      const now = performance.now();
      for (const id in otherPlayers) {
        const p = otherPlayers[id];
        const stale = (now - (p.lastUpdateAt || 0)) > OTHER_PLAYER_STALE_MS;
        let clip = stale ? 'idle' : mapRemoteClip(p.emote);
        if (p.swingStartAt && now - p.swingStartAt < SWING_DURATION_MS) clip = 'punch';
        const meta = DUCK_ANIM[clip] || DUCK_ANIM.idle;
        const frozen = now < (p.hitStopUntil || 0);

        if (stale && !frozen) {
          // Keep a backgrounded player gently looping their idle.
          p.localFrameTimer = (p.localFrameTimer || 0) + deltaTime;
          const interval = 1 / (meta.fps || 8);
          if (p.localFrameTimer >= interval) {
            p.localFrameTimer -= interval;
            p.localFrameIndex = ((p.localFrameIndex || 0) + 1) % meta.frames;
          }
          p.displayFrameIndex = p.localFrameIndex % meta.frames;
        } else if (!frozen) {
          // Trust the sender's frame while fresh (clamped to the clip length).
          p.displayFrameIndex = Math.min(meta.frames - 1, Math.max(0, p.frameIndex || 0));
        }

        p.displayClip = clip;
        p.displayFacing = (Number(p.facing) === -1) ? -1 : 1;
      }
    }
