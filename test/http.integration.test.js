'use strict';

// ---- HTTP route integration tests -------------------------------------------
// The persistence bridge is the one HTTP endpoint that writes durable player
// progression, and it is deliberately unauthenticated: the HMAC signature IS
// the authentication. These tests pin that down, plus the security headers and
// CORS gate added in the hardening pass.

// Requiring the helper first sets PLAYER_STATE_SECRET before any module reads it.
const {
  startTestServer,
  stopTestServer,
  getBaseUrl,
} = require('./helpers/server');

const test = require('node:test');
const assert = require('node:assert');

const { signStateToken } = require('../src/server/utils/crypto');

test.before(startTestServer);
test.after(stopTestServer);

function postState(body, headers = {}) {
  return fetch(`${getBaseUrl()}/api/player-state`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// ---- Signed player state ----------------------------------------------------

test('a validly signed token is accepted and sets an HttpOnly cookie', async () => {
  const token = signStateToken({
    playerId: 'abcd1234', rev: 1, coins: 5, exp: Date.now() + 60000,
  });
  const res = await postState({ token });

  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.ok, true);

  const cookie = res.headers.get('set-cookie') || '';
  assert.match(cookie, /HttpOnly/i, 'the save cookie must not be readable by JS');
  assert.match(cookie, /SameSite=Lax/i);
});

test('a forged token is rejected', async () => {
  const good = signStateToken({ coins: 1, exp: Date.now() + 60000 });
  const sig = good.slice(good.lastIndexOf('.') + 1);
  const forgedPayload = Buffer
    .from(JSON.stringify({ coins: 999999, exp: Date.now() + 60000 }))
    .toString('base64url');

  const res = await postState({ token: `${forgedPayload}.${sig}` });

  assert.strictEqual(res.status, 400, 'a tampered payload must not be accepted');
  const body = await res.json();
  assert.strictEqual(body.ok, false);
  assert.strictEqual(res.headers.get('set-cookie'), null, 'no cookie may be set');
});

test('an unsigned/garbage token is rejected', async () => {
  for (const token of ['', 'nonsense', 'a.b', '.', 'x'.repeat(200)]) {
    const res = await postState({ token });
    assert.strictEqual(res.status, 400, `token ${JSON.stringify(token)} must be rejected`);
  }
});

test('an expired token is rejected', async () => {
  const token = signStateToken({ coins: 1, exp: Date.now() - 1000 });
  const res = await postState({ token });
  assert.strictEqual(res.status, 400);
});

test('an older revision cannot overwrite a newer one', async () => {
  const playerId = 'rollback-test-id';
  const newer = signStateToken({ playerId, rev: 10, coins: 100, exp: Date.now() + 60000 });
  const first = await postState({ token: newer });
  assert.strictEqual(first.status, 200);

  // Replay the cookie we were just given, alongside an older save.
  const cookie = (first.headers.get('set-cookie') || '').split(';')[0];
  const older = signStateToken({ playerId, rev: 2, coins: 5, exp: Date.now() + 60000 });
  const second = await postState({ token: older }, { Cookie: cookie });

  assert.strictEqual(second.status, 409, 'a stale save must be refused');
  const body = await second.json();
  assert.strictEqual(body.stale, true);
});

// ---- Security headers -------------------------------------------------------

test('security headers are present on the game page', async () => {
  const res = await fetch(`${getBaseUrl()}/`);
  assert.strictEqual(res.status, 200);

  const csp = res.headers.get('content-security-policy');
  assert.ok(csp, 'a Content-Security-Policy must be set');
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.ok(
    !/script-src[^;]*\*/.test(csp),
    'script-src must not contain a wildcard'
  );
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  assert.ok(res.headers.get('referrer-policy'), 'a Referrer-Policy must be set');
});

test('static art is cached long-term but scene/shop config is never cached', async () => {
  const asset = await fetch(`${getBaseUrl()}/assets/obstacles/coin.png`);
  assert.match(asset.headers.get('cache-control') || '', /max-age=\d{5,}/);

  for (const file of ['scene.json', 'shop.json']) {
    const res = await fetch(`${getBaseUrl()}/${file}`);
    assert.strictEqual(
      res.headers.get('cache-control'),
      'no-store',
      `${file} is hot-reloaded and must not be cached`
    );
  }
});

// ---- Socket.IO CORS gate ----------------------------------------------------

test('a socket handshake from an unlisted origin is refused', async () => {
  const res = await fetch(`${getBaseUrl()}/socket.io/?EIO=4&transport=polling`, {
    headers: { Origin: 'https://evil.example.com' },
  });
  assert.strictEqual(res.status, 403, 'cross-origin handshakes must be refused');
});

test('a same-origin handshake and an origin-less client are allowed', async () => {
  const base = getBaseUrl();
  const sameOrigin = await fetch(`${base}/socket.io/?EIO=4&transport=polling`, {
    headers: { Origin: base },
  });
  assert.strictEqual(sameOrigin.status, 200, 'the game must be able to connect to itself');

  // No Origin header at all: OBS browser sources, curl, native clients.
  const noOrigin = await fetch(`${base}/socket.io/?EIO=4&transport=polling`);
  assert.strictEqual(noOrigin.status, 200);
});

// ---- Health -----------------------------------------------------------------

test('/health reports operational state without leaking secrets', async () => {
  const res = await fetch(`${getBaseUrl()}/health`);
  assert.strictEqual(res.status, 200);
  const body = await res.json();

  assert.strictEqual(body.status, 'ok');
  assert.ok(typeof body.players === 'number');
  assert.ok(body.stats && typeof body.stats.totalJoins === 'number');
  assert.ok(body.twitchRelay && typeof body.twitchRelay.queueDepth === 'number');

  const serialized = JSON.stringify(body);
  assert.ok(!/eyJ/.test(serialized), '/health must never expose a JWT');
  assert.ok(!/secret|service_role|jwt/i.test(serialized), '/health must not name secrets');
});

test('/config exposes the public channel + anon key only, never server secrets', async () => {
  const res = await fetch(`${getBaseUrl()}/config`);
  const body = await res.json();

  assert.ok(typeof body.twitchChannel === 'string');
  const serialized = JSON.stringify(body);
  assert.ok(
    !/serviceRole|service_role|seJwtToken|SE_JWT/i.test(serialized),
    '/config must never expose the service-role key or the StreamElements JWT'
  );
});
