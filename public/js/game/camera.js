    // ---- World vs view --------------------------------------------------
    // The WORLD is now wider than what's on screen: 3000 world units across,
    // three "screens" of playable level. The VIEW is the fixed-size window
    // the player sees at any moment (one screen's worth), and it's the view
    // — not the world — that gets scaled up to fill the browser window.
    // WORLD_WIDTH/HEIGHT and the box layout MUST stay in sync with
    // overlay.html (and the coin spots in server.js).
    // These describe the whole level. They start at the built-in defaults and
    // are overwritten by scene.json once it loads (see loadScene() below), so
    // the game plays even if that fetch fails. `let`, not const, for that swap.
    let WORLD_WIDTH = 3000;
    let WORLD_HEIGHT = 500;
    const VIEW_WIDTH = 1000;   // world units visible horizontally at once
    const VIEW_HEIGHT = 500;   // full world height is always visible

    // ---- Player-side dynamic camera ---------------------------------------
    // scene.json can define a base zoom plus rectangular zoom zones. This is
    // intentionally ONLY implemented in viewer.html: overlay.html keeps its
    // existing full-world framing and ignores scene.camera completely.
    let cameraX = 0;
    let cameraY = 0;
    let cameraBaseZoom = 1;
    let cameraZoom = 1;
    let cameraTargetZoom = 1;
    let cameraZoomZones = [];
    const CAMERA_ZOOM_MIN = 0.25;
    const CAMERA_ZOOM_MAX = 3;
    const CAMERA_ZOOM_TAU = 0.22; // seconds; smooth but responsive zone blend

    let baseScale = 1;
    let scale = 1;
    let offsetX = 0;
    let offsetY = 0;

    function clampCameraZoom(v) {
      const n = Number(v);
      return Math.max(CAMERA_ZOOM_MIN, Math.min(CAMERA_ZOOM_MAX, Number.isFinite(n) ? n : 1));
    }

    function resizeCanvas() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      baseScale = Math.min(canvas.width / VIEW_WIDTH, canvas.height / VIEW_HEIGHT);
      offsetX = (canvas.width - VIEW_WIDTH * baseScale) / 2;
      offsetY = (canvas.height - VIEW_HEIGHT * baseScale) / 2;
      scale = baseScale * cameraZoom;
    }

    function zoomTargetAtPlayer() {
      const px = player.x + player.width / 2;
      const py = player.y + player.height / 2;
      for (let i = cameraZoomZones.length - 1; i >= 0; i--) {
        const z = cameraZoomZones[i];
        if (px >= z.x && px <= z.x + z.width && py >= z.y && py <= z.y + z.height) return clampCameraZoom(z.zoom);
      }
      return cameraBaseZoom;
    }

    function cameraAxisFor(center, worldSize, visibleSize) {
      if (visibleSize >= worldSize) return (worldSize - visibleSize) / 2;
      return Math.max(0, Math.min(center - visibleSize / 2, worldSize - visibleSize));
    }

    function updatePlayerCamera(deltaTime) {
      cameraTargetZoom = zoomTargetAtPlayer();
      const dt = Math.max(0, Math.min(Number(deltaTime) || 0, 0.25));
      const blend = 1 - Math.exp(-dt / CAMERA_ZOOM_TAU);
      cameraZoom += (cameraTargetZoom - cameraZoom) * blend;
      if (Math.abs(cameraTargetZoom - cameraZoom) < 0.001) cameraZoom = cameraTargetZoom;
      cameraZoom = clampCameraZoom(cameraZoom);
      scale = baseScale * cameraZoom;
      const visibleW = VIEW_WIDTH / cameraZoom;
      const visibleH = VIEW_HEIGHT / cameraZoom;
      cameraX = cameraAxisFor(player.x + player.width / 2, WORLD_WIDTH, visibleW);
      cameraY = cameraAxisFor(player.y + player.height / 2, WORLD_HEIGHT, visibleH);
    }

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // Collision rectangles. Seeded with the built-in level as a fallback, then
    // replaced by scene.json in loadScene(). `let` so that swap can happen.
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
    // Horizontal collision-box alignment. The sprite stays exactly where it is;
    // only the physical collision rectangle is shifted. A +2 offset moves the
    // whole 20px-wide hitbox 2 world-pixels to the right, which balances the
    // equal left/right visual gap without making the hitbox wider.
    const PLAYER_HITBOX_OFFSET_X = 2;

    const player = {
      x: 100,
      y: 480,
      width: 20,
      height: 20,
      Yv: 0,
      Yforce: 0,
      YforceMax: 0.5,
      Xv: 0,
      gravity: 500,
      onGround: false,
      friction: 1200,
      speedMax : 150,
      running : false,
      jumping: false,
      username: "",
      color: "#1e3fff",
      action: "idle",
      score: 0,
      chatMessage: null,
      chatExpiresAt: 0,
      facing: 1,        // 1 = right, -1 = left; last direction actually run
      swingStartAt: 0   // performance.now() when the current bat swing began
    };
