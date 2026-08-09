// ============================================================================
//  INSPECTOR
// ============================================================================
const inspBody = document.getElementById('inspBody');

function renderInspector() {
  const refs = selectedRefs();
  if (!refs.length) { clearSelection(); renderWorldInspector(); return; }
  if (refs.length > 1) { renderMultiInspector(refs); return; }
  selection = refs[0]; selections = refs;
  const t = selection.type;
  let html = `<span class="badge ${t}">${t}</span>`;
  const selectedObj = objectForRef(selection);
  if (selectedObj && selectedObj.groupId) html += `<div class="src-label">Group: <b>${selectedObj.groupId}</b> · clicking any member selects the whole group</div>`;

  if (t === 'prop') {
    const p = scene.props[selection.index];
    html += `<div class="thumb-preview"><img src="${p.src}"></div>`;
    html += `<div class="src-label">${p.src}</div>`;
    html += numRow('X', 'prop-x', p.x) + numRow('Y', 'prop-y', p.y);
    html += numRow('Width', 'prop-w', p.width) + numRow('Height', 'prop-h', p.height);
    html += `<div class="insp-actions">
      <button class="btn ghost" data-act="copy">Copy</button>
      <button class="btn ghost" data-act="front">Front</button>
      <button class="btn ghost" data-act="back">Back</button>
      <button class="btn ghost" data-act="natural">Reset size</button>
      <button class="btn danger" data-act="delete">Delete</button></div>`;
  } else if (t === 'hitbox') {
    const b = scene.hitboxes[selection.index];
    html += numRow('X', 'hb-x', b.x) + numRow('Y', 'hb-y', b.y);
    html += numRow('Width', 'hb-w', b.width) + numRow('Height', 'hb-h', b.height);
    html += `<div class="insp-actions">
      <button class="btn ghost" data-act="copy">Copy</button>
      <button class="btn danger" data-act="delete">Delete</button>
    </div>`;
  } else if (t === 'coin') {
    const c = scene.coins[selection.index];
    html += numRow('X', 'coin-x', c.x) + numRow('Y', 'coin-y', c.y);
    html += `<div class="insp-actions">
      <button class="btn ghost" data-act="copy">Copy</button>
      <button class="btn danger" data-act="delete">Delete</button>
    </div>`;
  } else if (t === 'zoomZone') {
    const z = scene.camera.zoomZones[selection.index];
    html += numRow('X', 'zz-x', z.x) + numRow('Y', 'zz-y', z.y);
    html += numRow('Width', 'zz-w', z.width) + numRow('Height', 'zz-h', z.height);
    html += decimalRow('Zoom ×', 'zz-zoom', z.zoom, 0.05, 0.25, 3);
    html += `<p class="insp-empty">Player-side only. 1.00× = base view, &gt;1 zooms in, &lt;1 zooms out. Last overlapping zone wins.</p>`;
    html += `<div class="insp-actions"><button class="btn ghost" data-act="copy">Copy</button><button class="btn danger" data-act="delete">Delete</button></div>`;
  } else if (t === 'playerStart') {
    const p = scene.playerStart;
    html += numRow('X', 'ps-x', p.x) + numRow('Y', 'ps-y', p.y);
    html += `<p class="insp-empty">The player spawns here on join. There is exactly one spawn.</p>`;
  }
  inspBody.innerHTML = html;
  wireInspector();
}

function renderMultiInspector(refs) {
  const groupable = refs.filter(canGroupRef);
  const groupIds = new Set(groupable.map(ref => objectForRef(ref)?.groupId).filter(Boolean));
  const counts = {}; refs.forEach(r => counts[r.type] = (counts[r.type] || 0) + 1);
  const summary = Object.entries(counts).map(([k,v]) => `${v} ${k}${v===1?'':'s'}`).join(' · ');
  inspBody.innerHTML = `
    <span class="badge multi">${refs.length} SELECTED</span>
    <p class="insp-empty">${summary}</p>
    <p class="insp-empty">Drag any selected object to move the whole selection. Grouping makes props, hitboxes and coins permanently stick together after reload.</p>
    <div class="insp-actions">
      <button class="btn ghost" data-act="copy">Copy group</button>
      <button class="btn gold" data-act="group">Group / Stick</button>
      <button class="btn ghost" data-act="ungroup">Unstick</button>
      <button class="btn danger" data-act="delete">Delete all</button>
    </div>
    <div class="section-divider"></div>
    <p class="insp-empty">${groupIds.size ? `Contains ${groupIds.size} saved group${groupIds.size===1?'':'s'}.` : 'No saved group IDs yet.'}</p>`;
  wireInspector();
}

