  // ---- Duck player model (overlay copy) ------------------------------------
  // Mirrors public/js/game/duck.js so the stream overlay draws the same duck
  // as the game: one horizontal strip per animation, 64x64 frames, facing RIGHT
  // natively (flip for left). Recolor maps the teal body -> the player's color
  // and the tan beak/feet -> their secondary color.
  const DUCK_BASE = '/assets/duck/Ducky/Spritesheets';
  const DUCK_ANIM = {
    idle:  { src: `${DUCK_BASE}/idle.png`,       frames: 4, fps: 8,  loop: true  },
    walk:  { src: `${DUCK_BASE}/walk.png`,       frames: 4, fps: 12, loop: true  },
    jump:  { src: `${DUCK_BASE}/jump.png`,       frames: 4, fps: 14, loop: false },
    fall:  { src: `${DUCK_BASE}/fall.png`,       frames: 1, fps: 1,  loop: true  },
    land:  { src: `${DUCK_BASE}/land.png`,       frames: 2, fps: 14, loop: false },
    roll:  { src: `${DUCK_BASE}/roll_1.png`,     frames: 4, fps: 16, loop: false },
    hit:   { src: `${DUCK_BASE}/hit.png`,        frames: 2, fps: 10, loop: true  },
    punch: { src: `${DUCK_BASE}/right_hook.png`, frames: 5, fps: 20, loop: true  },
  };

  const duckImages = {};
  for (const name in DUCK_ANIM) {
    const im = new Image();
    im.src = DUCK_ANIM[name].src;
    im.onload = () => { if (typeof draw === 'function') requestAnimationFrame(draw); };
    duckImages[name] = im;
  }

  // emote sent by the game already IS the clip name; map the legacy 'run' and
  // anything unknown back to a safe clip.
  function mapDuckClip(emote) {
    if (DUCK_ANIM[emote]) return emote;
    if (emote === 'run') return 'walk';
    return 'idle';
  }

  // ---- Recolor (identical palettes/logic to the game) ----
  const DUCK_BODY_PALETTE = [ [175,213,208], [85,148,139], [35,107,97], [5,65,57] ];
  const DUCK_BEAK_PALETTE = [ [236,198,135], [170,127,56], [103,67,9], [37,23,0] ];
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
    let h = 0, s = 0; const l = (max + min) / 2; const d = max - min;
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

  const duckRecolorCache = {};
  function buildRecoloredStrip(img, bodyTargets, beakTargets) {
    const cvs = document.createElement('canvas');
    cvs.width = img.naturalWidth; cvs.height = img.naturalHeight;
    const c = cvs.getContext('2d');
    c.drawImage(img, 0, 0);
    const data = c.getImageData(0, 0, cvs.width, cvs.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 8) continue;
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
    c.putImageData(data, 0, 0);
    return cvs;
  }
  function duckSprite(name, bodyHex, beakHex) {
    let img = duckImages[name] || duckImages.idle;
    if (!img || !img.complete || !img.naturalWidth) {
      const fb = duckImages.idle;
      if (fb && fb.complete && fb.naturalWidth) { img = fb; name = 'idle'; }
    }
    if (!img || !img.complete || !img.naturalWidth) return img;
    const bodyTargets = shadeTargets(bodyHex, DUCK_BODY_PALETTE);
    const beakTargets = beakHex ? shadeTargets(beakHex, DUCK_BEAK_PALETTE) : null;
    if (!bodyTargets && !beakTargets) return img;
    const key = `${bodyHex || 'x'}|${beakHex || 'x'}`;
    let byClip = duckRecolorCache[key];
    if (!byClip) byClip = duckRecolorCache[key] = {};
    if (!byClip[name]) byClip[name] = buildRecoloredStrip(img, bodyTargets, beakTargets);
    return byClip[name];
  }
