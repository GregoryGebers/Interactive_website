    // ============================================================================
    //  MOBS — the shared combat creature.
    //
    //  In the REAL multiplayer game the mob is SERVER-AUTHORITATIVE: exactly one
    //  is alive at a time, the server runs its AI and broadcasts its position, and
    //  this file only renders it (and reacts when it hits the local player). That
    //  is what keeps viewer.html and overlay.html showing the same creature in the
    //  same place. See src/server/services/mob.service.js.
    //
    //  In the isolated editor Test Draft there is no server, so this file also
    //  contains a matching LOCAL simulation (weighted single mob, respawns) so the
    //  preview behaves like the real thing. LOCAL_SIM selects which path runs.
    //
    //  Damage is ATTACK-ONLY: touching a mob is harmless; it only hurts when it
    //  commits an attack, then goes on a 3s cooldown (it still moves during it).
    // ============================================================================
    const LOCAL_SIM = IS_EDITOR_TEST;   // editor preview simulates locally
    const MOB_PACK_BASE = '/assets/slimes/craftpix-net-788364-free-slime-mobs-pixel-art-top-down-sprite-pack/PNG';
    const MOB_PACK_ENEMY = '/assets/slimes/craftpix-net-743043-pixel-art-slime-enemies-top-down-sprite-pack/PNG';

    function slimeClips(pack, folder) {
      const p = `${pack}/${folder}/With_shadow/${folder}`;
      return {
        idle:   { src: `${p}_Idle_with_shadow.png`,   frames: 6,  fps: 6,  loop: true  },
        walk:   { src: `${p}_Walk_with_shadow.png`,   frames: 8,  fps: 10, loop: true  },
        run:    { src: `${p}_Run_with_shadow.png`,    frames: 8,  fps: 14, loop: true  },
        attack: { src: `${p}_Attack_with_shadow.png`, frames: 10, fps: 16, loop: false },
        hurt:   { src: `${p}_Hurt_with_shadow.png`,   frames: 5,  fps: 14, loop: false },
        death:  { src: `${p}_Death_with_shadow.png`,  frames: 10, fps: 12, loop: false },
      };
    }

    const MOB_ATTACK_COOLDOWN_MS = 3000;
    const MOB_ATTACK_HIT_AT = 0.45;
    const MOB_ATTACK_DURATION_MS = 640;   // 10-frame attack clip
    const MOB_RESPAWN_MS = 3000;          // local-sim respawn delay (matches server)
    // Recoil from a player's swing — MUST match the server (mob.service.js).
    const MOB_HIT_KB_X = 190;
    const MOB_HIT_KB_Y = 240;
    const MOB_STAGGER_MS = 360;

    // Draw framing is measured from the sheets: row 2 is the side view (row 0
    // faces the camera), nativeFacing is which way that art points, spriteGroundY
    // is where the baked shadow meets the floor (pinned to the mob's feet).
    const MOB_TYPES = {
      slime: {
        name: 'Slime', anim: slimeClips(MOB_PACK_BASE, 'Slime1'),
        fw: 64, fh: 64, row: 2, nativeFacing: -1, spriteGroundY: 40, drawSize: 72,
        width: 30, height: 24,
        patrolSpeed: 42, chaseSpeed: 66,
        detectRange: 160, attackRange: 46, attackHitRange: 56,
        damage: 1, knockbackX: 165, knockbackY: 190,
        health: 3, gravity: 900, maxFall: 720,
        jumpSpeed: 430, airSpeed: 120,
      },
      water: {
        name: 'Water Slime', anim: slimeClips(MOB_PACK_ENEMY, 'Slime1'),
        fw: 64, fh: 64, row: 2, nativeFacing: -1, spriteGroundY: 40, drawSize: 72,
        width: 30, height: 24,
        patrolSpeed: 40, chaseSpeed: 62,
        detectRange: 175, attackRange: 48, attackHitRange: 60,
        damage: 1, knockbackX: 330, knockbackY: 330,
        health: 3, gravity: 900, maxFall: 720,
        jumpSpeed: 430, airSpeed: 115,
        tint: '#4fc3f7',
      },
      electric: {
        name: 'Electric Slime', anim: slimeClips(MOB_PACK_ENEMY, 'Slime2'),
        fw: 64, fh: 64, row: 2, nativeFacing: -1, spriteGroundY: 40, drawSize: 72,
        width: 30, height: 24,
        patrolSpeed: 44, chaseSpeed: 70,
        detectRange: 200, attackRange: 62, attackHitRange: 74,
        damage: 2, knockbackX: 150, knockbackY: 170,
        health: 3, gravity: 900, maxFall: 720,
        jumpSpeed: 450, airSpeed: 130,
        tint: '#ffe066',
        chain: true, chainRadius: 95,
        // Kept in sync with the server (src/server/services/mob.service.js).
        teleport: true, teleportRange: 120, teleportCooldownMs: 4200, teleportMinGap: 70,
      },
      // Devil slime — no swing at all: it winds up and RAMS. The damage comes
      // off its speed on contact (x1 setting off, x2 half speed, x3 full), so
      // the safe play is to meet it early or get out of the lane entirely.
      // Charge numbers kept in sync with the server.
      devil: {
        name: 'Devil Slime', anim: slimeClips(MOB_PACK_ENEMY, 'Slime3'),
        fw: 64, fh: 64, row: 2, nativeFacing: -1, spriteGroundY: 40, drawSize: 72,
        width: 30, height: 24,
        patrolSpeed: 46, chaseSpeed: 74,
        detectRange: 210, attackRange: 52, attackHitRange: 60,
        damage: 1, knockbackX: 210, knockbackY: 200,
        health: 4, gravity: 900, maxFall: 720,
        jumpSpeed: 440, airSpeed: 135,
        tint: '#ff4d3d',
        charge: true,
        chargeRange: 200, chargeWindupMs: 420,
        chargeStartSpeed: 60, chargeSpeed: 330, chargeAccel: 340,
        chargeMaxMs: 1600, chargeHitRange: 34, chargeCooldownMs: 2600,
      },
    };
    const DEFAULT_MOB_TYPE = 'slime';
    // The nav-graph cache keys on type.id — stamp each type with its own id.
    for (const k in MOB_TYPES) MOB_TYPES[k].id = k;

    const mobImages = {};
    function mobSheet(typeId, clip) {
      const key = `${typeId}:${clip}`;
      if (!mobImages[key]) {
        const type = MOB_TYPES[typeId];
        const cfg = type && type.anim[clip];
        const im = new Image();
        if (cfg) im.src = cfg.src;
        im.onload = () => { if (typeof startGameLoop === 'function') startGameLoop(); };
        mobImages[key] = im;
      }
      return mobImages[key];
    }

    // Scene data (both modes parse it; only the local sim actually uses it).
    let mobZones = [];
    let spawners = [];
    let mobs = [];            // rendered mobs — 0 or 1 in the current design
    let mobFx = [];           // lightning arcs / blink rings
    let playerSpawnPoint = { x: player.x, y: player.y };
    let mobRespawnAt = 0;     // local-sim: when to spawn the next mob

    // ---- Player health ------------------------------------------------------
    const PLAYER_MAX_HEARTS = 3;
    const PLAYER_IFRAME_MS = 1100;
    function initPlayerHealth() {
      if (typeof player.maxHearts !== 'number') player.maxHearts = PLAYER_MAX_HEARTS;
      if (typeof player.hearts !== 'number') player.hearts = player.maxHearts;
      if (typeof player.invulnUntil !== 'number') player.invulnUntil = 0;
    }
    initPlayerHealth();

    function rectsOverlap(a, b) {
      return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    }
    function pointInRect(px, py, r) {
      return px >= r.x && px <= r.x + r.width && py >= r.y && py <= r.y + r.height;
    }
    function playerRect() {
      return { x: player.x + PLAYER_HITBOX_OFFSET_X, y: player.y, width: player.width, height: player.height };
    }
    function targetablePlayers() {
      const out = [];
      if (hasJoined !== false) {
        out.push({ id: 'local', local: true, cx: player.x + player.width / 2, cy: player.y + player.height / 2 });
      }
      for (const id in otherPlayers) {
        const p = otherPlayers[id];
        if (!p || p.invisible) continue;
        const x = p.renderX ?? p.x, y = p.renderY ?? p.y;
        out.push({ id, local: false, cx: x + 10, cy: y + 10 });
      }
      return out;
    }

    // =========================================================================
    //  SERVER-DRIVEN PATH (real game): render whatever the server broadcasts.
    // =========================================================================
    function mobFromSnapshot(snap) {
      const type = MOB_TYPES[snap.type] || MOB_TYPES.slime;
      return {
        id: snap.id, type: snap.type,
        x: snap.x, y: snap.y, renderX: snap.x, renderY: snap.y,
        width: type.width, height: type.height,
        facing: snap.facing === -1 ? -1 : 1,
        serverState: snap.state || 'idle',
        health: snap.health, maxHealth: snap.maxHealth,
        flashUntil: 0, dying: false, deadAt: 0,
        clip: 'idle', frame: 0, frameTimer: 0, clipDone: false,
      };
    }
    function currentServerMob() { return mobs.find(m => !m.dying) || null; }

    if (!LOCAL_SIM) {
      socket.on('mob', (snap) => {
        if (!snap) {
          // Server cleared the mob (usually right after a death event); drop any
          // living one, but let a dying mob finish its death clip.
          mobs = mobs.filter(m => m.dying);
          return;
        }
        const existing = mobs.find(m => m.id === snap.id && !m.dying);
        if (existing) { existing.x = snap.x; existing.y = snap.y; existing.serverState = snap.state; existing.health = snap.health; }
        else mobs.push(mobFromSnapshot(snap));
      });
      socket.on('mob-move', (snap) => {
        if (!snap) return;
        const m = mobs.find(x => x.id === snap.id && !x.dying);
        if (!m) { mobs.push(mobFromSnapshot(snap)); return; }
        m.x = snap.x; m.y = snap.y;
        m.facing = snap.facing === -1 ? -1 : 1;
        m.serverState = snap.state || 'idle';
        m.health = snap.health;
      });
      socket.on('mob-hurt', (d) => {
        const m = mobs.find(x => x.id === d.id && !x.dying);
        if (m) m.flashUntil = performance.now() + 120;
      });
      socket.on('mob-died', (d) => {
        const m = mobs.find(x => x.id === d.id) || currentServerMob();
        if (m) { m.dying = true; m.deadAt = performance.now(); m.clip = 'death'; m.frame = 0; m.frameTimer = 0; m.clipDone = false; }
        else if (Number.isFinite(d.x)) { /* nothing to fade, still show a death burst */ }
        if (typeof spawnImpactParticles === 'function' && Number.isFinite(d.x)) spawnImpactParticles(d.x, d.y, d.facing === -1 ? 1 : -1, 1, 3);
      });
      socket.on('mob-blink', (d) => { pushBlink(d.x, d.y, '#ffe066'); });
      socket.on('mob-hit', (d) => {
        damagePlayer(d.damage, d.srcX, d.knockbackX, d.knockbackY);
      });
    }

    // =========================================================================
    //  LOCAL SIMULATION (editor Test Draft only)
    // =========================================================================
    function spawnerZone(sp) {
      const cx = sp.x + sp.width / 2, cy = sp.y + sp.height / 2;
      return mobZones.find(z => pointInRect(cx, cy, z)) || null;
    }
    // Weighted pick of a spawner (its `chance` is the relative weight), then a
    // mob positioned inside it — mirrors the server's selection.
    function pickWeightedSpawner() {
      if (!spawners.length) return null;
      const weights = spawners.map(s => Math.max(0, Number(s.chance == null ? 100 : s.chance)));
      const total = weights.reduce((a, b) => a + b, 0);
      if (total <= 0) return spawners[Math.floor(Math.random() * spawners.length)];
      let r = Math.random() * total;
      for (let i = 0; i < spawners.length; i++) { if (r < weights[i]) return spawners[i]; r -= weights[i]; }
      return spawners[spawners.length - 1];
    }
    function makeLocalMob() {
      const sp = pickWeightedSpawner();
      if (!sp) return null;
      const typeId = MOB_TYPES[sp.mob] ? sp.mob : DEFAULT_MOB_TYPE;
      const type = MOB_TYPES[typeId];
      const damage = Number(sp.damage) > 0 ? Math.round(Number(sp.damage)) : type.damage;
      return {
        id: 'local', type: typeId,
        x: sp.x + Math.random() * Math.max(1, sp.width - type.width),
        y: sp.y + Math.random() * Math.max(1, sp.height - type.height),
        width: type.width, height: type.height,
        vx: 0, vy: 0, facing: Math.random() < 0.5 ? -1 : 1, onGround: false,
        zone: spawnerZone(sp), patrolDir: Math.random() < 0.5 ? -1 : 1,
        damage, health: type.health, maxHealth: type.health,
        state: 'idle',
        attacking: false, attackStartedAt: 0, attackHitDone: false, attackReadyAt: 0,
        chargePhase: 0, chargeStartedAt: 0,
        teleportReadyAt: performance.now() + Math.random() * 2000,
        flashUntil: 0, dying: false, deadAt: 0,
        clip: 'idle', frame: 0, frameTimer: 0, clipDone: false,
      };
    }

    // Client scene version for the nav-graph cache. `boxes` is REPLACED (new
    // array) by scene.js whenever a test scene loads, so we detect that by
    // reference and rebuild navigation from the fresh geometry — editing
    // hitboxes in the editor automatically re-derives mob routes.
    let mobSceneVersion = 1;
    let mobLastBoxesRef = null;
    function mobEnv(m, type) {
      if (boxes !== mobLastBoxesRef) {
        mobLastBoxesRef = boxes;
        mobSceneVersion++;
        if (window.MobNav) window.MobNav.invalidate();
      }
      const env = {
        world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
        boxes, zone: m.zone || null, version: mobSceneVersion,
      };
      env.graph = window.MobNav.buildGraph(env, type);
      return env;
    }
    // Local targets carry a foot Y so the pathfinder can tell which platform a
    // player is standing on (Euclidean distance alone attacks through floors).
    function localTargets() {
      return targetablePlayers().map(t => ({
        id: t.id, local: t.local, cx: t.cx, cy: t.cy,
        feetY: t.local ? (player.y + player.height) : (t.cy + 10),
      }));
    }

    function updateLocalSim(dt, now) {
      if (!mobs.length) {
        if (spawners.length && now >= mobRespawnAt) { const m = makeLocalMob(); if (m) mobs.push(m); }
        return;
      }
      const m = mobs[0];
      const type = MOB_TYPES[m.type] || MOB_TYPES.slime;

      if (m.dying) {
        applyMobGravity(m, type, dt);
        advanceMobAnim(m, 'death', dt, type);
        if (m.clipDone) { mobs.splice(0, 1); mobRespawnAt = now + MOB_RESPAWN_MS; }
        return;
      }

      // Everything — patrol/idle, wall pause+turn, target persistence, platform
      // pathfinding, jumps/drops, vertical-aware attacks, blink, AND the hit
      // stagger/knockback — is the SAME brain the server runs (a hit sets
      // m.staggerUntil, which MobNav rides out), so the preview matches the game.
      const env = mobEnv(m, type);
      const res = window.MobNav.stepMob(m, env, {
        type, targets: localTargets(), now, dt,
        attackDurationMs: MOB_ATTACK_DURATION_MS,
        attackHitAt: MOB_ATTACK_HIT_AT,
        attackCooldownMs: MOB_ATTACK_COOLDOWN_MS,
      });

      if (res.attack) applyLocalAttack(m, type, res.attack);
      // 'blink' = electric teleport, 'charge' = the devil setting off. Both
      // read as an expanding ring in the mob's own colour.
      for (const fx of res.fx) {
        if (fx.kind === 'blink' || fx.kind === 'charge') pushBlink(fx.x, fx.y, fx.color || type.tint);
      }

      // Show the hurt clip while the flash lasts; otherwise animate the AI state.
      advanceMobAnim(m, now < m.flashUntil ? 'hurt' : mobStateClip(m.state), dt, type);
    }
    function mobStateClip(state) {
      return (state === 'run' || state === 'walk' || state === 'attack' || state === 'idle') ? state : 'idle';
    }

    // Gravity kept locally for the dying/hurt paths (MobNav owns live physics).
    function applyMobGravity(m, type, dt) {
      m.vy = (m.vy || 0) + type.gravity * dt;
      if (m.vy > type.maxFall) m.vy = type.maxFall;
      const prevY = m.y; m.y += m.vy * dt; m.onGround = false; resolveMobY(m, prevY, type);
    }
    function resolveMobY(m, prevY, type) {
      for (const box of boxes) {
        const hOverlap = m.x + m.width > box.x && m.x < box.x + box.width;
        if (!hOverlap) continue;
        const wasAbove = prevY + m.height <= box.y;
        if (m.vy >= 0 && wasAbove && m.y + m.height >= box.y) { m.y = box.y - m.height; m.vy = 0; m.onGround = true; }
        else if (m.vy < 0 && prevY >= box.y + box.height && m.y < box.y + box.height) { m.y = box.y + box.height; m.vy = 10; }
      }
      if (m.y + m.height >= WORLD_HEIGHT) { m.y = WORLD_HEIGHT - m.height; m.vy = 0; m.onGround = true; }
    }
    // Turn a MobNav attack result into the local FX + local-player damage,
    // mirroring the old resolveMobAttack (lightning arcs for the electric type).
    function applyLocalAttack(m, type, atk) {
      const { mcx, mcy, primary, struck } = atk;
      // A charge carries its own speed-scaled damage/knockback (see MobNav).
      if (atk.charge) {
        if (struck.some(t => t.local)) {
          const kb = 0.7 + (atk.speedRatio || 0) * 0.8;
          damagePlayer(atk.damage, mcx, type.knockbackX * kb, type.knockbackY * kb);
        }
        return;
      }
      if (!primary) {
        if (type.chain) pushLightning(mcx, mcy, mcx + m.facing * type.attackHitRange, mcy, type.tint);
        return;
      }
      if (type.chain) {
        pushLightning(mcx, mcy, primary.cx, primary.cy, type.tint);
        for (let i = 1; i < struck.length; i++) pushLightning(primary.cx, primary.cy, struck[i].cx, struck[i].cy, type.tint);
      }
      if (struck.some(t => t.local)) damagePlayer(m.damage, mcx, type.knockbackX, type.knockbackY);
    }

    // Player's punch connecting with a mob. Server-authoritative in the real
    // game (server handles it), so this only acts in the local preview.
    function damageMobsInRange(cx, cy, dir) {
      if (!LOCAL_SIM) return false;   // real game: the server resolves swings
      const m = mobs[0];
      if (!m || m.dying) return false;
      const mcx = m.x + m.width / 2, mcy = m.y + m.height / 2;
      if ((mcx - cx) * dir < -m.width) return false;
      if (Math.hypot(mcx - cx, mcy - cy) > 60) return false;
      m.health -= 1; m.attacking = false;
      const kbDir = mcx >= cx ? 1 : -1;
      if (typeof spawnImpactParticles === 'function') spawnImpactParticles(mcx, mcy, -kbDir, 1, 3);
      if (m.health <= 0) {
        m.vx = kbDir * MOB_HIT_KB_X; m.vy = -140; m.onGround = false;
        m.dying = true; m.deadAt = performance.now(); m.clip = 'death'; m.frame = 0; m.frameTimer = 0; m.clipDone = false;
      } else {
        // Same recoil + stagger the server applies, via the shared brain.
        window.MobNav.hitKnockback(m, kbDir, performance.now(), MOB_HIT_KB_X, MOB_HIT_KB_Y, MOB_STAGGER_MS);
        m.flashUntil = performance.now() + MOB_STAGGER_MS; m.clip = 'hurt'; m.frame = 0; m.frameTimer = 0; m.clipDone = false;
      }
      if (typeof addCameraShake === 'function') addCameraShake(3, 90, dir, 0);
      return true;
    }

    // =========================================================================
    //  SHARED: per-frame update + rendering
    // =========================================================================
    function updateMobs(dt) {
      updateMobFx(dt);
      const now = performance.now();
      if (LOCAL_SIM) { updateLocalSim(dt, now); return; }

      // Server mode: ease the drawn position toward the last server position and
      // advance the animation from the server-provided state.
      const tau = 0.05;
      const blend = 1 - Math.exp(-Math.max(0, Math.min(dt, 0.1)) / tau);
      for (let i = mobs.length - 1; i >= 0; i--) {
        const m = mobs[i];
        const type = MOB_TYPES[m.type] || MOB_TYPES.slime;
        if (m.dying) { advanceMobAnim(m, 'death', dt, type); if (m.clipDone) mobs.splice(i, 1); continue; }
        m.renderX += ((m.x) - m.renderX) * blend;
        m.renderY += ((m.y) - m.renderY) * blend;
        advanceMobAnim(m, serverStateToClip(m.serverState), dt, type);
      }
    }
    function serverStateToClip(state) {
      return (state === 'run' || state === 'walk' || state === 'attack' || state === 'idle') ? state : 'idle';
    }

    function advanceMobAnim(m, clip, dt, type) {
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

    function damagePlayer(dmg, srcX, knockbackX = 165, knockbackY = 190) {
      const now = performance.now();
      if (now < (player.invulnUntil || 0)) return;
      if (hasJoined === false) return;   // not playing yet — nothing to damage
      player.hearts = Math.max(0, player.hearts - dmg);
      player.invulnUntil = now + PLAYER_IFRAME_MS;
      localHitFlashUntil = now + 140;
      const dir = (player.x + player.width / 2) < srcX ? -1 : 1;
      player.Xv = dir * Math.abs(knockbackX);
      player.Yv = -Math.abs(knockbackY);
      player.onGround = false;
      isDashing = false;
      const kbScale = Math.min(2, Math.abs(knockbackX) / 165);
      controlLockTimer = Math.max(controlLockTimer, 0.22 * kbScale);
      if (typeof addCameraShake === 'function') addCameraShake(5 * kbScale, 150, dir, -0.2);
      if (typeof spawnImpactParticles === 'function') spawnImpactParticles(player.x + player.width / 2, player.y + player.height / 2, dir, 1, 3);
      if (player.hearts <= 0) respawnPlayer();
    }
    function respawnPlayer() {
      player.x = playerSpawnPoint.x; player.y = playerSpawnPoint.y;
      player.Xv = 0; player.Yv = 0;
      player.hearts = player.maxHearts;
      player.invulnUntil = performance.now() + 1600;
      controlLockTimer = 0;
    }

    // ---- Mob FX (lightning arcs, blink rings) -------------------------------
    function pushLightning(x1, y1, x2, y2, color) {
      const segs = 7, pts = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs, jitter = (i === 0 || i === segs) ? 0 : 9;
        pts.push([x1 + (x2 - x1) * t + (Math.random() * 2 - 1) * jitter, y1 + (y2 - y1) * t + (Math.random() * 2 - 1) * jitter]);
      }
      mobFx.push({ kind: 'bolt', pts, color: color || '#ffe066', life: 0.22, maxLife: 0.22 });
    }
    function pushBlink(x, y, color) { mobFx.push({ kind: 'blink', x, y, color: color || '#ffe066', life: 0.3, maxLife: 0.3 }); }
    function updateMobFx(dt) { for (let i = mobFx.length - 1; i >= 0; i--) { mobFx[i].life -= dt; if (mobFx[i].life <= 0) mobFx.splice(i, 1); } }

    // ---- Rendering (world space; called from draw()) ------------------------
    function drawMobs() {
      const now = performance.now();
      for (const m of mobs) {
        const type = MOB_TYPES[m.type] || MOB_TYPES.slime;
        const sheet = mobSheet(m.type, m.clip);
        if (!sheet.complete || !sheet.naturalWidth) continue;
        const size = type.drawSize, scale = size / type.fh;
        const mx = LOCAL_SIM ? m.x : (m.renderX ?? m.x);
        const my = LOCAL_SIM ? m.y : (m.renderY ?? m.y);
        const drawX = mx + m.width / 2 - size / 2;
        const drawY = (my + m.height) - type.spriteGroundY * scale;
        const flip = m.facing !== (type.nativeFacing || 1);
        const flash = now < (m.flashUntil || 0);
        playObj.save();
        if (m.dying) {
          const cfg = type.anim.death, total = cfg.frames / cfg.fps;
          playObj.globalAlpha = 1 - Math.min(1, (now - m.deadAt) / (total * 1000)) * 0.8;
        }
        playObj.translate(drawX + (flip ? size : 0), drawY);
        playObj.scale(flip ? -1 : 1, 1);
        if (flash) {
          mobFlashCtx.setTransform(1, 0, 0, 1, 0, 0);
          mobFlashCtx.clearRect(0, 0, type.fw, type.fh);
          mobFlashCtx.globalCompositeOperation = 'source-over';
          mobFlashCtx.drawImage(sheet, m.frame * type.fw, type.row * type.fh, type.fw, type.fh, 0, 0, type.fw, type.fh);
          mobFlashCtx.globalCompositeOperation = 'source-atop';
          mobFlashCtx.fillStyle = '#ffffff';
          mobFlashCtx.fillRect(0, 0, type.fw, type.fh);
          mobFlashCtx.globalCompositeOperation = 'source-over';
          playObj.drawImage(mobFlashCanvas, 0, 0, type.fw, type.fh, 0, 0, size, size);
        } else {
          playObj.drawImage(sheet, m.frame * type.fw, type.row * type.fh, type.fw, type.fh, 0, 0, size, size);
        }
        playObj.restore();
      }
      drawMobFx();
    }
    const mobFlashCanvas = document.createElement('canvas');
    mobFlashCanvas.width = 64; mobFlashCanvas.height = 64;
    const mobFlashCtx = mobFlashCanvas.getContext('2d');

    function drawMobFx() {
      for (const fx of mobFx) {
        const a = Math.max(0, fx.life / fx.maxLife);
        playObj.save();
        playObj.globalAlpha = a;
        if (fx.kind === 'bolt') {
          playObj.strokeStyle = fx.color; playObj.lineWidth = 4; playObj.globalAlpha = a * 0.35; strokePath(fx.pts);
          playObj.globalAlpha = a; playObj.strokeStyle = '#ffffff'; playObj.lineWidth = 1.5; strokePath(fx.pts);
        } else {
          const r = 6 + (1 - a) * 22;
          playObj.strokeStyle = fx.color; playObj.lineWidth = 2;
          playObj.beginPath(); playObj.arc(fx.x, fx.y, r, 0, Math.PI * 2); playObj.stroke();
        }
        playObj.restore();
      }
    }
    function strokePath(pts) {
      playObj.beginPath(); playObj.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) playObj.lineTo(pts[i][0], pts[i][1]);
      playObj.stroke();
    }

    // Health hearts. Drawn in SCREEN space as part of the HUD (left-aligned
    // under the score chip), so they stay a fixed, readable size no matter how
    // far the camera is zoomed in. Caller passes the top-left corner of the row.
    function drawPlayerHearts(x, y, hs = 12, gap = 4) {
      if (typeof player.hearts !== 'number' || typeof player.maxHearts !== 'number') return;
      const n = player.maxHearts;
      const startX = Math.round(x);
      y = Math.round(y);
      const now = performance.now();
      const blinking = now < (player.invulnUntil || 0) && Math.floor(now / 100) % 2 === 0;
      for (let i = 0; i < n; i++) {
        const hx = startX + i * (hs + gap);
        const filled = i < player.hearts;
        drawPixelHeart(hx, y, hs, filled && !(blinking && i === player.hearts - 1));
      }
    }
    const HEART_MASK = ['0110110', '1111111', '1111111', '1111111', '0111110', '0011100', '0001000'];
    function drawPixelHeart(x, y, s, filled) {
      const u = s / 7;
      playObj.save();
      playObj.fillStyle = 'rgba(0,0,0,0.35)'; paintHeartMask(HEART_MASK, x + 1, y + 1, u);
      playObj.fillStyle = filled ? '#ff4d5e' : 'rgba(20,36,26,0.55)'; paintHeartMask(HEART_MASK, x, y, u);
      if (filled) { playObj.fillStyle = 'rgba(255,255,255,0.6)'; playObj.fillRect(Math.round(x + u), Math.round(y + u), Math.ceil(u), Math.ceil(u)); }
      playObj.restore();
    }
    function paintHeartMask(rows, x, y, u) {
      for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
        if (rows[r][c] === '1') playObj.fillRect(Math.round(x + c * u), Math.round(y + r * u), Math.ceil(u), Math.ceil(u));
      }
    }