function renderWorldInspector() {
  inspBody.innerHTML = `
    <p class="insp-empty">Nothing selected. Click an object to edit it, or use the tools above to add new ones.</p>
    <div class="section-divider"></div>
    <span class="badge">WORLD</span>
    ${numRow('Width', 'world-w', scene.world.width)}
    ${numRow('Height', 'world-h', scene.world.height)}
    <div class="section-divider"></div>
    <span class="badge zoomZone">PLAYER CAMERA</span>
    ${decimalRow('Base zoom ×', 'camera-base-zoom', scene.camera.baseZoom, 0.05, 0.25, 3)}
    <p class="insp-empty"><b>${scene.camera.zoomZones.length}</b> zoom zones · only viewer.html uses these; the stream overlay stays unchanged.</p>
    <div class="section-divider"></div>
    <span class="badge">GROUND</span>
    ${numRow('Height', 'ground-h', scene.ground.height)}
    ${numRow('Tile W', 'ground-tw', scene.ground.tileWidth)}
    <div class="section-divider"></div>
    <p class="insp-empty">
      <b>${scene.props.length}</b> props · <b>${scene.hitboxes.length}</b> hitboxes · <b>${scene.coins.length}</b> coins
    </p>
    <button class="btn gold" id="openShopFromInspector" style="width:100%;margin-top:8px">🛒 Open Shop Settings</button>`;
  wireInspector();
  const openBtn = document.getElementById('openShopFromInspector');
  if (openBtn) openBtn.addEventListener('click', openShopSettings);
}

function numRow(label, id, val) {
  return `<div class="insp-row"><label>${label}</label><input class="num" style="width:auto;flex:1" type="number" id="${id}" value="${Math.round(val || 0)}"></div>`;
}
function decimalRow(label, id, val, step=0.05, min=0, max=10) {
  const n = Number(val);
  return `<div class="insp-row"><label>${label}</label><input class="num" style="width:auto;flex:1" type="number" id="${id}" step="${step}" min="${min}" max="${max}" value="${Number.isFinite(n) ? n : 1}"></div>`;
}

function wireInspector() {
  const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('input', () => fn(parseFloat(el.value) || 0)); };
  // Selection fields
  if (selection && selection.type === 'prop') {
    const p = scene.props[selection.index];
    bind('prop-x', v => p.x = v); bind('prop-y', v => p.y = v);
    bind('prop-w', v => p.width = v); bind('prop-h', v => p.height = v);
  } else if (selection && selection.type === 'hitbox') {
    const b = scene.hitboxes[selection.index];
    bind('hb-x', v => b.x = v); bind('hb-y', v => b.y = v);
    bind('hb-w', v => b.width = v); bind('hb-h', v => b.height = v);
  } else if (selection && selection.type === 'coin') {
    const c = scene.coins[selection.index];
    bind('coin-x', v => c.x = v); bind('coin-y', v => c.y = v);
  } else if (selection && selection.type === 'zoomZone') {
    const z = scene.camera.zoomZones[selection.index];
    bind('zz-x', v => z.x = v); bind('zz-y', v => z.y = v);
    bind('zz-w', v => z.width = Math.max(1, v)); bind('zz-h', v => z.height = Math.max(1, v));
    bind('zz-zoom', v => z.zoom = Math.max(0.25, Math.min(3, v || 1)));
  } else if (selection && selection.type === 'playerStart') {
    bind('ps-x', v => scene.playerStart.x = v); bind('ps-y', v => scene.playerStart.y = v);
  } else {
    bind('world-w', v => scene.world.width = Math.max(100, v));
    bind('world-h', v => scene.world.height = Math.max(100, v));
    bind('camera-base-zoom', v => scene.camera.baseZoom = Math.max(0.25, Math.min(3, v || 1)));
    bind('ground-h', v => scene.ground.height = v);
    bind('ground-tw', v => scene.ground.tileWidth = Math.max(1, v));
  }
  // Action buttons
  inspBody.querySelectorAll('[data-act]').forEach(btn => {
    btn.addEventListener('click', () => inspectorAction(btn.dataset.act));
  });
}
