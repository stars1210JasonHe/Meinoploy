// gen-boardbg CLI — fs/env/codec layer over src/createmod/boardbg (reskin R2).
// Generates ONE hi-bit pixel board background per mod world/map and persists the
// composed prompt beside it. Wiring the asset into bundle.client.js is a
// documented follow-up edit (the CLI prints the exact line) — auto-wiring
// arrives with the create-mod integration (ROADMAP).
//
// usage: npm run gen-boardbg -- <mod-id> [--map <map-id>] [--image-model m] [--force] [--dry-run]
//   <mod-id>      generated mods read mods/<id>/<id>.data.json; `dominion` uses
//                 the hand-authored adapter (characters-data.js + maps/<map>/map.json)
//   --map         dominion only: which map to target (default: classic)
//   --image-model default gpt-image-2 (owner 2026-07-13), or BOARDBG_IMAGE_MODEL env
import fs from 'fs';
import path from 'path';
import { boardBgTarget, generateBoardBg } from '../src/createmod/boardbg';
import { createImagesClient } from '../src/createmod/portraits/client';
import { KEBAB_ID } from '../src/createmod/portraits';
import { pngCodec, redactSecrets } from './gen-portraits';
import { loadDotEnv } from './extract-facts';

const REPO_ROOT = path.resolve(__dirname, '..');
export const DEFAULT_BOARDBG_MODEL = 'gpt-image-2';

export function resolveBoardBgModel(opts) {
  return (opts && opts.imageModel) || process.env.BOARDBG_IMAGE_MODEL || DEFAULT_BOARDBG_MODEL;
}

export function parseArgs(argv) {
  const out = { modId: null, map: null, imageModel: null, force: false, dryRun: false, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') out.force = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--map') { out.map = argv[++i]; if (!out.map) out.errors.push('--map requires a value'); }
    else if (a === '--image-model') { out.imageModel = argv[++i]; if (!out.imageModel) out.errors.push('--image-model requires a value'); }
    else if (!a.startsWith('--') && !out.modId) out.modId = a;
    else out.errors.push(`unknown arg: ${a}`);
  }
  return out;
}

// Dominion adapter: hand-authored mod without <id>.data.json — compose from the
// server-safe roster + the target map.json (name/description carry the era).
async function loadDominionTarget(mapId) {
  const mapPath = path.join(REPO_ROOT, 'mods', 'dominion', 'maps', mapId, 'map.json');
  if (!fs.existsSync(mapPath)) throw new Error(`dominion map not found: ${mapPath}`);
  const mapJson = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const { CHARACTERS_DATA } = await import('../mods/dominion/characters-data');
  return {
    kind: 'map', targetId: mapJson.id,
    promptInput: {
      kind: 'map', mapName: mapJson.name, story: mapJson.description,
      places: [], lore: {},
      roster: CHARACTERS_DATA.map(c => ({ id: c.id, name: c.name, title: c.title })),
    },
  };
}

// imagesClient/codec are INJECTED (mirrors gen-portraits.js's runGenPortraits) so tests can
// exercise the full fs + generation flow with a fake client and no network — the dry-run path
// never touches either param, so callers may pass null/null when opts.dryRun is true.
export async function runGenBoardBg(opts, imagesClient, codec) {
  const log = opts.log || console.log;
  // rootDir defaults to the real repo (CLI usage) but MUST be honored when supplied — a prior
  // version of this function ignored it and always resolved against REPO_ROOT, which made it
  // impossible to test against an isolated tmp mod tree without touching the real mods/ dir.
  const rootDir = opts.rootDir || REPO_ROOT;
  const modId = String(opts.modId || '');
  if (!KEBAB_ID.test(modId)) throw new Error(`mod id must match ${KEBAB_ID}: ${modId}`);
  const modsRoot = path.resolve(rootDir, 'mods');
  const modDir = path.resolve(modsRoot, modId);
  if (!modDir.startsWith(modsRoot + path.sep)) throw new Error(`mod id escapes mods/: ${modId}`);

  let target;
  if (modId === 'dominion') {
    // dominion is the hand-authored mod and always lives in the REAL repo tree, never a test
    // tmp root (known limitation, ticketed — see spec Part B item 3: create-mod's --boardbg
    // chain never targets "dominion", so this path is unaffected by the rootDir fix above).
    target = await loadDominionTarget(opts.map || 'classic');
  } else {
    const dataPath = path.join(modDir, `${modId}.data.json`);
    if (!fs.existsSync(dataPath)) throw new Error(`mod not found (run create-mod first): ${dataPath}`);
    target = boardBgTarget(JSON.parse(fs.readFileSync(dataPath, 'utf8')), { modName: modId });
  }

  const bgDir = path.join(modDir, 'backgrounds');
  const pngPath = path.join(bgDir, `${target.targetId}.png`);
  const promptPath = path.join(bgDir, `${target.targetId}.prompt.txt`);
  if (fs.existsSync(pngPath) && !opts.force && !opts.dryRun) {
    log(`background exists: ${path.relative(rootDir, pngPath)} — use --force to regenerate`);
    return { ok: true, written: [] };
  }

  const model = resolveBoardBgModel(opts);
  log(`${modId} -> ${target.kind} "${target.targetId}" (1 image call, ${model}, 1536x1024, quality medium)`);

  const r = await generateBoardBg(target.promptInput, { dryRun: opts.dryRun }, imagesClient, codec);
  for (const w of r.warnings) log(`warning: ${w}`);
  if (opts.dryRun) {
    log('--- composed prompt ---');
    log(r.prompt);
    return { ok: true, written: [], prompt: r.prompt };
  }

  fs.mkdirSync(bgDir, { recursive: true });
  fs.writeFileSync(pngPath, r.png);
  fs.writeFileSync(promptPath, r.prompt + '\n');
  if (r.usage) log(`usage: ${r.usage.input_tokens} in / ${r.usage.output_tokens} out / ${r.usage.total_tokens} total tokens`);
  log(`wrote ${path.relative(rootDir, pngPath)} + prompt`);
  const rel = `./backgrounds/${target.targetId}.png`;
  if (target.kind === 'world') {
    log(`wire it: import bg from '${rel}'; atlasAssets: { '${target.targetId}': { worldBg: bg, cityImages: {} } }`);
  } else {
    log(`wire it: import bg from '${rel}'; mapAssets: { '${target.targetId}': { boardBg: bg } }`);
  }
  return { ok: true, written: [pngPath, promptPath] };
}

async function main() {
  loadDotEnv(REPO_ROOT);
  const args = parseArgs(process.argv.slice(2));
  if (args.errors.length) { console.error(args.errors.join('; ')); process.exit(1); }
  if (!args.modId) {
    console.error('usage: npm run gen-boardbg -- <mod-id> [--map <map-id>] [--image-model m] [--force] [--dry-run]');
    process.exit(1);
  }
  if (!args.dryRun && !process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY is not set (set it in .env or the environment)');
    process.exit(1);
  }
  try {
    const client = args.dryRun ? null : createImagesClient({ apiKey: process.env.OPENAI_API_KEY, imageModel: resolveBoardBgModel(args) });
    await runGenBoardBg(args, client, pngCodec);
  } catch (e) {
    console.error('gen-boardbg failed:', redactSecrets(e && e.message ? e.message : e));
    process.exit(1);
  }
}

if (require.main === module) main();
