// ============================================================================
//  HIT TESTING
// ============================================================================
function rectOf(type, index) {
  if (type === 'prop') return scene.props[index];
  if (type === 'hitbox') return scene.hitboxes[index];
  if (type === 'coin') { const c = scene.coins[index]; return c ? { x: c.x, y: c.y, width: COIN_SIZE, height: COIN_SIZE } : null; }
  if (type === 'zoomZone') return scene.camera.zoomZones[index] || null;
  if (type === 'playerStart') { const p = scene.playerStart; return { x: p.x, y: p.y, width: 20, height: 20 }; }
  return null;
}
function pointInRect(wx, wy, r) {
  return wx >= r.x && wx <= r.x + r.width && wy >= r.y && wy <= r.y + r.height;
}
// Topmost object under a world point. Order matters: coins/spawn (small) first,
// then hitboxes, then props (usually the biggest, so they don't steal clicks).
function hitTest(wx, wy) {
  for (let i = scene.coins.length - 1; i >= 0; i--) if (pointInRect(wx, wy, rectOf('coin', i))) return { type: 'coin', index: i };
  if (pointInRect(wx, wy, rectOf('playerStart', 0))) return { type: 'playerStart', index: 0 };
  for (let i = scene.hitboxes.length - 1; i >= 0; i--) if (pointInRect(wx, wy, scene.hitboxes[i])) return { type: 'hitbox', index: i };
  for (let i = scene.props.length - 1; i >= 0; i--) if (pointInRect(wx, wy, scene.props[i])) return { type: 'prop', index: i };
  // Zones are deliberately last because they can be huge; normal level art
  // and collision boxes remain easier to click inside a zoom zone.
  for (let i = scene.camera.zoomZones.length - 1; i >= 0; i--) if (pointInRect(wx, wy, scene.camera.zoomZones[i])) return { type: 'zoomZone', index: i };
  return null;
}
// Which resize handle (if any) is under the mouse for the current selection.
function handleAt(sx, sy) {
  if (!selection || selections.length !== 1 || selection.type === 'coin' || selection.type === 'playerStart') return null;
  const r = rectOf(selection.type, selection.index);
  if (!r) return null;
  for (const h of handlePositions(r)) {
    if (Math.abs(sx - h.sx) <= HANDLE && Math.abs(sy - h.sy) <= HANDLE) return h.id;
  }
  return null;
}
