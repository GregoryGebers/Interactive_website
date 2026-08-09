  let boxes = [
    {x: 0, y: 400, width: 20, height: 20},
    {x: 80, y: 450, width: 20, height: 20},
    {x: 100, y: 450, width: 20, height: 20},
    {x: 120, y: 450, width: 20, height: 20},
    {x: 90, y: 350, width: 20, height: 20},
    {x: 110, y: 350, width: 20, height: 20},
    {x: 200, y: 400, width: 20, height: 20},
    {x: 300, y: 480, width: 20, height: 20},
    {x: 420, y: 420, width: 20, height: 20},
    {x: 440, y: 420, width: 20, height: 20},
    {x: 550, y: 380, width: 20, height: 20},
    {x: 620, y: 340, width: 20, height: 20},
    {x: 645, y: 360, width: 20, height: 20},
    {x: 670, y: 340, width: 20, height: 20},
    {x: 750, y: 380, width: 20, height: 20},
    {x: 770, y: 380, width: 20, height: 20},
    {x: 790, y: 380, width: 20, height: 20},
    {x: 750, y: 440, width: 20, height: 20},
    {x: 770, y: 440, width: 20, height: 20},
    {x: 790, y: 440, width: 20, height: 20},


    {x: 860, y: 400, width: 20, height: 20},
    {x: 860, y: 380, width: 20, height: 20},
    
    {x: 980, y: 380, width: 20, height: 20},

    // ---- Extended world: second screen (1000-2000) ----
    {x: 1060, y: 440, width: 20, height: 20},
    {x: 1080, y: 440, width: 20, height: 20},
    {x: 1160, y: 400, width: 20, height: 20},
    {x: 1240, y: 360, width: 20, height: 20},
    {x: 1260, y: 360, width: 20, height: 20},
    {x: 1350, y: 440, width: 20, height: 20},
    {x: 1370, y: 440, width: 20, height: 20},
    {x: 1390, y: 440, width: 20, height: 20},
    {x: 1380, y: 340, width: 20, height: 20},
    {x: 1400, y: 340, width: 20, height: 20},
    {x: 1500, y: 400, width: 20, height: 20},
    {x: 1520, y: 400, width: 20, height: 20},
    {x: 1600, y: 340, width: 20, height: 20},
    {x: 1660, y: 380, width: 20, height: 20},
    {x: 1680, y: 380, width: 20, height: 20},
    {x: 1780, y: 460, width: 20, height: 20},
    {x: 1780, y: 440, width: 20, height: 20},
    {x: 1780, y: 420, width: 20, height: 20},
    {x: 1860, y: 400, width: 20, height: 20},
    {x: 1880, y: 400, width: 20, height: 20},
    {x: 1960, y: 360, width: 20, height: 20},

    // ---- Extended world: third screen (2000-3000) ----
    {x: 2040, y: 440, width: 20, height: 20},
    {x: 2060, y: 440, width: 20, height: 20},
    {x: 2140, y: 400, width: 20, height: 20},
    {x: 2220, y: 360, width: 20, height: 20},
    {x: 2240, y: 360, width: 20, height: 20},
    {x: 2320, y: 420, width: 20, height: 20},
    {x: 2400, y: 460, width: 20, height: 20},
    {x: 2420, y: 460, width: 20, height: 20},
    {x: 2440, y: 460, width: 20, height: 20},
    {x: 2420, y: 440, width: 20, height: 20},
    {x: 2540, y: 400, width: 20, height: 20},
    {x: 2620, y: 360, width: 20, height: 20},
    {x: 2640, y: 360, width: 20, height: 20},
    {x: 2720, y: 420, width: 20, height: 20},
    {x: 2740, y: 420, width: 20, height: 20},
    {x: 2840, y: 380, width: 20, height: 20},
    {x: 2900, y: 440, width: 20, height: 20},
    {x: 2920, y: 440, width: 20, height: 20},
    {x: 2980, y: 400, width: 20, height: 20},
  ];

  // Same fixed "world" the viewer.html physics/box layout use — now 3000
  // wide (three screens). Unlike viewer.html, the overlay has NO camera:
  // it always shows the ENTIRE world at once by scaling world coordinates
  // down to fit the canvas width. Vertical stays fixed; the same uniform
  // factor is applied to Y so sprites keep their proportions instead of
  // getting squashed.
  let WORLD_WIDTH = 3000;
  let WORLD_HEIGHT = 500;
  let GROUND_GRASS_HEIGHT = 14;
  let GROUND_TILE_WIDTH = 40;

  // 1920 / 3000 = 0.64 — every world unit is 0.64 overlay pixels. Recomputed
  // in loadScene() if the scene's world width differs from the default.
  let WORLD_SCALE = canvas.width / WORLD_WIDTH;

  // ---- Scene props (decorations, no collision) ----
  let props = [];
  const propImages = {};
  function getPropImage(src) {
    if (!propImages[src]) {
      const im = new Image();
      im.src = src;
      propImages[src] = im;
    }
    return propImages[src];
  }

  // Load the level from scene.json — the same file viewer.html and the server
  // read. On any failure we keep the built-in fallback level so the overlay is
  // never blank on stream.
  async function loadScene() {
    try {
      const res = await fetch('/scene.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const scene = await res.json();
      if (scene.world && Number.isFinite(scene.world.width) && Number.isFinite(scene.world.height)) {
        WORLD_WIDTH = scene.world.width;
        WORLD_HEIGHT = scene.world.height;
        WORLD_SCALE = canvas.width / WORLD_WIDTH;
      }
      if (Array.isArray(scene.hitboxes)) {
        boxes = scene.hitboxes
          .filter(b => b && Number.isFinite(b.x) && Number.isFinite(b.y))
          .map(b => ({ x: +b.x, y: +b.y, width: +b.width || 20, height: +b.height || 20 }));
      }
      if (Array.isArray(scene.props)) {
        props = scene.props
          .filter(p => p && p.src && Number.isFinite(p.x) && Number.isFinite(p.y))
          .map(p => ({ src: p.src, x: +p.x, y: +p.y, width: +p.width || 32, height: +p.height || 32 }));
      }
      if (scene.ground) {
        if (Number.isFinite(scene.ground.height)) GROUND_GRASS_HEIGHT = scene.ground.height;
        if (Number.isFinite(scene.ground.tileWidth)) GROUND_TILE_WIDTH = scene.ground.tileWidth;
        if (scene.ground.sprite) grassImg.src = scene.ground.sprite;
      }
    } catch (e) {
      console.warn('Could not load scene.json — using built-in fallback level:', e);
    }
  }
  loadScene();

// Push the rendered world down so jumping players/chat do not get cut off at the top.
const WORLD_OFFSET_Y = 100;

  // Players only send a position update ~30x/sec (see viewer.html's move
  // throttle), but this canvas redraws ~60x/sec. Snapping straight to each
  // new position on arrival is what caused the stutter/teleport look.
  // Instead we ease the drawn position toward the latest known target every
  // frame, scaled by actual elapsed time so it looks the same regardless of
  // OBS's frame rate.
  const OTHER_PLAYER_SMOOTHING_TAU = 0.08; // seconds — lower = snappier, higher = smoother
