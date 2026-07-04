import { extractFacts, kebabAscii } from '../createmod/extract/index';
import { validateModInput } from '../createmod/validate';
import { expandFacts } from '../createmod/smart/index';
import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';
import { CHANCE_CARDS, COMMUNITY_CARDS } from '../../mods/dominion/cards';

const OPTS_SP1 = { ARCHETYPES, reusedCards: { chance: CHANCE_CARDS, community: COMMUNITY_CARDS } };
const U = { prompt_tokens: 10, completion_tokens: 5 };

// A 3-chunk book worth of candidates: 4 chars, 4 places.
const CHARS = ['Ada Stone', 'Ben Cole', 'Cyrus Vale', 'Dara Finch'];
const PLACES = ['Northport', 'Eastmoor', 'Southgate', 'Westhollow'];
const mapResult = i => ({
  characters: CHARS.map((n, k) => ({ canonicalName: n, aliases: [], roleHints: '', traits: ['bold'], relationships: [], mentions: 5 - k })),
  places: PLACES.map((n, k) => ({ canonicalName: n, aliases: [], kind: 'city', regionHints: 'north', mentions: 5 - k })),
  themes: ['trade'],
});
const worldData = () => ({
  modId: 'test-book', modTitle: 'Test Book', tagline: 'A tale.', renderMode: 'globe',
  victory: { maxTurns: 150, params: { groupsToWin: 2 } },
  places: PLACES.map((n, k) => ({
    id: kebabAscii(n), realName: n, archetypes: ['market'],
    geo: { lat: 10 + k * 10, lng: -40 + k * 30 }, data: { population: 1000000, gdp: 50, fame: 60 },
  })),
});
const rosterData = () => ({
  roster: CHARS.map(n => ({ id: kebabAscii(n), name: n, title: 'The ' + n.split(' ')[1], passive: 'merchant', emphasis: 'negotiation' })),
});
const loreData = name => ({
  nameZh: name, titleZh: 't', identity: 'i', alignment: 'a', background: 'b ' + name, joining: 'j',
  styleIntro: 's', style: ['s1'], styleOutro: 'o', relationships: [{ target: CHARS[0], description: 'd' }], themeSummary: 'th',
});

