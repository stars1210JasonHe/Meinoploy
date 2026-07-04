import fs from 'fs';
import os from 'os';
import path from 'path';
import { runExtract, loadDotEnv } from '../../scripts/extract-facts';

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
