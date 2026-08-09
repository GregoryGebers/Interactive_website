'use strict';

const { PERSISTENCE_ENABLED } = require('../config/environment');
const {
  verifyStateToken,
  readPersistentCookie,
  setPersistentCookie,
} = require('../utils/crypto');

// Socket.IO cannot change browser cookies after the WebSocket handshake.
// Instead the server emits a signed one-time state snapshot; viewer.html POSTs
// that signed token here, and this HTTP response writes the HttpOnly cookie.
// The endpoint NEVER trusts raw coins/upgrades from the client — only a token
// whose signature it can verify.
function registerPlayerStateRoutes(app) {
  app.post('/api/player-state', (req, res) => {
    if (!PERSISTENCE_ENABLED) {
      res.status(503).json({ ok: false, error: 'Persistence is not configured.' });
      return;
    }
    const token = req.body && typeof req.body.token === 'string' ? req.body.token : '';
    const incoming = verifyStateToken(token);
    if (!incoming) {
      res.status(400).json({ ok: false, error: 'Invalid signed player-state token.' });
      return;
    }

    // Prevent normal network reordering from letting an older save overwrite a
    // newer cookie. (Without a database, a determined user can still manually
    // restore an old cookie backup; a signed-cookie-only design cannot prevent
    // rollback attacks across browser backups.)
    const current = readPersistentCookie(req.headers.cookie);
    const incomingRev = Number(incoming.rev) || 0;
    const currentRev = Number(current && current.rev) || 0;
    if (current && current.playerId === incoming.playerId && incomingRev < currentRev) {
      res.status(409).json({ ok: false, stale: true });
      return;
    }

    setPersistentCookie(req, res, token);
    res.json({ ok: true, rev: incomingRev });
  });
}

module.exports = { registerPlayerStateRoutes };
