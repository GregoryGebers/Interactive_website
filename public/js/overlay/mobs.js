  // ============================================================================
  //  MOBS on the overlay (Twitch view).
  //  The mob is server-authoritative (src/server/services/mob.service.js): the
  //  server broadcasts one shared creature's position/state, and the overlay —
  //  a pure spectator with no local player — just renders it so it appears on
  //  stream in the same place viewers see it. World-scaled, no camera.
  // ============================================================================
  const MOB_PACK_BASE = '/assets/slimes/craftpix-net-788364-free-slime-mobs-pixel-art-top-down-sprite-pack/PNG';
  const MOB_PACK_ENEMY = '/assets/slimes/craftpix-net-743043-pixel-art-slime-enemies-top-down-sprite-pack/PNG';

  function mobSlimeClips(pack, folder) {
    const p = `${pack}/${folder}/With_shadow/${folder}`;
    return {
      idle:   { src: `${p}_Idle_with_shadow.png`,   frames: 6,  fps: 6,  loop: true  },
      walk:   { src: `${p}_Walk_with_shadow.png`,   frames: 8,  fps: 10, loop: true  },
      run:    { src: `${p}_Run_with_shadow.png`,    frames: 8,  fps: 14, loop: true  },
      attack: { src: `${p}_Attack_with_shadow.png`, frames: 10, fps: 16, loop: false },
      death:  { src: `${p}_Death_with_shadow.png`,  frames: 10, fps: 12, loop: false },
    };
  }
  // Draw framing identical to the viewer: row 2 (side view), mirror to face the
  // travel direction, ground line pinned to the feet.
  const OVERLAY_MOB_TYPES = {
    slime:    { anim: mobSlimeClips(MOB_PACK_BASE, 'Slime1'),  fw: 64, fh: 64, row: 2, nativeFacing: -1, spriteGroundY: 40, drawSize: 72, width: 30, height: 24 },
    water:    { anim: mobSlimeClips(MOB_PACK_ENEMY, 'Slime1'), fw: 64, fh: 64, row: 2, nativeFacing: -1, spriteGroundY: 40, drawSize: 72, width: 30, height: 24 },
    electric: { anim: mobSlimeClips(MOB_PACK_ENEMY, 'Slime2'), fw: 64, fh: 64, row: 2, nativeFacing: -1, spriteGroundY: 45, drawSize: 72, width: 30, height: 24 },
    devil:    { anim: mobSlimeClips(MOB_PACK_ENEMY, 'Slime3'), fw: 64, fh: 64, row: 2, nativeFacing: -1, spriteGroundY: 40, drawSize: 72, width: 30, height: 24 },
  };

  const overlayMobImages = {};
  function overlayMobSheet(typeId, clip) {
    const key = `${typeId}:${clip}`;
    if (!overlayMobImages[key]) {
      const type = OVERLAY_MOB_TYPES[typeId];
      const cfg = type && type.anim[clip];
      const im = new Image();
      if (cfg) im.src = cfg.src;
      overlayMobImages[key] = im;
    }
    return overlayMobImages[key];
  }

  let overlayMobs = [];      // 0 or 1
  let overlayMobFx = [];     // blink rings

  function overlayMobFromSnapshot(snap) {
    const type = OVERLAY_MOB_TYPES[snap.type] || OVERLAY_MOB_TYPES.slime;
    return {
      id: snap.id, type: snap.type,
      x: snap.x, y: snap.y, renderX: snap.x, renderY: snap.y,
      width: type.width, height: type.height,
      facing: snap.facing === -1 ? -1 : 1,
      serverState: snap.state || 'idle',
      flashUntil: 0, dying: false, deadAt: 0,
      clip: 'idle', frame: 0, frameTimer: 0, clipDone: false,
    };
  }
  function overlayCurrentMob() { return overlayMobs.find(m => !m.dying) || null; }

  socket.on('mob', (snap) => {
    if (!snap) { overlayMobs = overlayMobs.filter(m => m.dying); return; }
    const existing = overlayMobs.find(m => m.id === snap.id && !m.dying);
    if (existing) { existing.x = snap.x; existing.y = snap.y; existing.serverState = snap.state; }
    else overlayMobs.push(overlayMobFromSnapshot(snap));
  });
  socket.on('mob-move', (snap) => {
    if (!snap) return;
    const m = overlayMobs.find(x => x.id === snap.id && !x.dying);
    if (!m) { overlayMobs.push(overlayMobFromSnapshot(snap)); return; }
    m.x = snap.x; m.y = snap.y; m.facing = snap.facing === -1 ? -1 : 1; m.serverState = snap.state || 'idle';
  });
  socket.on('mob-hurt', (d) => { const m = overlayMobs.find(x => x.id === d.id && !x.dying); if (m) m.flashUntil = performance.now() + 120; });
  socket.on('mob-died', (d) => {
    const m = overlayMobs.find(x => x.id === d.id) || overlayCurrentMob();
    if (m) { m.dying = true; m.deadAt = performance.now(); m.clip = 'death'; m.frame = 0; m.frameTimer = 0; m.clipDone = false; }
  });
  socket.on('mob-blink', (d) => { overlayMobFx.push({ x: d.x, y: d.y, life: 0.3, maxLife: 0.3, color: '#ffe066' }); });

  function overlayStateToClip(state) {
    return (state === 'run' || state === 'walk' || state === 'attack' || state === 'idle') ? state : 'idle';
  }
  function advanceOverlayMobAnim(m, clip, dt, type) {
    const cfg = type.anim[clip] || type.anim.idle;
    if (m.clip !== clip) { m.clip = clip; m.frame = 0; m.frameTimer = 0; m.clipDone = false; }
    m.frameTimer += dt;
    const interval = 1 / (cfg.fps || 8);
    while (m.frameTimer >= interval) {
      m.frameTimer -= interval;
      if (m.frame + 1 >= cfg.frames) { if (cfg.loop === false) { m.frame = cfg.frames - 1; m.clipDone = true; break; } m.frame = 0; }
      else m.frame++;
    }
  }

  function updateOverlayMobs(dt) {
    for (let i = overlayMobFx.length - 1; i >= 0; i--) { overlayMobFx[i].life -= dt; if (overlayMobFx[i].life <= 0) overlayMobFx.splice(i, 1); }
    const tau = 0.05;
    const blend = 1 - Math.exp(-Math.max(0, Math.min(dt, 0.1)) / tau);
    for (let i = overlayMobs.length - 1; i >= 0; i--) {
      const m = overlayMobs[i];
      const type = OVERLAY_MOB_TYPES[m.type] || OVERLAY_MOB_TYPES.slime;
      if (m.dying) { advanceOverlayMobAnim(m, 'death', dt, type); if (m.clipDone) overlayMobs.splice(i, 1); continue; }
      m.renderX += (m.x - m.renderX) * blend;
      m.renderY += (m.y - m.renderY) * blend;
      advanceOverlayMobAnim(m, overlayStateToClip(m.serverState), dt, type);
    }
  }

  // Drawn inside the overlay's active world-scale transform (same space as the
  // player sprites), so it scales down onto the full-world stream view.
  function drawOverlayMobs(context) {
    const now = performance.now();
    for (const m of overlayMobs) {
      const type = OVERLAY_MOB_TYPES[m.type] || OVERLAY_MOB_TYPES.slime;
      const sheet = overlayMobSheet(m.type, m.clip);
      if (!sheet.complete || !sheet.naturalWidth) continue;
      const size = type.drawSize, scale = size / type.fh;
      const drawX = m.renderX + m.width / 2 - size / 2;
      const drawY = (m.renderY + m.height) - type.spriteGroundY * scale;
      const flip = m.facing !== (type.nativeFacing || 1);
      context.save();
      if (m.dying) {
        const cfg = type.anim.death, total = cfg.frames / cfg.fps;
        context.globalAlpha = 1 - Math.min(1, (now - m.deadAt) / (total * 1000)) * 0.8;
      }
      context.translate(drawX + (flip ? size : 0), drawY);
      context.scale(flip ? -1 : 1, 1);
      context.drawImage(sheet, m.frame * type.fw, type.row * type.fh, type.fw, type.fh, 0, 0, size, size);
      context.restore();
    }
    for (const fx of overlayMobFx) {
      const a = Math.max(0, fx.life / fx.maxLife);
      const r = 6 + (1 - a) * 22;
      context.save();
      context.globalAlpha = a; context.strokeStyle = fx.color; context.lineWidth = 2;
      context.beginPath(); context.arc(fx.x, fx.y, r, 0, Math.PI * 2); context.stroke();
      context.restore();
    }
  }
