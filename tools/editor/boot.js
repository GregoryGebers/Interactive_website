// ============================================================================
//  BOOT
// ============================================================================
resize();
loadAssets();
loadDraftOrLive().then(() => { fitView(); renderInspector(); });
syncToolButtons();
updateZoomLabel();
requestAnimationFrame(render);
