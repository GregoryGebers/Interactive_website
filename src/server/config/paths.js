'use strict';

const path = require('path');

// Repository root, resolved from this file's location (src/server/config).
const ROOT_DIR = path.join(__dirname, '..', '..', '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const TOOLS_DIR = path.join(ROOT_DIR, 'tools');

// The scene (level layout) and shop config live in public/ so the same files
// can be read by the game (viewer.html / overlay.html), authored in the visual
// editor (editor.html), and read here on the server (coin spawns, pricing).
const SCENE_PATH = path.join(PUBLIC_DIR, 'scene.json');
const SHOP_PATH = path.join(PUBLIC_DIR, 'shop.json');

const VIEWER_HTML_PATH = path.join(PUBLIC_DIR, 'viewer.html');
const EDITOR_HTML_PATH = path.join(TOOLS_DIR, 'editor.html');

// Asset roots the read-only editor asset listing walks.
const EDIT_ASSETS_DIR = path.join(PUBLIC_DIR, 'assets', 'edit_assets');
const ALL_ASSETS_DIR = path.join(PUBLIC_DIR, 'assets');

module.exports = {
  ROOT_DIR,
  PUBLIC_DIR,
  TOOLS_DIR,
  SCENE_PATH,
  SHOP_PATH,
  VIEWER_HTML_PATH,
  EDITOR_HTML_PATH,
  EDIT_ASSETS_DIR,
  ALL_ASSETS_DIR,
};
