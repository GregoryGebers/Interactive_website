// ============================================================================
//  MOUSE INTERACTION
// ============================================================================
let drag = null; // { mode, handle, startWX, startWY, orig, panX, panY }
let spaceDown = false;
let mouseWX = 0, mouseWY = 0;
const coordsEl = document.getElementById('coords');

function getMouse(e) {
  const rect = canvas.getBoundingClientRect();
  return { sx: e.clientX - rect.left, sy: e.clientY - rect.top };
}

canvas.addEventListener('mousedown', (e) => {
  const { sx, sy } = getMouse(e);
  const wx = s2wx(sx), wy = s2wy(sy);

  // Panning: middle mouse, or space held, or the Pan tool.
  if (e.button === 1 || spaceDown || tool === 'pan') {
    drag = { mode: 'pan', startSX: sx, startSY: sy, panX: view.panX, panY: view.panY };
    e.preventDefault();
    return;
  }

  if (tool === 'select') {
    const h = handleAt(sx, sy);
    if (h) {
      drag = { mode: 'resize', handle: h, startWX: wx, startWY: wy, orig: { ...rectOf(selection.type, selection.index) } };
      return;
    }

    const hit = hitTest(wx, wy);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (additive) {
      if (hit && hit.type !== 'playerStart') { toggleSelection(hit); renderInspector(); return; }
      drag = { mode:'marquee', startWX:wx, startWY:wy, currentWX:wx, currentWY:wy, additive:true, baseSelections:selectedRefs().map(r => ({...r})) };
      return;
    }

    if (!hit) {
      drag = {
        mode:'marquee', startWX:wx, startWY:wy, currentWX:wx, currentWY:wy,
        additive:false, baseSelections:[],
      };
      return;
    }

    const obj = objectForRef(hit);
    if (canGroupRef(hit) && obj && obj.groupId) setSelections(refsForGroup(obj.groupId), hit);
    else setSelections([hit], hit);
    renderInspector();

    const refs = selectedRefs();
    const origins = refs.map(ref => { const o = objectForRef(ref); return { ref:{...ref}, x:o.x, y:o.y }; });
    const primaryOrigin = origins.find(o => sameRef(o.ref, hit)) || origins[0];
    drag = { mode: 'moveMulti', startWX: wx, startWY: wy, origins, primaryOrigin };
    return;
  }

  if (tool === 'hitbox') {
    const x = snapVal(wx), y = snapVal(wy);
    scene.hitboxes.push({ x, y, width: 0, height: 0 });
    setSelections([{ type: 'hitbox', index: scene.hitboxes.length - 1 }]);
    drag = { mode: 'draw', startWX: x, startWY: y };
    renderInspector();
    return;
  }

  if (tool === 'zoomZone') {
    const x = snapVal(wx), y = snapVal(wy);
    scene.camera.zoomZones.push({ x, y, width: 0, height: 0, zoom: Math.max(0.25, Number(scene.camera.baseZoom) || 1) });
    setSelections([{ type:'zoomZone', index: scene.camera.zoomZones.length - 1 }]);
    drag = { mode:'drawZoom', startWX:x, startWY:y };
    renderInspector();
    return;
  }

  if (tool === 'mobZone') {
    const x = snapVal(wx), y = snapVal(wy);
    scene.mobZones.push({ x, y, width: 0, height: 0 });
    setSelections([{ type:'mobZone', index: scene.mobZones.length - 1 }]);
    drag = { mode:'drawMobZone', startWX:x, startWY:y };
    renderInspector();
    return;
  }

  if (tool === 'spawner') {
    const x = snapVal(wx), y = snapVal(wy);
    scene.spawners.push({
      x, y, width: 0, height: 0,
      mob: DEFAULT_MOB_TYPE, count: 3,
      chance: DEFAULT_SPAWN_CHANCE, damage: mobTypeDef(DEFAULT_MOB_TYPE).damage,
      respawn: DEFAULT_RESPAWN_SECONDS,
    });
    setSelections([{ type:'spawner', index: scene.spawners.length - 1 }]);
    drag = { mode:'drawSpawner', startWX:x, startWY:y };
    renderInspector();
    return;
  }

  if (tool === 'coin') {
    const x = snapVal(wx - COIN_SIZE / 2), y = snapVal(wy - COIN_SIZE / 2);
    scene.coins.push({ x, y });
    setSelections([{ type: 'coin', index: scene.coins.length - 1 }]);
    renderInspector();
    return;
  }

  if (tool === 'playerStart') {
    scene.playerStart.x = snapVal(wx - 10);
    scene.playerStart.y = snapVal(wy - 10);
    setSelections([{ type: 'playerStart', index: 0 }]);
    renderInspector();
    return;
  }
});

