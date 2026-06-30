// Create-Mod CLI — the ONLY fs/sim-touching module. Run via `npm run create-mod -- <input.json>`.
//
//   npm run create-mod -- <input.json> [--dry-run] [--force] [--balance]
//   npm run create-mod -- --remove <id>
//
// Pure logic lives in src/createmod/* (Jest-tested). This file reads/writes files + runs the
// optional balance sim, and exports createMod/removeMod/parseArgs for the fs-smoke test.
import fs from 'fs';
import path from 'path';
import { validateModInput } from '../src/createmod/validate';
import { emitMod } from '../src/createmod/emit';
import { patchRegistries, unpatchRegistries } from '../src/createmod/registry-patch';
import { ARCHETYPES } from '../mods/dominion/atlas/archetypes';
import { CHANCE_CARDS, COMMUNITY_CARDS } from '../mods/dominion/cards';

const REPO_ROOT = path.resolve(__dirname, '..');
const OPTS = { ARCHETYPES, reusedCards: { chance: CHANCE_CARDS, community: COMMUNITY_CARDS } };

export function parseArgs(argv) {
  const out = { input: null, remove: null, dryRun: false, force: false, balance: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--remove') { out.remove = argv[++i]; }
    else if (a === '--dry-run') { out.dryRun = true; }
    else if (a === '--force') { out.force = true; }
    else if (a === '--balance') { out.balance = true; }
    else if (!a.startsWith('--') && !out.input) { out.input = a; }
  }
  return out;
}

function runBalance(normalized) {
  // Atlas only — the sim has no path to ingest a custom classic map.json (loads Dominion's
  // hardcoded classic board when world is null), so a classic balance run would test the
  // wrong board. Advisory: never blocks emit.
  const { runTournament } = require('../src/sim/tournament');
  const { CHARACTERS_DATA } = require('../mods/dominion/characters-data');
  const [a, b] = [CHARACTERS_DATA[0].id, CHARACTERS_DATA[1].id];
  const res = runTournament({
    world: normalized.world,
    contestants: [
      { label: a, charId: a, policy: { routeStrategy: 'camper' } },
      { label: b, charId: b, policy: { routeStrategy: 'camper' } },
    ],
    games: 40, baseSeed: '1',
    maxTurns: (normalized.world.victory && normalized.world.victory.maxTurns) || 150,
  });
  const g = res.gate;
  console.log(`[balance] gate 60/40: ${g.pass ? 'PASS' : 'FAIL'} (leader ${g.leader} ${(g.maxWinPct * 100).toFixed(1)}%)`);
}

export function createMod({ inputPath, rootDir = REPO_ROOT, dryRun = false, force = false, balance = false }) {
  const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  const inputDir = path.dirname(path.resolve(inputPath));
  const indexPath = path.join(rootDir, 'mods', 'index.js');
  const appPath = path.join(rootDir, 'src', 'App.js');
  const indexSrc = fs.readFileSync(indexPath, 'utf8');
  const appSrc = fs.readFileSync(appPath, 'utf8');

  // Validate FIRST so a malformed id is rejected cleanly before we ever build a RegExp from it.
  const { ok, errors, warnings, normalized } = validateModInput(input, OPTS);
  if (!ok) return { ok: false, errors, warnings, id: input.id, written: [] };

  // id is now validated kebab-case ([a-z0-9-]) — safe to interpolate into a RegExp.
  if (!force && new RegExp(`['"]${input.id}['"]\\s*:`).test(indexSrc)) {
    return { ok: false, errors: [`mod "${input.id}" already registered (use --force)`], warnings, id: input.id, written: [] };
  }

  if (balance) {
    if (normalized.mapType === 'atlas') runBalance(normalized);
    else console.log('[balance] skipped: the sim cannot ingest a custom classic map.json this slice');
  }

  const { files, copies } = emitMod(normalized);
  const patched = patchRegistries(input.id, { indexSrc, appSrc });

  if (dryRun) {
    console.log('[dry-run] would write:');
    files.forEach(f => console.log('  ' + f.path));
    copies.forEach(c => console.log('  copy ' + c.from + ' -> ' + c.to));
    console.log('[dry-run] registries patched=' + patched.changed);
    return { ok: true, errors: [], warnings, id: input.id, written: [] };
  }

  // Pre-flight: every declared portrait source must exist BEFORE we write anything —
  // avoids a half-written mod tree and keeps the {ok,errors} return contract.
  for (const c of copies) {
    const fromAbs = path.resolve(inputDir, c.from);
    if (!fs.existsSync(fromAbs)) {
      return { ok: false, errors: [`portrait source not found: ${fromAbs}`], warnings, id: input.id, written: [] };
    }
  }

  const written = [];
  for (const f of files) {
    const abs = path.join(rootDir, f.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.contents);
    written.push(f.path);
  }
  for (const c of copies) {
    const fromAbs = path.resolve(inputDir, c.from);
    const toAbs = path.join(rootDir, c.to);
    fs.mkdirSync(path.dirname(toAbs), { recursive: true });
    fs.copyFileSync(fromAbs, toAbs);
    written.push(c.to);
  }
  fs.writeFileSync(indexPath, patched.indexSrc);
  fs.writeFileSync(appPath, patched.appSrc);
  return { ok: true, errors: [], warnings, id: input.id, written };
}

export function removeMod({ id, rootDir = REPO_ROOT }) {
  if (!/^[a-z0-9-]+$/.test(id)) return { ok: false, errors: [`invalid id "${id}"`] };
  const modsRoot = path.resolve(path.join(rootDir, 'mods'));
  const modDir = path.resolve(path.join(rootDir, 'mods', id));
  if (modDir !== path.join(modsRoot, id) || !modDir.startsWith(modsRoot + path.sep)) {
    return { ok: false, errors: ['refusing to delete outside mods/'] };
  }
  const indexPath = path.join(rootDir, 'mods', 'index.js');
  const appPath = path.join(rootDir, 'src', 'App.js');
  const out = unpatchRegistries(id, {
    indexSrc: fs.readFileSync(indexPath, 'utf8'),
    appSrc: fs.readFileSync(appPath, 'utf8'),
  });
  if (!out.changed) console.log(`[remove] "${id}" not in registries (no-op on files)`);
  fs.writeFileSync(indexPath, out.indexSrc);
  fs.writeFileSync(appPath, out.appSrc);
  if (fs.existsSync(modDir)) fs.rmSync(modDir, { recursive: true, force: true });
  return { ok: true, errors: [] };
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.remove) {
    const r = removeMod({ id: args.remove });
    if (!r.ok) { r.errors.forEach(e => console.error('ERROR: ' + e)); process.exit(1); }
    console.log(`Removed mod ${args.remove}.`);
    return;
  }
  if (!args.input) {
    console.error('Usage: npm run create-mod -- <input.json> [--dry-run] [--force] [--balance] | --remove <id>');
    process.exit(1);
  }
  const r = createMod({ inputPath: args.input, dryRun: args.dryRun, force: args.force, balance: args.balance });
  (r.warnings || []).forEach(w => console.warn('WARN: ' + w));
  if (!r.ok) { r.errors.forEach(e => console.error('ERROR: ' + e)); process.exit(1); }
  if (!args.dryRun) console.log(`Created mod ${r.id} (${r.written.length} files). Run \`npm run build\` to play it.`);
}

if (require.main === module) main(process.argv.slice(2));
