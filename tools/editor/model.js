// ============================================================================
//  Scene Builder — a visual level editor for the platformer. It reads and
//  writes the SAME public/scene.json that viewer.html, overlay.html and the
//  server use, so anything you build here is exactly what the game loads.
// ============================================================================

// ---- Scene model (the thing we save) ---------------------------------------
const scene = {
  version: 2,
  world: { width: 3000, height: 500 },
  playerStart: { x: 100, y: 480 },
  ground: { sprite: '/assets/obstacles/grass.png', height: 14, tileWidth: 40 },
  // Player-side camera only. overlay.html intentionally ignores this block.
  camera: {
    baseZoom: 1,
    zoomZones: [], // { x, y, width, height, zoom } — last overlapping zone wins
  },
  props: [],      // { src, x, y, width, height, groupId? } — decoration
  hitboxes: [],   // { x, y, width, height, groupId? }       — collision
  coins: [],      // { x, y, groupId? }                      — coin spawn points
  // Combat mobs. A mobZone is a rectangle mobs are confined to (they never
  // leave it, even to chase the player). A spawner is a rectangle where mobs
  // of one type appear. `slime` is the first supported type; more can be added
  // to MOB_TYPES without touching the editor's zone/spawner plumbing.
  mobZones: [],   // { x, y, width, height }                 — containment region
  // { x, y, width, height, mob, count, chance, damage }     — mob spawn area
  spawners: [],
};

// Mob types the spawner tool can place. Keep ids and default damage in sync
// with the game's MOB_TYPES (public/js/game/mobs.js). Add rows here to expose
// more mobs — nothing else in the editor needs to change.
const MOB_TYPES = [
  { id: 'slime',    name: 'Slime',          damage: 1, note: 'Leaps at you. Baseline knockback.' },
  { id: 'water',    name: 'Water Slime',    damage: 1, note: 'Same damage as the basic slime, but launches you much further.' },
  { id: 'electric', name: 'Electric Slime', damage: 2, note: 'Chain lightning — arcs to any player standing near the one it hits. Blinks a short distance to close gaps.' },
  { id: 'devil',    name: 'Devil Slime',    damage: 1, note: 'Charges instead of swinging: winds up, then rams. Damage is its speed on impact — 1 up close, 2 at half speed, 3 at full speed. Damage above multiplies that whole ramp.' },
];
const DEFAULT_MOB_TYPE = 'slime';
const DEFAULT_SPAWN_CHANCE = 100;
const DEFAULT_RESPAWN_SECONDS = 10;   // 0 = killed mobs never come back
function mobTypeDef(id) { return MOB_TYPES.find(m => m.id === id) || MOB_TYPES[0]; }

// Public editor safety: on eberhex.com this page NEVER writes deployed files.
// Drafts live in this browser and Test Draft passes a one-off snapshot to
// viewer.html, which runs without joining the live Socket.IO world. The old
// localhost Python editor keeps its project-file save behavior for the owner.
const LOCAL_EDITOR_BACKEND = ['127.0.0.1', 'localhost'].includes(window.location.hostname) &&
  ['8000', '9000'].includes(window.location.port);
const DRAFT_SCENE_KEY = 'eberhex.sceneBuilder.scene.v1';
const DRAFT_SHOP_KEY = 'eberhex.sceneBuilder.shop.v1';
const TEST_SNAPSHOT_PREFIX = 'eberhex.sceneBuilder.test.';


