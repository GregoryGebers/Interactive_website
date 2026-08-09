'use strict';

// ---- Signed persistent player state (transport-level crypto) ---------------
// No database is required: the player's durable progression lives in a signed,
// HttpOnly cookie. The HMAC signature prevents the browser from editing coins,
// upgrades or cosmetic ownership and then presenting the modified state as
// legitimate. The secret lives ONLY on the server (see config/environment.js);
// if it is missing, signing/verification return null and persistence is off.

const crypto = require('crypto');
const { PLAYER_STATE_SECRET, PERSISTENCE_ENABLED, IS_PRODUCTION } = require('../config/environment');
const { PLAYER_STATE_COOKIE, PLAYER_STATE_MAX_AGE_SEC } = require('../config/gameConfig');

function base64urlJson(obj) {
  return Buffer.from(JSON.stringify(obj), 'utf8').toString('base64url');
}

function signPayload(payloadB64) {
  return crypto.createHmac('sha256', PLAYER_STATE_SECRET).update(payloadB64).digest('base64url');
}

/**
 * Serialize + sign a player-state object into a `payload.signature` token.
 * @returns {string|null} null when persistence is disabled.
 */
function signStateToken(state) {
  if (!PERSISTENCE_ENABLED) return null;
  const payload = base64urlJson(state);
  return `${payload}.${signPayload(payload)}`;
}

// Constant-time comparison so signature checks don't leak via timing.
function safeTimingEqual(a, b) {
  try {
    const aa = Buffer.from(String(a));
    const bb = Buffer.from(String(b));
    return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
  } catch (_) {
    return false;
  }
}

/**
 * Verify a signed token and return its parsed payload, or null if the
 * signature is invalid, the token is malformed, or it has expired.
 */
function verifyStateToken(token) {
  if (!PERSISTENCE_ENABLED || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!safeTimingEqual(sig, signPayload(payload))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return null;
    if (Number(parsed.exp) && Date.now() > Number(parsed.exp)) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i <= 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!key) continue;
    try { out[key] = decodeURIComponent(value); }
    catch (_) { out[key] = value; }
  }
  return out;
}

function readPersistentCookie(cookieHeader) {
  const token = parseCookies(cookieHeader)[PLAYER_STATE_COOKIE];
  return verifyStateToken(token);
}

function setPersistentCookie(req, res, token) {
  if (!token) return;
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const secure = req.secure || forwardedProto === 'https' || IS_PRODUCTION;
  const parts = [
    `${PLAYER_STATE_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${PLAYER_STATE_MAX_AGE_SEC}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

module.exports = {
  base64urlJson,
  signPayload,
  signStateToken,
  safeTimingEqual,
  verifyStateToken,
  parseCookies,
  readPersistentCookie,
  setPersistentCookie,
};
