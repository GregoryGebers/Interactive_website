'use strict';

// Validation for untrusted socket payloads. The one live consumer is the
// "move" handler, but keeping it pure and dependency-light makes it unit
// testable in isolation.

const {
  WORLD_WIDTH,
  WORLD_HEIGHT,
  MAX_USERNAME_LENGTH,
  DEFAULT_USERNAME_COLOR,
  HEX_COLOR_RE,
} = require('../config/gameConfig');

/**
 * Validate and normalize a movement packet before it enters server state.
 *
 * Position is clamped to the authoritative world bounds. Equipped skin and
 * score are intentionally NOT taken from the packet — both are
 * server-authoritative (skin changes go through `equip_skin`; score only
 * changes in the coin handler), so a modified client cannot use a move packet
 * to equip unowned cosmetics or rewrite its score.
 *
 * @param {object} data Raw movement payload from the client.
 * @param {object|null} existingPlayer Current server-side player, or null.
 * @returns {object|null} A sanitized player snapshot, or null if unusable.
 */
function sanitizeMoveData(data, existingPlayer = null) {
  if (!data || typeof data !== 'object') return null;

  const x = Number(data.x);
  const y = Number(data.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const username = typeof data.username === 'string'
    ? data.username.slice(0, MAX_USERNAME_LENGTH)
    : '';

  const color = typeof data.color === 'string' && HEX_COLOR_RE.test(data.color)
    ? data.color
    : DEFAULT_USERNAME_COLOR;

  // Secondary tint for the duck's beak + feet. Optional; null means "leave the
  // original beak color" on the client.
  const beakColor = typeof data.beakColor === 'string' && HEX_COLOR_RE.test(data.beakColor)
    ? data.beakColor
    : null;

  // Which way the duck faces (1 = right, -1 = left). Drives the client-side
  // horizontal flip when drawing other players.
  const facing = Number(data.facing) === -1 ? -1 : 1;

  // Equipped skin is server-owned persistent state; movement packets may not
  // switch it. Skin changes go through the `equip_skin` socket event.
  const skin = (existingPlayer && existingPlayer.skin) || 'classic';

  // Score is server-owned and only changes in the coin_taken handler. Some
  // viewer.html move packets omit score entirely (keydown/keyup emits), and
  // sanitising those to 0 previously made the overlay flicker between the real
  // score and 0. Keep the existing server score during movement updates.
  const existingScore = Number(existingPlayer && existingPlayer.score);

  return {
    x: Math.min(Math.max(x, 0), WORLD_WIDTH),
    y: Math.min(Math.max(y, 0), WORLD_HEIGHT),
    frameCount: Number.isFinite(Number(data.frameCount)) ? Number(data.frameCount) : 0,
    frameIndex: Number.isFinite(Number(data.frameIndex)) ? Number(data.frameIndex) : 0,
    frameRow: Number.isFinite(Number(data.frameRow)) ? Number(data.frameRow) : 0,
    username,
    color,
    beakColor,
    facing,
    emote: typeof data.emote === 'string' ? data.emote : 'idle',
    score: Number.isFinite(existingScore) ? existingScore : 0,
    skin,
    // Invisibility is a transient per-frame state the client reports; when a
    // player is invisible, everyone ELSE hides their sprite entirely.
    invisible: data.invisible === true,
  };
}

module.exports = { sanitizeMoveData };
