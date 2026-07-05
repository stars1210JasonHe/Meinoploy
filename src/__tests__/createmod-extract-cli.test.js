import fs from 'fs';
import os from 'os';
import path from 'path';
import { runExtract, loadDotEnv, resolveExtractModel, resolveSynthModel } from '../../scripts/extract-facts';

// Reuse the orchestrator mock shape (minimal inline version).
const U = { prompt_tokens: 1, completion_tokens: 1 };
const NAMES = ['Ada Stone', 'Ben Cole', 'Cyrus Vale'];
const PLACES = ['Northport', 'Eastmoor', 'Southgate'];
const keb = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
function makeLlm() {
  return {
    mapCalls: 0,
    async map() {
      this.mapCalls++;
      return { data: {
        characters: NAMES.map((n, k) => ({ canonicalName: n, aliases: [], roleHints: '', traits: [], relationships: [], mentions: 3 - k + 1 })),
        places: PLACES.map((n, k) => ({ canonicalName: n, aliases: [], kind: 'city', regionHints: '', mentions: 3 - k + 1 })),
        themes: ['trade'],
      }, usage: U };
    },
    async synth(prompt) {
      if (prompt.name.startsWith('synthesize_world')) return { data: {
        modId: 'cli-book', modTitle: 'CLI Book', tagline: 't', renderMode: 'globe',
        victory: { maxTurns: 150, params: { groupsToWin: 2 } },
        places: PLACES.map((n, k) => ({ id: keb(n), realName: n, archetypes: ['market'], geo: { lat: 10 + 10 * k, lng: 20 * k }, data: { population: 1e6, gdp: 50, fame: 60 } })),
      }, usage: U };
      if (prompt.name.startsWith('synthesize_roster')) return { data: { roster: NAMES.map(n => ({ id: keb(n), name: n, title: 't', passive: 'merchant', emphasis: 'luck' })) }, usage: U };
      if (prompt.name.startsWith('synthesize_lore')) return { data: {
        nameZh: 'n', titleZh: 't', identity: 'i', alignment: 'a', background: 'b', joining: 'j',
        styleIntro: 's', style: ['s'], styleOutro: 'o', relationships: [{ target: NAMES[0], description: 'd' }], themeSummary: 'x',
      }, usage: U };
      throw new Error('unexpected ' + prompt.name);
    },
  };
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'extract-cli-'));
  fs.writeFileSync(path.join(root, 'book.txt'), ('Chapter\n\n' + 'text '.repeat(600)).repeat(3));
  return root;
}
const baseOpts = root => ({
  book: path.join(root, 'book.txt'), out: null, id: null, chars: 3, places: 3, lang: 'en',
  mapType: 'atlas', mapImage: null, chunkSize: 2000, overlap: 100, maxChunks: 50,
  extractModel: null, synthModel: null, recache: false, rootDir: root,
});

