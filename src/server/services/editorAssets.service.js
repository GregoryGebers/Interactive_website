'use strict';

// Read-only listing of image assets for the public level editor. The editor
// exposes NO write routes online; this is the only editor API served in
// production, and it only reveals files already public through express.static.

const fs = require('fs');
const path = require('path');
const { PUBLIC_DIR, EDIT_ASSETS_DIR, ALL_ASSETS_DIR } = require('../config/paths');

const EDITOR_IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

// ---- Listing cache ----------------------------------------------------------
// The walk below is SYNCHRONOUS and covers thousands of files. Running it per
// request (which is what /api/editor-assets used to do, with Cache-Control:
// no-store) blocks the event loop for every connected player, so a plain loop
// against that one URL was enough to stall the whole game. The asset tree only
// changes when someone adds art and redeploys, so a short TTL is ample.
const LISTING_TTL_MS = 60 * 1000;
let cachedListing = null;
let cachedAt = 0;

/**
 * Cached editor asset listing. Recomputed at most once per LISTING_TTL_MS.
 * @param {{force?: boolean}} [options]
 * @returns {string[]}
 */
function listEditorAssets({ force = false } = {}) {
  const now = Date.now();
  if (!force && cachedListing && now - cachedAt < LISTING_TTL_MS) {
    return cachedListing;
  }
  cachedListing = walkEditorAssets();
  cachedAt = now;
  return cachedListing;
}

/**
 * Walk the editor asset directory and return web paths ("/assets/...") for
 * every image found, sorted. Prefers the curated edit_assets/ folder, falling
 * back to the full assets/ tree if that folder doesn't exist.
 * @returns {string[]}
 */
function walkEditorAssets() {
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

module.exports = { listEditorAssets, walkEditorAssets };
