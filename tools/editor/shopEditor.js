// ============================================================================
//  SHOP SETTINGS MODAL
// ============================================================================
const shopSettingsOverlay = document.getElementById('shopSettingsOverlay');
const cosmeticSettingsGrid = document.getElementById('cosmeticSettingsGrid');
const upgradeSettingsGrid = document.getElementById('upgradeSettingsGrid');
let activeShopTab = 'cosmetics';

function cosmeticSetting(id) {
  return shopConfig.cosmetics.items[id] || (shopConfig.cosmetics.items[id] = { enabled: true, cost: id === 'classic' ? 0 : 10 });
}

function cosmeticCardHTML(c) {
  const cfg = cosmeticSetting(c.id);
  const disabled = cfg.enabled === false;
  const price = Math.max(0, Math.round(Number(cfg.cost) || 0));
  return `<div class="cosmetic-config-card ${disabled ? 'disabled-card' : ''}" data-cosmetic-card="${c.id}">
    <div class="cosmetic-preview" style="background-image:url('${c.idle}')"></div>
    <div class="cosmetic-name">${c.name}</div>
    <div class="cosmetic-id">${c.id}</div>
    <label class="config-toggle"><input type="checkbox" data-cosmetic-enabled="${c.id}" ${cfg.enabled !== false ? 'checked' : ''}> Enabled in shop</label>
    <label class="config-field">
      <span>Price (coins)</span>
      <input class="num" type="number" min="0" data-cosmetic-cost="${c.id}" value="${price}" ${c.starter ? 'disabled' : ''}>
    </label>
    ${c.starter ? '<div class="starter-note">Starter / fallback skin · always free</div>' : ''}
  </div>`;
}

function upgradeModalCardHTML(key, title) {
  const u = shopConfig.upgrades[key];
  const costs = Array.isArray(u.costs) ? u.costs : [];
  const costInputs = costs.map((cost, i) =>
    `<label>Tier ${i + 1}<input class="num" type="number" min="0" data-upgrade-cost="${key}" data-tier-index="${i}" value="${Math.round(Number(cost) || 0)}"></label>`
  ).join('');
  const pct = Object.prototype.hasOwnProperty.call(u, 'pct')
    ? `<label class="config-field"><span>Increase per tier (%)</span><input class="num" type="number" min="0" step="0.1" data-upgrade-pct="${key}" value="${Number(u.pct) || 0}"></label>`
    : '';
  const stun = key === 'knockback'
    ? `<div class="modal-field-grid">
         <label class="config-field"><span>Base hit-stun (ms)</span><input class="num" type="number" min="0" data-knockback-stun="base" value="${Math.round(Number(u.stunBaseMs) || 0)}"></label>
         <label class="config-field"><span>Max-tier hit-stun (ms)</span><input class="num" type="number" min="0" data-knockback-stun="max" value="${Math.round(Number(u.stunMaxMs) || 0)}"></label>
       </div>`
    : '';
  return `<div class="upgrade-config-card ${u.enabled === false ? 'disabled-card' : ''}" data-upgrade-card="${key}">
    <div class="upgrade-config-head">
      <div class="upgrade-config-name">${title}</div>
      <label class="config-toggle" style="margin:0"><input type="checkbox" data-upgrade-enabled="${key}" ${u.enabled !== false ? 'checked' : ''}> Enabled</label>
    </div>
    <div class="tier-costs ${costs.length === 1 ? 'one' : ''}">${costInputs}</div>
    ${pct}${stun}
  </div>`;
}

function renderShopSettings() {
  if (!cosmeticSettingsGrid || !upgradeSettingsGrid) return;
  cosmeticSettingsGrid.innerHTML = COSMETIC_CATALOG.map(cosmeticCardHTML).join('');
  upgradeSettingsGrid.innerHTML = [
    ['jump', 'HIGHER JUMP'],
    ['dash', 'STRONGER DASH'],
    ['knockback', 'STRONGER WEAPON / KNOCKBACK'],
    ['health', 'MORE HEALTH'],
    ['doubleJump', 'DOUBLE JUMP'],
    ['invisibility', 'INVISIBILITY'],
  ].map(([key, title]) => upgradeModalCardHTML(key, title)).join('');
  wireShopSettings();
}

