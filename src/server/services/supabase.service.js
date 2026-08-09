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

/**
 * Verify a Supabase access-token (JWT) presented by the browser on the socket
 * handshake and return the authenticated user, or null if it is missing,
 * expired, or invalid. This is what ties a socket to a real account.
 * @returns {Promise<{ id: string, email: string|null } | null>}
 */
async function verifyAccessToken(token) {
  if (!client || typeof token !== 'string' || token.length < 20) return null;
  try {
    const { data, error } = await client.auth.getUser(token);
    if (error || !data || !data.user) return null;
    return { id: data.user.id, email: data.user.email || null };
  } catch (err) {
    console.error('[supabase] verifyAccessToken error:', err);
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
  loadPlayerState,
  savePlayerState,
};
