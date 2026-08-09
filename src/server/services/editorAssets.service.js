'use strict';

// Read-only listing of image assets for the public level editor. The editor
// exposes NO write routes online; this is the only editor API served in
// production, and it only reveals files already public through express.static.

const fs = require('fs');
const path = require('path');
const { PUBLIC_DIR, EDIT_ASSETS_DIR, ALL_ASSETS_DIR } = require('../config/paths');

const EDITOR_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

/**
 * Walk the editor asset directory and return web paths ("/assets/...") for
 * every image found, sorted. Prefers the curated edit_assets/ folder, falling
 * back to the full assets/ tree if that folder doesn't exist.
 * @returns {string[]}
 */
function listEditorAssets() {
  const root = fs.existsSync(EDIT_ASSETS_DIR) ? EDIT_ASSETS_DIR : ALL_ASSETS_DIR;
  const out = [];
  if (!fs.existsSync(root)) return out;

  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch (e) { continue; }

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && EDITOR_IMAGE_EXTS.has(path.extname(entry.name).toLowerCase())) {
        const rel = path.relative(PUBLIC_DIR, full).split(path.sep).join('/');
        out.push('/' + rel);
      }
    }
  }
  out.sort();
  return out;
}

module.exports = { listEditorAssets };