// ---- Shop/combat tuning (saved separately to public/shop.json) ------------
// Cosmetic ids mirror viewer.html. Classic is the guaranteed starter/fallback;
// all purchasable skins can be individually enabled and priced.
const EDITOR_CHAR_DIR = '/assets/characters/craftpix-net-879657-free-slime-mobs-pixel-art-top-down-sprite-pack/PNG/Slime1';
const EDITOR_P_MOB = '/assets/slimes/craftpix-net-788364-free-slime-mobs-pixel-art-top-down-sprite-pack/PNG';
const EDITOR_P_MONSTER = '/assets/slimes/craftpix-net-510319-top-down-pixel-art-slime-monsters-sprite-pack/PNG';
const EDITOR_P_ENEMY = '/assets/slimes/craftpix-net-743043-pixel-art-slime-enemies-top-down-sprite-pack/PNG';
const editorIdleSheet = (base, n) => `${base}/Slime${n}/Parts/Slime${n}_Idle_body.png`;
const COSMETIC_CATALOG = [
  { id: 'classic',  name: 'Classic Slime', idle: `${EDITOR_CHAR_DIR}/Idle/Slime1_Idle_body.png`, starter: true },
  { id: 'mob1',     name: 'Blue Mob',      idle: editorIdleSheet(EDITOR_P_MOB, 1) },
  { id: 'mob2',     name: 'Green Mob',     idle: editorIdleSheet(EDITOR_P_MOB, 2) },
  { id: 'mob3',     name: 'Red Mob',       idle: editorIdleSheet(EDITOR_P_MOB, 3) },
  { id: 'monster1', name: 'Monster I',     idle: editorIdleSheet(EDITOR_P_MONSTER, 1) },
  { id: 'monster2', name: 'Monster II',    idle: editorIdleSheet(EDITOR_P_MONSTER, 2) },
  { id: 'monster3', name: 'Monster III',   idle: editorIdleSheet(EDITOR_P_MONSTER, 3) },
  { id: 'enemy1',   name: 'Enemy I',       idle: editorIdleSheet(EDITOR_P_ENEMY, 1) },
  { id: 'enemy2',   name: 'Enemy II',      idle: editorIdleSheet(EDITOR_P_ENEMY, 2) },
  { id: 'enemy3',   name: 'Enemy III',     idle: editorIdleSheet(EDITOR_P_ENEMY, 3) },
];
const DEFAULT_COSMETIC_ITEMS = Object.fromEntries(
  COSMETIC_CATALOG.map(c => [c.id, { enabled: true, cost: c.starter ? 0 : 10 }])
);
const DEFAULT_SHOP_CONFIG = {
  version: 2,
  cosmetics: { items: DEFAULT_COSMETIC_ITEMS },
  upgrades: {
    jump:         { enabled: true, costs: [5, 10, 15], pct: 10 },
    dash:         { enabled: true, costs: [5, 10, 15], pct: 10 },
    knockback:    { enabled: true, costs: [5, 10, 15], pct: 15, stunBaseMs: 500, stunMaxMs: 1500 },
    health:       { enabled: true, costs: [5, 10, 15] },
    doubleJump:   { enabled: true, costs: [20] },
    invisibility: { enabled: true, costs: [10, 20, 30] },
  },
};
let shopConfig = JSON.parse(JSON.stringify(DEFAULT_SHOP_CONFIG));

// ---- View (camera over the world) ------------------------------------------
const view = { scale: 1, panX: -40, panY: -40 };

// ---- Editor state ----------------------------------------------------------
let tool = 'select';
let selection = null;         // primary selected ref (kept for the existing inspector)
let selections = [];          // every selected ref; Shift/Ctrl-click builds this list
let activeAsset = null;       // asset src armed for click-to-place
let snap = false, gridSize = 10;

// Internal scene clipboard. It can contain one object OR a whole mixed group
// of props/hitboxes/coins/zoom zones, preserving dimensions and relative layout.
let sceneClipboard = null;    // { entries:[{type,data}], count }
let pasteCount = 0;
const PASTE_OFFSET = 20;
let groupSerial = 1;

const COIN_SIZE = 20;         // matches how the game draws coins
const HANDLE = 8;             // resize handle size in screen px

const canvas = document.getElementById('editorCanvas');
const ctx = canvas.getContext('2d');
const wrap = document.getElementById('canvasWrap');
const statusEl = document.getElementById('status');

// ---- Shared image cache ----------------------------------------------------
const imgCache = {};
function getImg(src) {
  if (!imgCache[src]) { const im = new Image(); im.src = src; imgCache[src] = im; }
  return imgCache[src];
}
const grassImg = () => getImg(scene.ground.sprite);
const coinImg = getImg('/assets/obstacles/coin.png');

// ---- Coordinate transforms -------------------------------------------------
function w2sx(x) { return (x - view.panX) * view.scale; }
function w2sy(y) { return (y - view.panY) * view.scale; }
function s2wx(sx) { return sx / view.scale + view.panX; }
function s2wy(sy) { return sy / view.scale + view.panY; }
function snapVal(v) { return snap ? Math.round(v / gridSize) * gridSize : Math.round(v); }

