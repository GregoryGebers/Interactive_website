// ============================================================================
//  SAVE / LOAD / EXPORT
// ============================================================================
function cleanScene() {
  // Emit a tidy, rounded copy so scene.json stays readable.
  const r = n => Math.round(n);
  return {
    version: 2,
    world: { width: r(scene.world.width), height: r(scene.world.height) },
    playerStart: { x: r(scene.playerStart.x), y: r(scene.playerStart.y) },
    ground: { sprite: scene.ground.sprite, height: r(scene.ground.height), tileWidth: r(scene.ground.tileWidth) },
    camera: {
      baseZoom: Math.round(Math.max(0.25, Math.min(3, Number(scene.camera.baseZoom) || 1)) * 100) / 100,
      zoomZones: scene.camera.zoomZones.map(z => ({
        x:r(z.x), y:r(z.y), width:r(z.width), height:r(z.height),
        zoom: Math.round(Math.max(0.25, Math.min(3, Number(z.zoom) || 1)) * 100) / 100,
      })),
    },
    props: scene.props.map(p => {
      // A prop dropped before its image finished loading can still have 0 size.
      // Resolve to the image's natural size now (or a 32px default), so the
      // saved scene always has real dimensions the game can draw.
      let w = p.width, h = p.height;
      if (!w || !h) { const im = getImg(p.src); w = im.naturalWidth || 32; h = im.naturalHeight || 32; }
      return { src: p.src, x: r(p.x), y: r(p.y), width: r(w), height: r(h), ...(p.groupId ? { groupId:p.groupId } : {}) };
    }),
    hitboxes: scene.hitboxes.map(b => ({ x: r(b.x), y: r(b.y), width: r(b.width), height: r(b.height), ...(b.groupId ? { groupId:b.groupId } : {}) })),
    coins: scene.coins.map(c => ({ x: r(c.x), y: r(c.y), ...(c.groupId ? { groupId:c.groupId } : {}) })),
    mobZones: scene.mobZones.map(z => ({ x: r(z.x), y: r(z.y), width: r(z.width), height: r(z.height) })),
    spawners: scene.spawners.map(s => {
      const mob = MOB_TYPES.some(m => m.id === s.mob) ? s.mob : DEFAULT_MOB_TYPE;
      return {
        x: r(s.x), y: r(s.y), width: r(s.width), height: r(s.height),
        mob,
        count: Math.max(1, Math.min(50, Math.round(Number(s.count) || 1))),
        chance: Math.max(0, Math.min(100, Math.round(Number(s.chance ?? DEFAULT_SPAWN_CHANCE)))),
        damage: Math.max(1, Math.min(10, Math.round(Number(s.damage) || mobTypeDef(mob).damage))),
        respawn: Math.max(0, Math.min(600, Math.round(Number(s.respawn ?? DEFAULT_RESPAWN_SECONDS)))),
      };
    }),
  };
}

function persistBrowserDraft({ sceneOnly = false, shopOnly = false } = {}) {
  try {
    if (!shopOnly) localStorage.setItem(DRAFT_SCENE_KEY, JSON.stringify(cleanScene()));
    if (!sceneOnly) localStorage.setItem(DRAFT_SHOP_KEY, JSON.stringify(cleanShopConfig()));
    return true;
  } catch (e) {
    console.error('Could not save browser draft:', e);
    return false;
  }
}

async function saveShopOnly() {
  if (!persistBrowserDraft({ shopOnly: true })) {
    setStatus('browser draft save failed', 'err');
    return;
  }

  // Preserve the owner's old localhost workflow, but NEVER expose these write
  // calls from the public Node editor.
  if (LOCAL_EDITOR_BACKEND) {
    setStatus('saving shop…');
    try {
      const res = await fetch('/api/shop', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cleanShopConfig()),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || ('Shop HTTP ' + res.status));
      setStatus('shop draft + local shop.json saved ✓', 'ok');
    } catch (e) {
      setStatus('draft saved; local file save failed', 'err');
      console.error(e);
    }
    return;
  }

  setStatus('shop draft saved in this browser ✓', 'ok');
}

