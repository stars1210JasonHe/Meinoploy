// Meinopoly — boardgame.io Multiplayer Server
// Usage: node -r esm server.js                        (dominion/classic, as before)
//        MOD=terra-titans node -r esm server.js       (mod's first map/world)
//        MOD=dominion MAP=classic node -r esm server.js
// Port 8088 by default (PORT env var overrides).

const { Server } = require('boardgame.io/server');
const serve = require('koa-static');
const path = require('path');

// Use esm to import ES module game definition
const { Monopoly } = require('./src/Game');

// Boot-time mod/map activation (MT2-SP3, spec §0): one mod+map per server
// process; the browser client aligns to G.activeModId/activeMapId on first sync.
if (process.env.MOD) {
  const { resolveModMap } = require('./src/mod-map-select');
  const r = resolveModMap(process.env.MOD, process.env.MAP || undefined);
  console.log(`Active mod: ${r.modId}  map: ${r.mapId === null ? '(mod default board)' : r.mapId}`);
} else if (process.env.MAP) {
  throw new Error('MAP= requires MOD= (a map id only means something within a mod)');
}

const server = Server({
  games: [Monopoly],
  origins: ['*'],  // Allow all origins (restrict in production)
});

// Serve the built client files from dist/
const buildPath = path.resolve(__dirname, 'dist');
server.app.use(serve(buildPath));

// require.main gate (MT2-SP3): requiring this file (unit tests) must not bind
// a port — only direct execution runs the server. The process-wide
// uncaughtException/unhandledRejection handlers below are ALSO inside this
// gate (fix wave): registered at module load, they used to install into
// EVERY process that merely `require()`s this file — including jest workers
// running mod-map-select.test.js, silently swallowing that worker's own
// rejections.
if (require.main === module) {
  // Prevent server crash from stale client reconnections
  process.on('uncaughtException', (err) => {
    console.error('WARN: uncaught exception (server continues):', err && err.message);
  });
  // A move that throws inside bgio's fire-and-forget Master.onUpdate call becomes
  // an UNHANDLED REJECTION, not an uncaughtException — without this handler Node
  // terminates the whole process (MT2-SP3, spec §2 engine hardening).
  process.on('unhandledRejection', (err) => {
    console.error('WARN: unhandled rejection (server continues):', (err && err.message) || err);
  });

  const PORT = process.env.PORT || 8088;
  server.run(PORT, () => {
    console.log(`Meinopoly server running on http://localhost:${PORT}`);
  });
}
