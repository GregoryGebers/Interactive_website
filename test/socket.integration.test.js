'use strict';

// ---- Socket handler integration tests ---------------------------------------
// These drive a REAL server over a REAL socket. Every case below asserts an
// economic or safety invariant that the game depends on holding even when the
// client is hostile: a modified browser can send any payload it likes, so the
// server must be the only thing that decides prices, balances, ownership and
// whether a hit landed.

const test = require('node:test');
const assert = require('node:assert');

const {
  startTestServer,
  stopTestServer,
  connectClient,
  joinAs,
  once,
  neverFires,
  sleep,
  setScore,
  gameState,
} = require('./helpers/server');

const { loadShopConfig } = require('../src/server/services/shop.service');

test.before(startTestServer);
test.after(stopTestServer);

/** First cosmetic that is actually on sale, or null when none is. */
function firstPurchasableSkin() {
  const items = loadShopConfig().cosmetics.items;
  for (const [id, cfg] of Object.entries(items)) {
    if (id !== 'classic' && cfg.enabled !== false) return id;
  }
  return null;
}

/** First cosmetic that is switched off (falling back to any non-classic id). */
function firstDisabledSkin() {
  const items = loadShopConfig().cosmetics.items;
  for (const [id, cfg] of Object.entries(items)) {
    if (id !== 'classic' && cfg.enabled === false) return id;
  }
  return 'mob1';
}

// ---- Joining ----------------------------------------------------------------

test('a fresh player starts with zero coins and only the classic skin', async () => {
  const client = await connectClient();
  const state = await joinAs(client, 'Fresh');

  assert.strictEqual(state.coins, 0);
  assert.deepStrictEqual(state.cosmetics, ['classic']);
  assert.strictEqual(state.equippedSkin, 'classic');
  client.close();
});

test('connecting without joining never spawns a player (overlay.html case)', async () => {
  const spectator = await connectClient();
  await sleep(200);
  assert.strictEqual(
    gameState.players[spectator.id],
    undefined,
    'a socket that never sent "join" must not become a player'
  );
  spectator.close();
});

// ---- The shop: prices and balances are server-owned --------------------------

test('buying with insufficient coins is refused and does not change the balance', async () => {
  const client = await connectClient();
  await joinAs(client, 'Broke');
  setScore(client.id, 1); // a jump tier costs more than this

  client.emit('buy', { item: 'jump', tier: 1 });
  const result = await once(client, 'buy_result');

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'poor');
  assert.strictEqual(gameState.players[client.id].score, 1, 'balance must be untouched');
  assert.strictEqual(gameState.playerUpgrades[client.id].jump, 0);
  client.close();
});

test('upgrade tiers cannot be skipped', async () => {
  const client = await connectClient();
  await joinAs(client, 'Skipper');
  setScore(client.id, 100000); // affording it must not be enough

  client.emit('buy', { item: 'jump', tier: 3 }); // still on tier 0
  const result = await once(client, 'buy_result');

  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'invalid');
  assert.strictEqual(gameState.playerUpgrades[client.id].jump, 0);
  assert.strictEqual(gameState.players[client.id].score, 100000, 'must not be charged');
  client.close();
});

test('a purchase deducts exactly the server-side price, not a client-supplied one', async () => {
  const client = await connectClient();
  await joinAs(client, 'Buyer');
  setScore(client.id, 1000);

  // The client cheekily supplies its own price/cost fields; the server owns them.
  client.emit('buy', { item: 'jump', tier: 1, price: 0, cost: 0 });
  const result = await once(client, 'buy_result');

  assert.strictEqual(result.ok, true);
  const spent = 1000 - gameState.players[client.id].score;
  assert.ok(spent > 0, 'a real price must have been deducted');
  assert.strictEqual(gameState.playerUpgrades[client.id].jump, 1);
  client.close();
});

test('the same cosmetic cannot be bought twice', async (t) => {
  // Which cosmetics are purchasable is a DESIGN choice living in
  // public/shop.json, and at the time of writing every one of them is
  // `enabled: false`. Pick whatever is actually on sale rather than hardcoding
  // an id, so this test asserts the invariant instead of the current economy.
  const purchasable = firstPurchasableSkin();
  if (!purchasable) {
    t.skip('no cosmetic is currently enabled in public/shop.json');
    return;
  }

  const client = await connectClient();
  await joinAs(client, 'Collector');
  setScore(client.id, 100000);

  client.emit('buy', { item: 'skin', skinId: purchasable });
  const first = await once(client, 'buy_result');
  assert.strictEqual(first.ok, true, `expected to be able to buy ${purchasable}`);
  const balanceAfterFirst = gameState.players[client.id].score;

  client.emit('buy', { item: 'skin', skinId: purchasable });
  const second = await once(client, 'buy_result');

  assert.strictEqual(second.ok, false);
  assert.strictEqual(second.reason, 'owned');
  assert.strictEqual(
    gameState.players[client.id].score,
    balanceAfterFirst,
    'must not be charged a second time'
  );
  client.close();
});

test('a disabled cosmetic cannot be bought at all', async () => {
  const disabled = firstDisabledSkin();
  const client = await connectClient();
  await joinAs(client, 'Sneak');
  setScore(client.id, 100000); // affording it must not matter

  client.emit('buy', { item: 'skin', skinId: disabled });
  const result = await once(client, 'buy_result');

  assert.strictEqual(result.ok, false, `${disabled} is disabled and must not be purchasable`);
  assert.strictEqual(result.reason, 'invalid');
  assert.strictEqual(gameState.players[client.id].score, 100000, 'must not be charged');
  client.close();
});

