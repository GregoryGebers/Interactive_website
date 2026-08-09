// ============================================================================
//  RENDERING
// ============================================================================
function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const W = scene.world.width, H = scene.world.height;

  // World backdrop
  ctx.fillStyle = '#101a13';
  ctx.fillRect(w2sx(0), w2sy(0), W * view.scale, H * view.scale);

  drawGrid();

  // Ground strip
  const g = grassImg();
  const gh = scene.ground.height, tw = scene.ground.tileWidth;
  if (g.complete && g.naturalWidth) {
    for (let x = 0; x < W; x += tw) {
      ctx.drawImage(g, w2sx(x), w2sy(H - gh), tw * view.scale, gh * view.scale);
    }
  } else {
    ctx.fillStyle = '#4c9a2a';
    ctx.fillRect(w2sx(0), w2sy(H - gh), W * view.scale, gh * view.scale);
  }

  // Props
  scene.props.forEach((p, i) => {
    const im = getImg(p.src);
    // Adopt natural size the first time the image is known, if not set yet.
    if ((!p.width || !p.height) && im.complete && im.naturalWidth) {
      p.width = im.naturalWidth; p.height = im.naturalHeight;
    }
    if (im.complete && im.naturalWidth) {
      ctx.drawImage(im, w2sx(p.x), w2sy(p.y), (p.width || 32) * view.scale, (p.height || 32) * view.scale);
    } else {
      ctx.fillStyle = 'rgba(126,217,87,.25)';
      ctx.fillRect(w2sx(p.x), w2sy(p.y), (p.width || 32) * view.scale, (p.height || 32) * view.scale);
    }
    if (isSelectedRef('prop', i)) drawSelection(p);
  });

  // Hitboxes are INVISIBLE collision in the game, so here we only draw an
  // editing overlay — a translucent fill + dashed outline — to mark the solid
  // bounds. Nothing of this is rendered in viewer.html / overlay.html.
  scene.hitboxes.forEach((b, i) => {
    const sx = w2sx(b.x), sy = w2sy(b.y), sw = b.width * view.scale, sh = b.height * view.scale;
    ctx.fillStyle = 'rgba(255,193,69,.16)';
    ctx.fillRect(sx, sy, sw, sh);
    ctx.strokeStyle = 'rgba(255,193,69,.9)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(sx, sy, sw, sh);
    ctx.setLineDash([]);
    if (isSelectedRef('hitbox', i)) drawSelection(b);
  });

  // Coins
  scene.coins.forEach((c, i) => {
    if (coinImg.complete && coinImg.naturalWidth) {
      ctx.drawImage(coinImg, w2sx(c.x), w2sy(c.y), COIN_SIZE * view.scale, COIN_SIZE * view.scale);
    } else {
      ctx.fillStyle = '#ffc145';
      ctx.beginPath();
      ctx.arc(w2sx(c.x + COIN_SIZE / 2), w2sy(c.y + COIN_SIZE / 2), (COIN_SIZE / 2) * view.scale, 0, Math.PI * 2);
      ctx.fill();
    }
    if (isSelectedRef('coin', i)) {
      ctx.strokeStyle = '#7ed957'; ctx.lineWidth = 2;
      ctx.strokeRect(w2sx(c.x) - 2, w2sy(c.y) - 2, COIN_SIZE * view.scale + 4, COIN_SIZE * view.scale + 4);
    }
  });

  // Player-only camera zoom zones. These are editor guides only; viewer.html
  // consumes them, while overlay.html deliberately ignores them.
  scene.camera.zoomZones.forEach((z, i) => {
    const sx = w2sx(z.x), sy = w2sy(z.y), sw = z.width * view.scale, sh = z.height * view.scale;
    ctx.fillStyle = 'rgba(129,90,203,.12)'; ctx.fillRect(sx, sy, sw, sh);
    ctx.strokeStyle = isSelectedRef('zoomZone', i) ? '#7ed957' : 'rgba(174,132,255,.95)';
    ctx.lineWidth = isSelectedRef('zoomZone', i) ? 2.5 : 1.5; ctx.setLineDash([7,4]);
    ctx.strokeRect(sx, sy, sw, sh); ctx.setLineDash([]);
    ctx.fillStyle = '#d6c4ff'; ctx.font = 'bold 10px Inter, sans-serif'; ctx.textBaseline = 'top';
    ctx.fillText(`ZOOM ${Number(z.zoom || 1).toFixed(2)}×`, sx + 5, sy + 5);
    if (isSelectedRef('zoomZone', i) && selections.length === 1) drawSelection(z);
  });

  if (selections.length > 1) drawMultiSelectionBounds();
  drawMarquee();

  // Player start marker
  drawPlayerStart();

  // World border
  ctx.strokeStyle = '#5a7a63'; ctx.lineWidth = 2;
  ctx.strokeRect(w2sx(0), w2sy(0), W * view.scale, H * view.scale);

  requestAnimationFrame(render);
}

