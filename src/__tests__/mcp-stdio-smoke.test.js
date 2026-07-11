// src/__tests__/mcp-stdio-smoke.test.js
// End-to-end proof over REAL processes (spec §5): spawns the game server on an
// ephemeral port + the MCP server over stdio pipes, speaks raw JSON-RPC:
// initialize -> tools/list -> create_match -> join_match -> get_state ->
// make_move(selectCharacter). Skips LOUDLY if the sandbox blocks ports.
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

jest.setTimeout(120000);

const ROOT = path.resolve(__dirname, '..', '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const s = http.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

function waitHttp(url, ms) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    (function poll() {
      http.get(url, () => resolve()).on('error', () =>
        Date.now() - t0 > ms ? reject(new Error('server not up')) : setTimeout(poll, 300));
    })();
  });
}

class McpStdio {
  constructor(proc) {
    this.proc = proc; this.buf = ''; this.pending = new Map(); this.nextId = 1;
    this.stderrBuf = '';
    proc.stderr && proc.stderr.on && proc.stderr.on('data', (d) => { this.stderrBuf += d.toString(); });
    proc.stdout.on('data', (d) => {
      this.buf += d.toString();
      let idx;
      while ((idx = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, idx).trim(); this.buf = this.buf.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line); // ANY non-JSON stdout line = wire corruption = test failure
        } catch (e) {
          throw new Error(`non-JSON stdout line (wire corruption): ${JSON.stringify(line)}`);
        }
        if (msg.id && this.pending.has(msg.id)) { this.pending.get(msg.id)(msg); this.pending.delete(msg.id); }
      }
    });
  }
  request(method, params) {
    const id = this.nextId++;
    const p = new Promise((resolve, reject) => {
      this.pending.set(id, resolve);
      setTimeout(() => { if (this.pending.delete(id)) reject(new Error(`timeout: ${method} — stderr so far:\n${this.stderrBuf}`)); }, 30000);
    });
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    return p;
  }
  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }
}

const toolJson = (res) => JSON.parse(res.result.content[0].text);

function killTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      require('child_process').execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch (e) { /* already dead */ }
}

describe('stdio smoke', () => {
  let gamePort, gameProc, mcpProc, mcp;

  beforeAll(async () => {
    try {
      gamePort = await freePort();
    } catch (e) {
      console.warn('\n[mcp-stdio-smoke] SANDBOX BLOCKS PORTS — SKIPPING the whole-stack smoke test\n');
      gamePort = null; return;
    }
    gameProc = spawn(process.execPath, ['-r', 'esm', 'server.js'],
      { cwd: ROOT, env: { ...process.env, PORT: String(gamePort) }, stdio: 'ignore' });
    await waitHttp(`http://127.0.0.1:${gamePort}/games/monopoly`, 20000);
    mcpProc = spawn(process.execPath, ['scripts/mcp-server.js'],
      { cwd: ROOT, env: { ...process.env, MEINOPOLY_SERVER_URL: `http://127.0.0.1:${gamePort}`,
        MEINOPOLY_MCP_SESSION_FILE: path.join(ROOT, '.superpowers', `mcp-smoke-${Date.now()}.json`) },
        stdio: ['pipe', 'pipe', 'inherit'] });
    mcp = new McpStdio(mcpProc);
  });

  afterAll(() => {
    killTree(mcpProc && mcpProc.pid);
    killTree(gameProc && gameProc.pid);
  });

  test('initialize -> 9 tools -> create/join/state/legal/move round-trip', async () => {
    if (!gamePort) return; // loud skip happened in beforeAll
    const init = await mcp.request('initialize', {
      protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } });
    expect(init.result.serverInfo.name).toBe('meinopoly');
    mcp.notify('notifications/initialized', {});

    const tools = await mcp.request('tools/list', {});
    const names = tools.result.tools.map(t => t.name).sort();
    expect(names).toEqual(['create_match', 'get_events', 'get_state', 'get_state_digest',
      'join_match', 'list_legal_moves', 'list_matches', 'make_move', 'wait_for_my_turn']);

    const created = toolJson(await mcp.request('tools/call', { name: 'create_match', arguments: { numPlayers: 2 } }));
    expect(created.matchID).toBeTruthy();

    const joined = toolJson(await mcp.request('tools/call', { name: 'join_match', arguments: { matchID: created.matchID, seat: 0 } }));
    expect(joined.ok).toBe(true);
    expect(joined.seat).toBe('0'); // string-coercion pin

    const state = toolJson(await mcp.request('tools/call', { name: 'get_state', arguments: {} }));
    expect(state.phase).toBe('characterSelect');
    expect(state.yourSeat).toBe('0');

    const legal = toolJson(await mcp.request('tools/call', { name: 'list_legal_moves', arguments: {} }));
    expect(legal[0].move).toBe('selectCharacter');
    const charId = legal[0].argsHint.characterIds[0];

    const moved = toolJson(await mcp.request('tools/call', { name: 'make_move', arguments: { move: 'selectCharacter', args: [charId] } }));
    expect(moved.accepted).toBe(true);

    const events = toolJson(await mcp.request('tools/call', { name: 'get_events', arguments: {} }));
    expect(events.events.some(e => e.type === 'character_selected' && e.seq === 0)).toBe(true); // seq-0 delivered

    const errRes = await mcp.request('tools/call', { name: 'make_move', arguments: { move: 'zorch' } });
    expect(errRes.result.isError).toBe(true); // error envelope, not a success shape
  });
});
