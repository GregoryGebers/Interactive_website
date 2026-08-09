'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { sanitizeMoveData } = require('../src/server/utils/validation');
const { WORLD_WIDTH, WORLD_HEIGHT } = require('../src/server/config/gameConfig');

test('rejects non-object and non-finite positions', () => {
  assert.strictEqual(sanitizeMoveData(null), null);
  assert.strictEqual(sanitizeMoveData({ x: 'a', y: 1 }), null);
  assert.strictEqual(sanitizeMoveData({ x: Infinity, y: 1 }), null);
});

test('clamps position to world bounds', () => {
  const clean = sanitizeMoveData({ x: 999999, y: -50 });
  assert.strictEqual(clean.x, WORLD_WIDTH);
  assert.strictEqual(clean.y, 0);
  const clean2 = sanitizeMoveData({ x: -10, y: 999999 });
  assert.strictEqual(clean2.x, 0);
  assert.strictEqual(clean2.y, WORLD_HEIGHT);
});

test('never trusts client skin — uses existing server skin', () => {
  const clean = sanitizeMoveData({ x: 1, y: 1, skin: 'enemy3' }, { skin: 'mob2', score: 5 });
  assert.strictEqual(clean.skin, 'mob2'); // ignores client-supplied skin
});

test('defaults skin to classic when no existing player', () => {
  const clean = sanitizeMoveData({ x: 1, y: 1, skin: 'enemy3' });
  assert.strictEqual(clean.skin, 'classic');
});

test('keeps existing server score, ignores client score', () => {
  const clean = sanitizeMoveData({ x: 1, y: 1, score: 9999 }, { score: 42 });
  assert.strictEqual(clean.score, 42);
});

test('invalid hex color falls back to default', () => {
  const clean = sanitizeMoveData({ x: 1, y: 1, color: 'red' });
  assert.strictEqual(clean.color, '#1e3fff');
  const ok = sanitizeMoveData({ x: 1, y: 1, color: '#AbCdEf' });
  assert.strictEqual(ok.color, '#AbCdEf');
});

test('username is truncated to max length', () => {
  const clean = sanitizeMoveData({ x: 1, y: 1, username: 'x'.repeat(50) });
  assert.strictEqual(clean.username.length, 20);
});