function drawGrid() {
  if (view.scale < 0.15) return;
  const W = scene.world.width, H = scene.world.height;
  const step = gridSize > 0 ? gridSize : 10;
  // Only draw grid if lines aren't too dense on screen.
  if (step * view.scale >= 6) {
    ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= W; x += step) { ctx.moveTo(w2sx(x), w2sy(0)); ctx.lineTo(w2sx(x), w2sy(H)); }
    for (let y = 0; y <= H; y += step) { ctx.moveTo(w2sx(0), w2sy(y)); ctx.lineTo(w2sx(W), w2sy(y)); }
    ctx.stroke();
  }
}

function drawSelection(r) {
  ctx.strokeStyle = '#7ed957'; ctx.lineWidth = 2;
  ctx.strokeRect(w2sx(r.x), w2sy(r.y), r.width * view.scale, r.height * view.scale);
  // Handles
  ctx.fillStyle = '#7ed957';
  for (const h of handlePositions(r)) {
    ctx.fillRect(h.sx - HANDLE / 2, h.sy - HANDLE / 2, HANDLE, HANDLE);
  }
}

function drawMultiSelectionBounds() {
  const rects = selectedRefs().map(ref => rectOf(ref.type, ref.index)).filter(Boolean);
  if (!rects.length) return;
  const left = Math.min(...rects.map(r => r.x));
  const top = Math.min(...rects.map(r => r.y));
  const right = Math.max(...rects.map(r => r.x + r.width));
  const bottom = Math.max(...rects.map(r => r.y + r.height));
  ctx.strokeStyle = '#7ed957'; ctx.lineWidth = 2; ctx.setLineDash([8,4]);
  ctx.strokeRect(w2sx(left)-3, w2sy(top)-3, (right-left)*view.scale+6, (bottom-top)*view.scale+6);
  ctx.setLineDash([]);
}

function drawMarquee() {
  if (!drag || drag.mode !== 'marquee') return;
  const x1 = drag.startWX, y1 = drag.startWY;
  const x2 = drag.currentWX ?? x1, y2 = drag.currentWY ?? y1;
  const left = Math.min(x1, x2), top = Math.min(y1, y2);
  const right = Math.max(x1, x2), bottom = Math.max(y1, y2);
  ctx.fillStyle = 'rgba(126,217,87,.08)';
  ctx.fillRect(w2sx(left), w2sy(top), (right-left)*view.scale, (bottom-top)*view.scale);
  ctx.strokeStyle = '#7ed957'; ctx.lineWidth = 1.5; ctx.setLineDash([5,3]);
  ctx.strokeRect(w2sx(left), w2sy(top), (right-left)*view.scale, (bottom-top)*view.scale);
  ctx.setLineDash([]);
}

function handlePositions(r) {
  const x1 = w2sx(r.x), y1 = w2sy(r.y);
  const x2 = w2sx(r.x + r.width), y2 = w2sy(r.y + r.height);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  return [
    { id: 'nw', sx: x1, sy: y1 }, { id: 'n', sx: mx, sy: y1 }, { id: 'ne', sx: x2, sy: y1 },
    { id: 'w', sx: x1, sy: my },                                { id: 'e', sx: x2, sy: my },
    { id: 'sw', sx: x1, sy: y2 }, { id: 's', sx: mx, sy: y2 }, { id: 'se', sx: x2, sy: y2 },
  ];
}

function drawPlayerStart() {
  const p = scene.playerStart;
  const sx = w2sx(p.x), sy = w2sy(p.y);
  const sel = isSelectedRef('playerStart', 0);
  // Body box (20x20 like the player)
  ctx.strokeStyle = sel ? '#7ed957' : '#3b6ff5';
  ctx.lineWidth = 2;
  ctx.strokeRect(sx, sy, 20 * view.scale, 20 * view.scale);
  // Flag
  ctx.fillStyle = sel ? '#7ed957' : '#3b6ff5';
  ctx.fillRect(sx, sy - 22, 2, 22);
  ctx.beginPath();
  ctx.moveTo(sx + 2, sy - 22); ctx.lineTo(sx + 16, sy - 17); ctx.lineTo(sx + 2, sy - 12);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 9px Inter, sans-serif'; ctx.textBaseline = 'bottom';
  ctx.fillText('P1', sx + 4, sy - 23);
}
