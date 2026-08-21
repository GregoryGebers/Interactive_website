'use strict';

const { VIEWER_HTML_PATH } = require('../config/paths');
const { activeHost } = require('../config/hosts');
const {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  SUPABASE_ENABLED,
  PERSISTENCE_ENABLED,
} = require('../config/environment');
const gameState = require('../state/gameState');
const { isMobLoopRunning } = require('../socket/mob.handlers');
const { isSupabaseEnabled } = require('../services/supabase.service');
const { relayStats } = require('../services/twitchRelay.service');

// Root game page, the server-chosen Twitch channel, and a health probe.
function registerConfigRoutes(app) {
  app.get('/', (req, res) => {
    res.sendFile(VIEWER_HTML_PATH);
  });

  // Tells viewer.html which Twitch channel to embed as the background. The
  // choice is made SERVER-SIDE by the isEberhex env var, because the browser
  // can't read env vars itself. Only the PUBLIC channel name is exposed here —
  // never the JWT.
  app.get('/config', (req, res) => {
    res.json({
      twitchChannel: activeHost.twitchChannel,
      // Public Supabase credentials, safe to expose to the browser. The anon
      // key only grants what Row Level Security allows; the service-role key is
      // never sent. When Supabase is not configured, `supabase` is null and the
      // client hides the login UI and stays on the guest/cookie flow.
      supabase: SUPABASE_ENABLED
        ? { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY }
        : null,
    });
  });

  // Lightweight endpoint for an uptime monitor (e.g. UptimeRobot, cron-job.org)
  // hit every 5-10 min. Render's free tier spins a service down after ~15 min
  // idle; a periodic ping keeps it warm so players don't hit the cold start.
  //
  // It also reports the counters below, because Render's free tier discards
  // logs: without them there is no way to answer "how busy was it last night"
  // or "did someone abuse the Twitch relay" after the fact. `mobLoopRunning` is
  // here because a scene saved with no spawners disables combat entirely, and
  // that otherwise leaves no trace after one startup log line.
  app.get('/health', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      status: 'ok',
      players: Object.keys(gameState.players).length,
      uptime: process.uptime(),
      mobLoopRunning: isMobLoopRunning(),
      supabase: isSupabaseEnabled(),
      persistence: PERSISTENCE_ENABLED,
      stats: { ...gameState.stats },
      twitchRelay: relayStats(),
    });
  });
}

module.exports = { registerConfigRoutes };
