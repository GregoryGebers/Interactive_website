'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  censorChatMessage,
  collapseRepeats,
  isBadToken,
} = require('../src/server/services/profanity.service');

test('collapseRepeats squashes runs', () => {
  assert.strictEqual(collapseRepeats('fuuuuck'), 'fuck');
  assert.strictEqual(collapseRepeats('hello'), 'helo');
});

test('leetspeak evasion is caught', () => {
  assert.strictEqual(isBadToken('f4ck'), true);
  assert.strictEqual(isBadToken('sh!t'), true);
});

test('clean words pass through untouched', () => {
  assert.strictEqual(isBadToken('hello'), false);
  assert.strictEqual(censorChatMessage('hello there friend'), 'hello there friend');
});

test('censorChatMessage stars out an evasion token', () => {
  const out = censorChatMessage('you f4ck');
  assert.ok(/\*+/.test(out));
  assert.ok(!out.includes('f4ck'));
});
