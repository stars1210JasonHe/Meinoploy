// Meinopoly — boardgame.io Multiplayer Server
// Usage: node -r esm server.js
// Runs on port 8000 by default (set PORT env var to override)

const { Server } = require('boardgame.io/server');
const serve = require('koa-static');
const path = require('path');

// Use esm to import ES module game definition
const { Monopoly } = require('./src/Game');

const server = Server({
  games: [Monopoly],
  origins: ['*'],  // Allow all origins (restrict in production)
});

// Serve the built client files from dist/
const buildPath = path.resolve(__dirname, 'dist');
server.app.use(serve(buildPath));

// Prevent server crash from stale client reconnections
process.on('uncaughtException', (err) => {
  console.error('WARN: uncaught exception (server continues):', err.message);
});

const PORT = process.env.PORT || 8088;
server.run(PORT, () => {
  console.log(`Meinopoly server running on http://localhost:${PORT}`);
});
