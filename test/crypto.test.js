'use strict';

// The signed-cookie crypto disables itself unless PLAYER_STATE_SECRET is set,
// so provide a test secret BEFORE requiring the module.
process.env.PLAYER_STATE_SECRET = 'test-secret-of-at-least-thirty-two-characters-long';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('../src/server/utils/crypto');

test('sign then verify round-trips a payload', () => {
  const state = { playerId: 'abc12345', rev: 3, coins: 10, exp: Date.now() + 100000 };
  const token = crypto.signStateToken(state);
  assert.ok(typeof token === 'string' && token.includes('.'));
  const back = crypto.verifyStateToken(token);
  assert.strictEqual(back.coins, 10);
  assert.strictEqual(back.rev, 3);
});

test('a tampered payload fails verification', () => {
  const token = crypto.signStateToken({ coins: 1, exp: Date.now() + 100000 });
  const [payload, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ coins: 999999 })).toString('base64url');
  assert.strictEqual(crypto.verifyStateToken(`${forged}.${sig}`), null);
});

test('an expired token is rejected', () => {
  const token = crypto.signStateToken({ coins: 1, exp: Date.now() - 1000 });
  assert.strictEqual(crypto.verifyStateToken(token), null);
});

test('parseCookies handles multiple pairs', () => {
  const out = crypto.parseCookies('a=1; b=two; c=');
  assert.strictEqual(out.a, '1');
  assert.strictEqual(out.b, 'two');
});