function mockLlm(overrides = {}) {
  return {
    calls: { map: 0, world: 0, board: 0, roster: 0, lore: [] },
    async map(prompt) { this.calls.map++; return { data: mapResult(), usage: U }; },
    async synth(prompt, o = {}) {
      if (prompt.name.startsWith('synthesize_world')) { this.calls.world++; return { data: (overrides.world || worldData)(this.calls.world), usage: U }; }
      if (prompt.name.startsWith('synthesize_board')) { this.calls.board++; return { data: (overrides.board || (() => { throw new Error('no board expected'); }))(), usage: U }; }
      if (prompt.name.startsWith('synthesize_roster')) { this.calls.roster++; return { data: (overrides.roster || rosterData)(this.calls.roster), usage: U }; }
      if (prompt.name.startsWith('synthesize_lore')) {
        const m = prompt.user.match(/CHARACTER: ([^(\n]+)/);
        const name = m[1].trim();
        this.calls.lore.push(name);
        if (overrides.loreFail && overrides.loreFail === name) throw new Error('lore boom');
        return { data: loreData(name), usage: U };
      }
      throw new Error('unknown prompt ' + prompt.name);
    },
  };
}

const BOOK = ('Chapter.\n\n' + 'text '.repeat(500)).repeat(3);
const baseOpts = () => ({
  bookBasename: 'test-book', chars: 4, places: 4, lang: 'en', mapType: 'atlas',
  chunkSize: 2000, overlap: 100, maxChunks: 50,
});

describe('extractFacts — happy paths', () => {
  test('atlas: facts pass the full SP1 pipeline offline', async () => {
    const llm = mockLlm();
    const { facts, report } = await extractFacts(BOOK, baseOpts(), llm);
    expect(facts.id).toBe('test-book');
    expect(facts.mapType).toBe('atlas');
    expect(facts.seed).toBe(facts.id);
    expect(facts.roster).toHaveLength(4);
    expect(Object.keys(facts.lore).sort()).toEqual(facts.roster.map(r => r.id).sort());
    expect(facts.lore[facts.roster[1].id].background).toContain(CHARS[1]);
    const r = validateModInput(expandFacts(facts, { ARCHETYPES }), OPTS_SP1);
    expect(r.errors).toEqual([]);
    expect(report.validationErrors).toEqual([]);
    expect(report.usage.prompt_tokens).toBeGreaterThan(0);
  });
  test('classic path uses the board call', async () => {
    const llm = mockLlm({
      board: () => ({
        modId: 'test-book', modTitle: 'Test Book', tagline: 't',
        groups: [
          { name: 'North', color: 'seagreen', places: ['Northport', 'Eastmoor'] },
          { name: 'South', color: 'goldenrod', places: ['Southgate', 'Westhollow'] },
        ],
      }),
    });
    const { facts } = await extractFacts(BOOK, { ...baseOpts(), mapType: 'classic', places: 4 }, llm);
    expect(facts.map).toBeUndefined();
    expect(facts.board.groups).toHaveLength(2);
    expect(llm.calls.board).toBe(1);
    expect(llm.calls.world).toBe(0);
    const r = validateModInput(expandFacts(facts, { ARCHETYPES }), OPTS_SP1);
    expect(r.errors).toEqual([]);
  });
  test('map-image: pos-only output gets pseudo-geo + mapImage + flat', async () => {
    const llm = mockLlm({
      world: () => ({
        modId: 'test-book', modTitle: 'Test Book', tagline: 't', renderMode: 'flat',
        victory: { maxTurns: 150, params: { groupsToWin: 2 } },
        places: PLACES.map((n, k) => ({
          id: kebabAscii(n), realName: n, archetypes: ['market'],
          pos: { x: 10 + k * 20, y: 20 + k * 15 }, data: { population: 1000000, gdp: 50, fame: 60 },
        })),
      }),
    });
    const { facts } = await extractFacts(BOOK, {
      ...baseOpts(), mapImageDataUrl: 'data:image/png;base64,AA', mapImageRelPath: 'maps/westeros.png',
    }, llm);
    expect(facts.world.mapImage).toBe('maps/westeros.png');
    expect(facts.world.renderMode).toBe('flat');
    facts.world.places.forEach(p => {
      expect(p.pos).toBeDefined();
      expect(p.geo).toBeDefined(); // unconditional pseudo-geo backfill
      expect(p.geo.lat).toBeCloseTo(90 - p.pos.y / 100 * 180, 5);
    });
    const r = validateModInput(expandFacts(facts, { ARCHETYPES }), OPTS_SP1);
    expect(r.errors).toEqual([]);
  });
  test('cached chunks are not re-mapped; onChunkResult fires for fresh ones', async () => {
    const llm = mockLlm();
    const saved = {};
    const first = await extractFacts(BOOK, { ...baseOpts(), onChunkResult: (i, d) => { saved[i] = d; } }, llm);
    const mapCallsFirst = llm.calls.map;
    expect(mapCallsFirst).toBeGreaterThan(0);
    const llm2 = mockLlm();
    await extractFacts(BOOK, { ...baseOpts(), cachedChunks: saved }, llm2);
    expect(llm2.calls.map).toBe(0);
    expect(first.report.chunksTotal).toBe(Object.keys(saved).length);
  });
  test('shortfall aborts BEFORE synthesis (1 usable character)', async () => {
    const llm = mockLlm();
    llm.map = async () => ({ data: { characters: [{ canonicalName: 'Only One', aliases: [], roleHints: '', traits: [], relationships: [], mentions: 1 }], places: mapResult().places, themes: [] }, usage: U });
    await expect(extractFacts(BOOK, baseOpts(), llm)).rejects.toThrow(/yields only 1/);
    expect(llm.calls.world + llm.calls.roster).toBe(0);
  });
  test('lore degrade: one failing lore call -> key omitted, warning, still valid offline', async () => {
    const llm = mockLlm({ loreFail: CHARS[2] });
    const { facts, report } = await extractFacts(BOOK, baseOpts(), llm);
    const failedId = kebabAscii(CHARS[2]);
    expect(facts.lore[failedId]).toBeUndefined();
    expect(report.degradedLore).toContain(failedId);
    expect(report.warnings.join(' ')).toMatch(new RegExp(failedId));
    const r = validateModInput(expandFacts(facts, { ARCHETYPES }), OPTS_SP1);
    expect(r.errors).toEqual([]); // SP1 stubs the missing entry
  });
});

describe('kebabAscii', () => {
  test('folds to kebab, strips non-ascii', () => {
    expect(kebabAscii('The Test  Book!')).toBe('the-test-book');
    expect(kebabAscii('三国演义')).toBe(''); // pure CJK -> empty -> caller falls to modId
  });
});

describe('extractFacts — repair round', () => {
  test('dup roster ids: gate repairs BEFORE lore; lore sees only repaired ids', async () => {
    let rosterCall = 0;
    const llm = mockLlm({
      roster: () => {
        rosterCall++;
        if (rosterCall === 1) {
          const bad = rosterData();
          bad.roster[1].id = bad.roster[0].id; // duplicate
          return bad;
        }
        return rosterData();
      },
    });
    const { facts, report } = await extractFacts(BOOK, baseOpts(), llm);
    expect(rosterCall).toBe(2); // gate consumed one repair
    expect(new Set(facts.roster.map(r => r.id)).size).toBe(4);
    expect(llm.calls.lore).toHaveLength(4); // lore ran once, against clean roster
    expect(report.validationErrors).toEqual([]);
  });
  test('world repair: bad archetype output is repaired via the default bucket', async () => {
    let worldCall = 0;
    const llm = mockLlm({
      world: () => {
        worldCall++;
        const w = worldData();
        if (worldCall === 1) w.places[0].archetypes = ['not-a-real-archetype'];
        return w;
      },
    });
    const { report } = await extractFacts(BOOK, baseOpts(), llm);
    expect(worldCall).toBe(2);
    expect(report.validationErrors).toEqual([]);
  });
  test('repair still failing: facts written with validationErrors non-empty', async () => {
    const llm = mockLlm({
      world: () => {
        const w = worldData();
        w.places[0].archetypes = ['still-bad'];
        return w;
      },
    });
    const { facts, report } = await extractFacts(BOOK, baseOpts(), llm);
    expect(facts).toBeTruthy();
    expect(report.validationErrors.length).toBeGreaterThan(0);
  });
});
