'use strict';

const express = require('express');
const http = require('http');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const {
  PERSISTENCE_ENABLED,
  ALLOWED_ORIGINS,
  IS_PRODUCTION,
} = require('./config/environment');
const { activeHost } = require('./config/hosts');
const { PUBLIC_DIR, TOOLS_DIR } = require('./config/paths');
const { registerRoutes } = require('./routes');

// The localhost scene editor (scene_editor.py) serves the game from ports
// 8000/9000 and connects here for multiplayer testing. Everything else must be
// on the ALLOWED_ORIGINS list.
const LOCAL_EDITOR_ORIGIN_RE = /^https?:\/\/(127\.0\.0\.1|localhost):(8000|9000)$/;

/**
 * Decide whether a browser Origin may talk to this server.
 *
 * A missing Origin means a non-browser client (OBS, curl, a native app) — allowed,
 * as before. `host` is the request's Host header: browsers DO send an Origin on
 * same-origin WebSocket upgrades, so without comparing the two, an allowlist
 * would reject the game's own page. That is not hypothetical — it is exactly what
 * happened when this check first shipped without the host comparison.
 *
 * @param {string|undefined} origin  request Origin header
 * @param {string|undefined} host    request Host header, when available
 */
function isOriginAllowed(origin, host) {
  if (!origin) return true;
  if (LOCAL_EDITOR_ORIGIN_RE.test(origin)) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  if (host) {
    try {
      if (new URL(origin).host === host) return true; // same-origin
    } catch (_) { /* malformed Origin — fall through to reject */ }
  }
  return false;
}

/**
 * Build the Express app: security headers, compression, JSON body parsing (only
 * used by the signed-cookie persistence bridge), static hosting of public/, and
 * all HTTP routes.
 * @returns {import('express').Express}
 */
function createApp() {
  const app = express();

  // Render (and most PaaS) terminate TLS at a proxy. Without this, req.ip is the
  // proxy's address for every request, which would make the rate limiters below
  // treat all traffic as one client and ban everyone at once.
  app.set('trust proxy', 1);

  // ---- Security headers -----------------------------------------------------
  // The CSP is tailored to what the three pages actually load: the Supabase SDK
  // from jsDelivr, Google Fonts, and the Twitch player in an iframe. Everything
  // else is same-origin. frameAncestors keeps overlay.html embeddable in OBS and
  // Twitch panels while blocking clickjacking from anywhere else.
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        // No third-party script origins at all: socket.io is served by this
        // server and the Supabase SDK is vendored into public/js/vendor/.
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'", 'https://*.supabase.co', 'wss://*.supabase.co', 'ws:', 'wss:'],
        frameSrc: ['https://player.twitch.tv', 'https://www.twitch.tv', 'https://embed.twitch.tv'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'self'", 'https://*.twitch.tv'],
        upgradeInsecureRequests: IS_PRODUCTION ? [] : null,
      },
    },
    // The Twitch iframe is cross-origin and not COEP-aware; enabling this would
    // blank the stream background.
    crossOriginEmbedderPolicy: false,
    // overlay.html is loaded by OBS as a browser source and the game embeds a
    // cross-origin player, so the strictest same-origin resource policy is too
    // tight here.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  // gzip/brotli for text responses (HTML, JS, CSS, JSON). Images are already
  // compressed, and compression's default filter skips them.
  app.use(compression());

  // ---- Rate limiting --------------------------------------------------------
  // Every HTTP endpoint here is unauthenticated by design, so the only backstop
  // against a request flood is a per-IP budget. Socket.IO's own transport is
  // mounted on the raw HTTP server, not through Express, so this does not touch
  // gameplay traffic.
  const generalLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { ok: false, error: 'Too many requests.' },
  });
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { ok: false, error: 'Too many requests.' },
  });
  app.use(generalLimiter);
  app.use('/api/', apiLimiter);

  // Small JSON bodies are used only for the signed-cookie persistence bridge.
  app.use(express.json({ limit: '16kb' }));

  // ---- Static files ---------------------------------------------------------
  // Long-lived caching for the ~45MB of art, which never changes without a
  // filename change in practice. scene.json / shop.json are the exception: the
  // clients fetch them with `cache: 'no-store'` and the server hot-reloads them,
  // so they must never be cached.
  const LIVE_CONFIG_FILES = new Set(['scene.json', 'shop.json']);
  const staticOptions = {
    maxAge: '30d',
    setHeaders(res, filePath) {
      if (LIVE_CONFIG_FILES.has(path.basename(filePath))) {
        res.setHeader('Cache-Control', 'no-store');
      } else {
        res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
      }
    },
  };
  app.use(express.static(PUBLIC_DIR, staticOptions));

  // The scene editor lives outside public/ (it is a dev tool, not part of the
  // deployed game). Serve its stylesheet/scripts read-only from /tools/... so
  // editor.html can load them. This exposes only the tools/ directory; there is
  // still NO write route for scene/shop online.
  app.use('/tools', express.static(TOOLS_DIR, { maxAge: '1h' }));

  registerRoutes(app);
  return app;
}

