// src/__tests__/node-compat-register.test.js
// Ticket (node-22 loader): scripts/node-compat-register.js replaces `-r esm`
// as the require-hook for plain-Node execution of this project's
// ES-module-syntax files (Game.js, mods/*, src/sim/*, etc). The hook itself
// operates on Node's real Module system, which Jest's own sandboxed module
// registry does not use for test files — so these tests spawn REAL child
// `node` processes (same pattern as mcp-stdio-smoke.test.js) rather than
// requiring the hook in-process, which would install it into the shared
// jest worker and risk leaking into unrelated test files.
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
// `-r` resolves bare specifiers via node_modules — a leading "./" is required
// for it to treat this as a path relative to cwd.
const HOOK = './' + path.join('scripts', 'node-compat-register.js').replace(/\\/g, '/');

function run(code, extraArgs = []) {
  return spawnSync(process.execPath, ['-r', HOOK, ...extraArgs, '-e', code], { cwd: ROOT, encoding: 'utf8' });
}

describe('node-compat-register.js', () => {
  test('loads Game.js (ESM syntax, boardgame.io directory import, extensionless relative imports, mod JSON files)', () => {
    const res = run("const g = require('./src/Game.js'); console.log(JSON.stringify({ hasMonopoly: typeof g.Monopoly, name: g.Monopoly && g.Monopoly.name }));");
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout.trim().split('\n').pop())).toEqual({ hasMonopoly: 'object', name: 'monopoly' });
  });

  test('loads src/sim/match.js (boardgame.io/client + a *.json import)', () => {
    const res = run("const m = require('./src/sim/match.js'); console.log(JSON.stringify({ hasRunMatch: typeof m.runMatch, hasIngestMap: typeof m.ingestMap }));");
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout.trim().split('\n').pop())).toEqual({ hasRunMatch: 'function', hasIngestMap: 'function' });
  });

  test('server.js is still require-safe (require.main gate) when loaded through the new hook', () => {
    const res = run("require('./server.js'); console.log('OK');");
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/OK/);
  });

  test('mcp-server.js --selftest passes through the new hook (no scoped esm shim)', () => {
    const res = spawnSync(process.execPath, ['scripts/mcp-server.js', '--selftest'], { cwd: ROOT, encoding: 'utf8' });
    expect(res.status).toBe(0);
    expect(res.stderr).toMatch(/BOOTSTRAP OK/);
  });

  test('a plain CJS file (no import/export syntax) is left untouched by the transform branch', () => {
    // koa-static is a real node_modules CJS package required transitively by
    // server.js; requiring it directly here proves the node_modules bypass
    // branch does not choke on packages that never go through babel.
    const res = run("const s = require('koa-static'); console.log(JSON.stringify({ hasStatic: typeof s }));");
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout.trim().split('\n').pop())).toEqual({ hasStatic: 'function' });
  });
});
