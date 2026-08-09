    // ---- Socket connection ---------------------------------------------------
    // Use the page's own origin in production/custom-domain deployments so
    // the HttpOnly persistence cookie is first-party. The local Python editor
    // still points at the deployed game server for multiplayer testing.
    const LOCAL_SCENE_EDITOR = ['127.0.0.1', 'localhost'].includes(window.location.hostname) &&
      ['8000', '9000'].includes(window.location.port);
    const GAME_SERVER_ORIGIN = LOCAL_SCENE_EDITOR
      ? 'https://interactive-website-9620.onrender.com'
      : window.location.origin;

    const socket = IS_EDITOR_TEST
      ? createEditorTestSocket(EDITOR_TEST_PAYLOAD)
      : io(GAME_SERVER_ORIGIN, {
          reconnection: true,
          reconnectionAttempts: Infinity,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 10000, // tolerate a slow Render cold-start
          timeout: 30000,
          withCredentials: !LOCAL_SCENE_EDITOR,
        });

    const connectionStatus = document.getElementById('connectionStatus');
    const editorTestBadge = document.getElementById('editorTestBadge');
    if (IS_EDITOR_TEST) {
      connectionStatus.style.display = 'none';
      editorTestBadge.style.display = 'block';
      if (!EDITOR_TEST_PAYLOAD.scene) {
        editorTestBadge.innerHTML = 'EDITOR TEST · ISOLATED<br>Draft snapshot missing — live server still blocked';
      }
    } else {
      connectionStatus.style.display = 'block'; // "Connecting..." until first connect
    }

    socket.on('connect', () => {
      connectionStatus.style.display = 'none';
    });
    socket.on('disconnect', () => {
      connectionStatus.textContent = 'Reconnecting...';
      connectionStatus.style.display = 'block';
    });
    socket.io.on('reconnect_attempt', (attempt) => {
      connectionStatus.textContent = `Reconnecting... (attempt ${attempt})`;
      connectionStatus.style.display = 'block';
    });

    const box_1_img = new Image();
    box_1_img.src = '/assets/obstacles/box_1.png';
    box_1_img.onload = () => {
      requestAnimationFrame(gameLoop);
    }

    const trampoline_img = new Image();
    trampoline_img.src = '/assets/obstacles/trampoline.png';
    trampoline_img.onload = () => {
      requestAnimationFrame(gameLoop);
    }

    const idleImg = new Image();
    idleImg.src = '/assets/characters/craftpix-net-879657-free-slime-mobs-pixel-art-top-down-sprite-pack/PNG/Slime1/Idle/Slime1_Idle_body.png';
    idleImg.onload = () => {
      requestAnimationFrame(gameLoop);
    };

    const runImg = new Image();
    runImg.src = '/assets/characters/craftpix-net-879657-free-slime-mobs-pixel-art-top-down-sprite-pack/PNG/Slime1/Run/Slime1_Run_body.png';
    runImg.onload = () => {
      requestAnimationFrame(gameLoop);
    }

    const coinImg = new Image();
    coinImg.src = '/assets/obstacles/coin.png';
    coinImg.onload = () => {
      requestAnimationFrame(gameLoop);
    }

    const grassImg = new Image();
    grassImg.src = '/assets/obstacles/grass.png';
    grassImg.onload = () => {
      requestAnimationFrame(gameLoop);
    }

    // Bat sprite is drawn VERTICALLY (grip at the bottom) — the swing code
    // rotates it around the grip, so image-up = where the bat points.
    const batImg = new Image();
    batImg.src = '/assets/obstacles/bat.png';

    let img = idleImg
    const animations = {
      frameWidth: 64,
      frameHeight: 64,
      frameCount: 6,
      currentFrame: 0,
      frameRow: 0
    };
    const canvas = document.getElementById('game');
    canvas.setAttribute('tabindex', '0');
    canvas.focus();

    const box1 = canvas.getContext('2d');
    const trampoline = canvas.getContext('2d');
    const playObj = canvas.getContext('2d');
