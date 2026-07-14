// Create-Mod CLI — the ONLY fs/sim-touching module. Run via `npm run create-mod -- <input.json>`.
//
//   npm run create-mod -- <input.json> [--dry-run] [--force] [--balance]
//   npm run create-mod -- <facts.json> --smart [--seed <s>] [--dry-run] [--force] [--balance]
//   npm run create-mod -- --remove <id>
//
// Pure logic lives in src/createmod/* (Jest-tested). This file reads/writes files + runs the
// optional balance sim, and exports createMod/removeMod/parseArgs for the fs-smoke test.
import fs from 'fs';
import path from 'path';
import { validateModInput } from '../src/createmod/validate';
import { emitMod } from '../src/createmod/emit';
import { patchRegistries, unpatchRegistries } from '../src/createmod/registry-patch';
import { expandFacts } from '../src/createmod/smart/index';
import { ARCHETYPES } from '../mods/dominion/atlas/archetypes';
import { CHANCE_CARDS, COMMUNITY_CARDS } from '../mods/dominion/cards';
import { runExtract, resolveExtractModel, resolveSynthModel } from './extract-facts';
import { parseExtractArgs, EXTRACT_VALUE_FLAGS } from '../src/createmod/extract/flags';

const REPO_ROOT = path.resolve(__dirname, '..');
const OPTS = { ARCHETYPES, reusedCards: { chance: CHANCE_CARDS, community: COMMUNITY_CARDS } };

export function parseArgs(argv) {
  const out = {
    input: null, remove: null, dryRun: false, force: false, balance: false, smart: false, seed: null,
    fromBook: false, portraits: false, style: null, imageModel: null,
    autoBalance: false, balanceGames: 100, searchGames: 60, maxIterations: 8, maxEvals: 80,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--remove') { out.remove = argv[++i]; }
    else if (a === '--dry-run') { out.dryRun = true; }
    else if (a === '--force') { out.force = true; }
    else if (a === '--balance') { out.balance = true; }
    else if (a === '--auto-balance') { out.autoBalance = true; out.balance = true; }
    else if (a === '--balance-games') { out.balanceGames = parseInt(argv[++i], 10); }
    else if (a === '--search-games') { out.searchGames = parseInt(argv[++i], 10); }
    else if (a === '--max-iterations') { out.maxIterations = parseInt(argv[++i], 10); }
    else if (a === '--max-evals') { out.maxEvals = parseInt(argv[++i], 10); }
    else if (a === '--smart') { out.smart = true; }
    else if (a === '--seed') { out.seed = argv[++i]; }
    else if (a === '--portraits') { out.portraits = true; }
    else if (a === '--style') { out.style = argv[++i]; }
    else if (a === '--image-model') { out.imageModel = argv[++i]; }
    else if (a === '--from-book') { out.fromBook = true; }
    else if (EXTRACT_VALUE_FLAGS.includes(a)) { i++; } // extraction flag values are not positionals
    else if (!a.startsWith('--') && !out.input) { out.input = a; }
  }
  return out;
}

// --from-book flags that belong to create-mod's own dispatch (not the SP2 extraction flag
// set) must be stripped before delegating to parseExtractArgs, which REJECTS any unrecognized
// "--" flag (spec rule, see src/createmod/extract/flags.js) — so combining e.g.
// `--from-book --chars 3 --force` would otherwise misfire as "unrecognized flag: --force".
const CREATE_MOD_ONLY_BOOL_FLAGS = ['--from-book', '--dry-run', '--force', '--balance', '--auto-balance', '--smart', '--portraits'];
const CREATE_MOD_ONLY_VALUE_FLAGS = ['--seed', '--style', '--image-model', '--balance-games', '--search-games', '--max-iterations', '--max-evals'];

export function stripCreateModFlags(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (CREATE_MOD_ONLY_BOOL_FLAGS.includes(a)) continue;
    if (CREATE_MOD_ONLY_VALUE_FLAGS.includes(a)) { i++; continue; }
    out.push(a);
  }
  return out;
}

// Pure: derives the OpenAI client's {extractModel, synthModel} from --from-book argv using the
// EXACT same flag-parsing path runFromBook uses internally (stripCreateModFlags + parseExtractArgs
// + resolveExtractModel/resolveSynthModel). Previously loadFromBookEnvAndRun built the client
// with apiKey only, silently ignoring --extract-model/--synth-model while runExtract's cache key
// still keyed on the (unused) requested model — mislabeling default-model results under the
// requested model's cache key. Routing both the client and the cache key through this same
// resolver call means they can never disagree. No fs/network — safe to unit test directly.
export function buildFromBookClientOptions(argv) {
  const ex = parseExtractArgs(stripCreateModFlags(argv));
  return { extractModel: resolveExtractModel(ex), synthModel: resolveSynthModel(ex) };
}