async function saveScene() {
  if (!persistBrowserDraft()) {
    setStatus('browser draft save failed', 'err');
    return;
  }

  if (LOCAL_EDITOR_BACKEND) {
    setStatus('saving local project files…');
    try {
      const [sceneRes, shopRes] = await Promise.all([
        fetch('/api/scene', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cleanScene()),
        }),
        fetch('/api/shop', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cleanShopConfig()),
        }),
      ]);
      if (!sceneRes.ok) throw new Error((await sceneRes.json().catch(() => ({}))).error || ('Scene HTTP ' + sceneRes.status));
      if (!shopRes.ok) throw new Error((await shopRes.json().catch(() => ({}))).error || ('Shop HTTP ' + shopRes.status));
      setStatus('draft + local scene/shop saved ✓', 'ok');
    } catch (e) {
      setStatus('draft saved; local file save failed', 'err');
      console.error(e);
    }
    return;
  }

  setStatus('draft saved in this browser ✓', 'ok');
}

function cleanShopConfig() {
  const clean = JSON.parse(JSON.stringify(shopConfig));
  clean.version = 2;
  clean.cosmetics = clean.cosmetics && typeof clean.cosmetics === 'object' ? clean.cosmetics : { items: {} };
  clean.cosmetics.items = clean.cosmetics.items && typeof clean.cosmetics.items === 'object' ? clean.cosmetics.items : {};
  for (const c of COSMETIC_CATALOG) {
    const item = clean.cosmetics.items[c.id] || (clean.cosmetics.items[c.id] = {});
    item.enabled = item.enabled !== false;
    item.cost = c.starter ? 0 : Math.max(0, Math.round(Number(item.cost) || 0));
  }
  for (const u of Object.values(clean.upgrades)) {
    u.enabled = u.enabled !== false;
    u.costs = (u.costs || []).map(v => Math.max(0, Math.round(Number(v) || 0)));
    if (Object.prototype.hasOwnProperty.call(u, 'pct')) u.pct = Math.max(0, Number(u.pct) || 0);
  }
  const kb = clean.upgrades.knockback;
  kb.stunBaseMs = Math.max(0, Math.round(Number(kb.stunBaseMs) || 0));
  kb.stunMaxMs = Math.max(kb.stunBaseMs, Math.round(Number(kb.stunMaxMs) || 0));
  return clean;
}

function normalizeEditorShopConfig(raw) {
  const out = JSON.parse(JSON.stringify(DEFAULT_SHOP_CONFIG));
  const src = raw && typeof raw === 'object' ? raw : {};
  const srcCos = src.cosmetics && typeof src.cosmetics === 'object' ? src.cosmetics : {};
  const srcItems = srcCos.items && typeof srcCos.items === 'object' ? srcCos.items : null;
  // Backward compatibility with the previous {enabled,cost} cosmetics shape.
  for (const c of COSMETIC_CATALOG) {
    const target = out.cosmetics.items[c.id];
    const incoming = srcItems && srcItems[c.id] && typeof srcItems[c.id] === 'object' ? srcItems[c.id] : null;
    if (incoming) {
      target.enabled = incoming.enabled !== false;
      const n = Number(incoming.cost);
      if (Number.isFinite(n)) target.cost = c.starter ? 0 : Math.max(0, Math.round(n));
    } else if (!c.starter && (Object.prototype.hasOwnProperty.call(srcCos, 'enabled') || Object.prototype.hasOwnProperty.call(srcCos, 'cost'))) {
      target.enabled = srcCos.enabled !== false;
      const n = Number(srcCos.cost);
      if (Number.isFinite(n)) target.cost = Math.max(0, Math.round(n));
    }
  }
  const srcUp = src.upgrades && typeof src.upgrades === 'object' ? src.upgrades : {};
  for (const [key, fallback] of Object.entries(DEFAULT_SHOP_CONFIG.upgrades)) {
    const incoming = srcUp[key] && typeof srcUp[key] === 'object' ? srcUp[key] : {};
    const u = out.upgrades[key];
    u.enabled = incoming.enabled !== false;
    if (Array.isArray(incoming.costs) && incoming.costs.length) {
      const costs = incoming.costs.map(Number).filter(Number.isFinite).map(v => Math.max(0, Math.round(v)));
      if (costs.length) u.costs = costs;
    }
    if (Object.prototype.hasOwnProperty.call(fallback, 'pct')) {
      const pct = Number(incoming.pct);
      if (Number.isFinite(pct)) u.pct = Math.max(0, pct);
    }
  }
  const kbIn = srcUp.knockback || {};
  const b = Number(kbIn.stunBaseMs), m = Number(kbIn.stunMaxMs);
  if (Number.isFinite(b)) out.upgrades.knockback.stunBaseMs = Math.max(0, Math.round(b));
  if (Number.isFinite(m)) out.upgrades.knockback.stunMaxMs = Math.max(out.upgrades.knockback.stunBaseMs, Math.round(m));
  return out;
}