function wireShopSettings() {
  document.querySelectorAll('[data-cosmetic-enabled]').forEach(el => el.addEventListener('change', () => {
    cosmeticSetting(el.dataset.cosmeticEnabled).enabled = el.checked;
    const card = document.querySelector(`[data-cosmetic-card="${el.dataset.cosmeticEnabled}"]`);
    if (card) card.classList.toggle('disabled-card', !el.checked);
  }));
  document.querySelectorAll('[data-cosmetic-cost]').forEach(el => el.addEventListener('input', () => {
    const id = el.dataset.cosmeticCost;
    if (id === 'classic') return;
    const n = Number(el.value);
    if (Number.isFinite(n)) cosmeticSetting(id).cost = Math.max(0, Math.round(n));
  }));
  document.querySelectorAll('[data-upgrade-enabled]').forEach(el => el.addEventListener('change', () => {
    const key = el.dataset.upgradeEnabled;
    shopConfig.upgrades[key].enabled = el.checked;
    const card = document.querySelector(`[data-upgrade-card="${key}"]`);
    if (card) card.classList.toggle('disabled-card', !el.checked);
  }));
  document.querySelectorAll('[data-upgrade-cost]').forEach(el => el.addEventListener('input', () => {
    const key = el.dataset.upgradeCost;
    const i = Number(el.dataset.tierIndex);
    const n = Number(el.value);
    if (Number.isFinite(n) && shopConfig.upgrades[key] && shopConfig.upgrades[key].costs[i] !== undefined) {
      shopConfig.upgrades[key].costs[i] = Math.max(0, Math.round(n));
    }
  }));
  document.querySelectorAll('[data-upgrade-pct]').forEach(el => el.addEventListener('input', () => {
    const n = Number(el.value);
    if (Number.isFinite(n)) shopConfig.upgrades[el.dataset.upgradePct].pct = Math.max(0, n);
  }));
  document.querySelectorAll('[data-knockback-stun]').forEach(el => el.addEventListener('input', () => {
    const n = Number(el.value);
    if (!Number.isFinite(n)) return;
    if (el.dataset.knockbackStun === 'base') shopConfig.upgrades.knockback.stunBaseMs = Math.max(0, Math.round(n));
    else shopConfig.upgrades.knockback.stunMaxMs = Math.max(0, Math.round(n));
  }));
}

