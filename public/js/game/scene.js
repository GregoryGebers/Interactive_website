    // ---- Scene props (decorations) --------------------------------------
    // Props are purely decorative images (trees, bushes, stones...) placed in
    // the editor. They have no collision — that's what hitboxes/boxes are for.
    // Each is { src, x, y, width, height }, drawn in world space.
    let props = [];

    // One <img> per unique src, lazily created and reused across frames so the
    // browser isn't asked to reload the same art every draw.
    const propImages = {};
    function getPropImage(src) {
      if (!propImages[src]) {
        const im = new Image();
        im.src = src;
        propImages[src] = im;
      }
      return propImages[src];
    }

    // ---- Load the level from scene.json ---------------------------------
    // Single source of truth shared with overlay.html and the server. On any
    // failure we simply keep the built-in fallback level defined above, so the
    // game is never left blank. Called immediately below.
    async function loadScene() {
      try {
        let scene;
        if (IS_EDITOR_TEST && EDITOR_TEST_PAYLOAD.scene && typeof EDITOR_TEST_PAYLOAD.scene === 'object') {
          scene = EDITOR_TEST_PAYLOAD.scene;
        } else {
          const res = await fetch('/scene.json', { cache: 'no-store' });
          if (!res.ok) throw new Error('HTTP ' + res.status);
          scene = await res.json();
        }

        if (scene.world && Number.isFinite(scene.world.width) && Number.isFinite(scene.world.height)) {
          WORLD_WIDTH = scene.world.width;
          WORLD_HEIGHT = scene.world.height;
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
        const cam = scene.camera && typeof scene.camera === 'object' ? scene.camera : {};
        cameraBaseZoom = clampCameraZoom(cam.baseZoom ?? 1);
        cameraZoomZones = Array.isArray(cam.zoomZones)
          ? cam.zoomZones.filter(z => z && Number.isFinite(Number(z.x)) && Number.isFinite(Number(z.y)))
              .map(z => ({ x:Number(z.x), y:Number(z.y), width:Math.max(1, Number(z.width) || 1), height:Math.max(1, Number(z.height) || 1), zoom:clampCameraZoom(z.zoom ?? cameraBaseZoom) }))
          : [];
        cameraZoom = cameraBaseZoom;
        cameraTargetZoom = cameraBaseZoom;
        if (scene.ground) {
          if (Number.isFinite(scene.ground.height)) GROUND_GRASS_HEIGHT = scene.ground.height;
          if (Number.isFinite(scene.ground.tileWidth)) GROUND_TILE_WIDTH = scene.ground.tileWidth;
          if (scene.ground.sprite) grassImg.src = scene.ground.sprite;
        }
        // Only reposition the player to the scene's start if they haven't
        // already spawned and started playing.
        if (!hasJoined && scene.playerStart &&
            Number.isFinite(scene.playerStart.x) && Number.isFinite(scene.playerStart.y)) {
          player.x = scene.playerStart.x;
          player.y = scene.playerStart.y;
        }
        resizeCanvas(); // world size may have changed
      } catch (e) {
        console.warn(IS_EDITOR_TEST ? 'Could not load editor test scene — using isolated fallback level:' : 'Could not load scene.json — using built-in fallback level:', e);
      }
    }
    loadScene();

    function drawGrassGround() {
      // The world floor at WORLD_HEIGHT is where players actually land
      // (see the ground-collision check in update()) but had no visual
      // representation before — tile the grass strip across it.
      for (let x = 0; x < WORLD_WIDTH; x += GROUND_TILE_WIDTH) {
        playObj.drawImage(grassImg, x, WORLD_HEIGHT - GROUND_GRASS_HEIGHT, GROUND_TILE_WIDTH, GROUND_GRASS_HEIGHT);
      }
    }

    function setObjects() {
      drawGrassGround();
      // Only decorations (props) are drawn. Hitboxes are invisible collision —
      // put a prop where you want players to see something solid.
      for (const p of props) {
        const im = getPropImage(p.src);
        if (im.complete && im.naturalWidth) {
          playObj.drawImage(im, p.x, p.y, p.width, p.height);
        }
      }
      if (coin != null) {
        playObj.drawImage(coinImg, coin.x, coin.y, 20, 20);
      }
    }


    // Small scratch buffer lets us tint a single sprite frame white without
    // tinting the scenery behind it. It also gives all squash/stretch effects
    // one common draw path.
    const spriteFxCanvas = document.createElement('canvas');
    spriteFxCanvas.width = 64; spriteFxCanvas.height = 64;
    const spriteFxCtx = spriteFxCanvas.getContext('2d');
