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
  // Task 10 replaces this stub with the full 9-tool registration.
  log('tool registration not implemented yet (Task 10)');
  process.exit(1);
}

main().catch(err => {
  log('fatal:', err && err.stack || err);
  process.exit(1);
});