function setShopTab(tab) {
  activeShopTab = tab;
  document.querySelectorAll('.shop-tab').forEach(btn => {
    const active = btn.dataset.shopTab === tab;
    btn.classList.toggle('active', active);
    btn.classList.toggle('ghost', !active);
  });
  document.querySelectorAll('.shop-tab-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.shopPanel === tab));
}

function openShopSettings() {
  renderShopSettings();
  setShopTab(activeShopTab);
  shopSettingsOverlay.classList.add('open');
  shopSettingsOverlay.setAttribute('aria-hidden', 'false');
}
function closeShopSettings() {
  shopSettingsOverlay.classList.remove('open');
  shopSettingsOverlay.setAttribute('aria-hidden', 'true');
  canvas.focus();
}

document.getElementById('shopSettingsBtn').addEventListener('click', openShopSettings);
document.getElementById('shopSettingsClose').addEventListener('click', closeShopSettings);
document.getElementById('shopSettingsSave').addEventListener('click', saveShopOnly);
document.getElementById('shopSettingsExport').addEventListener('click', exportShop);
document.getElementById('shopSettingsReload').addEventListener('click', async () => {
  await loadShop(true); renderShopSettings();
});
document.querySelectorAll('.shop-tab').forEach(btn => btn.addEventListener('click', () => setShopTab(btn.dataset.shopTab)));
shopSettingsOverlay.addEventListener('mousedown', e => { if (e.target === shopSettingsOverlay) closeShopSettings(); });

function inspectorAction(act) {
  if (!selection) return;
  if (act === 'delete') { deleteSelection(); return; }
  if (act === 'copy') { copySelection(); return; }
  if (act === 'group') { groupSelection(); return; }
  if (act === 'ungroup') { ungroupSelection(); return; }
  if (selectedRefs().length !== 1 || selection.type !== 'prop') return;
  const i = selection.index;
  if (act === 'front') {
    const [p] = scene.props.splice(i, 1); scene.props.push(p);
    setSelections([{ type:'prop', index: scene.props.length - 1 }]);
  } else if (act === 'back') {
    const [p] = scene.props.splice(i, 1); scene.props.unshift(p);
    setSelections([{ type:'prop', index: 0 }]);
  } else if (act === 'natural') {
    const p = scene.props[i]; const im = getImg(p.src);
    if (im.naturalWidth) { p.width = im.naturalWidth; p.height = im.naturalHeight; }
  }
  renderInspector();
}

function deleteSelection() {
  const refs = selectedRefs().filter(r => r.type !== 'playerStart');
  if (!refs.length) return;
  const byType = {};
  refs.forEach(r => (byType[r.type] ||= []).push(r.index));
  for (const [type, indexes] of Object.entries(byType)) {
    indexes.sort((a,b) => b-a);
    const arr = type === 'prop' ? scene.props : type === 'hitbox' ? scene.hitboxes : type === 'coin' ? scene.coins : type === 'zoomZone' ? scene.camera.zoomZones : type === 'mobZone' ? scene.mobZones : type === 'spawner' ? scene.spawners : null;
    if (!arr) continue;
    indexes.forEach(i => arr.splice(i, 1));
  }
  clearSelection(); renderInspector();
}

function appendSceneObject(type, data) {
  const clone = { ...data };
  let index = -1;
  if (type === 'prop') { scene.props.push(clone); index = scene.props.length - 1; }
  else if (type === 'hitbox') { scene.hitboxes.push(clone); index = scene.hitboxes.length - 1; }
  else if (type === 'coin') { scene.coins.push(clone); index = scene.coins.length - 1; }
  else if (type === 'zoomZone') { scene.camera.zoomZones.push(clone); index = scene.camera.zoomZones.length - 1; }
  else if (type === 'mobZone') { scene.mobZones.push(clone); index = scene.mobZones.length - 1; }
  else if (type === 'spawner') { scene.spawners.push(clone); index = scene.spawners.length - 1; }
  return index >= 0 ? { type, index } : null;
}

// Copy every selected item into one internal clipboard. Saved group IDs are
// remapped during paste, so a pasted building/platform becomes its OWN group
// instead of remaining linked to the originals.
function copySelection() {
  const refs = selectedRefs().filter(r => r.type !== 'playerStart');
  if (!refs.length) { setStatus('nothing copyable selected', 'err'); return; }
  sceneClipboard = {
    entries: refs.map(ref => ({ type: ref.type, data: { ...objectForRef(ref) } })),
    count: refs.length,
  };
  pasteCount = 0;
  setStatus(`${refs.length === 1 ? refs[0].type : refs.length + ' objects'} copied ✓`, 'ok');
}

function pasteSelection() {
  if (!sceneClipboard || !Array.isArray(sceneClipboard.entries) || !sceneClipboard.entries.length) {
    setStatus('copy something first', 'err'); return;
  }
  pasteCount += 1;
  const offset = PASTE_OFFSET * pasteCount;
  const groupMap = new Map();
  const pasted = [];
  for (const entry of sceneClipboard.entries) {
    const data = { ...entry.data };
    data.x = snapVal(Number(data.x || 0) + offset);
    data.y = snapVal(Number(data.y || 0) + offset);
    if (data.groupId) {
      if (!groupMap.has(data.groupId)) groupMap.set(data.groupId, newGroupId());
      data.groupId = groupMap.get(data.groupId);
    }
    const ref = appendSceneObject(entry.type, data);
    if (ref) pasted.push(ref);
  }
  setSelections(pasted, pasted[pasted.length - 1]);
  tool = 'select'; syncToolButtons(); renderInspector();
  setStatus(`${pasted.length === 1 ? pasted[0].type : pasted.length + ' objects'} pasted ✓`, 'ok');
}