function applyShopData(raw) {
  shopConfig = normalizeEditorShopConfig(raw);
  if (!selection) renderInspector();
  if (shopSettingsOverlay && shopSettingsOverlay.classList.contains('open')) renderShopSettings();
}

async function loadShop(announce) {
  try {
    const res = await fetch('/shop.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    applyShopData(await res.json());
    if (announce) setStatus('live shop loaded ✓', 'ok');
    return true;
  } catch (e) {
    applyShopData(DEFAULT_SHOP_CONFIG);
    console.warn('loadShop:', e);
    if (announce) setStatus('live shop load failed', 'err');
    return false;
  }
}

function applySceneData(s) {
  if (!s || typeof s !== 'object') throw new Error('Scene JSON must be an object.');
  if (!s.world || !Number.isFinite(Number(s.world.width)) || !Number.isFinite(Number(s.world.height))) {
    throw new Error('Scene JSON needs numeric world.width and world.height.');
  }
  scene.world = { width: +s.world.width || 3000, height: +s.world.height || 500 };
  if (s.playerStart) scene.playerStart = { x: +s.playerStart.x || 0, y: +s.playerStart.y || 0 };
  if (s.ground) scene.ground = {
    sprite: s.ground.sprite || '/assets/obstacles/grass.png',
    height: Number.isFinite(Number(s.ground.height)) ? +s.ground.height : 14,
    tileWidth: +s.ground.tileWidth || 40,
  };
  const cam = s.camera && typeof s.camera === 'object' ? s.camera : {};
  scene.camera.baseZoom = Math.max(0.25, Math.min(3, Number(cam.baseZoom) || 1));
  scene.camera.zoomZones = Array.isArray(cam.zoomZones) ? cam.zoomZones
    .filter(z => z && Number.isFinite(Number(z.x)) && Number.isFinite(Number(z.y)))
    .map(z => ({ x:+z.x, y:+z.y, width:+z.width || 200, height:+z.height || 150, zoom:Math.max(0.25, Math.min(3, Number(z.zoom) || 1)) })) : [];
  scene.props = Array.isArray(s.props) ? s.props
    .filter(p => p && typeof p.src === 'string')
    .map(p => ({ src: p.src, x: +p.x || 0, y: +p.y || 0, width: +p.width || 0, height: +p.height || 0, ...(p.groupId ? {groupId:String(p.groupId)} : {}) })) : [];
  scene.hitboxes = Array.isArray(s.hitboxes) ? s.hitboxes.map(b => ({ x: +b.x || 0, y: +b.y || 0, width: +b.width || 20, height: +b.height || 20, ...(b.groupId ? {groupId:String(b.groupId)} : {}) })) : [];
  scene.coins = Array.isArray(s.coins) ? s.coins.map(c => ({ x: +c.x || 0, y: +c.y || 0, ...(c.groupId ? {groupId:String(c.groupId)} : {}) })) : [];
  scene.mobZones = Array.isArray(s.mobZones) ? s.mobZones
    .filter(z => z && Number.isFinite(Number(z.x)) && Number.isFinite(Number(z.y)))
    .map(z => ({ x:+z.x, y:+z.y, width:Math.max(1, +z.width || 1), height:Math.max(1, +z.height || 1) })) : [];
  scene.spawners = Array.isArray(s.spawners) ? s.spawners
    .filter(sp => sp && Number.isFinite(Number(sp.x)) && Number.isFinite(Number(sp.y)))
    .map(sp => {
      const mob = MOB_TYPES.some(m => m.id === sp.mob) ? sp.mob : DEFAULT_MOB_TYPE;
      return {
        x:+sp.x, y:+sp.y, width:Math.max(1, +sp.width || 1), height:Math.max(1, +sp.height || 1),
        mob,
        count: Math.max(1, Math.min(50, Math.round(Number(sp.count) || 1))),
        chance: Math.max(0, Math.min(100, Math.round(Number(sp.chance ?? DEFAULT_SPAWN_CHANCE)))),
        damage: Math.max(1, Math.min(10, Math.round(Number(sp.damage) || mobTypeDef(mob).damage))),
        respawn: Math.max(0, Math.min(600, Math.round(Number(sp.respawn ?? DEFAULT_RESPAWN_SECONDS)))),
      };
    }) : [];
  clearSelection();
  renderInspector();
}

async function loadScene(announce) {
  try {
    const res = await fetch('/scene.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    applySceneData(await res.json());
    if (announce) setStatus('live scene loaded ✓', 'ok');
    return true;
  } catch (e) {
    if (announce) setStatus('live scene load failed', 'err');
    console.warn('loadScene:', e);
    return false;
  }
}

async function loadAll(announce) {
  const results = await Promise.all([loadScene(false), loadShop(false)]);
  clearSelection();
  renderInspector();
  fitView();
  if (announce) { persistBrowserDraft(); setStatus('published scene + shop copied into your draft ✓', 'ok'); }
  return results;
}

function loadBrowserDraft() {
  const restored = { scene: false, shop: false };
  try {
    const sceneRaw = localStorage.getItem(DRAFT_SCENE_KEY);
    if (sceneRaw) { applySceneData(JSON.parse(sceneRaw)); restored.scene = true; }
  } catch (e) { console.warn('Could not restore scene draft:', e); }
  try {
    const shopRaw = localStorage.getItem(DRAFT_SHOP_KEY);
    if (shopRaw) { applyShopData(JSON.parse(shopRaw)); restored.shop = true; }
  } catch (e) { console.warn('Could not restore shop draft:', e); }
  return restored;
}

async function loadDraftOrLive() {
  const restored = loadBrowserDraft();
  if (!restored.scene) await loadScene(false);
  if (!restored.shop) await loadShop(false);
  if (restored.scene || restored.shop) setStatus('browser draft restored ✓', 'ok');
}

function downloadJson(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  a.click(); URL.revokeObjectURL(a.href);
}

function exportScene() {
  downloadJson('scene.json', cleanScene());
  setStatus('scene.json exported ✓', 'ok');
}

function exportShop() {
  downloadJson('shop.json', cleanShopConfig());
  setStatus('shop.json exported ✓', 'ok');
}

async function readJsonFile(file) {
  if (!file) throw new Error('No file selected.');
  if (file.size > 4 * 1024 * 1024) throw new Error('JSON file is larger than 4 MB.');
  return JSON.parse(await file.text());
}

async function importSceneFile(input) {
  try {
    const parsed = await readJsonFile(input.files && input.files[0]);
    applySceneData(parsed);
    persistBrowserDraft({ sceneOnly: true });
    fitView();
    setStatus('scene JSON imported + draft saved ✓', 'ok');
  } catch (e) {
    console.error(e);
    setStatus('invalid scene JSON', 'err');
  } finally {
    input.value = '';
  }
}

async function importShopFile(input) {
  try {
    const parsed = await readJsonFile(input.files && input.files[0]);
    if (!parsed || typeof parsed !== 'object' || !parsed.cosmetics || !parsed.upgrades) {
      throw new Error('Shop JSON needs cosmetics and upgrades objects.');
    }
    applyShopData(parsed);
    persistBrowserDraft({ shopOnly: true });
    renderShopSettings();
    setStatus('shop JSON imported + draft saved ✓', 'ok');
  } catch (e) {
    console.error(e);
    setStatus('invalid shop JSON', 'err');
  } finally {
    input.value = '';
  }
}

function testDraft() {
  try {
    // Save first so returning to /editor.html restores exactly what was tested.
    persistBrowserDraft();
    const token = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const payload = { scene: cleanScene(), shop: cleanShopConfig(), createdAt: Date.now() };
    localStorage.setItem(TEST_SNAPSHOT_PREFIX + token, JSON.stringify(payload));

    // Clean old test snapshots opportunistically so repeated tests do not grow
    // localStorage forever. Current + recent tabs are kept for reloads.
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(TEST_SNAPSHOT_PREFIX) || key === TEST_SNAPSHOT_PREFIX + token) continue;
      try {
        const old = JSON.parse(localStorage.getItem(key));
        if (!old || Number(old.createdAt) < cutoff) localStorage.removeItem(key);
      } catch (_) { localStorage.removeItem(key); }
    }

    window.open(`/viewer.html?editorTest=${encodeURIComponent(token)}`, '_blank', 'noopener');
    setStatus('isolated test opened ✓', 'ok');
  } catch (e) {
    console.error(e);
    setStatus('could not start test', 'err');
  }
}
