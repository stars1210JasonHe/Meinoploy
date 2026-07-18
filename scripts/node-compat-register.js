// node-compat-register.js — replaces `-r esm` as the require-hook for
// plain-Node execution of this project's ES-module-syntax source files
// (Game.js, mods/*, src/createmod/*, src/sim/*, etc).
//
// WHY (investigated 2026-07-18, ticket: node-22 loader): the `esm` npm
// package (v3.2.25, last published ~2020) crashes UNCONDITIONALLY under
// Node 22 — merely loading it (`require('esm')`, with or without the `-r`
// CLI flag, with or without ever calling the returned function) throws a
// native assertion failure inside Node's internal fs binding:
//   "node::fs::InternalModuleStat ... Assertion failed: (args.Length()) >= (2)"
// esm@3.2.25 monkey-patches an internal V8/Node binding whose calling
// convention changed; this is not a catchable JS error, so there is no way
// to "guard" the `-r esm` flag from inside the loaded code — the crash
// happens before any project code runs.
//
// Node's OWN native "require(ESM)" support (stable, unflagged, present in
// BOTH pinned versions here: 20.19.0 and 22.12.0) looked like a drop-in
// replacement, but it enforces the strict ESM specifier-resolution
// algorithm: no extensionless relative imports (`from './foo'` must be
// `from './foo.js'`), no directory imports via a nested package.json "main"
// field (`boardgame.io/core` -> ERR_UNSUPPORTED_DIR_IMPORT), and JSON
// imports require an explicit `with { type: 'json' }` attribute. This
// codebase (~200+ relative imports, several boardgame.io subpath imports,
// several *.data.json imports) is written in the lenient Parcel/CJS style
// throughout, so satisfying native ESM would mean editing dozens of files
// across src/ and mods/ — not a minimal change, and it also bypasses Node's
// module customization hooks entirely for require()-of-ESM (only applies to
// import()), so even a custom resolver hook can't paper over it for the
// require() call sites this project uses (server.js, mcp-server.js).
//
// MECHANISM: hook Module._extensions['.js'] (the same low-level seam
// @babel/register and ts-node use) to transpile ES-module syntax to plain
// CommonJS via the project's EXISTING babel.config.js (@babel/core and
// @babel/preset-env are already devDependencies — no new dependency added)
// before Node's own compiler ever sees the file. Transpiled output uses
// plain require() calls, which Node's CLASSIC CommonJS resolver has always
// handled leniently (extensionless files, directory + package.json "main",
// and native .json parsing) — the exact behaviors the strict ESM resolver
// rejects. node_modules is left untouched (already valid CJS/has its own
// exports maps; deferring to Node's stock resolver here is both faster and
// avoids re-resolving packages like @modelcontextprotocol/sdk whose modern
// "exports" map the old esm shim could never parse either).
//
// Usage: `node -r ./scripts/node-compat-register.js <entry>.js` (see
// package.json scripts), or `require('./node-compat-register')` at the top
// of a script that is not itself launched with `-r` (mcp-server.js).
//
// COST (measured at review, 4 trials each, node 20.19): server boot with the
// old `-r esm` shim ≈ 1.4s; with this hook ≈ 1.9-2.9s (node 22 ≈ 1.7s) —
// babel transpiles the src/ graph per boot with no disk cache. A ~0.5-1.5s
// per-restart dev-loop cost, accepted for dual-node correctness; an
// mtime-keyed transpile cache is the known upgrade path if it starts to hurt.
'use strict';

const Module = require('module');
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

const CONFIG_FILE = path.join(__dirname, '..', 'babel.config.js');
const IMPORT_EXPORT_RE = /(^|\n)\s*(import|export)\s/;

const originalJsHandler = Module._extensions['.js'];

Module._extensions['.js'] = function nodeCompatJsHandler(mod, filename) {
  if (filename.indexOf('node_modules') !== -1) {
    return originalJsHandler(mod, filename);
  }
  const source = fs.readFileSync(filename, 'utf8');
  if (!IMPORT_EXPORT_RE.test(source)) {
    return originalJsHandler(mod, filename); // plain CJS file — nothing to transform
  }
  const { code } = babel.transformSync(source, {
    filename,
    configFile: CONFIG_FILE,
    babelrc: false,
    sourceMaps: 'inline',
  });
  mod._compile(code, filename);
};
