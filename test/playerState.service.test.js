'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  normalizePersistentState,
  freshPersistentState,
  publicPersistentState,
} = require('../src/server/services/playerState.service');

test('freshPersistentState starts with classic only, zero coins', () => {
  const s = freshPersistentState();
  assert.strictEqual(s.coins, 0);
  assert.deepStrictEqual(s.cosmetics, ['classic']);
  assert.strictEqual(s.equippedSkin, 'classic');
});

test('normalizePersistentState clamps coins to >= 0 integer', () => {
  assert.strictEqual(normalizePersistentState({ coins: -5 }).coins, 0);
  assert.strictEqual(normalizePersistentState({ coins: 12.9 }).coins, 12);
  assert.strictEqual(normalizePersistentState({ coins: 'x' }).coins, 0);
});

test('normalizePersistentState drops unknown cosmetics but keeps known ones', () => {
  const s = normalizePersistentState({ cosmetics: ['classic', 'mob2', 'not-real'] });
  assert.ok(s.cosmetics.includes('mob2'));
  assert.ok(!s.cosmetics.includes('not-real'));
});

test('cannot equip a skin that is not owned', () => {
  const s = normalizePersistentState({ cosmetics: ['classic'], equippedSkin: 'enemy3' });
  assert.strictEqual(s.equippedSkin, 'classic');
});

test('publicPersistentState exposes only display fields', () => {
  const pub = publicPersistentState(freshPersistentState());
  assert.deepStrictEqual(Object.keys(pub).sort(), ['coins', 'cosmetics', 'equippedSkin', 'upgrades']);
  assert.strictEqual(pub.playerId, undefined); // never leak internal id/exp/rev
});
