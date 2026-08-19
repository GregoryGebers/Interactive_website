// ============================================================================
//  KEYBOARD
// ============================================================================
window.addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (e.key === ' ' && !typing) { spaceDown = true; if (!drag) canvas.style.cursor = 'grab'; }
  if (typing) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') { e.preventDefault(); e.shiftKey ? ungroupSelection() : groupSelection(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); copySelection(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteSelection(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    if (selectedRefs().some(r => r.type !== 'playerStart')) { copySelection(); pasteSelection(); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); saveScene(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
  if (e.key === 'Escape') { if (shopSettingsOverlay.classList.contains('open')) { closeShopSettings(); return; } clearSelection(); activeAsset = null; document.querySelectorAll('.file-row.active').forEach(t => t.classList.remove('active')); renderInspector(); return; }

  const map = { v: 'select', b: 'hitbox', z: 'zoomZone', m: 'mobZone', n: 'spawner', c: 'coin', p: 'playerStart', h: 'pan' };
  if (map[e.key.toLowerCase()]) { tool = map[e.key.toLowerCase()]; syncToolButtons(); return; }

  // Arrow-key nudge moves the entire selection/group together.
  if (selectedRefs().length && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = (e.key === 'ArrowRight' ? step : 0) - (e.key === 'ArrowLeft' ? step : 0);
    const dy = (e.key === 'ArrowDown' ? step : 0) - (e.key === 'ArrowUp' ? step : 0);
    moveSelectedBy(dx, dy); renderInspector();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.key === ' ') { spaceDown = false; syncToolButtons(); }
});
