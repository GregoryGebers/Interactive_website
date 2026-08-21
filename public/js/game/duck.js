    // ---- Duck player model ---------------------------------------------------
    // Replaces the old two-sheet slime. Every animation is its OWN horizontal
    // strip of 64x64 frames, all drawn facing LEFT natively — facing right is a
    // horizontal flip at draw time (see the scaleX sign in rendering.js). One
    // file per clip, so a small state machine (updatePlayerClip) picks the clip
    // from real game state instead of the old idle/run-only pose switch.
    const DUCK_BASE = '/assets/duck/Ducky/Spritesheets';

    // frames/fps/loop measured from the shipped PNGs. Only clips that map to a
    // state the game actually has are wired; the rest of the sheet is unused.
    const DUCK_ANIM = {
      idle:  { src: `${DUCK_BASE}/idle.png`,       frames: 4, fps: 8,  loop: true  },
      walk:  { src: `${DUCK_BASE}/walk.png`,       frames: 4, fps: 12, loop: true  },
      jump:  { src: `${DUCK_BASE}/jump.png`,       frames: 4, fps: 14, loop: false },
      fall:  { src: `${DUCK_BASE}/fall.png`,       frames: 1, fps: 1,  loop: true  },
      land:  { src: `${DUCK_BASE}/land.png`,       frames: 2, fps: 14, loop: false },
      roll:  { src: `${DUCK_BASE}/roll_1.png`,     frames: 4, fps: 12, loop: false },
      hit:   { src: `${DUCK_BASE}/hit.png`,        frames: 2, fps: 10, loop: true  },
      punch: { src: `${DUCK_BASE}/right_hook.png`, frames: 5, fps: 20, loop: true },
    };
    const DUCK_FRAME = 64;

    // Preload every wired clip. Kick the game loop on each load, exactly like the
    // other asset loaders. startGameLoop() is idempotent — that matters, because
    // gameLoop re-schedules ITSELF, so calling requestAnimationFrame(gameLoop)
    // here once per image (as this used to) started one extra permanent render
    // chain per clip.
    const duckImages = {};
    for (const name in DUCK_ANIM) {
      const im = new Image();
      im.src = DUCK_ANIM[name].src;
      im.onload = () => { if (typeof startGameLoop === 'function') startGameLoop(); };
      duckImages[name] = im;
    }

    // ---- Local player animation clock ---------------------------------------
    // `animations` (defined in socket.js) is reused as the local player's clip
    // state. setClip swaps clips and resets the frame cursor; tickPlayerAnim
    // advances it, looping or clamping per the clip's `loop` flag.
    function setClip(name) {
      const clip = DUCK_ANIM[name] ? name : 'idle';
      if (animations.clip !== clip) {
        animations.clip = clip;
        animations.frameCount = DUCK_ANIM[clip].frames;
        animations.currentFrame = 0;
        animations.frameTimer = 0;
        animations.done = false;
        player.action = clip; // broadcast field: the clip name doubles as emote
      }
    }

    function tickPlayerAnim(dt) {
      const clip = DUCK_ANIM[animations.clip] || DUCK_ANIM.idle;
      animations.frameCount = clip.frames;
      animations.frameTimer = (animations.frameTimer || 0) + dt;
      const interval = 1 / (clip.fps || 10);
      while (animations.frameTimer >= interval) {
        animations.frameTimer -= interval;
        if (animations.currentFrame + 1 >= clip.frames) {
          if (clip.loop) { animations.currentFrame = 0; }
          else { animations.currentFrame = clip.frames - 1; animations.done = true; break; }
        } else {
          animations.currentFrame++;
        }
      }
    }

    // Landing edge sets this so the (brief) land clip can play; see loop.js.
    let landClipUntil = 0;
    const LAND_CLIP_MS = 160;

    // Priority-ordered clip pick from live game state. Runs every frame after
    // physics. All the flags/timers referenced here are module-level globals
    // shared across the game scripts (movement.js, combat.js, effects.js).
    function updatePlayerClip() {
      const now = performance.now();
      let clip;
      if (controlLockTimer > 0 && !player.onGround) {
        clip = 'hit'; // knocked back: loop the 2 hit frames until we land
      } else if (player.swingStartAt && now - player.swingStartAt < SWING_DURATION_MS) {
        clip = 'punch';
      } else if (isDashing) {
        clip = 'roll';
      } else if (!player.onGround) {
        clip = player.Yv < 0 ? 'jump' : 'fall';
      } else if (now < landClipUntil && Math.abs(player.Xv) <= 12) {
        clip = 'land';
      } else if (Math.abs(player.Xv) > 12) {
        clip = 'walk';
      } else {
        clip = 'idle';
      }
      setClip(clip);
    }

    // ---- Recolor -------------------------------------------------------------
    // The duck body is a 4-shade teal ramp and the beak/feet a 3-shade tan ramp
    // (sampled from idle.png). Recolor maps each source shade to the same
    // lightness in the player's chosen hue, so shading/shape are preserved.
    // Outline and eyes fall outside both palettes and are left untouched.
    const DUCK_BODY_PALETTE = [
      [175, 213, 208], [85, 148, 139], [35, 107, 97], [5, 65, 57],
    ];
    const DUCK_BEAK_PALETTE = [
      [236, 198, 135], [170, 127, 56], [103, 67, 9], [37, 23, 0],
    ];
    // Squared-distance tolerances: tight for the body so the near-black outline
    // (~3158 from the darkest teal) is never caught; looser for the isolated
    // orange beak ramp.
    const BODY_TOL_SQ = 1800;
    const BEAK_TOL_SQ = 4000;

    function hexToRgb(hex) {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
      if (!m) return null;
      const n = parseInt(m[1], 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function rgbToHsl(r, g, b) {
      r /= 255; g /= 255; b /= 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      let h = 0, s = 0; const l = (max + min) / 2;
      const d = max - min;
      if (d !== 0) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        h /= 6;
      }
      return [h, s, l];
    }
    function hslToRgb(h, s, l) {
      let r, g, b;
      if (s === 0) { r = g = b = l; }
      else {
        const hue2rgb = (p, q, t) => {
          if (t < 0) t += 1; if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        r = hue2rgb(p, q, h + 1 / 3); g = hue2rgb(p, q, h); b = hue2rgb(p, q, h - 1 / 3);
      }
      return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }

    // Build the per-shade target colors for a chosen hex: keep the target hue &
    // saturation, but take each output shade's LIGHTNESS from the source shade.
    function shadeTargets(hex, palette) {
      const rgb = hexToRgb(hex);
      if (!rgb) return null;
      const [h, s] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
      return palette.map(([r, g, b]) => hslToRgb(h, s, rgbToHsl(r, g, b)[2]));
    }
    function nearestShade(r, g, b, palette, tolSq) {
      let best = -1, bestD = tolSq;
      for (let i = 0; i < palette.length; i++) {
        const dr = r - palette[i][0], dg = g - palette[i][1], db = b - palette[i][2];
        const d = dr * dr + dg * dg + db * db;
        if (d <= bestD) { bestD = d; best = i; }
      }
      return best;
    }

    // Recolored strips are cached per "bodyHex|beakHex" then per clip name, so
    // the per-pixel work happens once per color choice, not per frame.
    const duckRecolorCache = {};

    function buildRecoloredStrip(img, bodyTargets, beakTargets) {
      const cvs = document.createElement('canvas');
      cvs.width = img.naturalWidth; cvs.height = img.naturalHeight;
      const ctx = cvs.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, cvs.width, cvs.height);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 8) continue; // transparent
        const r = px[i], g = px[i + 1], b = px[i + 2];
        if (bodyTargets) {
          const bi = nearestShade(r, g, b, DUCK_BODY_PALETTE, BODY_TOL_SQ);
          if (bi >= 0) { const t = bodyTargets[bi]; px[i] = t[0]; px[i + 1] = t[1]; px[i + 2] = t[2]; continue; }
        }
        if (beakTargets) {
          const ki = nearestShade(r, g, b, DUCK_BEAK_PALETTE, BEAK_TOL_SQ);
          if (ki >= 0) { const t = beakTargets[ki]; px[i] = t[0]; px[i + 1] = t[1]; px[i + 2] = t[2]; }
        }
      }
      ctx.putImageData(data, 0, 0);
      return cvs;
    }

    // Return the draw source for a clip in the given body/beak colors: the raw
    // Image when no recolor is possible/needed, otherwise a cached recolored
    // canvas. Falls back to idle while a freshly-referenced clip is still
    // loading so the duck never flashes blank.
    function duckSprite(name, bodyHex, beakHex) {
      let img = duckImages[name] || duckImages.idle;
      if (!img || !img.complete || !img.naturalWidth) {
        const fb = duckImages.idle;
        img = (fb && fb.complete && fb.naturalWidth) ? fb : img;
        name = duckImages[name] === img ? name : 'idle';
      }
      if (!img || !img.complete || !img.naturalWidth) return img; // nothing ready yet
      const bodyTargets = shadeTargets(bodyHex, DUCK_BODY_PALETTE);
      const beakTargets = beakHex ? shadeTargets(beakHex, DUCK_BEAK_PALETTE) : null;
      if (!bodyTargets && !beakTargets) return img; // no valid colors -> original
      const key = `${bodyHex || 'x'}|${beakHex || 'x'}`;
      let byClip = duckRecolorCache[key];
      if (!byClip) { byClip = duckRecolorCache[key] = {}; }
      if (!byClip[name]) byClip[name] = buildRecoloredStrip(img, bodyTargets, beakTargets);
      return byClip[name];
    }
