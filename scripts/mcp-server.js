#!/usr/bin/env node
// Meinopoly MCP server — stdio transport. AI agents join a running game server
// (npm run server) as a real player seat. Spec: docs/superpowers/specs/2026-07-10-mcp-layer-design.md
//
// Registration (direct node — NEVER via `npm run`, npm's banner corrupts the stdio wire):
//   claude mcp add meinopoly -- node <absolute path>/scripts/mcp-server.js
//
// MODULE BOOTSTRAP (spec §2, empirically verified): this file is plain CJS run
// WITHOUT `-r esm`. The MCP SDK ships CJS builds but uses a modern package
// `exports` map the old esm@3.2.25 shim cannot resolve — so the SDK and zod are
// required NATIVELY here, and project `src/` files (ESM syntax + boardgame.io
// directory imports) are loaded through a SCOPED shim instance instead. Order
// does not matter (verified both ways), but .js extensions are load-bearing:
// a .mjs handed to esmRequire() is routed to Node's strict resolver and dies
// on boardgame.io 0.45's directory imports.

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

const esmRequire = require('esm')(module);

function log(...args) {
  // stdout is the JSON-RPC wire — stderr only, never credentials.
  console.error('[meinopoly-mcp]', ...args);
}

async function main() {
  if (process.argv.includes('--selftest')) {
    // Bootstrap verification (spec V4): prove the scoped shim loads the full
    // src/ graph (Game.js -> mods registry, boardgame.io client + transports)
    // alongside the natively-required SDK, in ONE process.
    const { Monopoly } = esmRequire('../src/Game.js');
    const { Client } = esmRequire('boardgame.io/client');
    const { SocketIO, Local } = esmRequire('boardgame.io/multiplayer');
    if (typeof McpServer !== 'function') throw new Error('selftest: McpServer not a constructor');
    if (typeof z.object !== 'function') throw new Error('selftest: zod not loaded');
    if (!Monopoly || Monopoly.name !== 'monopoly') throw new Error('selftest: Game.js failed to load');
    if (typeof Client !== 'function' || typeof SocketIO !== 'function' || typeof Local !== 'function') {
      throw new Error('selftest: boardgame.io client/transports failed to load');
    }
    log('BOOTSTRAP OK: sdk + zod (native) + Game.js + boardgame.io (scoped esm)');
    return;
  }
  // --- full tool registration ---
  const path = require('path');
  const fs = require('fs');
  const mcpCore = esmRequire('../src/mcp/index.js');
  const { createSession, McpToolError } = mcpCore;
  const { Client } = esmRequire('boardgame.io/client');
  const { SocketIO } = esmRequire('boardgame.io/multiplayer');
  const { Monopoly, setActiveMod } = esmRequire('../src/Game.js');

  const SERVER_URL = process.env.MEINOPOLY_SERVER_URL || 'http://localhost:8088';
  const MOVE_TIMEOUT = Number(process.env.MEINOPOLY_MCP_MOVE_TIMEOUT_MS) || 1500;
  const SYNC_TIMEOUT = Number(process.env.MEINOPOLY_MCP_SYNC_TIMEOUT_MS) || 5000;
  const SESSION_FILE = process.env.MEINOPOLY_MCP_SESSION_FILE
    || path.join(__dirname, '..', '.superpowers', 'mcp-session.json');

  const credStore = {
    load() {
      try { return JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')); } catch { return {}; }
    },
    save(data) {
      fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
      fs.writeFileSync(SESSION_FILE, JSON.stringify(data)); // credentials on disk: gitignored dir, same trust domain as the machine (spec §7)
    },
  };

  const session = createSession({
    serverUrl: SERVER_URL,
    fetchImpl: (...a) => fetch(...a), // Node 20 global fetch
    clientFactory: ({ matchID, playerID, credentials, numPlayers }) => Client({
      game: Monopoly, numPlayers, multiplayer: SocketIO({ server: SERVER_URL }),
      matchID, playerID, credentials, debug: false,
    }),
    credStore,
    setActiveModImpl: (id) => setActiveMod(id),
    moveTimeoutMs: MOVE_TIMEOUT,
    syncTimeoutMs: SYNC_TIMEOUT,
    log,
  });

  const server = new McpServer({ name: 'meinopoly', version: '1.0.0' });

  const ok = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] });
  const wrap = (fn) => async (input) => {
    try {
      return ok(await fn(input || {}));
    } catch (e) {
      if (e instanceof McpToolError) return { content: [{ type: 'text', text: e.message }], isError: true };
      log('tool crash:', e && e.stack || e);
      return { content: [{ type: 'text', text: `internal error: ${e.message}` }], isError: true };
    }
  };

  server.registerTool('list_matches',
    { description: 'List open matches on the Meinopoly game server.', inputSchema: {} },
    wrap(() => session.listMatches()));

  server.registerTool('create_match',
    { description: 'Create a match (2..10 players; seat enforcement on; victory mode follows the server default). Does NOT auto-join.',
      inputSchema: { numPlayers: z.number().int().min(2).max(10) } },
    wrap(({ numPlayers }) => session.createMatch({ numPlayers })));

  server.registerTool('join_match',
    { description: 'Join a match as a seat (takes over the session; one active session per server). Numbers are coerced to string seats.',
      inputSchema: { matchID: z.string(), seat: z.union([z.string(), z.number()]), name: z.string().optional() } },
    wrap(({ matchID, seat, name }) => session.joinMatch({ matchID, seat, name })));

  server.registerTool('get_state',
    { description: 'Structured view of the joined match: seats, flags, canAct/isYourTurn/isAddressed, gameover.', inputSchema: {} },
    wrap(() => session.getState()));

  server.registerTool('get_state_digest',
    { description: 'Compact English digest of the current state — the primary per-turn read.', inputSchema: {} },
    wrap(() => session.getStateDigest()));

  server.registerTool('list_legal_moves',
    { description: 'Moves YOUR seat can make right now, with argsHints and required expect values.', inputSchema: {} },
    wrap(() => session.listLegalMoves()));

  server.registerTool('make_move',
    { description: 'Dispatch a move. args = positional array. For placeBid/passAuction/acceptTrade/rejectTrade/respondDuel/declineDuel, echo expect from list_legal_moves. Returns {accepted, reason?, digest}.',
      inputSchema: { move: z.string(), args: z.array(z.any()).optional(),
        expect: z.object({ decisionSeq: z.number() }).optional() } },
    wrap(({ move, args, expect }) => session.makeMove({ move, args, expect })));

  server.registerTool('get_events',
    { description: 'Typed engine events since your cursor (parameterless advances it) or since an explicit sinceSeq (pure read; -1 = full history). gap:true means the 200-event log trimmed past your cursor — reconcile via get_state.',
      inputSchema: { sinceSeq: z.number().optional() } },
    wrap(({ sinceSeq }) => session.getEvents({ sinceSeq })));

  server.registerTool('wait_for_my_turn',
    { description: 'Long-poll (1-45s, default 25s) until you can act or the game ends. Resolves immediately if you already can.',
      inputSchema: { timeoutMs: z.number().optional() } },
    wrap(({ timeoutMs }) => session.waitForMyTurn({ timeoutMs })));

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`ready — game server: ${SERVER_URL}`);
}

main().catch(err => {
  log('fatal:', err && err.stack || err);
  process.exit(1);
});
