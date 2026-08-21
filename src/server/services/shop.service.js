'use strict';

// ---- Shop configuration + authoritative pricing -----------------------------
// public/shop.json is shared by the level editor, viewer and this server. The
// server re-reads it when a purchase or hit happens, so prices and combat
// tuning stay authoritative even though the editor/client can display them.

const fs = require('fs');
const { SHOP_PATH } = require('../config/paths');

const DEFAULT_COSMETIC_ITEMS = {
  classic:  { enabled: true, cost: 0 },
  mob1:     { enabled: true, cost: 10 }, mob2:     { enabled: true, cost: 10 }, mob3:     { enabled: true, cost: 10 },
  monster1: { enabled: true, cost: 10 }, monster2: { enabled: true, cost: 10 }, monster3: { enabled: true, cost: 10 },
  enemy1:   { enabled: true, cost: 10 }, enemy2:   { enabled: true, cost: 10 }, enemy3:   { enabled: true, cost: 10 },
};

const DEFAULT_SHOP_CONFIG = {
  version: 2,
  cosmetics: { items: DEFAULT_COSMETIC_ITEMS },
  upgrades: {
    jump:         { enabled: true, costs: [5, 10, 15], pct: 10 },
    dash:         { enabled: true, costs: [5, 10, 15], pct: 10 },
    knockback:    { enabled: true, costs: [5, 10, 15], pct: 15, stunBaseMs: 500, stunMaxMs: 1500 },
    health:       { enabled: true, costs: [5, 10, 15] },
    doubleJump:   { enabled: true, costs: [20] },
    invisibility: { enabled: true, costs: [10, 20, 30] },
  },
};

function finiteNumber(value, fallback, min = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, n) : fallback;
}

function normalizeCosts(value, fallback) {
  if (!Array.isArray(value) || !value.length) return [...fallback];
  const clean = value
    .map(v => Math.round(finiteNumber(v, NaN, 0)))
    .filter(Number.isFinite);
  return clean.length ? clean : [...fallback];
}

/**
 * Merge a raw (possibly partial or untrusted) shop object onto the defaults,
 * coercing every field to a safe type/range. Backward compatible with the older
 * flat `cosmetics.enabled/cost` shape as well as the current per-item shape.
 * @param {object} raw
 * @returns {object} a fully-populated, validated shop config
 */
function normalizeShopConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const srcUp = src.upgrades && typeof src.upgrades === 'object' ? src.upgrades : {};
  const out = structuredClone(DEFAULT_SHOP_CONFIG);

  const srcCos = src.cosmetics && typeof src.cosmetics === 'object' ? src.cosmetics : {};
  const srcItems = srcCos.items && typeof srcCos.items === 'object' ? srcCos.items : null;
  for (const [id, fallback] of Object.entries(DEFAULT_COSMETIC_ITEMS)) {
    const target = out.cosmetics.items[id];
    const incoming = srcItems && srcItems[id] && typeof srcItems[id] === 'object' ? srcItems[id] : null;
    if (incoming) {
      target.enabled = incoming.enabled !== false;
      target.cost = id === 'classic' ? 0 : Math.round(finiteNumber(incoming.cost, fallback.cost, 0));
    } else if (id !== 'classic' && (Object.prototype.hasOwnProperty.call(srcCos, 'enabled') || Object.prototype.hasOwnProperty.call(srcCos, 'cost'))) {
      target.enabled = srcCos.enabled !== false;
      target.cost = Math.round(finiteNumber(srcCos.cost, fallback.cost, 0));
    }
  }

  for (const [key, fallback] of Object.entries(DEFAULT_SHOP_CONFIG.upgrades)) {
    const incoming = srcUp[key] && typeof srcUp[key] === 'object' ? srcUp[key] : {};
    const target = out.upgrades[key];
    target.enabled = incoming.enabled !== false;
    target.costs = normalizeCosts(incoming.costs, fallback.costs);
    if (Object.prototype.hasOwnProperty.call(fallback, 'pct')) {
      target.pct = finiteNumber(incoming.pct, fallback.pct, 0);
    }
  }

  const kbIn = srcUp.knockback && typeof srcUp.knockback === 'object' ? srcUp.knockback : {};
  out.upgrades.knockback.stunBaseMs = Math.round(finiteNumber(
    kbIn.stunBaseMs, DEFAULT_SHOP_CONFIG.upgrades.knockback.stunBaseMs, 0
  ));
  out.upgrades.knockback.stunMaxMs = Math.max(
    out.upgrades.knockback.stunBaseMs,
    Math.round(finiteNumber(kbIn.stunMaxMs, DEFAULT_SHOP_CONFIG.upgrades.knockback.stunMaxMs, 0))
  );
  return out;
}