// Creation-time balance (spec 2026-07-14-createmod-balance): the modern melee
// on the mod's REAL board with its REAL roster (the old slice ran two DOMINION
// characters as a proxy and skipped classic maps entirely — both fixed by the
// sim-mod wave's mapJson ingest + Game.setActiveModObject). Advisory: never
// blocks emit. Returns the balance context for the persisted report, and the
// tuned roster when --auto-balance applied moves (caller swaps it into
// `normalized` BEFORE emit so the written data.json carries the tuned stats).
function runBalance(normalized, args) {
  const { runCreateModBalance } = require('../src/createmod/balance/run');
  return runCreateModBalance(normalized, {
    games: args.balanceGames,
    searchGames: args.searchGames,
    seed: args.seed != null ? String(args.seed) : '1',
    autoBalance: args.autoBalance,
    maxIterations: args.maxIterations,
    maxEvals: args.maxEvals,
  });
}

export function createMod({ inputPath, rootDir = REPO_ROOT, dryRun = false, force = false, balance = false, smart = false, seed = null, balanceArgs = null }) {
  let input;
  if (smart) {
    // Facts -> near-final input. A throw here is an IMPOSSIBLE derivation: return the
    // {ok,errors} contract with NO input (nothing to inspect, even in dry-run).
    const facts = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    try {
      input = expandFacts(facts, { ARCHETYPES, seed: seed !== null ? seed : undefined });
    } catch (e) {
      // facts may be null/scalar (expandFacts throws before reading it) and e may be a non-Error.
      return { ok: false, errors: ['smart-build failed: ' + String((e && e.message) || e)], warnings: [], id: facts && facts.id, written: [] };
    }
  } else {
    input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  }
  const inputDir = path.dirname(path.resolve(inputPath));
  const indexPath = path.join(rootDir, 'mods', 'index.js');
  const appPath = path.join(rootDir, 'src', 'App.js');
  const indexSrc = fs.readFileSync(indexPath, 'utf8');
  const appSrc = fs.readFileSync(appPath, 'utf8');

  // Validate FIRST so a malformed id is rejected cleanly before we ever build a RegExp from it.
  const { ok, errors, warnings, normalized } = validateModInput(input, OPTS);

  // --smart --dry-run: print the derived JSON REGARDLESS of validity (the inspect/tweak
  // escape hatch), plus validation results as clearly-labeled non-blocking advisory.
  if (smart && dryRun) {
    console.log(JSON.stringify(input, null, 2));
    if (errors.length) {
      console.log('[advisory] validation errors (non-blocking in smart dry-run):');
      errors.forEach(e => console.log('  - ' + e));
    }
    if (warnings.length) {
      console.log('[advisory] warnings:');
      warnings.forEach(w => console.log('  - ' + w));
    }
    return { ok, errors, warnings, id: input.id, written: [], input };
  }

  if (!ok) return { ok: false, errors, warnings, id: input.id, written: [] };

  // id is now validated kebab-case ([a-z0-9-]) — safe to interpolate into a RegExp.
  if (!force && new RegExp(`['"]${input.id}['"]\\s*:`).test(indexSrc)) {
    return { ok: false, errors: [`mod "${input.id}" already registered (use --force)`], warnings, id: input.id, written: [] };
  }

  let balanceCtx = null;
  if (balance) {
    const bArgs = balanceArgs || { balanceGames: 100, searchGames: 60, autoBalance: false, maxIterations: 8, maxEvals: 80, seed };
    balanceCtx = runBalance(normalized, bArgs);
    if (balanceCtx.tunedRoster) {
      // Swap the tuned stats in BEFORE emit — the written data.json/bundles
      // then carry them natively (no post-hoc file editing).
      normalized.roster = balanceCtx.tunedRoster;
      console.log('[balance] tuned roster will be emitted (auto-balance applied moves)');
    }
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

  // Persist the balance report beside the mod (spec §1 — the persist-for-later
  // pattern backgrounds/*.prompt.txt established). Written after the mod files
  // so a balance-report can never exist for a mod that failed to write.
  if (balanceCtx) {
    const { renderBalanceReport } = require('../src/createmod/balance/report');
    const reportPath = path.join(rootDir, 'mods', input.id, 'balance-report.md');
    const auto = balanceCtx.auto
      ? Object.assign({ ran: true }, balanceCtx.auto)
      : { ran: false };
    fs.writeFileSync(reportPath, renderBalanceReport({
      modId: input.id,
      seed: seed != null ? String(seed) : '1',
      games: (balanceArgs && balanceArgs.balanceGames) || 100,
      date: new Date().toISOString().slice(0, 10),
      melee: balanceCtx.verifyMelee || balanceCtx.melee,
      gate: balanceCtx.gate,
      autoBalance: auto,
    }));
    written.push(path.join('mods', input.id, 'balance-report.md'));
  }
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

// Fires after a successful build (plain/smart AND --from-book) when --portraits was passed.
// `runner` is the test seam — real callers omit it and get the default, which lazy-requires
// gen-portraits + the images client (network-capable code a unit test must never load). Never
// throws: any preflight/network/write failure is reported and swallowed to `false` so the
// caller can exit 1 while leaving the already-built mod tree intact.
export async function chainPortraits({ modId, style, imageModel, rootDir, force, runner }) {
  try {
    const run = runner || (async o => {
      const gp = require('./gen-portraits');
      const client = require('../src/createmod/portraits/client')
        .createImagesClient({ apiKey: process.env.OPENAI_API_KEY, imageModel: gp.resolveImageModel(o) });
      return gp.runGenPortraits(o, client, gp.pngCodec);
    });
    // force must reach runGenPortraits's opts.force: create-mod --force re-emits characters.js
    // with an empty PORTRAIT_MAP (see gen-portraits.js's rewireCharactersJs), so a chained
    // --portraits --force needs the SAME force semantics the standalone CLI has.
    const r = await run({ modId, style: style || undefined, imageModel: imageModel || undefined, rootDir, force: !!force });
    if (!r.ok) {
      console.error('portraits generation failed — the mod itself was built and is playable with placeholders.');
      console.error(`retry standalone: npm run gen-portraits -- ${modId}`);
      return false;
    }
    return true;
  } catch (e) {
    const { redactSecrets } = require('./gen-portraits');
    console.error(`portraits generation failed: ${redactSecrets(e.message)}`);
    console.error(`the mod itself was built; retry standalone: npm run gen-portraits -- ${modId}`);
    return false;
  }
}

// --from-book sugar path: extract facts from a book, then feed them into the existing
// --smart chain. Consumes: runExtract (./extract-facts), parseExtractArgs (../src/createmod/
// extract/flags), createMod (above). Runs an early duplicate-id check BEFORE extraction so a
// mod that's already registered fails fast without spending any API money.
export async function runFromBook({ argv, rootDir = REPO_ROOT, llm }) {
  // Reuse create-mod's own parser for the create-mod-only flags instead of re-parsing argv by
  // hand — this is the same parseArgs() call the --smart path uses, so --seed/--force/--dry-run/
  // --balance are captured under the same option names with the same undefined-when-absent
  // default (seed: null), and forwarded to createMod() exactly like --smart does below.
  const args = parseArgs(argv);
  const ex = parseExtractArgs(stripCreateModFlags(argv));
  if (ex.errors.length) return { ok: false, errors: ex.errors };
  if (!ex.book) return { ok: false, errors: ['--from-book requires a book file'] };
  // Early dup-check: when the id is determinable BEFORE extraction, fail fast without --force.
  const force = args.force;
  const basename = path.basename(ex.book).replace(/\.[^.]*$/, ''); // path already imported at top
  const preId = ex.id || (basename.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || null);
  if (preId && !force) {
    const indexSrc = fs.readFileSync(path.join(rootDir, 'mods', 'index.js'), 'utf8');
    if (new RegExp(`['"]${preId}['"]\\s*:`).test(indexSrc)) {
      return { ok: false, errors: [`mod "${preId}" already registered (use --force)`] };
    }
  }
  const r = await runExtract({ ...ex, rootDir }, llm);
  if (!r.ok) {
    return { ok: false, errors: ['extraction produced invalid facts (see report); hand-edit ' + r.factsPath + ' then run: create-mod -- <facts> --smart' + (force ? ' --force' : '')] };
  }
  return createMod({ inputPath: r.factsPath, rootDir, smart: true, force, dryRun: args.dryRun, balance: args.balance, seed: args.seed, balanceArgs: args });
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.fromBook) {
    loadFromBookEnvAndRun(args, argv);
    return;
  }
  if (args.remove) {
    // --remove never builds anything, so --portraits has nothing to chain onto.
    if (args.portraits) console.log('--portraits ignored: nothing was built');
    const r = removeMod({ id: args.remove });
    if (!r.ok) { r.errors.forEach(e => console.error('ERROR: ' + e)); process.exit(1); }
    console.log(`Removed mod ${args.remove}.`);
    return;
  }
  if (!args.input) {
    console.error('Usage: npm run create-mod -- <input.json> [--smart] [--seed <s>] [--dry-run] [--force] [--balance] [--portraits] [--style <s>] [--image-model <m>]'
      + ' | npm run create-mod -- <book.txt> --from-book [extract flags] [--seed <s>] [--dry-run] [--force] [--balance] [--portraits]'
      + ' | --remove <id>');
    process.exit(1);
  }
  const r = createMod({ inputPath: args.input, dryRun: args.dryRun, force: args.force, balance: args.balance, smart: args.smart, seed: args.seed, balanceArgs: args });
  // Smart dry-run owns its own output (derived JSON + advisory) and exits 0 — but only
  // when a derived input exists; an impossible derivation falls through to ERROR + exit 1.
  if (args.smart && args.dryRun && r.input) {
    if (args.portraits) console.log('--portraits ignored: nothing was built');
    return;
  }
  (r.warnings || []).forEach(w => console.warn('WARN: ' + w));
  if (!r.ok) { r.errors.forEach(e => console.error('ERROR: ' + e)); process.exit(1); }
  if (args.dryRun) {
    if (args.portraits) console.log('--portraits ignored: nothing was built');
    return;
  }
  console.log(`Created mod ${r.id} (${r.written.length} files). Run \`npm run build\` to play it.`);
  if (args.portraits) runPortraitsChain(args, r.id).catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });
}

