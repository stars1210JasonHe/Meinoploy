// gen-portraits CLI — fs/env/codec layer over src/createmod/portraits.
// Spec: docs/superpowers/specs/2026-07-06-create-mod-portraits-design.md §7.
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { generatePortraits, KEBAB_ID, validateRosterIds } from '../src/createmod/portraits';
import { createImagesClient, DEFAULT_IMAGE_MODEL } from '../src/createmod/portraits/client';
import { charactersJs } from '../src/createmod/templates';
import { loadDotEnv } from './extract-facts';

const REPO_ROOT = path.resolve(__dirname, '..');

export function resolveImageModel(opts) {
  return (opts && opts.imageModel) || process.env.IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
}

export const pngCodec = {
  decode(b64) {
    const p = PNG.sync.read(Buffer.from(b64, 'base64'));
    return { width: p.width, height: p.height, data: new Uint8Array(p.data) };
  },
  encode(img) {
    const p = new PNG({ width: img.width, height: img.height });
    p.data = Buffer.from(img.data);
    return PNG.sync.write(p);
  },
};

function resolveName(dataJson, modDir, modId) {
  if (typeof dataJson.name === 'string' && dataJson.name) return dataJson.name;
  const bundlePath = path.join(modDir, 'bundle.data.js');
  if (fs.existsSync(bundlePath)) {
    const m = fs.readFileSync(bundlePath, 'utf8').match(/^  name: (".*"),$/m);
    if (m) { try { return JSON.parse(m[1]); } catch (e) { /* fall through */ } }
  }
  return modId;
}

// The OPENAI_API_KEY (or any bearer-token-shaped string an upstream error might echo back,
// e.g. a provider error message that includes the request's Authorization header) must never
// land in a written report. Defense in depth: redact anything key-shaped before it is persisted.
function redactSecrets(s) {
  return String(s).replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]');
}

function renderReport(ctx) {
  const lines = [`# Portrait generation report — ${ctx.modId}`, ''];
  lines.push(`- characters: ${ctx.rosterCount}`);
  lines.push(`- image calls: ${ctx.plan.map(p => `${p.count} chars @ ${p.geometry.size} (${p.geometry.cols}x${p.geometry.rows})`).join('; ') || 'none'}`);
  if (ctx.usage) lines.push(`- usage: ${ctx.usage.input_tokens} in / ${ctx.usage.output_tokens} out / ${ctx.usage.total_tokens} total tokens`);
  if (ctx.pruned.length) lines.push(`- pruned stale portraits: ${ctx.pruned.join(', ')}`);
  if (ctx.warnings.length) { lines.push('', '## Warnings'); for (const w of ctx.warnings) lines.push(`- ${w}`); }
  if (ctx.error) { lines.push('', '## Error', '', ctx.error, '', 'No files were written. The mod still plays with placeholder portraits.'); }
  lines.push('', '## Notes', '- characters.js is a GENERATED file and was re-rendered; hand edits there are not preserved.',
    '- If a run crashes mid-write, the next run detects the incomplete set and regenerates.',
    '', `Next: npm run build`);
  return lines.join('\n') + '\n';
}

