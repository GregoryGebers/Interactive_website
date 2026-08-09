    // ---- Cosmetic slime skins ---------------------------------------------
    // Every skin is just a pair of sprite sheets in the SAME layout as the
    // original slime (Idle 6x4 @64px, Run 8x4 @64px), so swapping one in is
    // purely visual. "classic" is the free default and reuses the already-
    // loaded idle/run images. Each other skin costs 10 coins.
    const CHAR_DIR = '/assets/characters/craftpix-net-879657-free-slime-mobs-pixel-art-top-down-sprite-pack/PNG/Slime1';
    const P_MOB = '/assets/slimes/craftpix-net-788364-free-slime-mobs-pixel-art-top-down-sprite-pack/PNG';
    const P_MONSTER = '/assets/slimes/craftpix-net-510319-top-down-pixel-art-slime-monsters-sprite-pack/PNG';
    const P_ENEMY = '/assets/slimes/craftpix-net-743043-pixel-art-slime-enemies-top-down-sprite-pack/PNG';
    const bodySheets = (base, n) => ({
      idle: `${base}/Slime${n}/Parts/Slime${n}_Idle_body.png`,
      run: `${base}/Slime${n}/Parts/Slime${n}_Run_body.png`,
    });
    const SKINS = {
      classic:  { name: 'Classic Slime',  enabled: true, cost: 0, idle: `${CHAR_DIR}/Idle/Slime1_Idle_body.png`, run: `${CHAR_DIR}/Run/Slime1_Run_body.png` },
      mob1:     { name: 'Blue Mob',        enabled: true, cost: 10, ...bodySheets(P_MOB, 1) },
      mob2:     { name: 'Green Mob',       enabled: true, cost: 10, ...bodySheets(P_MOB, 2) },
      mob3:     { name: 'Red Mob',         enabled: true, cost: 10, ...bodySheets(P_MOB, 3) },
      monster1: { name: 'Monster I',       enabled: true, cost: 10, ...bodySheets(P_MONSTER, 1) },
      monster2: { name: 'Monster II',      enabled: true, cost: 10, ...bodySheets(P_MONSTER, 2) },
      monster3: { name: 'Monster III',     enabled: true, cost: 10, ...bodySheets(P_MONSTER, 3) },
      enemy1:   { name: 'Enemy I',         enabled: true, cost: 10, ...bodySheets(P_ENEMY, 1) },
      enemy2:   { name: 'Enemy II',        enabled: true, cost: 10, ...bodySheets(P_ENEMY, 2) },
      enemy3:   { name: 'Enemy III',       enabled: true, cost: 10, ...bodySheets(P_ENEMY, 3) },
    };

    // Lazily loaded sheet pair per skin. "classic" reuses the images the game
    // already loaded up top so it never re-downloads.
    const skinSheetCache = { classic: { idle: idleImg, run: runImg } };
    function skinSheet(id, action) {
      const key = SKINS[id] ? id : 'classic';
      let sheets = skinSheetCache[key];
      if (!sheets) {
        const s = SKINS[key];
        sheets = { idle: new Image(), run: new Image() };
        sheets.idle.src = s.idle;
        sheets.run.src = s.run;
        skinSheetCache[key] = sheets;
      }
      const want = action === 'run' ? sheets.run : sheets.idle;
      if (want.complete && want.naturalWidth) return want;
      // While a freshly-selected skin is still loading, fall back to classic
      // so the character never flashes a blank frame.
      const c = skinSheetCache.classic;
      const cf = action === 'run' ? c.run : c.idle;
      return (cf.complete && cf.naturalWidth) ? cf : want;
    }

    // Ownership, equipped skin, coins and upgrades are restored by the server
    // from a signed HttpOnly cookie. Nothing valuable is trusted from
    // localStorage anymore.
    let ownedSkins = new Set(['classic']);
    let equippedSkin = 'classic';
    let pendingBuy = null;
    let pendingEquip = null;
    player.skin = 'classic';

    function persistSkins() {
      // Persistence is server-side now. Kept as a no-op so older call sites
      // remain harmless while all authoritative changes flow through sockets.
    }

    async function writeSignedStateCookie(token) {
      if (!token || LOCAL_SCENE_EDITOR || IS_EDITOR_TEST) return; // editor tests never touch the live cookie
      try {
        await fetch('/api/player-state', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
      } catch (e) {
        console.warn('Could not refresh persistent player cookie:', e);
      }
    }

    // The socket server creates the signed state; this browser only hands that
    // opaque token to the HTTP endpoint so it can write an HttpOnly cookie.
