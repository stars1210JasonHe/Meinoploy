// SP2 CLI — the ONLY fs/network layer. Run via `npm run extract-facts -- <book.txt> [flags]`.
// Pure logic lives in src/createmod/extract/* (mock-LLM tested); this file reads the book,
// loads .env, encodes --map-image, owns the success-only chunk cache, writes facts + report,
// and exports runExtract(opts, llm) so tests inject a mock client.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createHash } from 'crypto';
import { parseExtractArgs } from '../src/createmod/extract/flags';
import { extractFacts, kebabAscii } from '../src/createmod/extract/index';
import { createOpenAiClient } from '../src/createmod/extract/client';
import { MAP_CACHE_KEY } from '../src/createmod/extract/prompts';
import { detectLang } from '../src/createmod/extract/language';

const REPO_ROOT = path.resolve(__dirname, '..');
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

export function loadDotEnv(rootDir) {
  const p = path.join(rootDir, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

// Minimal dimension sniff for the short-side warning (PNG IHDR; JPEG SOFn scan).
// webp returns null (no warn) — acceptable per spec, the warn is advisory only.
function imageDims(buf, ext) {
  try {
    if (ext === '.png') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (ext === '.jpg' || ext === '.jpeg') {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch (e) { /* sniff is best-effort */ }
  return null;
}

function cacheDirFor(rootDir, bookText, opts, resolvedLang) {
  const bookHash = createHash('sha256').update(bookText).digest('hex').slice(0, 16);
  const params = createHash('sha256')
    .update(JSON.stringify({
      chunkSize: opts.chunkSize, overlap: opts.overlap, lang: resolvedLang,
      extractModel: opts.extractModel || process.env.EXTRACT_MODEL || 'gpt-4o-mini',
      mapKey: MAP_CACHE_KEY,
    }))
    .digest('hex').slice(0, 16);
  return path.join(rootDir, '.extract-cache', `${bookHash}-${params}`);
}

export async function runExtract(opts, llm) {
  const rootDir = opts.rootDir || REPO_ROOT;
  const bookText = fs.readFileSync(opts.book, 'utf8');
  if (!bookText.trim()) throw new Error(`book is empty: ${opts.book}`);
  const bookBasename = path.basename(opts.book).replace(/\.[^.]*$/, '');
  const resolvedLang = opts.lang === 'auto' ? detectLang(bookText) : opts.lang;

  // success-only chunk cache
  const cacheDir = cacheDirFor(rootDir, bookText, opts, resolvedLang);
  fs.mkdirSync(cacheDir, { recursive: true });
  const cachedChunks = {};
  if (!opts.recache) {
    for (const f of fs.readdirSync(cacheDir)) {
      const m = f.match(/^chunk-(\d+)\.json$/);
      if (!m) continue;
      try {
        cachedChunks[Number(m[1])] = JSON.parse(fs.readFileSync(path.join(cacheDir, f), 'utf8'));
      } catch (e) {
        // corrupt/truncated cache file (e.g. process killed mid-write) — treat as a cache miss.
        // Do not delete: the next successful map for this chunk overwrites it.
        console.warn('WARN: corrupt cache file ignored: ' + f);
      }
    }
  }

  // --map-image: validate + encode (CLI owns fs; the pure core sees only the data URL)
  let mapImageDataUrl;
  let mapImageRelPath;
  if (opts.mapImage) {
    const ext = path.extname(opts.mapImage).toLowerCase();
    if (!MIME[ext]) throw new Error(`--map-image extension must be one of ${Object.keys(MIME).join('/')} (got "${ext}")`);
    if (!fs.existsSync(opts.mapImage)) throw new Error(`--map-image not found: ${opts.mapImage}`);
    const stat = fs.statSync(opts.mapImage);
    if (stat.size > 20 * 1024 * 1024) throw new Error('--map-image exceeds 20 MB');
    const buf = fs.readFileSync(opts.mapImage);
    const dims = imageDims(buf, ext);
    if (dims && Math.min(dims.w, dims.h) > 2048) {
      console.warn(`WARN: --map-image short side is ${Math.min(dims.w, dims.h)}px; the API downscales to ~2048px — tiny labels may be unreadable (consider pre-cropping)`);
    }
    mapImageDataUrl = `data:${MIME[ext]};base64,${buf.toString('base64')}`;
  }

  const outPath = opts.out || path.join(path.dirname(opts.book), `${bookBasename}.facts.json`);
  if (opts.mapImage) {
    mapImageRelPath = path.relative(path.dirname(outPath), opts.mapImage).replace(/\\/g, '/');
  }

  const { facts, report } = await extractFacts(bookText, {
    id: opts.id, bookBasename, chars: opts.chars, places: opts.places, lang: opts.lang,
    mapType: opts.mapType, mapImageDataUrl, mapImageRelPath,
    chunkSize: opts.chunkSize, overlap: opts.overlap, maxChunks: opts.maxChunks,
    cachedChunks,
    onChunkResult: (i, data) => fs.writeFileSync(path.join(cacheDir, `chunk-${i}.json`), JSON.stringify(data)),
  }, llm);

  fs.writeFileSync(outPath, JSON.stringify(facts, null, 2) + '\n');
  const reportPath = outPath.replace(/\.facts\.json$/, '') + '.extract-report.md';
  fs.writeFileSync(reportPath, renderReport(facts, report, opts));
  return { ok: report.validationErrors.length === 0, factsPath: outPath, reportPath, validationErrors: report.validationErrors };
}

function renderReport(facts, r, opts) {
  return [
    `# Extraction report — ${facts.name || facts.id}`,
    '',
    `- language: ${r.lang}`,
    `- chunks: ${r.chunksTotal} processed, ${r.chunksSkipped.length} skipped${r.chunksSkipped.length ? ' (' + r.chunksSkipped.join(', ') + ')' : ''}`,
    `- candidates: ${r.candidates.characters} characters / ${r.candidates.places} places`,
    `- cut kept: ${r.cut.characters.join(', ')} | ${r.cut.places.join(', ')}`,
    `- cut dropped: ${r.cut.droppedCharacters.join(', ') || 'none'} | ${r.cut.droppedPlaces.join(', ') || 'none'}`,
    `- degraded lore: ${r.degradedLore.join(', ') || 'none'}`,
    `- interpolated map-image places: ${(r.interpolatedPlaces || []).join(', ') || 'none'}`,
    `- token usage: ${r.usage.prompt_tokens} prompt / ${r.usage.completion_tokens} completion`,
    '',
    '## Warnings', ...(r.warnings.length ? r.warnings.map(w => `- ${w}`) : ['- none']),
    '',
    '## Validation', ...(r.validationErrors.length ? r.validationErrors.map(e => `- ${e}`) : ['- ok']),
    '',
    r.validationErrors.length
      ? 'facts.json was written but is INVALID — hand-edit it, then run: npm run create-mod -- <facts.json> --smart'
      : 'Next: npm run create-mod -- <facts.json> --smart',
    '',
  ].join('\n');
}

async function main(argv) {
  const opts = parseExtractArgs(argv);
  if (opts.errors.length) { opts.errors.forEach(e => console.error('ERROR: ' + e)); process.exit(1); }
  if (!opts.book) { console.error('Usage: npm run extract-facts -- <book.txt> [flags]'); process.exit(1); }
  if (!fs.existsSync(opts.book)) { console.error('ERROR: book not found: ' + opts.book); process.exit(1); }
  loadDotEnv(REPO_ROOT);
  if (!process.env.OPENAI_API_KEY) {
    console.error('ERROR: OPENAI_API_KEY is not set (set the env var or put it in a repo-root .env)');
    process.exit(1);
  }
  const llm = createOpenAiClient({
    apiKey: process.env.OPENAI_API_KEY,
    extractModel: opts.extractModel || process.env.EXTRACT_MODEL || 'gpt-4o-mini',
    synthModel: opts.synthModel || process.env.SYNTH_MODEL || 'gpt-4o',
  });
  try {
    const r = await runExtract(opts, llm);
    console.log(`facts:  ${r.factsPath}`);
    console.log(`report: ${r.reportPath}`);
    if (!r.ok) {
      r.validationErrors.forEach(e => console.error('VALIDATION: ' + e));
      console.error('facts.json written but invalid — hand-edit it, then run create-mod --smart.');
      process.exit(1);
    }
  } catch (e) {
    console.error('ERROR: ' + e.message);
    process.exit(1);
  }
}

if (require.main === module) main(process.argv.slice(2));