/**
 * Create the HTTP server + Socket.IO server for a given Express app.
 * @returns {{ server: http.Server, io: import('socket.io').Server }}
 */
function createServer(app) {
  const server = http.createServer(app);

  const io = new Server(server, {
    // An allowlist, not '*'. Two layers, because neither alone is sufficient:
    //
    //  - `cors.origin` decides whether to emit Access-Control-Allow-Origin on the
    //    polling handshake. It never sees the Host header, so it cannot recognise
    //    same-origin requests — that is fine, because browsers do not check CORS
    //    on same-origin responses at all. It must NEVER call back with an Error
    //    (that turns a merely-unauthorised origin into a 500).
    //  - `allowRequest` is the real gate. It sees the full request, so it can do
    //    the same-origin comparison, and it rejects before any handshake.
    cors: {
      origin(origin, cb) {
        cb(null, !origin || LOCAL_EDITOR_ORIGIN_RE.test(origin) || ALLOWED_ORIGINS.includes(origin));
      },
      methods: ['GET', 'POST'],
      credentials: true,
    },
    allowRequest(req, cb) {
      const origin = req.headers && req.headers.origin;
      const host = req.headers && req.headers.host;
      if (isOriginAllowed(origin, host)) return cb(null, true);
      console.warn(`[cors] rejected socket handshake from origin: ${origin}`);
      cb('FORBIDDEN_ORIGIN', false);
    },
    // Lets a client with a brief network drop (mobile blip, laptop sleep,
    // Render free-tier idling) rejoin with the SAME socket.id and have buffered
    // events replayed, instead of being treated as a brand new connection.
    // Requires socket.io >= 4.6.0 on both server and client.
    connectionStateRecovery: {
      maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes
      skipMiddlewares: true,
    },
    // Guards against absurdly large payloads from a misbehaving/malicious client.
    maxHttpBufferSize: 1e5, // 100 KB
  });

  return { server, io };
}

// One-line startup summary so logs show which host/persistence mode is active.
function logStartupBanner() {
  const { IS_EBERHEX } = require('./config/environment');
  console.log(`[host] active host: ${activeHost.twitchChannel} (isEberhex=${IS_EBERHEX})`);
  if (!PERSISTENCE_ENABLED) {
    console.warn(
      '[player-state] PLAYER_STATE_SECRET is missing/too short; persistent cookies are DISABLED. ' +
      'Set a random secret of at least 32 characters on Render.'
    );
  }
  if (!ALLOWED_ORIGINS.length) {
    console.warn(
      '[cors] ALLOWED_ORIGINS is empty — only same-origin and the localhost editor ' +
      'can open sockets. Set it if the game is embedded on another domain.'
    );
  } else {
    console.log(`[cors] allowed origins: ${ALLOWED_ORIGINS.join(', ')}`);
  }
}

module.exports = { createApp, createServer, logStartupBanner, isOriginAllowed };
