'use strict';

const { EDITOR_HTML_PATH } = require('../config/paths');
const { listEditorAssets } = require('../services/editorAssets.service');

// ---- Public, SAFE level editor ---------------------------------------------
// Anyone may open /editor.html and build/test a level, but the public editor is
// deliberately READ-ONLY with respect to the deployed game files:
//   - there is NO public POST /api/scene or /api/shop route here;
//   - editor.html stores drafts in that visitor's browser / downloads JSON;
//   - viewer.html?editorTest=... runs a local isolated test and never joins the
//     live Socket.IO world.
// The only editor API exposed online is a read-only list of image assets that
// are already public through express.static(). (Owner-only scene/shop writes
// are provided separately by the localhost-bound scene_editor.py helper.)
function registerEditorRoutes(app) {
  app.get(['/editor', '/editor.html'], (req, res) => {
    res.sendFile(EDITOR_HTML_PATH);
  });

  app.get('/api/editor-assets', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ assets: listEditorAssets() });
  });
}

module.exports = { registerEditorRoutes };
