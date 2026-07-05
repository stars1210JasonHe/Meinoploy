import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseArgs, runFromBook, buildFromBookClientOptions } from '../../scripts/create-mod';

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frombook-'));
  fs.mkdirSync(path.join(root, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mods', 'index.js'),
    `import { dominionData } from './dominion/bundle.data';\nexport const MODS = {\n  dominion: dominionData,\n};\n`);
  fs.writeFileSync(path.join(root, 'src', 'App.js'),
    `import dominionMod from '../mods/dominion/bundle.client';\nconst MODS = [dominionMod];\n`);
  fs.writeFileSync(path.join(root, 'book.txt'), ('Ch\n\n' + 'w '.repeat(600)).repeat(3));
  return root;
}

// Same mock llm as the extract-cli test (3 chars / 3 places, modId 'cli-book').
const U = { prompt_tokens: 1, completion_tokens: 1 };
const NAMES = ['Ada Stone', 'Ben Cole', 'Cyrus Vale'];
const PLACES = ['Northport', 'Eastmoor', 'Southgate'];
const keb = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const makeLlm = () => ({
  async map() {
    return { data: {
      characters: NAMES.map((n, k) => ({ canonicalName: n, aliases: [], roleHints: '', traits: [], relationships: [], mentions: 4 - k })),
      places: PLACES.map((n, k) => ({ canonicalName: n, aliases: [], kind: 'city', regionHints: '', mentions: 4 - k })),
      themes: [],
    }, usage: U };
  },
  async synth(prompt) {
    if (prompt.name.startsWith('synthesize_world')) return { data: {
      modId: 'book-mod', modTitle: 'Book Mod', tagline: 't', renderMode: 'globe',
      victory: { maxTurns: 150, params: { groupsToWin: 2 } },
      places: PLACES.map((n, k) => ({ id: keb(n), realName: n, archetypes: ['market'], geo: { lat: 5 + 15 * k, lng: 30 * k }, data: { population: 1e6, gdp: 40, fame: 55 } })),
    }, usage: U };
    if (prompt.name.startsWith('synthesize_roster')) return { data: { roster: NAMES.map(n => ({ id: keb(n), name: n, title: 't', passive: 'financier', emphasis: 'capital' })) }, usage: U };
    if (prompt.name.startsWith('synthesize_lore')) return { data: {
      nameZh: 'n', titleZh: 't', identity: 'i', alignment: 'a', background: 'b', joining: 'j',
      styleIntro: 's', style: ['s'], styleOutro: 'o', relationships: [{ target: NAMES[0], description: 'd' }], themeSummary: 'x',
    }, usage: U };
    throw new Error('unexpected ' + prompt.name);
  },
});

describe('--from-book', () => {
  test('parseArgs recognizes --from-book and does not eat extraction flag values as positionals', () => {
    const a = parseArgs(['book.txt', '--from-book', '--chars', '3']);
    expect(a.fromBook).toBe(true);
    expect(a.input).toBe('book.txt');
  });
  test('end-to-end: extraction -> facts.json checkpoint -> smart pipeline writes the mod', async () => {
    const root = makeRoot();
    const r = await runFromBook({ argv: [path.join(root, 'book.txt'), '--from-book', '--chars', '3', '--places', '3'], rootDir: root, llm: makeLlm() });
    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(root, 'book.facts.json'))).toBe(true); // durable checkpoint
    expect(fs.existsSync(path.join(root, 'mods', 'book', 'bundle.data.js'))).toBe(true); // id = kebab(basename)
    expect(fs.readFileSync(path.join(root, 'mods', 'index.js'), 'utf8')).toContain("'book': bookData,");
    fs.rmSync(root, { recursive: true, force: true });
  });
  test('early dup-check: pre-registered determinable id fails fast BEFORE extraction', async () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, 'mods', 'index.js'),
      `import { bookData } from './book/bundle.data';\nexport const MODS = {\n  'book': bookData,\n};\n`);
    const llm = makeLlm();
    let mapCalled = 0;
    const origMap = llm.map.bind(llm);
    llm.map = async p => { mapCalled++; return origMap(p); };
    const r = await runFromBook({ argv: [path.join(root, 'book.txt'), '--from-book'], rootDir: root, llm });
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/already registered/);
    expect(mapCalled).toBe(0); // zero API spend
    fs.rmSync(root, { recursive: true, force: true });
  });

  // Task 10 review finding: --from-book combined create-mod-only flags (--seed, --force) with
  // extract flags (--chunk-size) in the same argv. stripCreateModFlags() must strip the former
  // before parseExtractArgs sees them (which REJECTS unrecognized "--" flags), while --seed must
  // still reach expandFacts() via createMod() instead of being silently dropped.
  test('combo: --from-book + --seed + extract value flag parse together, and --seed reaches the smart derivation', async () => {
    const rootA = makeRoot();
    const rootB = makeRoot();
    const rA = await runFromBook({
      argv: [path.join(rootA, 'book.txt'), '--from-book', '--seed', 'seed-alpha', '--chunk-size', '9000'],
      rootDir: rootA, llm: makeLlm(),
    });
    const rB = await runFromBook({
      argv: [path.join(rootB, 'book.txt'), '--from-book', '--seed', 'seed-beta', '--chunk-size', '9000'],
      rootDir: rootB, llm: makeLlm(),
    });
    // Assertion 1: no "unrecognized flag" parse error from either run — the strip/skip lists
    // are correct in both directions (create-mod-only flags stripped, extract value swallowed).
    expect(rA.ok).toBe(true);
    expect(rB.ok).toBe(true);
    // Assertion 2: the seed value demonstrably reaches the smart chain. deriveRoster()
    // (src/createmod/smart/roster.js) seeds its RNG from the --seed value and uses it for
    // per-character stat jitter + color-offset — two different seeds over the same mock-LLM
    // facts must diverge in the emitted roster.
    const dataA = JSON.parse(fs.readFileSync(path.join(rootA, 'mods', 'book', 'book.data.json'), 'utf8'));
    const dataB = JSON.parse(fs.readFileSync(path.join(rootB, 'mods', 'book', 'book.data.json'), 'utf8'));
    expect(dataA.roster).not.toEqual(dataB.roster);
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  });

  // Assertion 3: --force semantics mirror plain createMod --force — a pre-registered colliding
  // id does not block the run, even with --seed/--chunk-size also present in the same argv.
  test('combo: --force lets --from-book proceed past a pre-registered colliding id', async () => {
    const root = makeRoot();
    fs.writeFileSync(path.join(root, 'mods', 'index.js'),
      `import { bookData } from './book/bundle.data';\nexport const MODS = {\n  'book': bookData,\n};\n`);
    const r = await runFromBook({
      argv: [path.join(root, 'book.txt'), '--from-book', '--seed', 'custom-seed', '--force', '--chunk-size', '9000'],
      rootDir: root, llm: makeLlm(),
    });
    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(root, 'mods', 'book', 'bundle.data.js'))).toBe(true);
    fs.rmSync(root, { recursive: true, force: true });
  });
});

