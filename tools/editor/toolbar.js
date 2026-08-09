// ============================================================================
//  TOOLBAR WIRING
// ============================================================================
function syncToolButtons() {
  document.querySelectorAll('.btn.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
  canvas.style.cursor = tool === 'pan' ? 'grab' : (tool === 'select' ? 'default' : 'crosshair');
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
