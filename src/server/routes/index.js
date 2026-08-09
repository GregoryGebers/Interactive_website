'use strict';

const { registerConfigRoutes } = require('./config.routes');
const { registerEditorRoutes } = require('./editor.routes');
const { registerPlayerStateRoutes } = require('./playerState.routes');

// Wire every HTTP route group onto the Express app.
function registerRoutes(app) {
  registerEditorRoutes(app);
  registerPlayerStateRoutes(app);
  registerConfigRoutes(app);
}

module.exports = { registerRoutes };