function refKey(ref) { return ref ? `${ref.type}:${ref.index}` : ''; }
function sameRef(a, b) { return !!a && !!b && a.type === b.type && a.index === b.index; }
function selectedRefs() { return selections.filter(ref => !!rectOf(ref.type, ref.index)); }
function setSelections(refs, primary = null) {
  const seen = new Set();
  selections = (refs || []).filter(ref => {
    if (!ref || !rectOf(ref.type, ref.index)) return false;
    const k = refKey(ref); if (seen.has(k)) return false; seen.add(k); return true;
  });
  selection = primary && selections.some(r => sameRef(r, primary))
    ? selections.find(r => sameRef(r, primary))
    : (selections[selections.length - 1] || null);
}
function clearSelection() { setSelections([]); }
function isSelectedRef(type, index) { return selections.some(r => r.type === type && r.index === index); }
function objectForRef(ref) {
  if (!ref) return null;
  if (ref.type === 'prop') return scene.props[ref.index] || null;
  if (ref.type === 'hitbox') return scene.hitboxes[ref.index] || null;
  if (ref.type === 'coin') return scene.coins[ref.index] || null;
  if (ref.type === 'zoomZone') return scene.camera.zoomZones[ref.index] || null;
  if (ref.type === 'mobZone') return scene.mobZones[ref.index] || null;
  if (ref.type === 'spawner') return scene.spawners[ref.index] || null;
  if (ref.type === 'playerStart') return scene.playerStart;
  return null;
}
function canGroupRef(ref) { return !!ref && ['prop','hitbox','coin'].includes(ref.type); }
function allGroupableRefs() {
  const out = [];
  scene.props.forEach((_, index) => out.push({ type:'prop', index }));
  scene.hitboxes.forEach((_, index) => out.push({ type:'hitbox', index }));
  scene.coins.forEach((_, index) => out.push({ type:'coin', index }));
  return out;
}
function allBoxSelectableRefs() {
  return [
    ...allGroupableRefs(),
    ...scene.camera.zoomZones.map((_, index) => ({ type:'zoomZone', index })),
    ...scene.mobZones.map((_, index) => ({ type:'mobZone', index })),
    ...scene.spawners.map((_, index) => ({ type:'spawner', index })),
  ];
}
function rectsIntersect(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
function refsForGroup(groupId) {
  if (!groupId) return [];
  return allGroupableRefs().filter(ref => objectForRef(ref)?.groupId === groupId);
}
function newGroupId() {
  const used = new Set(allGroupableRefs().map(ref => objectForRef(ref)?.groupId).filter(Boolean));
  let id; do { id = `g${groupSerial++}`; } while (used.has(id));
  return id;
}
function toggleSelection(ref) {
  const ix = selections.findIndex(r => sameRef(r, ref));
  if (ix >= 0) selections.splice(ix, 1); else selections.push(ref);
  selection = selections[selections.length - 1] || null;
}
function moveRefTo(ref, x, y) {
  const obj = objectForRef(ref); if (!obj) return; obj.x = x; obj.y = y;
}
function moveSelectedBy(dx, dy) {
  for (const ref of selectedRefs()) {
    const obj = objectForRef(ref);
    if (!obj) continue;
    obj.x += dx; obj.y += dy;
  }
}
function groupSelection() {
  const refs = selectedRefs().filter(canGroupRef);
  if (refs.length < 2) { setStatus('select 2+ props/hitboxes/coins to group', 'err'); return; }
  const id = newGroupId();
  refs.forEach(ref => { objectForRef(ref).groupId = id; });
  setSelections(refs, refs[refs.length - 1]);
  renderInspector(); setStatus(`${refs.length} objects grouped ✓`, 'ok');
}
function ungroupSelection() {
  const refs = selectedRefs().filter(canGroupRef);
  const ids = new Set(refs.map(ref => objectForRef(ref)?.groupId).filter(Boolean));
  if (!ids.size) { setStatus('selected objects are not grouped', 'err'); return; }
  // Unstick the whole selected group(s), not just the one clicked member.
  allGroupableRefs().forEach(ref => { if (ids.has(objectForRef(ref)?.groupId)) delete objectForRef(ref).groupId; });
  renderInspector(); setStatus('group un-stuck ✓', 'ok');
}

function resize() {
  canvas.width = wrap.clientWidth;
  canvas.height = wrap.clientHeight;
}
window.addEventListener('resize', resize);

// ---- Status helper ---------------------------------------------------------
let statusTimer = null;
function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = kind || '';
  if (statusTimer) clearTimeout(statusTimer);
  if (kind === 'ok' || kind === 'err') {
    statusTimer = setTimeout(() => { statusEl.textContent = 'ready'; statusEl.className = ''; }, 2500);
  }
}
