// ============================================================================
//  TOOLBAR WIRING
// ============================================================================

// Shortcuts shown in the bottom status bar, per tool. Only the keys that
// actually do something for the active tool are listed, so the bar stays short.
const TOOL_HINTS = {
  select:      ['Drag: Box Select', 'Shift: Add', 'Ctrl: Remove', 'Ctrl+G: Group',
                'Ctrl+C/V: Copy', 'Arrows: Nudge', 'Del: Delete'],
  hitbox:      ['Drag: Draw Box', 'Wheel: Zoom', 'V: Back to Select', 'Del: Delete'],
  zoomZone:    ['Drag: Draw Zone', 'Zoom × set in Inspector', 'V: Back to Select'],
  mobZone:     ['Drag: Draw Pen', 'Spawners inside are contained', 'V: Back to Select'],
  spawner:     ['Drag: Draw Spawn Area', 'Mob / Weight in Inspector', 'V: Back to Select'],
  coin:        ['Click: Place Coin', 'Snap: Align to Grid', 'V: Back to Select'],
  playerStart: ['Click: Move Spawn', 'Only one spawn exists', 'V: Back to Select'],
  pan:         ['Drag: Move View', 'Wheel: Zoom', 'Space: Temporary Pan', 'Fit: Frame World'],
};
const TOOL_NAMES = {
  select: 'SELECT', hitbox: 'HITBOX', zoomZone: 'ZOOM ZONE', mobZone: 'MOB ZONE',
  spawner: 'SPAWNER', coin: 'COIN', playerStart: 'SPAWN', pan: 'PAN',
};

function syncStatusBar() {
  const nameEl = document.getElementById('statusTool');
  const hintsEl = document.getElementById('statusHints');
  if (!nameEl || !hintsEl) return;
  nameEl.textContent = TOOL_NAMES[tool] || String(tool).toUpperCase();
  hintsEl.innerHTML = (TOOL_HINTS[tool] || []).map(h => {
    const [key, ...rest] = h.split(': ');
    return rest.length
      ? `<span class="hint"><b>${key}</b> ${rest.join(': ')}</span>`
      : `<span class="hint">${key}</span>`;
  }).join('');
}

function syncToolButtons() {
  document.querySelectorAll('.btn.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  canvas.style.cursor = tool === 'pan' ? 'grab' : (tool === 'select' ? 'default' : 'crosshair');
  syncStatusBar();
}
document.querySelectorAll('.btn.tool').forEach(b => {
  b.addEventListener('click', () => { tool = b.dataset.tool; syncToolButtons(); });
});

function updateZoomLabel() { document.getElementById('zoomLabel').textContent = Math.round(view.scale * 100) + '%'; }
document.getElementById('zoomIn').addEventListener('click', () => zoomBy(1.2));
document.getElementById('zoomOut').addEventListener('click', () => zoomBy(1 / 1.2));
document.getElementById('zoomFit').addEventListener('click', fitView);
function zoomBy(f) {
  const cx = canvas.width / 2, cy = canvas.height / 2;
  const wx = s2wx(cx), wy = s2wy(cy);
  view.scale = Math.max(0.1, Math.min(6, view.scale * f));
  view.panX = wx - cx / view.scale; view.panY = wy - cy / view.scale;
  updateZoomLabel();
}
function fitView() {
  const pad = 40;
  const sx = (canvas.width - pad * 2) / scene.world.width;
  const sy = (canvas.height - pad * 2) / scene.world.height;
  view.scale = Math.max(0.1, Math.min(6, Math.min(sx, sy)));
  view.panX = -(canvas.width / view.scale - scene.world.width) / 2;
  view.panY = -(canvas.height / view.scale - scene.world.height) / 2;
  updateZoomLabel();
}

document.getElementById('snapToggle').addEventListener('change', e => snap = e.target.checked);
document.getElementById('groupBtn').addEventListener('click', groupSelection);
document.getElementById('ungroupBtn').addEventListener('click', ungroupSelection);
document.getElementById('gridSize').addEventListener('input', e => gridSize = Math.max(1, parseInt(e.target.value) || 10));

document.getElementById('saveBtn').addEventListener('click', saveScene);
document.getElementById('exportBtn').addEventListener('click', exportScene);
document.getElementById('loadBtn').addEventListener('click', () => loadAll(true));
document.getElementById('importSceneBtn').addEventListener('click', () => document.getElementById('sceneFileInput').click());
document.getElementById('importShopBtn').addEventListener('click', () => document.getElementById('shopFileInput').click());
document.getElementById('sceneFileInput').addEventListener('change', e => importSceneFile(e.target));
document.getElementById('shopFileInput').addEventListener('change', e => importShopFile(e.target));
document.getElementById('testBtn').addEventListener('click', testDraft);

// ---------------------------------------------------------------------------
//  Compact File menu — the import/export/load actions live behind one button so
//  they don't sit next to the everyday editing tools. The buttons themselves are
//  unchanged; only their container moved, so the handlers above still apply.
// ---------------------------------------------------------------------------
const fileMenuWrap = document.getElementById('fileMenuWrap');
const fileMenuBtn = document.getElementById('fileMenuBtn');
function closeFileMenu() {
  fileMenuWrap.classList.remove('open');
  fileMenuBtn.setAttribute('aria-expanded', 'false');
}
fileMenuBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = fileMenuWrap.classList.toggle('open');
  fileMenuBtn.setAttribute('aria-expanded', String(open));
});
document.addEventListener('click', (e) => { if (!fileMenuWrap.contains(e.target)) closeFileMenu(); });
fileMenuWrap.querySelectorAll('.menu-item').forEach(item => item.addEventListener('click', closeFileMenu));
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeFileMenu(); });

syncStatusBar();
