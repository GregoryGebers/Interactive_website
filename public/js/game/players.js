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
          cx - EFFECT_DASH.w / 2 - dir * 18,
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

    // If another player's tab gets backgrounded, their browser throttles its
    // requestAnimationFrame loop and stops sending fresh frameIndex values —
    // without this, they'd freeze mid-animation on our screen too. Animate
    // everyone's sprite locally instead, only taking emote/frameRow (facing
    // direction) from the network, and falling back to idle if we haven't
    // heard from them in a while.
    const OTHER_PLAYER_FRAME_INTERVAL = 0.1; // seconds per animation frame
    const OTHER_PLAYER_STALE_MS = 600;

    function updateOtherPlayersAnimation(deltaTime) {
      const now = performance.now();
      for (const id in otherPlayers) {
        const p = otherPlayers[id];
        const stale = (now - (p.lastUpdateAt || 0)) > OTHER_PLAYER_STALE_MS;
        const emote = stale ? 'idle' : (p.emote || 'idle');
        const frameCount = emote === 'run' ? 8 : 6;

        const visuallyFrozen = now < (p.hitStopUntil || 0);
        if (!visuallyFrozen) {
          p.localFrameTimer = (p.localFrameTimer || 0) + deltaTime;
          if (p.localFrameTimer >= OTHER_PLAYER_FRAME_INTERVAL) {
            p.localFrameTimer -= OTHER_PLAYER_FRAME_INTERVAL;
            p.localFrameIndex = ((p.localFrameIndex || 0) + 1) % frameCount;
          }
        }
        if (!(p.localFrameIndex < frameCount)) p.localFrameIndex = 0;

        p.displayEmote = emote;
        p.displayFrameRow = emote === 'run' ? (p.frameRow ?? 3) : 0;
        p.displayFrameIndex = p.localFrameIndex;
      }
    }
