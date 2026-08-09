  // ---- Cosmetic slime skins (mirrors viewer.html) ----
  // Players send their equipped skin id in each move packet; map it to the
  // right sprite sheets so the overlay shows the same look the game does.
  const CHAR_DIR = '/assets/characters/craftpix-net-879657-free-slime-mobs-pixel-art-top-down-sprite-pack/PNG/Slime1';
  const P_MOB = '/assets/slimes/craftpix-net-788364-free-slime-mobs-pixel-art-top-down-sprite-pack/PNG';
  const P_MONSTER = '/assets/slimes/craftpix-net-510319-top-down-pixel-art-slime-monsters-sprite-pack/PNG';
  const P_ENEMY = '/assets/slimes/craftpix-net-743043-pixel-art-slime-enemies-top-down-sprite-pack/PNG';
  const bodySheets = (base, n) => ({
    idle: `${base}/Slime${n}/Parts/Slime${n}_Idle_body.png`,
    run: `${base}/Slime${n}/Parts/Slime${n}_Run_body.png`,
  });
  const SKINS = {
    classic:  { idle: `${CHAR_DIR}/Idle/Slime1_Idle_body.png`, run: `${CHAR_DIR}/Run/Slime1_Run_body.png` },
    mob1: bodySheets(P_MOB, 1), mob2: bodySheets(P_MOB, 2), mob3: bodySheets(P_MOB, 3),
    monster1: bodySheets(P_MONSTER, 1), monster2: bodySheets(P_MONSTER, 2), monster3: bodySheets(P_MONSTER, 3),
    enemy1: bodySheets(P_ENEMY, 1), enemy2: bodySheets(P_ENEMY, 2), enemy3: bodySheets(P_ENEMY, 3),
  };
  const skinSheetCache = { classic: { idle: idleimg, run: walkimg } };
  function skinSheet(id, action) {
    const key = SKINS[id] ? id : 'classic';
    let sheets = skinSheetCache[key];
    if (!sheets) {
      const s = SKINS[key];
      sheets = { idle: new Image(), run: new Image() };
      sheets.idle.src = s.idle; sheets.run.src = s.run;
      sheets.idle.onload = () => requestAnimationFrame(draw);
      sheets.run.onload = () => requestAnimationFrame(draw);
      skinSheetCache[key] = sheets;
    }
    const want = action === 'run' ? sheets.run : sheets.idle;
    if (want.complete && want.naturalWidth) return want;
    const c = skinSheetCache.classic;
    const cf = action === 'run' ? c.run : c.idle;
    return (cf.complete && cf.naturalWidth) ? cf : want;
  }


  const boximg = new Image();
  boximg.src = '/assets/obstacles/box_1.png';
  boximg.onload = () => requestAnimationFrame(draw);

  const coinImg = new Image();
  coinImg.src = '/assets/obstacles/coin.png';
  coinImg.onload = () => {
    requestAnimationFrame(draw);
  }

  const grassImg = new Image();
  grassImg.src = '/assets/obstacles/grass.png';
  grassImg.onload = () => {
    requestAnimationFrame(draw);
  }

  // Bat sprite is drawn VERTICALLY (grip at the bottom) — the swing code
  // rotates it around the grip, so image-up = where the bat points.
  const batImg = new Image();
  batImg.src = '/assets/obstacles/bat.png';
