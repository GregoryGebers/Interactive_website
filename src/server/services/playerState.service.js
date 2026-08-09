'use strict';

// ---- Persistent player state (domain logic) --------------------------------
// The durable per-player progression: coins, owned cosmetics, equipped skin and
// upgrade tiers. This module owns the SHAPE of that state and how it is
// normalized, derived from live game state, and pushed to a client. The
// signing/cookie transport lives in utils/crypto.js.

const crypto = require('crypto');
const { PLAYER_STATE_MAX_AGE_SEC } = require('../config/gameConfig');
const { signStateToken } = require('../utils/crypto');
const { loadShopConfig, DEFAULT_COSMETIC_ITEMS } = require('./shop.service');
const { savePlayerState } = require('./supabase.service');
const gameState = require('../state/gameState');

function freshUpgradeState() {
  return { jump: 0, dash: 0, knockback: 0, health: 0, invisibility: 0, doubleJump: 0 };
}

function freshPersistentState() {
  return {
    v: 1,
    playerId: crypto.randomUUID(),
    rev: 0,
    exp: Date.now() + PLAYER_STATE_MAX_AGE_SEC * 1000,
    coins: 0,
    cosmetics: ['classic'],
    equippedSkin: 'classic',
    upgrades: freshUpgradeState(),
  };
}

/**
 * Coerce a raw (possibly untrusted) persistent-state object into a valid one:
 * clamp coins/tiers, restrict cosmetics to known ids, and drop an equipped skin
 * that is unowned or currently disabled. Never trusts raw values as-is.
 */
function normalizePersistentState(raw) {
  const base = freshPersistentState();
  if (!raw || typeof raw !== 'object') return base;

  if (typeof raw.playerId === 'string' && /^[A-Za-z0-9-]{8,80}$/.test(raw.playerId)) {
    base.playerId = raw.playerId;
  }
  base.rev = Math.max(0, Math.floor(Number(raw.rev) || 0));
  base.coins = Math.max(0, Math.floor(Number(raw.coins) || 0));

  const allowedSkins = new Set(Object.keys(DEFAULT_COSMETIC_ITEMS));
  const owned = new Set(['classic']);
  if (Array.isArray(raw.cosmetics)) {
    for (const id of raw.cosmetics) {
      if (typeof id === 'string' && allowedSkins.has(id)) owned.add(id);
    }
  }
  base.cosmetics = [...owned];

  if (typeof raw.equippedSkin === 'string' && owned.has(raw.equippedSkin)) {
    base.equippedSkin = raw.equippedSkin;
  }

  const cfg = loadShopConfig();
  const incomingUp = raw.upgrades && typeof raw.upgrades === 'object' ? raw.upgrades : {};
  for (const key of Object.keys(base.upgrades)) {
    const maxTier = key === 'doubleJump'
      ? 1
      : Math.max(0, Number(cfg.upgrades[key] && cfg.upgrades[key].costs.length) || 0);
    base.upgrades[key] = Math.max(0, Math.min(maxTier, Math.floor(Number(incomingUp[key]) || 0)));
  }

  // Disabled cosmetics remain owned so re-enabling them later restores access,
  // but a currently disabled skin is not allowed to remain equipped.
  const equippedCfg = cfg.cosmetics.items[base.equippedSkin];
  if (base.equippedSkin !== 'classic' && (!equippedCfg || equippedCfg.enabled === false)) {
    base.equippedSkin = 'classic';
  }

  base.exp = Date.now() + PLAYER_STATE_MAX_AGE_SEC * 1000;
  return base;
}

/**
 * Build the authoritative persistent state for a socket by folding the live
 * game state (score, owned cosmetics, equipped skin, upgrades) onto the
 * socket's last-known persistent snapshot.
 */
function stateForSocket(socket) {
  const player = gameState.players[socket.id];
  if (!player) return socket.data.persistentState || freshPersistentState();

  const previous = socket.data.persistentState || freshPersistentState();
  return normalizePersistentState({
    ...previous,
    coins: Math.max(0, Math.floor(Number(player.score) || 0)),
    cosmetics: [...(gameState.playerCosmetics[socket.id] || new Set(['classic']))],
    equippedSkin: player.skin || 'classic',
    upgrades: { ...(gameState.playerUpgrades[socket.id] || freshUpgradeState()) },
  });
}

// The subset of persistent state safe to hand the live client for display.
function publicPersistentState(state) {
  return {
    coins: state.coins,
    cosmetics: [...state.cosmetics],
    equippedSkin: state.equippedSkin,
    upgrades: { ...state.upgrades },
  };
}

/**
 * Recompute this socket's persistent state and push it to the client: the live
 * `player_state` (always) plus a signed `persist_state` token (when
 * persistence is enabled) that viewer.html POSTs back to set the cookie.
 */
function pushPersistentState(socket, { bumpRevision = true } = {}) {
  if (!gameState.players[socket.id]) return;
  let state = stateForSocket(socket);
  if (bumpRevision) state.rev = (Number(state.rev) || 0) + 1;
  state.exp = Date.now() + PLAYER_STATE_MAX_AGE_SEC * 1000;
  socket.data.persistentState = state;

  // Always update the live client, even when cookie persistence is disabled.
  socket.emit('player_state', publicPersistentState(state));

  const token = signStateToken(state);
  if (token) socket.emit('persist_state', { token, rev: state.rev });

  // Logged-in players are persisted to the database (server-authoritative — the
  // browser never writes these values itself). Fire-and-forget: a slow or
  // failing write must not block gameplay, and savePlayerState never throws.
  if (socket.data && socket.data.userId) {
    savePlayerState(socket.data.userId, state).catch((err) => {
      console.error('[player-state] async DB save failed:', err);
    });
  }
}

module.exports = {
  freshUpgradeState,
  freshPersistentState,
  normalizePersistentState,
  stateForSocket,
  publicPersistentState,
  pushPersistentState,
};