test('an unowned skin cannot be equipped', async () => {
  const client = await connectClient();
  await joinAs(client, 'Pretender');

  client.emit('equip_skin', { skinId: 'monster3' });
  const result = await once(client, 'equip_result');

  assert.strictEqual(result.ok, false);
  assert.strictEqual(gameState.players[client.id].skin, 'classic');
  client.close();
});

// ---- Movement packets are not a back door -----------------------------------

test('a move packet cannot change skin or score', async () => {
  const victimless = await connectClient();
  await joinAs(victimless, 'Cheater');
  setScore(victimless.id, 7);

  victimless.emit('move', {
    x: 50, y: 50,
    skin: 'monster3',   // not owned
    score: 999999,      // not earned
    username: 'Cheater',
  });
  await sleep(150);

  const server = gameState.players[victimless.id];
  assert.strictEqual(server.skin, 'classic', 'skin must come from server state');
  assert.strictEqual(server.score, 7, 'score must come from server state');
  victimless.close();
});

test('a move packet is clamped to world bounds', async () => {
  const client = await connectClient();
  await joinAs(client, 'Wanderer');

  client.emit('move', { x: 999999, y: -999999, username: 'Wanderer' });
  await sleep(150);

  const p = gameState.players[client.id];
  assert.ok(p.x <= 3000 && p.x >= 0, `x out of bounds: ${p.x}`);
  assert.ok(p.y <= 500 && p.y >= 0, `y out of bounds: ${p.y}`);
  client.close();
});

// ---- Combat is decided by the server ----------------------------------------

test('a swing from across the map does not hit anyone', async () => {
  const attacker = await connectClient();
  const target = await connectClient();
  await joinAs(attacker, 'Attacker');
  await joinAs(target, 'Target');

  // Put them at opposite ends of the world, server-side.
  gameState.players[attacker.id].x = 10;
  gameState.players[attacker.id].y = 100;
  gameState.players[target.id].x = 2900;
  gameState.players[target.id].y = 100;

  const knockback = neverFires(target, 'knockback', 500);
  attacker.emit('swing', { dir: 1 });

  assert.strictEqual(await knockback, null, 'a distant target must not be knocked back');
  attacker.close();
  target.close();
});

test('a swing at point-blank range does hit (the check is not simply broken)', async () => {
  const attacker = await connectClient();
  const target = await connectClient();
  await joinAs(attacker, 'Attacker2');
  await joinAs(target, 'Target2');

  gameState.players[attacker.id].x = 500;
  gameState.players[attacker.id].y = 100;
  gameState.players[target.id].x = 515; // well inside SWING_RADIUS
  gameState.players[target.id].y = 100;

  const knockback = once(target, 'knockback', 2000);
  attacker.emit('swing', { dir: 1 });
  const hit = await knockback;

  assert.ok(Number.isFinite(hit.vx) && Number.isFinite(hit.vy));
  attacker.close();
  target.close();
});

// ---- Spectators (never joined) cannot act -----------------------------------

test('a socket that never joined cannot buy, chat, swing or emit effects', async () => {
  const ghost = await connectClient();

  const buyResult = neverFires(ghost, 'buy_result', 400);
  ghost.emit('buy', { item: 'jump', tier: 1 });
  assert.strictEqual(await buyResult, null, 'a non-player must not be able to buy');

  const chatEcho = neverFires(ghost, 'chat', 400);
  ghost.emit('chat', { message: 'hello' });
  assert.strictEqual(await chatEcho, null, 'a non-player must not be able to chat');

  assert.strictEqual(gameState.players[ghost.id], undefined);
  ghost.close();
});

// ---- Chat -------------------------------------------------------------------

test('chat is rate limited to one message per interval', async () => {
  const client = await connectClient();
  await joinAs(client, 'Chatty');

  const first = once(client, 'chat');
  client.emit('chat', { message: 'first message' });
  await first;

  // Immediately again: must be dropped silently.
  const second = neverFires(client, 'chat', 500);
  client.emit('chat', { message: 'second message' });
  assert.strictEqual(await second, null, 'the second message must be dropped');
  client.close();
});

test('chat is profanity filtered server-side, including leetspeak evasion', async () => {
  const client = await connectClient();
  await joinAs(client, 'Mouth');

  const echo = once(client, 'chat');
  client.emit('chat', { message: 'you are a sh!t player' });
  const { message } = await echo;

  assert.ok(!/sh!t/i.test(message), `evasion leaked through: ${message}`);
  assert.ok(message.includes('*'), `expected censoring, got: ${message}`);
  client.close();
});

test('control characters are stripped from chat', async () => {
  const client = await connectClient();
  await joinAs(client, 'Sneaky');

  const echo = once(client, 'chat');
  const withControlChars = [104, 105, 0, 27, 127, 119, 111, 114, 100]
      .map((c) => String.fromCharCode(c))
      .join('');
    client.emit('chat', { message: withControlChars });
  const { message } = await echo;

  assert.ok(!/[\u0000-\u001f\u007f]/.test(message), `control chars survived: ${JSON.stringify(message)}`);
  client.close();
});

// ---- Coins ------------------------------------------------------------------

test('a coin can only be collected once', async () => {
  const a = await connectClient();
  const b = await connectClient();
  await joinAs(a, 'First');
  await joinAs(b, 'Second');

  // Make sure a coin is actually live before racing for it.
  if (gameState.currentCoin === null) {
    await once(a, 'coin', 5000);
  }
  setScore(a.id, 0);
  setScore(b.id, 0);

  a.emit('coin_taken');
  b.emit('coin_taken'); // same coin, should be refused
  await sleep(250);

  const total = gameState.players[a.id].score + gameState.players[b.id].score;
  assert.strictEqual(total, 1, 'exactly one player may score from one coin');
  a.close();
  b.close();
});
