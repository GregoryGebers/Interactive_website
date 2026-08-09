'use strict';

// Single home for every value read out of the process environment. Nothing
// else in the server should touch `process.env` directly, so that all runtime
// configuration and its defaults are discoverable in one place.

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || '';
const IS_PRODUCTION = NODE_ENV === 'production';

// Persistent player state lives in a signed HttpOnly cookie (see
// utils/crypto.js). The secret must never reach the browser. If it is missing
// or too short, persistence is deliberately disabled rather than silently
// using an unstable secret that changes on every deploy.
const PLAYER_STATE_SECRET = String(process.env.PLAYER_STATE_SECRET || '');
const PERSISTENCE_ENABLED = PLAYER_STATE_SECRET.length >= 32;

// ---- Supabase (accounts + durable player-state database) --------------------
// Logged-in players get their progression stored in a Supabase table instead of
// (only) a signed cookie. The SERVICE-ROLE key stays on the server and bypasses
// RLS to read/write any player's row — it must NEVER reach the browser. The
// ANON key and URL are public and are handed to the client via /config so it
// can run Supabase Auth (sign up / sign in) itself. If URL or service-role key
// are missing, account persistence is disabled and the game falls back to the
// existing signed-cookie / guest flow with no errors.
// Accept a project URL even if it was pasted with a trailing slash or the
// `/rest/v1` API path appended — supabase-js wants only the bare origin
// (https://xxxx.supabase.co) and otherwise builds broken auth URLs like
// `/rest/v1/auth/v1/token`.
const SUPABASE_URL = String(process.env.SUPABASE_URL || '')
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/rest\/v1$/i, '')
  .replace(/\/+$/, '');
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
const SUPABASE_ENABLED = Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);

// Two people can run this game over their own stream: eberhex and izu_kora.
// A SINGLE env var, isEberhex, flips EVERYTHING to the right host at once (see
// config/hosts.js). Render env vars are always strings, so "true" (any
// capitalization) counts as true; anything else — including unset — is false.
const IS_EBERHEX = String(process.env.isEberhex).toLowerCase() === 'true';

// StreamElements bot credentials for each host. Treat every JWT like a
// password — they live ONLY on the server and are never exposed to a client.
const SE_CREDENTIALS = {
  eberhex: {
    seJwtToken: process.env.SE_JWT_TOKEN_EBERHEX || '',
    seChannelId: process.env.SE_CHANNEL_ID_EBERHEX || '',
  },
  izu_kora: {
    seJwtToken: process.env.SE_JWT_TOKEN_IZU || '',
    seChannelId: process.env.SE_CHANNEL_ID_IZU || '',
  },
};

module.exports = {
  PORT,
  NODE_ENV,
  IS_PRODUCTION,
  PLAYER_STATE_SECRET,
  PERSISTENCE_ENABLED,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_ENABLED,
  IS_EBERHEX,
  SE_CREDENTIALS,
};
