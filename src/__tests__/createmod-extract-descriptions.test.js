// Create-Mod content quality wave (2026-07-16), Part A step 1 — extract per-place
// description from the book. Spec: docs/superpowers/specs/2026-07-16-createmod-content-wave.md
//
// Covers: strict-structured-output schema shape (world places + classic board group places),
// the code-side degrade-on-failure sanitizer (missing/null/overlong -> omitted, never a hard
// failure), and end-to-end extractFacts behavior with a mock LLM (no network). The passthrough
// into expandFacts/emit/validate + the popover field-name finding are covered by
// createmod-place-descriptions.test.js (Part A steps 2-4).
import { buildWorldPrompt, buildBoardPrompt } from '../createmod/extract/prompts';
import {
  extractFacts, kebabAscii, sanitizeDescription, sanitizeBoardGroups, PLACE_DESCRIPTION_MAX,
} from '../createmod/extract/index';
import { expandFacts } from '../createmod/smart/index';
import { validateModInput } from '../createmod/validate';
import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';
import { CHANCE_CARDS, COMMUNITY_CARDS } from '../../mods/dominion/cards';

const OPTS_SP1 = { ARCHETYPES, reusedCards: { chance: CHANCE_CARDS, community: COMMUNITY_CARDS } };

// ── Schema shape ──────────────────────────────────────────────────────
describe('extraction schema — per-place description field', () => {
  const cut = { places: [{ canonicalName: 'Northport', mentions: 5, kind: 'city', regionHints: [] }] };

  test('worldSchema: places[].description is a nullable string (strict-mode optional)', () => {
    const { schema } = buildWorldPrompt(cut, [], 'en');
    const descProp = schema.properties.places.items.properties.description;
    expect(descProp).toEqual({ type: ['string', 'null'] });
    // strict-mode rule: every property listed in `required`, even nullable ones.
    expect(schema.properties.places.items.required).toContain('description');
  });

  test('BOARD_SCHEMA: groups[].places[] are {name, description} objects, description nullable', () => {
    const { schema } = buildBoardPrompt(cut, [], 'en');
    const placeItem = schema.properties.groups.items.properties.places.items;
    expect(placeItem.properties.name).toEqual({ type: 'string' });
    expect(placeItem.properties.description).toEqual({ type: ['string', 'null'] });
    expect(placeItem.required.sort()).toEqual(['description', 'name']);
  });

  test('prompt text tells the model description is optional, capped, and grounded', () => {
    const world = buildWorldPrompt(cut, [], 'en');
    expect(world.system).toMatch(/description/);
    expect(world.system).toMatch(/120/);
    const board = buildBoardPrompt(cut, [], 'en');
    expect(board.system).toMatch(/description/);
    expect(board.system).toMatch(/120/);
  });
});

// ── Code-side degrade / length-cap enforcement ───────────────────────
describe('sanitizeDescription (code-side degrade-on-failure)', () => {
  test('valid trimmed string within cap -> kept (trimmed)', () => {
    expect(sanitizeDescription('  A windswept harbor town.  ')).toBe('A windswept harbor town.');
  });
  test('null -> omitted (undefined)', () => {
    expect(sanitizeDescription(null)).toBeUndefined();
  });
  test('missing/undefined -> omitted', () => {
    expect(sanitizeDescription(undefined)).toBeUndefined();
  });
  test('non-string (number/object) -> omitted, never throws', () => {
    expect(sanitizeDescription(42)).toBeUndefined();
    expect(sanitizeDescription({ x: 1 })).toBeUndefined();
  });
  test('empty / whitespace-only -> omitted', () => {
    expect(sanitizeDescription('')).toBeUndefined();
    expect(sanitizeDescription('   ')).toBeUndefined();
  });
  test('exactly at the cap (120 chars) -> kept', () => {
    const s = 'x'.repeat(PLACE_DESCRIPTION_MAX);
    expect(sanitizeDescription(s)).toBe(s);
  });
  test('over the cap (121 chars) -> omitted, NOT truncated', () => {
    const s = 'x'.repeat(PLACE_DESCRIPTION_MAX + 1);
    expect(sanitizeDescription(s)).toBeUndefined();
  });
  test('custom maxLen respected', () => {
    expect(sanitizeDescription('12345', 4)).toBeUndefined();
    expect(sanitizeDescription('1234', 4)).toBe('1234');
  });
});

describe('sanitizeBoardGroups', () => {
  test('valid description -> object form kept', () => {
    const out = sanitizeBoardGroups([{ name: 'G', color: 'red', places: [{ name: 'P1', description: 'A rusted foundry.' }] }]);
    expect(out[0].places[0]).toEqual({ name: 'P1', description: 'A rusted foundry.' });
  });
  test('null/overlong description -> collapses to bare string (name only)', () => {
    const overlong = { name: 'P2', description: 'x'.repeat(200) };
    const out = sanitizeBoardGroups([{ name: 'G', color: 'red', places: [{ name: 'P1', description: null }, overlong] }]);
    expect(out[0].places[0]).toBe('P1');
    expect(out[0].places[1]).toBe('P2');
  });
  test('plain string items pass through untouched (backward compat)', () => {
    const out = sanitizeBoardGroups([{ name: 'G', color: 'red', places: ['Plain Name'] }]);
    expect(out[0].places[0]).toBe('Plain Name');
  });
  test('empty/undefined groups -> empty array, no throw', () => {
    expect(sanitizeBoardGroups(undefined)).toEqual([]);
    expect(sanitizeBoardGroups([])).toEqual([]);
  });
});