// ---- Config cache -----------------------------------------------------------
// loadShopConfig() is called on every purchase, every price lookup and — worst —
// once per player hit inside the combat loop. Each call used to be a synchronous
// readFileSync + JSON.parse + a deep clone of the defaults, i.e. blocking disk
// I/O on the event loop during combat.
//
// The hot-reload-without-restart behaviour is deliberate and preserved: the
// cache is invalidated by the file's mtime, so editing shop.json still takes
// effect within STAT_DEBOUNCE_MS without touching the process. We only stat the
// file (cheap) rather than reading and parsing it (not cheap), and at most once
// per debounce window.
const STAT_DEBOUNCE_MS = 5000;
let cachedConfig = null;
let cachedMtimeMs = -1;
let lastStatAt = 0;

function readShopConfigFromDisk() {
  try {
    return normalizeShopConfig(JSON.parse(fs.readFileSync(SHOP_PATH, 'utf8')));
  } catch (e) {
    console.warn('[shop] could not load shop.json — using defaults:', e.message);
    return normalizeShopConfig(DEFAULT_SHOP_CONFIG);
  }
}

/**
 * Load + normalize shop.json, cached until the file's mtime changes.
 * Callers may mutate the returned object freely only if they clone it first —
 * it is shared. Every current caller treats it as read-only.
 */
function loadShopConfig() {
  const now = Date.now();

  if (cachedConfig && now - lastStatAt < STAT_DEBOUNCE_MS) {
    return cachedConfig;
  }
  lastStatAt = now;

  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(SHOP_PATH).mtimeMs;
  } catch (_) {
    // Missing/unreadable file: fall through and let the reader log + default.
  }

  if (cachedConfig && mtimeMs === cachedMtimeMs) {
    return cachedConfig;
  }

  cachedConfig = readShopConfigFromDisk();
  cachedMtimeMs = mtimeMs;
  return cachedConfig;
}

// Drop the cache (used by tests, which rewrite shop.json faster than mtime
// resolution can distinguish).
function invalidateShopConfigCache() {
  cachedConfig = null;
  cachedMtimeMs = -1;
  lastStatAt = 0;
}

/**
 * Authoritative price for an item/tier.
 * @returns {number|null} the coin price, or null when disabled/invalid.
 */
function priceOf(item, tier, skinId) {
  const cfg = loadShopConfig();
  if (item === 'skin') {
    if (typeof skinId !== 'string' || skinId === 'classic') return null;
    const skin = cfg.cosmetics.items[skinId];
    return skin && skin.enabled !== false ? skin.cost : null;
  }
  const def = cfg.upgrades[item];
  if (!def || !def.enabled) return null;
  const t = Number(tier);
  if (!Number.isInteger(t) || t < 1 || t > def.costs.length) return null;
  return def.costs[t - 1];
}

module.exports = {
  DEFAULT_COSMETIC_ITEMS,
  DEFAULT_SHOP_CONFIG,
  finiteNumber,
  normalizeCosts,
  normalizeShopConfig,
  loadShopConfig,
  invalidateShopConfigCache,
  priceOf,
};
