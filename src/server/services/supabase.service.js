'use strict';

// ---- Supabase account persistence (server side) ----------------------------
// This module is the ONLY place the Supabase service-role key is used. The
// service-role client bypasses Row Level Security, so it can read and write any
// player's row — which is exactly what keeps the game server-authoritative:
// the browser never writes coins/upgrades to the database directly (RLS blocks
// that), it only authenticates and lets the server persist the state it owns.
//
// If Supabase env vars are absent the whole module degrades to no-ops and the
// game keeps working on the existing signed-cookie / guest path.

const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ENABLED,
} = require('../config/environment');

const PLAYER_STATE_TABLE = 'player_state';

let client = null;
if (SUPABASE_ENABLED) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch (err) {
    console.error('[supabase] failed to initialize client; account persistence disabled:', err);
    client = null;
  }
}

function isSupabaseEnabled() {
  return Boolean(client);
}

// ---- Access-token verification cache ----------------------------------------
// verifyAccessToken() used to hit the Supabase auth API on EVERY socket
// connection that carried a token, gated only by `token.length < 20`. Anyone
// could therefore force one outbound API request per connection with 20 bytes of
// garbage — latency and quota amplification against our own auth service, from
// an unauthenticated attacker.
//
// Two cheap defences, before any network call:
//   1. Structural pre-check: it must actually look like a JWT, and its own
//      unverified `exp` must not already be in the past. This is NOT a security
//      check (the payload is attacker-controlled and unverified) — it only
//      rejects obvious junk without paying for a round trip. Supabase remains
//      the sole authority on whether a token is genuine.
//   2. Positive and negative caches, so repeats are free.
const crypto = require('crypto');

const TOKEN_CACHE_TTL_MS = 60 * 1000;      // re-verify a good token at most 1/min
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1000; // remember junk for longer
const TOKEN_CACHE_MAX = 500;

const tokenCache = new Map(); // hash -> { user: object|null, expiresAt: number }

function tokenKey(token) {
  return crypto.createHash('sha256').update(token).digest('base64');
}

function cacheGet(key) {
  const hit = tokenCache.get(key);
  if (!hit) return undefined;
  if (Date.now() > hit.expiresAt) {
    tokenCache.delete(key);
    return undefined;
  }
  return hit;
}

function cacheSet(key, user) {
  // Simple bounded cache: drop the oldest entry once full. Map preserves
  // insertion order, so the first key is the oldest.
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const oldest = tokenCache.keys().next().value;
    if (oldest !== undefined) tokenCache.delete(oldest);
  }
  tokenCache.set(key, {
    user,
    expiresAt: Date.now() + (user ? TOKEN_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS),
  });
}

/**
 * Cheap structural sanity check on a JWT: three dot-separated segments and a
 * decodable payload whose `exp` (if present) is still in the future.
 *
 * SECURITY NOTE: this reads UNVERIFIED, attacker-controlled claims. It may only
 * ever be used to REJECT tokens early, never to accept one — a token that passes
 * still goes to Supabase for real verification.
 */
function looksLikeLiveJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload || typeof payload !== 'object') return false;
    const exp = Number(payload.exp);
    // exp is in SECONDS. Allow a little clock skew.
    if (Number.isFinite(exp) && exp > 0 && Date.now() / 1000 > exp + 60) return false;
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Verify a Supabase access-token (JWT) presented by the browser on the socket
 * handshake and return the authenticated user, or null if it is missing,
 * expired, or invalid. This is what ties a socket to a real account.
 * @returns {Promise<{ id: string, email: string|null } | null>}
 */
async function verifyAccessToken(token) {
  if (!client || typeof token !== 'string' || token.length < 20) return null;
  // Reject obvious junk without spending a network round trip on it.
  if (!looksLikeLiveJwt(token)) return null;

  const key = tokenKey(token);
  const cached = cacheGet(key);
  if (cached) return cached.user;

  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data || !data.user) {
      cacheSet(key, null);
      return null;
    }
    const user = { id: data.user.id, email: data.user.email || null };
    cacheSet(key, user);
    return user;
  } catch (err) {
    console.error('[supabase] verifyAccessToken error:', err);
    // Do NOT cache transport failures as negatives — a Supabase blip would
    // otherwise lock every player out to guest mode for the full negative TTL.
    return null;
  }
}

/**
 * Load a user's stored progression. Returns the raw row (to be normalized by
 * playerState.service) or null when the user has no row yet / on error.
 */
async function loadPlayerState(userId) {
  if (!client || !userId) return null;
  try {
    const { data, error } = await client
      .from(PLAYER_STATE_TABLE)
      .select('coins, cosmetics, equipped_skin, upgrades, rev')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) {
      console.error('[supabase] loadPlayerState error:', error);
      return null;
    }
    if (!data) return null;
    // Map snake_case DB columns onto the in-memory camelCase shape.
    return {
      coins: data.coins,
      cosmetics: data.cosmetics,
      equippedSkin: data.equipped_skin,
      upgrades: data.upgrades,
      rev: data.rev,
    };
  } catch (err) {
    console.error('[supabase] loadPlayerState threw:', err);
    return null;
  }
}

/**
 * Upsert a user's progression. The passed state is assumed already normalized
 * and server-owned. Fire-and-forget friendly: it resolves to true/false and
 * never throws, so callers can ignore the result without unhandled rejections.
 */
async function savePlayerState(userId, state) {
  if (!client || !userId || !state) return false;
  try {
    const { error } = await client
      .from(PLAYER_STATE_TABLE)
      .upsert(
        {
          user_id: userId,
          coins: Math.max(0, Math.floor(Number(state.coins) || 0)),
          cosmetics: Array.isArray(state.cosmetics) ? state.cosmetics : ['classic'],
          equipped_skin: state.equippedSkin || 'classic',
          upgrades: state.upgrades || {},
          rev: Math.max(0, Math.floor(Number(state.rev) || 0)),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id' }
      );
    if (error) {
      console.error('[supabase] savePlayerState error:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[supabase] savePlayerState threw:', err);
    return false;
  }
}

module.exports = {
  isSupabaseEnabled,
  verifyAccessToken,
  looksLikeLiveJwt,
  loadPlayerState,
  savePlayerState,
};
