'use strict';

// ---- Scene service ----------------------------------------------------------
// Reads the deployed level (public/scene.json) for the data the SERVER needs:
// the coin spawn points. The game and overlay read the same file for rendering.
// Public editor drafts are browser-local and never touch this file.

const fs = require('fs');
const { SCENE_PATH } = require('../config/paths');

// If the scene can't be read or has no coins, we fall back to this built-in
// list so the game still works exactly as before.
const FALLBACK_COINS = [
  { x: 500, y: 480 }, { x: 0, y: 380 }, { x: 100, y: 330 }, { x: 100, y: 430 },
  { x: 300, y: 460 }, { x: 300, y: 330 }, { x: 550, y: 360 }, { x: 500, y: 480 },
  { x: 645, y: 340 }, { x: 815, y: 380 }, { x: 980, y: 360 },
  { x: 1070, y: 420 }, { x: 1160, y: 380 }, { x: 1250, y: 340 }, { x: 1390, y: 320 },
  { x: 1510, y: 380 }, { x: 1600, y: 320 }, { x: 1780, y: 400 }, { x: 1870, y: 380 },
  { x: 1960, y: 340 },
  { x: 2050, y: 420 }, { x: 2140, y: 380 }, { x: 2230, y: 340 }, { x: 2420, y: 420 },
  { x: 2540, y: 380 }, { x: 2630, y: 340 }, { x: 2730, y: 400 }, { x: 2840, y: 360 },
  { x: 2910, y: 420 }, { x: 2980, y: 380 },
];

/**
 * Read + validate coin spawn points from scene.json.
 * @returns {Array<{x:number,y:number}>|null} null on any problem (missing file,
 *   bad JSON, no usable coins) so the caller can fall back.
 */
function loadCoinsFromScene() {
  try {
    const raw = fs.readFileSync(SCENE_PATH, 'utf8');
    const scene = JSON.parse(raw);
    if (!scene || !Array.isArray(scene.coins)) return null;
    const clean = scene.coins
      .filter(c => c && Number.isFinite(Number(c.x)) && Number.isFinite(Number(c.y)))
      .map(c => ({ x: Number(c.x), y: Number(c.y) }));
    return clean.length ? clean : null;
  } catch (e) {
    console.warn('[scene] could not load coins from scene.json — using fallback list:', e.message);
    return null;
  }
}

// Loaded once at startup. The public editor never mutates it; an owner-only
// publish mechanism could hot-swap it later via setCoins().
let coins = loadCoinsFromScene() || FALLBACK_COINS;
console.log(`[scene] loaded ${coins.length} coin spawn points`);

function getCoins() {
  return coins;
}

function setCoins(next) {
  if (Array.isArray(next) && next.length) coins = next;
}

function pickRandomCoin() {
  return coins[Math.floor(Math.random() * coins.length)];
}

module.exports = {
  FALLBACK_COINS,
  loadCoinsFromScene,
  getCoins,
  setCoins,
  pickRandomCoin,
};
