// Meinopoly — boardgame.io Multiplayer Server
// Usage: npm run server                                          (dominion/classic, as before)
//        MOD=terra-titans npm run server                         (mod's first map/world)
//        MOD=dominion MAP=classic npm run server                 (mod + map/world id)
//   or directly: node -r ./scripts/node-compat-register.js server.js
// Port 8088 by default (PORT env var overrides). Works under Node 20.19 and
// Node 22 (node-compat-register.js replaces the old `-r esm` loader, which
// crashes unconditionally under Node 22 — see that file's header comment).
//
// MEINOPOLY_MATCH_LOG_CAP (default 200, `0` = unlimited/legacy): caps how
// many of the newest per-match action-log entries the server keeps and ever
// sends back on a `sync` (reconnect). A live socket probe against a running
// match measured a 510-entry / 104KB sync frame mid-game, still growing —
// boardgame.io's storage never trims this log, so long matches leak server
// memory AND make every reconnect fatter. See
// src/server/log-capped-storage.js for the full measurement + rationale.
//
// MEINOPOLY_PERSUASION (default unset = disabled, `1` = opt back in): the
// owner decided persuasion (MT2-SP5 direction C2 "舌战群儒") is DISABLED for
// ALL online matches in v1 (docs/superpowers/specs/2026-07-18-dialogue-c-
// design.md open question 4). App.js's own UI gate (hide the 求情/叫阵/游说
// buttons when online) is presentation-only — an MCP seat is an online
// socket client too, and could dispatch attemptPersuasion directly
// regardless of what the browser shows. This process forces
// RULES.persuasion.enabled = false at boot unless MEINOPOLY_PERSUASION=1, so
// src/Game.js's attemptPersuasion move (which already returns INVALID_MOVE
// whenever rules.enabled is false) rejects it for real, server-side. Local
// hot-seat (the browser's own in-memory G, no server involved) and the sim
// (a separate one-shot process that imports Game.js directly and never
// boots this file) are UNTOUCHED — RULES is a per-process singleton.

const { Server } = require('boardgame.io/server');
const serve = require('koa-static');
const path = require('path');

// node-compat-register.js (loaded via -r) transpiles this ES-module-syntax
// file to CommonJS on the fly, so require() works normally here.
const { Monopoly } = require('./src/Game');
const { capMatchLog } = require('./src/server/log-capped-storage');
const { RULES } = require('./mods/active-rules');

// Boot-time mod/map activation (MT2-SP3, spec §0): one mod+map per server
// process; the browser client aligns to G.activeModId/activeMapId on first sync.
if (process.env.MOD) {
  const { resolveModMap } = require('./src/mod-map-select');
  const r = resolveModMap(process.env.MOD, process.env.MAP || undefined);
  console.log(`Active mod: ${r.modId}  map: ${r.mapId === null ? '(mod default board)' : r.mapId}`);
} else if (process.env.MAP) {
  throw new Error('MAP= requires MOD= (a map id only means something within a mod)');
}

// Persuasion online-disable (MT2-SP5 direction C2, T4 — see header doc above
// for the full rationale). Placed AFTER the MOD=/MAP= activation block:
// resolveModMap's setActiveMod clears+reassigns EVERY RULES.* key (including
// .persuasion) from the target mod's own rules object, so running this gate
// any earlier would just get overwritten the moment a mod switch reseeds
// RULES — this line always runs LAST, once, at boot, whether or not MOD= was
// passed (RULES is already populated from the default dominion import even
// with no MOD= env, so the gate still applies to that default path too).
if (process.env.MEINOPOLY_PERSUASION !== '1') {
  RULES.persuasion.enabled = false;
}

const server = Server({
  games: [Monopoly],
  origins: ['*'],  // Allow all origins (restrict in production)
});

// Cap the per-match action log in place (see MEINOPOLY_MATCH_LOG_CAP doc
// comment above + src/server/log-capped-storage.js for why). Parsed here
// (not inside capMatchLog) so a garbage env value warns and falls back to
// the safe default instead of silently landing on 0 (unlimited) — the exact
// footgun this change exists to close.
function parseMatchLogCap(raw) {
  const DEFAULT_CAP = 200;
  if (raw === undefined) return DEFAULT_CAP;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(`WARN: MEINOPOLY_MATCH_LOG_CAP=${raw} is not a valid non-negative number; using default ${DEFAULT_CAP}`);
    return DEFAULT_CAP;
  }
  return n;
}
capMatchLog(server.db, parseMatchLogCap(process.env.MEINOPOLY_MATCH_LOG_CAP));

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

// Exposed for tests (e.g. asserting server.db got the log cap applied) —
// requiring this module never binds a port (see the require.main gate
// above), so this is safe to pull into jest.
module.exports = { server, parseMatchLogCap };
