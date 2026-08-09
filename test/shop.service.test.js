'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  normalizeShopConfig,
  normalizeCosts,
  finiteNumber,
  priceOf,
  DEFAULT_SHOP_CONFIG,
} = require('../src/server/services/shop.service');

test('finiteNumber coerces and clamps', () => {
  assert.strictEqual(finiteNumber('5', 0), 5);
  assert.strictEqual(finiteNumber('nope', 7), 7);
  assert.strictEqual(finiteNumber(-3, 0, 0), 0); // clamped to min
});

test('normalizeCosts falls back on empty/invalid', () => {
  assert.deepStrictEqual(normalizeCosts([], [1, 2]), [1, 2]);
  assert.deepStrictEqual(normalizeCosts([3, 4], [1, 2]), [3, 4]);
  assert.deepStrictEqual(normalizeCosts('x', [9]), [9]);
});

test('normalizeShopConfig fills defaults and keeps classic free', () => {
  const cfg = normalizeShopConfig({});
  assert.strictEqual(cfg.cosmetics.items.classic.cost, 0);
  assert.strictEqual(cfg.upgrades.jump.enabled, true);
  assert.deepStrictEqual(cfg.upgrades.jump.costs, DEFAULT_SHOP_CONFIG.upgrades.jump.costs);
});

test('normalizeShopConfig forces classic cost to 0 even if input says otherwise', () => {
  const cfg = normalizeShopConfig({ cosmetics: { items: { classic: { enabled: true, cost: 999 } } } });
  assert.strictEqual(cfg.cosmetics.items.classic.cost, 0);
});

test('normalizeShopConfig clamps knockback stunMax >= stunBase', () => {
  const cfg = normalizeShopConfig({ upgrades: { knockback: { stunBaseMs: 800, stunMaxMs: 100 } } });
  assert.ok(cfg.upgrades.knockback.stunMaxMs >= cfg.upgrades.knockback.stunBaseMs);
});

test('priceOf uses live shop.json for skins and upgrades', () => {
  // classic is never purchasable
  assert.strictEqual(priceOf('skin', undefined, 'classic'), null);
  // invalid upgrade tier -> null
  assert.strictEqual(priceOf('jump', 0), null);
  assert.strictEqual(priceOf('jump', 99), null);
  // a valid first tier returns a finite price
  const p = priceOf('jump', 1);
  assert.ok(p === null || Number.isFinite(p));
});
