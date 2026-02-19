// Meinopoly — boardgame.io Multiplayer Server
// Usage: node -r esm server.js
// Runs on port 8000 by default (set PORT env var to override)

const { Server } = require('boardgame.io/server');
const serve = require('koa-static');
const path = require('path');

// Use esm to import ES module game definition
const { Monopoly } = require('./src/Game');

const server = Server({ games: [Monopoly] });

// Serve the built client files from dist/
const buildPath = path.resolve(__dirname, 'dist');
server.app.use(serve(buildPath));

const PORT = process.env.PORT || 8088;
server.run(PORT, () => {
  console.log(`Meinopoly server running on http://localhost:${PORT}`);
});
