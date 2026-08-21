'use strict';

// The shop config is now cached (it used to be re-read from disk on every
// purchase and every combat hit). Hot-reloading an edited shop.json WITHOUT a
// restart is deliberate existing behaviour, so these tests pin both halves:
// the cache must actually cache, and an edit must still take effect.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

const { SHOP_PATH } = require('../src/server/config/paths');
const {
  loadShopConfig,
  invalidateShopConfigCache,
  priceOf,
} = require('../src/server/services/shop.service');

test('repeated loads return the cached object rather than re-reading', () => {
  invalidateShopConfigCache();
  const a = loadShopConfig();
  const b = loadShopConfig();
  assert.strictEqual(a, b, 'the same object should be handed back within the cache window');
});

test('an edit to shop.json is picked up without a restart', async (t) => {
  const original = fs.readFileSync(SHOP_PATH, 'utf8');

  t.after(() => {
    fs.writeFileSync(SHOP_PATH, original, 'utf8');
    invalidateShopConfigCache();
  });

  invalidateShopConfigCache();
  const before = priceOf('jump', 1);

  // Change the first jump tier's price to something unmistakable.
  const edited = JSON.parse(original);
  edited.upgrades = edited.upgrades || {};
  edited.upgrades.jump = { ...(edited.upgrades.jump || {}), enabled: true, costs: [4242, 10, 15] };
  fs.writeFileSync(SHOP_PATH, JSON.stringify(edited, null, 2), 'utf8');

  // The cache is mtime-based with a short stat debounce, so drop it explicitly
  // rather than sleeping — this asserts the reload path, not the timer.
  invalidateShopConfigCache();
  const after = priceOf('jump', 1);

  assert.notStrictEqual(after, before, 'the edited price should be visible');
  assert.strictEqual(after, 4242);
});

test('a malformed shop.json falls back to defaults instead of throwing', (t) => {
  const original = fs.readFileSync(SHOP_PATH, 'utf8');
  t.after(() => {
    fs.writeFileSync(SHOP_PATH, original, 'utf8');
    invalidateShopConfigCache();
  });

  fs.writeFileSync(SHOP_PATH, '{ this is not json', 'utf8');
  invalidateShopConfigCache();

  const cfg = loadShopConfig();
  assert.ok(cfg && cfg.upgrades && cfg.cosmetics, 'must still return a usable config');
  assert.strictEqual(cfg.cosmetics.items.classic.cost, 0);
});