// ── extractFacts end-to-end degrade (mock LLM, no network) ──────────
const CHARS = ['Ada Stone', 'Ben Cole'];
const PLACES = ['Northport', 'Eastmoor', 'Southgate', 'Westhollow'];
const U = { prompt_tokens: 10, completion_tokens: 5 };
const mapResult = () => ({
  characters: CHARS.map((n, k) => ({ canonicalName: n, aliases: [], roleHints: '', traits: ['bold'], relationships: [], mentions: 5 - k })),
  places: PLACES.map((n, k) => ({ canonicalName: n, aliases: [], kind: 'city', regionHints: 'north', mentions: 5 - k })),
  themes: ['trade'],
});
const rosterData = () => ({
  roster: CHARS.map(n => ({ id: kebabAscii(n), name: n, title: 'The ' + n.split(' ')[1], passive: 'merchant', emphasis: 'negotiation' })),
});
const loreData = name => ({
  nameZh: name, titleZh: 't', identity: 'i', alignment: 'a', background: 'b ' + name, joining: 'j',
  styleIntro: 's', style: ['s1'], styleOutro: 'o', relationships: [{ target: CHARS[0], description: 'd' }], themeSummary: 'th',
});
function mockLlm({ world, board } = {}) {
  return {
    calls: { map: 0, world: 0, board: 0, roster: 0, lore: [] },
    async map() { this.calls.map++; return { data: mapResult(), usage: U }; },
    async synth(prompt) {
      if (prompt.name.startsWith('synthesize_world')) { this.calls.world++; return { data: world(), usage: U }; }
      if (prompt.name.startsWith('synthesize_board')) { this.calls.board++; return { data: board(), usage: U }; }
      if (prompt.name.startsWith('synthesize_roster')) { this.calls.roster++; return { data: rosterData(), usage: U }; }
      if (prompt.name.startsWith('synthesize_lore')) {
        const name = prompt.user.match(/CHARACTER: ([^(\n]+)/)[1].trim();
        this.calls.lore.push(name);
        return { data: loreData(name), usage: U };
      }
      throw new Error('unknown prompt ' + prompt.name);
    },
  };
}
const BOOK = ('Chapter.\n\n' + 'text '.repeat(500)).repeat(3);
const baseOpts = (mapType) => ({ bookBasename: 'test-book', chars: 2, places: 4, lang: 'en', mapType, chunkSize: 2000, overlap: 100, maxChunks: 50 });

function worldWithDescriptions(descByIdx) {
  return {
    modId: 'test-book', modTitle: 'Test Book', tagline: 't', renderMode: 'globe',
    victory: { maxTurns: 150, params: { groupsToWin: 2 } },
    places: PLACES.map((n, k) => ({
      id: kebabAscii(n), realName: n, archetypes: ['market'],
      geo: { lat: 10 + k * 10, lng: -40 + k * 30 }, data: { population: 1000000, gdp: 50, fame: 60 },
      description: descByIdx[k],
    })),
  };
}

describe('extractFacts — atlas description degrade (no new API round-trip: rides the world call)', () => {
  test('valid description survives into facts.world.places[].description', async () => {
    const llm = mockLlm({ world: () => worldWithDescriptions(['A fog-bound trading post.', null, undefined, 'Cliffs over a cold sea.']) });
    const { facts } = await extractFacts(BOOK, baseOpts('atlas'), llm);
    expect(facts.world.places[0].description).toBe('A fog-bound trading post.');
    expect(facts.world.places[3].description).toBe('Cliffs over a cold sea.');
    expect(llm.calls.world).toBe(1); // exactly one synthesis call — no extra round-trip for description
  });
  test('null/missing/overlong descriptions are OMITTED, never fail extraction', async () => {
    const overlong = 'x'.repeat(PLACE_DESCRIPTION_MAX + 1);
    const llm = mockLlm({ world: () => worldWithDescriptions([null, undefined, overlong, '']) });
    const { facts, report } = await extractFacts(BOOK, baseOpts('atlas'), llm);
    facts.world.places.slice(0, 4).forEach(p => expect(p).not.toHaveProperty('description'));
    expect(report.validationErrors).toEqual([]);
    const r = validateModInput(expandFacts(facts, { ARCHETYPES }), OPTS_SP1);
    expect(r.errors).toEqual([]);
  });
});

describe('extractFacts — classic board description degrade (rides the board call)', () => {
  const boardWith = (d1, d2) => () => ({
    modId: 'test-book', modTitle: 'Test Book', tagline: 't',
    groups: [
      { name: 'North', color: 'seagreen', places: [{ name: 'Northport', description: d1 }, { name: 'Eastmoor', description: d2 }] },
      { name: 'South', color: 'goldenrod', places: ['Southgate', 'Westhollow'] },
    ],
  });
  test('valid description kept as {name, description}; string items untouched', async () => {
    const llm = mockLlm({ board: boardWith('A busy northern wharf.', null) });
    const { facts } = await extractFacts(BOOK, { ...baseOpts('classic'), places: 4 }, llm);
    expect(facts.board.groups[0].places[0]).toEqual({ name: 'Northport', description: 'A busy northern wharf.' });
    expect(facts.board.groups[0].places[1]).toBe('Eastmoor'); // null description -> collapsed to bare string
    expect(facts.board.groups[1].places).toEqual(['Southgate', 'Westhollow']);
  });
  test('overlong description collapses to bare string, offline pipeline still validates clean', async () => {
    const llm = mockLlm({ board: boardWith('y'.repeat(PLACE_DESCRIPTION_MAX + 5), null) });
    const { facts, report } = await extractFacts(BOOK, { ...baseOpts('classic'), places: 4 }, llm);
    expect(facts.board.groups[0].places[0]).toBe('Northport');
    expect(report.validationErrors).toEqual([]);
    const r = validateModInput(expandFacts(facts, { ARCHETYPES }), OPTS_SP1);
    expect(r.errors).toEqual([]);
  });
});