// Review finding: loadFromBookEnvAndRun built the real OpenAI client with `{ apiKey }` only,
// so --extract-model/--synth-model never reached the client (it silently fell back to
// EXTRACT_MODEL/SYNTH_MODEL env or the hardcoded default) — while runExtract's chunk-cache key
// DID key on the requested --extract-model, mislabeling default-model results under the
// requested model's cache key. buildFromBookClientOptions() is the pure extraction of that
// resolution so the network-touching entry point (loadFromBookEnvAndRun, untestable without
// hitting the real API) can be proven correct via a pure unit test.
describe('buildFromBookClientOptions (fixes --extract-model/--synth-model ignored by --from-book)', () => {
  test('--extract-model foo --synth-model bar resolve into client options', () => {
    const argv = ['book.txt', '--from-book', '--extract-model', 'foo', '--synth-model', 'bar'];
    expect(buildFromBookClientOptions(argv)).toEqual({ extractModel: 'foo', synthModel: 'bar' });
  });
  test('falls back to the same defaults the client itself uses when the flags are absent', () => {
    expect(buildFromBookClientOptions(['book.txt', '--from-book'])).toEqual({ extractModel: 'gpt-4o-mini', synthModel: 'gpt-4o' });
  });
  test('create-mod-only flags (--seed, --force) mixed in do not confuse the resolution', () => {
    const argv = ['book.txt', '--from-book', '--seed', 's1', '--extract-model', 'foo', '--force'];
    expect(buildFromBookClientOptions(argv).extractModel).toBe('foo');
  });
  // Ties the client-options resolution to the SAME opts.extractModel that reaches runExtract's
  // chunk-cache key (cacheDirFor), so client and cache key can never disagree. Both derive from
  // parseExtractArgs(stripCreateModFlags(argv)) applied to the identical argv, so two distinct
  // --extract-model values must produce two distinct cache directories for the identical book —
  // the only externally observable trace of opts.extractModel inside runExtract.
  test('the resolved --extract-model demonstrably reaches the opts handed to runExtract (distinct cache dirs)', async () => {
    const rootA = makeRoot();
    const rootB = makeRoot();
    const argvA = [path.join(rootA, 'book.txt'), '--from-book', '--extract-model', 'foo'];
    const argvB = [path.join(rootB, 'book.txt'), '--from-book', '--extract-model', 'zzz-different'];
    expect(buildFromBookClientOptions(argvA).extractModel).toBe('foo');
    expect(buildFromBookClientOptions(argvB).extractModel).toBe('zzz-different');
    await runFromBook({ argv: argvA, rootDir: rootA, llm: makeLlm() });
    await runFromBook({ argv: argvB, rootDir: rootB, llm: makeLlm() });
    const cacheDirName = root => fs.readdirSync(path.join(root, '.extract-cache'))[0];
    expect(cacheDirName(rootA)).not.toBe(cacheDirName(rootB));
    fs.rmSync(rootA, { recursive: true, force: true });
    fs.rmSync(rootB, { recursive: true, force: true });
  });
});