window.addEventListener('mousemove', (e) => {
  const { sx, sy } = getMouse(e);
  mouseWX = s2wx(sx); mouseWY = s2wy(sy);
  coordsEl.textContent = `${Math.round(mouseWX)}, ${Math.round(mouseWY)}`;
  if (!drag) return;

  if (drag.mode === 'pan') {
    view.panX = drag.panX - (sx - drag.startSX) / view.scale;
    view.panY = drag.panY - (sy - drag.startSY) / view.scale;
    return;
  }

  const wx = s2wx(sx), wy = s2wy(sy);

  if (drag.mode === 'marquee') {
    drag.currentWX = wx; drag.currentWY = wy;
    return;
  }

  if (drag.mode === 'moveMulti') {
    const rawDX = wx - drag.startWX, rawDY = wy - drag.startWY;
    let dx = rawDX, dy = rawDY;
    if (snap && drag.primaryOrigin) {
      dx = snapVal(drag.primaryOrigin.x + rawDX) - drag.primaryOrigin.x;
      dy = snapVal(drag.primaryOrigin.y + rawDY) - drag.primaryOrigin.y;
    }
    drag.origins.forEach(o => moveRefTo(o.ref, o.x + dx, o.y + dy));
    renderInspector();
    return;
  }

  if (drag.mode === 'draw') {
    const b = scene.hitboxes[selection.index];
    const x2 = snapVal(wx), y2 = snapVal(wy);
    b.x = Math.min(drag.startWX, x2); b.y = Math.min(drag.startWY, y2);
    b.width = Math.abs(x2 - drag.startWX); b.height = Math.abs(y2 - drag.startWY);
    renderInspector();
    return;
  }

  if (drag.mode === 'drawZoom') {
    const z = scene.camera.zoomZones[selection.index];
    const x2 = snapVal(wx), y2 = snapVal(wy);
    z.x = Math.min(drag.startWX, x2); z.y = Math.min(drag.startWY, y2);
    z.width = Math.abs(x2 - drag.startWX); z.height = Math.abs(y2 - drag.startWY);
    renderInspector();
    return;
  }

  if (drag.mode === 'drawMobZone' || drag.mode === 'drawSpawner') {
    const arr = drag.mode === 'drawMobZone' ? scene.mobZones : scene.spawners;
    const z = arr[selection.index];
    const x2 = snapVal(wx), y2 = snapVal(wy);
    z.x = Math.min(drag.startWX, x2); z.y = Math.min(drag.startWY, y2);
    z.width = Math.abs(x2 - drag.startWX); z.height = Math.abs(y2 - drag.startWY);
    renderInspector();
    return;
  }

  if (drag.mode === 'resize') {
    const r = rectOf(selection.type, selection.index);
    const o = drag.orig;
    let left = o.x, top = o.y, right = o.x + o.width, bottom = o.y + o.height;
    const nx = snapVal(wx), ny = snapVal(wy);
    if (drag.handle.includes('w')) left = nx;
    if (drag.handle.includes('e')) right = nx;
    if (drag.handle.includes('n')) top = ny;
    if (drag.handle.includes('s')) bottom = ny;
    r.x = Math.min(left, right); r.y = Math.min(top, bottom);
    r.width = Math.max(1, Math.abs(right - left)); r.height = Math.max(1, Math.abs(bottom - top));
    renderInspector();
    return;
  }
});

window.addEventListener('mouseup', () => {
  if (drag && drag.mode === 'marquee') {
    const x1 = drag.startWX, y1 = drag.startWY, x2 = drag.currentWX ?? x1, y2 = drag.currentWY ?? y1;
    const area = { x:Math.min(x1,x2), y:Math.min(y1,y2), width:Math.abs(x2-x1), height:Math.abs(y2-y1) };
    const picked = (area.width * view.scale >= 3 || area.height * view.scale >= 3)
      ? allBoxSelectableRefs().filter(ref => { const r=rectOf(ref.type, ref.index); return r && rectsIntersect(area, r); })
      : [];
    const combined = drag.additive ? [...drag.baseSelections, ...picked] : picked;
    setSelections(combined, picked[picked.length-1] || combined[combined.length-1] || null);
    renderInspector();
  }
  if (drag && drag.mode === 'draw') {
    const b = scene.hitboxes[selection.index];
    if (b.width < 2 || b.height < 2) { b.width = b.width < 2 ? 40 : b.width; b.height = b.height < 2 ? 20 : b.height; }
    renderInspector();
  }
  if (drag && drag.mode === 'drawZoom') {
    const z = scene.camera.zoomZones[selection.index];
    if (z.width < 2 || z.height < 2) { z.width = z.width < 2 ? 200 : z.width; z.height = z.height < 2 ? 150 : z.height; }
    renderInspector();
  }
  if (drag && (drag.mode === 'drawMobZone' || drag.mode === 'drawSpawner')) {
    const arr = drag.mode === 'drawMobZone' ? scene.mobZones : scene.spawners;
    const z = arr[selection.index];
    const defW = drag.mode === 'drawMobZone' ? 300 : 120;
    const defH = drag.mode === 'drawMobZone' ? 200 : 80;
    if (z.width < 2 || z.height < 2) { z.width = z.width < 2 ? defW : z.width; z.height = z.height < 2 ? defH : z.height; }
    renderInspector();
  }
  drag = null;
});

// Zoom with the wheel, centered on the cursor.
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const { sx, sy } = getMouse(e);
  const wxBefore = s2wx(sx), wyBefore = s2wy(sy);
  const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
  view.scale = Math.max(0.1, Math.min(6, view.scale * factor));
  // Keep the world point under the cursor fixed while zooming.
  view.panX = wxBefore - sx / view.scale;
  view.panY = wyBefore - sy / view.scale;
  updateZoomLabel();
}, { passive: false });

// ---- Drag & drop assets from the panel onto the canvas ----
canvas.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
canvas.addEventListener('drop', (e) => {
  e.preventDefault();
  const src = e.dataTransfer.getData('text/asset-src');
  if (!src) return;
  const { sx, sy } = getMouse(e);
  placeProp(src, s2wx(sx), s2wy(sy), true);
});

function placeProp(src, wx, wy, centered) {
  const im = getImg(src);
  const w = im.naturalWidth || 32, h = im.naturalHeight || 32;
  const prop = {
    src,
    x: snapVal(centered ? wx - w / 2 : wx),
    y: snapVal(centered ? wy - h / 2 : wy),
    width: im.naturalWidth || 0,
    height: im.naturalHeight || 0,
  };
  scene.props.push(prop);
  setSelections([{ type: 'prop', index: scene.props.length - 1 }]);
  tool = 'select'; syncToolButtons();
  renderInspector();
}