export async function runGenPortraits(opts, imagesClient, codec) {
  const log = opts.log || console.log;
  const rootDir = opts.rootDir || REPO_ROOT;
  const modId = String(opts.modId || '');

  // step 1: mod-id validation + containment (mirrors removeMod's guard)
  if (!KEBAB_ID.test(modId)) throw new Error(`mod id must match ${KEBAB_ID}: ${modId}`);
  const modsRoot = path.resolve(rootDir, 'mods');
  const modDir = path.resolve(modsRoot, modId);
  if (!modDir.startsWith(modsRoot + path.sep)) throw new Error(`mod id escapes mods/: ${modId}`);
  const dataPath = path.join(modDir, `${modId}.data.json`);
  if (!fs.existsSync(dataPath)) throw new Error(`mod not found (run create-mod first): ${dataPath}`);
  const dataJson = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  const roster = dataJson.roster || [];

  // step 2: roster id validation BEFORE any use — defense in depth (spec §7 step 2); the core
  // generatePortraits validates again internally, so this is intentional belt-and-suspenders,
  // not duplication to remove. Shared with the core's own check via validateRosterIds.
  if (!roster.length) throw new Error('roster is empty');
  const idErrors = validateRosterIds(roster);
  if (idErrors.length) throw new Error(idErrors.join('; ') + ' — refusing to write files or imports for it');

  // step 3: portraits dir preconditions + no-op / partial detection
  const portraitsDir = path.join(modDir, 'portraits');
  if (fs.existsSync(portraitsDir) && !fs.statSync(portraitsDir).isDirectory()) {
    throw new Error(`mods/${modId}/portraits exists but is a file, not a directory`);
  }
  const wanted = roster.map(c => `${c.id}.png`);
  const existing = fs.existsSync(portraitsDir) ? fs.readdirSync(portraitsDir) : [];
  const allPresent = wanted.every(f => existing.includes(f));
  if (allPresent && !opts.force) {
    log(`portraits already exist for all ${roster.length} character(s); use --force to regenerate`);
    return { ok: true, written: [], pruned: [], reportPath: null, warnings: [] };
  }
  const stale = existing.filter(f => /^[a-z0-9-]+\.png$/.test(f) && !wanted.includes(f));

  // step 4: pre-call plan (before any spend/delete)
  const dry = await generatePortraits({ roster, lore: dataJson.lore }, { style: opts.style, dryRun: true }, imagesClient, codec);
  const model = resolveImageModel(opts);
  log(`${roster.length} character(s) -> ${dry.plan.length} image call(s) (${model}, ${dry.plan.map(p => p.geometry.size).join('/')}, quality medium)`);
  if (stale.length) log(`stale portraits that a successful run will prune: ${stale.join(', ')}`);
  if (opts.dryRun) {
    for (const p of dry.plan) log(`--- prompt (${p.count} chars in ${p.geometry.cols}x${p.geometry.rows}) ---\n${p.prompt}`);
    return { ok: true, written: [], pruned: [], reportPath: null, warnings: dry.warnings };
  }

  // step 6: generate everything in memory, then the atomic write phase
  const reportPath = path.join(portraitsDir, 'generation-report.md');
  let result;
  try {
    result = await generatePortraits({ roster, lore: dataJson.lore }, { style: opts.style }, imagesClient, codec);
  } catch (e) {
    const safeMessage = redactSecrets(e.message);
    fs.mkdirSync(portraitsDir, { recursive: true });
    fs.writeFileSync(reportPath, renderReport({
      modId, rosterCount: roster.length, plan: dry.plan, usage: null,
      pruned: [], warnings: dry.warnings, error: safeMessage,
    }));
    return { ok: false, written: [], pruned: [], reportPath, warnings: dry.warnings, error: safeMessage };
  }

  fs.mkdirSync(portraitsDir, { recursive: true });
  const written = [];
  for (const p of result.portraits) {
    const file = path.join(portraitsDir, `${p.id}.png`);
    fs.writeFileSync(file, codec.encode(p.image));
    written.push(file);
  }
  const pruned = [];
  for (const f of stale) { fs.rmSync(path.join(portraitsDir, f)); pruned.push(f); }

  // step 6c: re-render characters.js (name chain: data.json.name -> bundle.data.js -> id)
  const name = resolveName(dataJson, modDir, modId);
  const portraits = roster.map(c => ({ id: c.id, path: `portraits/${c.id}.png` }));
  fs.writeFileSync(path.join(modDir, 'characters.js'), charactersJs({ name, portraits }));

  fs.writeFileSync(reportPath, renderReport({
    modId, rosterCount: roster.length, plan: result.plan, usage: result.usage,
    pruned, warnings: result.warnings, error: null,
  }));
  log(`wrote ${written.length} portrait(s) + characters.js; report: ${reportPath}`);
  return { ok: true, written, pruned, reportPath, warnings: result.warnings };
}

function parseCliArgs(argv) {
  const out = { modId: null, style: null, imageModel: null, force: false, dryRun: false, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--style') { out.style = argv[++i]; if (out.style == null || out.style === '') out.errors.push('--style requires a value'); }
    else if (a === '--image-model') { out.imageModel = argv[++i]; if (!out.imageModel) out.errors.push('--image-model requires a value'); }
    else if (a === '--force') out.force = true;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--')) out.errors.push(`unrecognized flag: ${a}`);
    else if (!out.modId) out.modId = a;
    else out.errors.push(`unexpected argument: ${a}`);
  }
  return out;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.errors.length) { for (const e of args.errors) console.error(`ERROR: ${e}`); process.exit(1); }
  if (!args.modId) { console.error('usage: npm run gen-portraits -- <mod-id> [--style "<text>"] [--image-model m] [--force] [--dry-run]'); process.exit(1); }
  try {
    let client = null;
    if (!args.dryRun) {
      loadDotEnv(REPO_ROOT);
      if (!process.env.OPENAI_API_KEY) { console.error('ERROR: OPENAI_API_KEY is not set (set it in .env or the environment)'); process.exit(1); }
      client = createImagesClient({ apiKey: process.env.OPENAI_API_KEY, imageModel: resolveImageModel(args) });
    } else {
      client = { generate: async () => { throw new Error('dry-run must not call the API'); } };
    }
    const r = await runGenPortraits({ modId: args.modId, rootDir: REPO_ROOT, style: args.style, imageModel: args.imageModel, force: args.force, dryRun: args.dryRun }, client, pngCodec);
    process.exit(r.ok ? 0 : 1);
  } catch (e) {
    console.error(`ERROR: ${e.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();