describe('runExtract', () => {
  test('writes facts + report; exit-ok on valid extraction', async () => {
    const root = makeRoot();
    const r = await runExtract(baseOpts(root), makeLlm());
    expect(r.ok).toBe(true);
    const facts = JSON.parse(fs.readFileSync(r.factsPath, 'utf8'));
    expect(facts.id).toBe('book'); // kebab of basename
    expect(fs.readFileSync(r.reportPath, 'utf8')).toMatch(/chunks/i);
    fs.rmSync(root, { recursive: true, force: true });
  });
  test('cache round-trip: second run consumes cache (llm.map not called); --recache bypasses', async () => {
    const root = makeRoot();
    const llm1 = makeLlm();
    await runExtract(baseOpts(root), llm1);
    expect(llm1.mapCalls).toBeGreaterThan(0);
    const llm2 = makeLlm();
    await runExtract(baseOpts(root), llm2);
    expect(llm2.mapCalls).toBe(0);
    const llm3 = makeLlm();
    await runExtract({ ...baseOpts(root), recache: true }, llm3);
    expect(llm3.mapCalls).toBe(llm1.mapCalls);
    fs.rmSync(root, { recursive: true, force: true });
  });
  test('resume-after-failure: failed chunk writes no cache and is retried next run', async () => {
    const root = makeRoot();
    const llm = makeLlm();
    let call = 0;
    const origMap = llm.map.bind(llm);
    llm.map = async function (p) { call++; if (call === 1) throw new Error('boom'); return origMap(p); };
    await runExtract(baseOpts(root), llm);
    const llm2 = makeLlm();
    await runExtract(baseOpts(root), llm2);
    expect(llm2.mapCalls).toBe(1); // only the previously-failed chunk
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('--map-image preflight', () => {
  const PNG_1x1 = Buffer.from('89504e470d0a1a0a0000000d494844520000000100000001080600000037' + '6ef9240000000a49444154789c6360000002000154a24f710000000049454e44ae426082', 'hex');
  test('valid png: data URL threaded, world.mapImage POSIX-relative to the facts file', async () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, 'map.png'), PNG_1x1);
    const llm = makeLlm();
    let sawImage = null;
    const orig = llm.synth.bind(llm);
    llm.synth = async (p, o) => { if (p.name.startsWith('synthesize_world')) sawImage = o && o.imageDataUrl; return orig(p, o); };
    const r = await runExtract({ ...baseOpts(root), mapImage: path.join(root, 'map.png') }, llm);
    expect(sawImage).toMatch(/^data:image\/png;base64,/);
    const facts = JSON.parse(fs.readFileSync(r.factsPath, 'utf8'));
    expect(facts.world.mapImage).toBe('map.png'); // POSIX, relative to facts.json's dir
    expect(facts.world.mapImage).not.toMatch(/\\\\/);
    fs.rmSync(root, { recursive: true, force: true });
  });
  test('bad extension and missing file reject before any API call', async () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, 'map.gif'), 'x');
    const llm = makeLlm();
    let mapCalls = 0;
    const orig = llm.map.bind(llm);
    llm.map = async p => { mapCalls++; return orig(p); };
    await expect(runExtract({ ...baseOpts(root), mapImage: path.join(root, 'map.gif') }, llm)).rejects.toThrow(/extension/);
    await expect(runExtract({ ...baseOpts(root), mapImage: path.join(root, 'nope.png') }, llm)).rejects.toThrow(/not found/);
    expect(mapCalls).toBe(0);
    fs.rmSync(root, { recursive: true, force: true });
  });
  test('corrupt cache file is ignored as a cache miss (no crash)', async () => {
    const root = makeRoot();
    const llm1 = makeLlm();
    await runExtract(baseOpts(root), llm1);
    // corrupt one cache file
    const cacheRoot = path.join(root, '.extract-cache');
    const dir = path.join(cacheRoot, fs.readdirSync(cacheRoot)[0]);
    const files = fs.readdirSync(dir).filter(f => f.startsWith('chunk-'));
    fs.writeFileSync(path.join(dir, files[0]), '{truncated');
    const llm2 = makeLlm();
    await runExtract(baseOpts(root), llm2);
    expect(llm2.mapCalls).toBe(1); // only the corrupted chunk re-mapped
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('resolveExtractModel / resolveSynthModel (centralized fallback chain)', () => {
  const savedExtract = process.env.EXTRACT_MODEL;
  const savedSynth = process.env.SYNTH_MODEL;
  afterEach(() => {
    if (savedExtract === undefined) delete process.env.EXTRACT_MODEL; else process.env.EXTRACT_MODEL = savedExtract;
    if (savedSynth === undefined) delete process.env.SYNTH_MODEL; else process.env.SYNTH_MODEL = savedSynth;
  });
  test('explicit opts flag wins over env and default', () => {
    delete process.env.EXTRACT_MODEL;
    delete process.env.SYNTH_MODEL;
    expect(resolveExtractModel({ extractModel: 'flag-model' })).toBe('flag-model');
    expect(resolveSynthModel({ synthModel: 'flag-model' })).toBe('flag-model');
  });
  test('falls back to env var when opts flag absent', () => {
    process.env.EXTRACT_MODEL = 'env-extract';
    process.env.SYNTH_MODEL = 'env-synth';
    expect(resolveExtractModel({})).toBe('env-extract');
    expect(resolveSynthModel({})).toBe('env-synth');
  });
  test('falls back to hardcoded default when neither flag nor env is set', () => {
    delete process.env.EXTRACT_MODEL;
    delete process.env.SYNTH_MODEL;
    expect(resolveExtractModel({})).toBe('gpt-4o-mini');
    expect(resolveSynthModel({})).toBe('gpt-4o');
  });
});

describe('loadDotEnv', () => {
  test('parses KEY=value lines, skips comments, never overwrites set vars', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenv-'));
    fs.writeFileSync(path.join(root, '.env'), '# c\nFOO_TEST_X=abc\nOPENAI_API_KEY=file-key\n');
    process.env.OPENAI_API_KEY = 'env-key';
    delete process.env.FOO_TEST_X;
    loadDotEnv(root);
    expect(process.env.FOO_TEST_X).toBe('abc');
    expect(process.env.OPENAI_API_KEY).toBe('env-key');
    delete process.env.FOO_TEST_X;
    fs.rmSync(root, { recursive: true, force: true });
  });
});