// Fires the optional --portraits chain after the plain/smart build path succeeds. This path
// (unlike --from-book) never needed OPENAI_API_KEY before, so the .env load is lazy and only
// happens here, gated on --portraits actually being requested on a real (non-dry-run) build.
// async: a synchronous throw from loadDotEnv/require (e.g. a broken .env parse or a missing
// module) must land in the caller's `.catch(...)`, not escape as a raw, unhandled stack trace.
// Wrapping the body in `async` turns any synchronous throw into a rejected promise automatically.
export async function runPortraitsChain(args, modId) {
  const { loadDotEnv } = require('./extract-facts');
  loadDotEnv(REPO_ROOT);
  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY is not set (env var or repo-root .env)');
    process.exit(1);
  }
  return chainPortraits({ modId, style: args.style, imageModel: args.imageModel, rootDir: REPO_ROOT, force: !!args.force }).then(ok => {
    if (!ok) process.exit(1);
  });
}

// Loads .env + validates the API key, builds the real OpenAI client, then runs --from-book.
// Kept out of main()'s body (and using require() for the OpenAI-client import) so tests that
// exercise main()/parseArgs never pull in network-capable code paths.
function loadFromBookEnvAndRun(args, argv) {
  const { loadDotEnv } = require('./extract-facts');
  loadDotEnv(REPO_ROOT);
  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY is not set (env var or repo-root .env)');
    process.exit(1);
  }
  const { createOpenAiClient } = require('../src/createmod/extract/client');
  const { extractModel, synthModel } = buildFromBookClientOptions(argv);
  const llm = createOpenAiClient({ apiKey: process.env.OPENAI_API_KEY, extractModel, synthModel });
  runFromBook({ argv, llm }).then(r => {
    (r.warnings || []).forEach(w => console.warn('WARN: ' + w));
    if (!r.ok) { r.errors.forEach(e => console.error('ERROR: ' + e)); process.exit(1); }
    console.log(`Created mod ${r.id} from book (${(r.written || []).length} files). Run \`npm run build\` to play it.`);
    if (args.dryRun) {
      if (args.portraits) console.log('--portraits ignored: nothing was built');
      return;
    }
    if (args.portraits) {
      // OPENAI_API_KEY was already loaded above to build the extraction client; reuse it.
      return chainPortraits({ modId: r.id, style: args.style, imageModel: args.imageModel, rootDir: REPO_ROOT }).then(ok => {
        if (!ok) process.exit(1);
      });
    }
  }).catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });
}

if (require.main === module) main(process.argv.slice(2));
