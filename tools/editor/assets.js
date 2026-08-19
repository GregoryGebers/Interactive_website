// ============================================================================
//  ASSET PANEL
// ============================================================================
async function loadAssets() {
  const listEl = document.getElementById('assetList');
  try {
    const res = await fetch(LOCAL_EDITOR_BACKEND ? '/api/assets' : '/api/editor-assets', { cache: 'no-store' });
    const { assets } = await res.json();
    if (!assets.length) {
      listEl.innerHTML = '<p class="assets-hint">No editor assets are currently available.</p>';
      return;
    }
    // Build a nested tree from the path segments after /assets/[edit_assets/],
    // so the panel mirrors your folder structure exactly.
    const root = { folders: {}, files: [] };
    for (const src of assets) {
      const rel = src.replace(/^\/assets\/(edit_assets\/)?/, '');
      const parts = rel.split('/');
      const file = parts.pop();
      let node = root;
      for (const seg of parts) {
        node.folders[seg] = node.folders[seg] || { folders: {}, files: [] };
        node = node.folders[seg];
      }
      node.files.push({ src, name: file });
    }
    listEl.innerHTML = renderTree(root, true);

    listEl.querySelectorAll('.file-row').forEach(el => {
      const src = el.dataset.src;
      el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/asset-src', src); e.dataTransfer.effectAllowed = 'copy'; });
      el.addEventListener('click', () => {
        // Toggle "armed" asset for click-to-place.
        listEl.querySelectorAll('.file-row.active').forEach(t => t.classList.remove('active'));
        if (activeAsset === src) { activeAsset = null; }
        else { activeAsset = src; el.classList.add('active'); setStatus('click canvas to place'); }
      });
    });
  } catch (e) {
    listEl.innerHTML = '<p class="assets-hint">Could not load assets. Is scene_editor.py running?</p>';
  }
}

// How many files sit anywhere beneath this tree node (shown next to folders).
function countFiles(node) {
  let n = node.files.length;
  for (const k in node.folders) n += countFiles(node.folders[k]);
  return n;
}

// Recursively render a tree node: folders as collapsible rows (top level open),
// then each file as a draggable row showing its thumbnail and name.
function renderTree(node, topLevel) {
  let html = '';
  const folderNames = Object.keys(node.folders).sort();
  folderNames.forEach((name, i) => {
    const child = node.folders[name];
    html += `<details class="tree-folder" ${topLevel && i < 4 ? 'open' : ''}>
      <summary>${name}<span class="count">${countFiles(child)}</span></summary>
      <div class="tree-children">${renderTree(child, false)}</div>
    </details>`;
  });
  for (const f of node.files) {
    const label = f.name.replace(/\.[^.]+$/, '');
    html += `<div class="file-row" draggable="true" data-src="${f.src}" title="${f.name}">
      <span class="fr-thumb"><img src="${f.src}" loading="lazy"></span>
      <span class="fr-name">${label}</span>
    </div>`;
  }
  return html;
}

// Click-to-place armed asset (in select tool, empty space).
canvas.addEventListener('click', (e) => {
  if (!activeAsset) return;
  if (drag) return;
  const { sx, sy } = getMouse(e);
  placeProp(activeAsset, s2wx(sx), s2wy(sy), true);
  document.querySelectorAll('.file-row.active').forEach(t => t.classList.remove('active'));
  activeAsset = null;
});
