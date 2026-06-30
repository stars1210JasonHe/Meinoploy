import { normalizeAtlasWorld, normalizeClassicMap, normalizeRoster } from '../createmod/validate';

const ARCH = {
  'downtown': { spaceSlots: [{ role: 'property' }, { role: 'property' }, { role: 'property' }] },
  'port': { spaceSlots: [{ role: 'property' }, { role: 'transit' }] },
};

describe('normalizeAtlasWorld', () => {
  test('derives pos from geo', () => {
    const w = normalizeAtlasWorld({ renderMode: 'flat', places: [{ id: 'a', archetypes: ['downtown'], geo: { lat: 0, lng: 0 } }] }, ARCH);
    expect(w.places[0].pos).toEqual({ x: 50, y: 50 });
    expect(w.places[0].geo).toEqual({ lat: 0, lng: 0 });
  });
  test('derives geo from pos when renderMode is globe', () => {
    const w = normalizeAtlasWorld({ renderMode: 'globe', places: [{ id: 'a', archetypes: ['downtown'], pos: { x: 50, y: 50 } }] }, ARCH);
    expect(w.places[0].geo).toEqual({ lat: 0, lng: 0 });
  });
  test('does NOT derive geo from pos when flat', () => {
    const w = normalizeAtlasWorld({ renderMode: 'flat', places: [{ id: 'a', archetypes: ['downtown'], pos: { x: 50, y: 50 } }] }, ARCH);
    expect(w.places[0].geo).toBeUndefined();
  });
  test('auto-fills size from places + archetype spaceSlots', () => {
    const w = normalizeAtlasWorld({ places: [
      { id: 'a', archetypes: ['downtown'], geo: { lat: 1, lng: 1 } },
      { id: 'b', archetypes: ['port'], geo: { lat: 2, lng: 2 } },
    ] }, ARCH);
    expect(w.size).toEqual({ maxPlaces: 2, maxSpaces: 5 }); // 3 + 2
  });
  test('keeps an explicit size', () => {
    const w = normalizeAtlasWorld({ size: { maxPlaces: 9, maxSpaces: 99 }, places: [] }, ARCH);
    expect(w.size).toEqual({ maxPlaces: 9, maxSpaces: 99 });
  });
  test('does not mutate the input', () => {
    const input = { places: [{ id: 'a', archetypes: ['downtown'], geo: { lat: 0, lng: 0 } }] };
    normalizeAtlasWorld(input, ARCH);
    expect(input.places[0].pos).toBeUndefined();
  });
});

const REUSED = {
  chance: [
    { text: 'GO', action: 'moveTo', value: 0 },
    { text: 'Illinois', action: 'moveTo', value: 24 },
    { text: 'StCharles', action: 'moveTo', value: 11 },
    { text: 'Div', action: 'gain', value: 50 },
  ],
  community: [{ text: 'GO', action: 'moveTo', value: 0 }, { text: 'Bank', action: 'gain', value: 200 }],
};

describe('normalizeClassicMap', () => {
  test('defaults id/name from input when absent', () => {
    const m = normalizeClassicMap({ spaceCount: 12 }, { id: 'steam-barons', name: 'Steam Barons' }, REUSED);
    expect(m.id).toBe('steam-barons');
    expect(m.name).toBe('Steam Barons');
  });
  test('injects sanitized cards when absent — drops out-of-range moveTo', () => {
    const m = normalizeClassicMap({ spaceCount: 10 }, { id: 'x', name: 'X' }, REUSED);
    // spaceCount 10 -> valid indices 0..9; moveTo 24 AND 11 dropped, moveTo 0 kept
    const moves = m.cards.chance.filter(c => c.action === 'moveTo').map(c => c.value);
    expect(moves).toEqual([0]);
    expect(m.cards.chance.some(c => c.action === 'gain')).toBe(true);
    expect(m.cards.community.length).toBe(2);
  });
  test('keeps in-range moveTo', () => {
    const m = normalizeClassicMap({ spaceCount: 30 }, { id: 'x', name: 'X' }, REUSED);
    const moves = m.cards.chance.filter(c => c.action === 'moveTo').map(c => c.value).sort((a, b) => a - b);
    expect(moves).toEqual([0, 11, 24]);
  });
  test('preserves explicit cards', () => {
    const explicit = { chance: [{ text: 'c', action: 'gain', value: 1 }], community: [{ text: 'c', action: 'gain', value: 1 }] };
    const m = normalizeClassicMap({ spaceCount: 12, cards: explicit }, { id: 'x', name: 'X' }, REUSED);
    expect(m.cards).toBe(explicit);
  });
});

const ROSTER = [
  { id: 'a', name: 'Alpha', title: 'First', stats: { capital: 6, luck: 3, negotiation: 6, charisma: 5, tech: 5, stamina: 9 }, passive: { id: 'enforcer', name: 'E', description: 'd' }, color: '#111', portrait: 'portraits/a.png' },
  { id: 'b', name: 'Beta', stats: { capital: 5, luck: 5, negotiation: 7, charisma: 9, tech: 4, stamina: 4 }, passive: { id: 'pioneer', name: 'P', description: 'd' }, color: '#222' },
];

describe('normalizeRoster', () => {
  test('data has CHARACTERS_DATA shape with no portrait field', () => {
    const { data } = normalizeRoster(ROSTER, {});
    expect(data[0]).toEqual({ id: 'a', name: 'Alpha', title: 'First', stats: ROSTER[0].stats, passive: ROSTER[0].passive, color: '#111' });
    expect('portrait' in data[0]).toBe(false);
    expect(data[1].title).toBe(''); // defaulted
  });
  test('portraits lists only entries with a portrait path', () => {
    const { portraits } = normalizeRoster(ROSTER, {});
    expect(portraits).toEqual([{ id: 'a', path: 'portraits/a.png' }]);
  });
  test('auto-stubs valid lore for members lacking it', () => {
    const { lore } = normalizeRoster(ROSTER, {});
    expect(Array.isArray(lore.a.style)).toBe(true);
    expect(lore.a.style.length).toBeGreaterThan(0);
    expect(Array.isArray(lore.a.relationships)).toBe(true);
    expect(lore.a.relationships.length).toBeGreaterThan(0);
    expect(lore.a.relationships[0].target).toBe('Beta'); // another roster member
    expect(typeof lore.a.background).toBe('string');
    expect(typeof lore.a.joining).toBe('string');
    expect(typeof lore.a.themeSummary).toBe('string');
  });
  test('preserves provided lore', () => {
    const provided = { a: { background: 'kept', joining: 'j', style: ['x'], relationships: [{ target: 'b', description: 'd' }], themeSummary: 't' } };
    const { lore } = normalizeRoster(ROSTER, provided);
    expect(lore.a.background).toBe('kept');
  });
});

import { normalizeInput, validateModInput } from '../createmod/validate';
import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';
import { CHANCE_CARDS, COMMUNITY_CARDS } from '../../mods/dominion/cards';

const OPTS = { ARCHETYPES, reusedCards: { chance: CHANCE_CARDS, community: COMMUNITY_CARDS } };

// Minimal valid atlas world (geo-only — exercises geo->pos derivation). 4-city ring, 1 hub.
function atlasInput(over) {
  return Object.assign({
    id: 'test-atlas', name: 'Test Atlas', mapType: 'atlas',
    world: {
      movementMode: 'atlas', renderMode: 'flat',
      // All 4 places carry IDENTICAL data so each holds exactly 25% of board value —
      // under validateWorld's 0.35 valueShareCap. (Varying the data would let one city
      // exceed the cap and fail validateWorld, which is correct behavior, not a test bug.)
      places: [
        { id: 'aa', realName: 'Aa', archetypes: ['market'], geo: { lat: 40, lng: -74 }, connectors: { e: 'bb' }, data: { population: 2000000, gdp: 200, fame: 70 } },
        { id: 'bb', realName: 'Bb', archetypes: ['market'], geo: { lat: 51, lng: 0 }, connectors: { e: 'cc' }, data: { population: 2000000, gdp: 200, fame: 70 } },
        { id: 'cc', realName: 'Cc', archetypes: ['market'], geo: { lat: 35, lng: 139 }, connectors: { e: 'dd' }, data: { population: 2000000, gdp: 200, fame: 70 } },
        { id: 'dd', realName: 'Dd', archetypes: ['market'], geo: { lat: -33, lng: 151 }, connectors: { e: 'aa' }, data: { population: 2000000, gdp: 200, fame: 70 } },
      ],
      hubs: ['aa'], winPaths: ['dominion', 'wealth', 'survival'],
      victory: { maxTurns: 150, params: { groupsToWin: 1 } },
    },
    roster: [
      { id: 'r1', name: 'R1', title: 'T1', stats: { capital: 6, luck: 3, negotiation: 6, charisma: 5, tech: 5, stamina: 9 }, passive: { id: 'enforcer', name: 'E', description: 'd' }, color: '#111' },
      { id: 'r2', name: 'R2', title: 'T2', stats: { capital: 5, luck: 5, negotiation: 7, charisma: 9, tech: 4, stamina: 4 }, passive: { id: 'pioneer', name: 'P', description: 'd' }, color: '#222' },
    ],
  }, over);
}

describe('validateModInput — atlas', () => {
  test('a valid atlas input passes; normalize derived pos + size', () => {
    const r = validateModInput(atlasInput(), OPTS);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.normalized.world.places[0].pos).toBeDefined();
    expect(r.normalized.world.size.maxPlaces).toBe(4);
  });
  test('place with neither pos nor geo errors', () => {
    const bad = atlasInput();
    delete bad.world.places[0].geo;
    const r = validateModInput(bad, OPTS);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/requires pos.*or geo/i);
  });
  test('globe world with a geo-less place errors', () => {
    const bad = atlasInput();
    bad.world.renderMode = 'globe';
    bad.world.places[0].pos = { x: 10, y: 10 };
    delete bad.world.places[0].geo;
    // pos present so the "neither" check passes; but globe requires geo. However normalize
    // derives geo from pos when globe -> so to truly trigger, remove pos too:
    delete bad.world.places[0].pos;
    const r = validateModInput(bad, OPTS);
    expect(r.errors.join(' ')).toMatch(/globe.*requires geo|requires pos.*or geo/i);
  });
});

describe('validateModInput — roster rules', () => {
  test('roster < 2 errors', () => {
    const r = validateModInput(atlasInput({ roster: [atlasInput().roster[0]] }), OPTS);
    expect(r.errors.join(' ')).toMatch(/roster must have >= 2/);
  });
  test('dead passive (operator/shadow) errors', () => {
    const bad = atlasInput();
    bad.roster[0].passive.id = 'operator';
    const r = validateModInput(bad, OPTS);
    expect(r.errors.join(' ')).toMatch(/passive.id "operator" not one of/);
  });
  test('duplicate color errors', () => {
    const bad = atlasInput();
    bad.roster[1].color = bad.roster[0].color;
    const r = validateModInput(bad, OPTS);
    expect(r.errors.join(' ')).toMatch(/duplicate color/);
  });
  test('stat out of 1-10 errors', () => {
    const bad = atlasInput();
    bad.roster[0].stats.capital = 11;
    const r = validateModInput(bad, OPTS);
    expect(r.errors.join(' ')).toMatch(/stat capital must be integer 1-10/);
  });
  test('roster > 10 is NOT an error (atlas pool can exceed player cap)', () => {
    const big = atlasInput();
    big.roster = Array.from({ length: 12 }, (_, i) => ({
      id: 'c' + i, name: 'C' + i, title: 'T', color: '#' + (100000 + i),
      stats: { capital: 6, luck: 3, negotiation: 6, charisma: 5, tech: 5, stamina: 9 },
      passive: { id: 'enforcer', name: 'E', description: 'd' },
    }));
    const r = validateModInput(big, OPTS);
    expect(r.errors.join(' ')).not.toMatch(/roster/);
  });
  test('stat sum != 34 is a warning not an error', () => {
    const bad = atlasInput();
    bad.roster[0].stats.capital = 10; // sum now 38 (base 34 - capital:6 + capital:10 = 38)
    const r = validateModInput(bad, OPTS);
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/stat sum 38 != 34/);
  });
  test('missing lore FIELD (partial provided lore) errors', () => {
    const bad = atlasInput();
    bad.lore = { r1: { background: 'b', joining: 'j', style: [], relationships: [{ target: 'x', description: 'd' }], themeSummary: 't' } };
    const r = validateModInput(bad, OPTS);
    expect(r.errors.join(' ')).toMatch(/lore \(r1\): style\[\] required/);
  });
});

describe('validateModInput — classic', () => {
  function classicInput(over) {
    const spaces = [
      { id: 0, name: 'GO', type: 'go' },
      { id: 1, name: 'P1', type: 'property', color: 'red', price: 60, rent: 4 },
      { id: 2, name: 'P2', type: 'property', color: 'red', price: 60, rent: 4 },
      { id: 3, name: 'Chance', type: 'chance' },
      { id: 4, name: 'P3', type: 'property', color: 'blue', price: 100, rent: 6 },
      { id: 5, name: 'Tax', type: 'tax', taxAmount: 100 },
      { id: 6, name: 'Jail', type: 'jail' },
      { id: 7, name: 'P4', type: 'property', color: 'blue', price: 100, rent: 6 },
      { id: 8, name: 'Community', type: 'community' },
      { id: 9, name: 'P5', type: 'property', color: 'green', price: 140, rent: 10 },
      { id: 10, name: 'P6', type: 'property', color: 'green', price: 140, rent: 10 },
      { id: 11, name: 'Chance2', type: 'chance' },
    ];
    return Object.assign({
      id: 'test-classic', name: 'Test Classic', mapType: 'classic',
      map: {
        spaceCount: 12, layout: { type: 'circle' }, spaces,
        colorGroups: { red: { name: 'Red', spaces: [1, 2] }, blue: { name: 'Blue', spaces: [4, 7] }, green: { name: 'Green', spaces: [9, 10] } },
        specialSpaces: { go: 0, jail: 6 },
        theme: { boardBackground: '#222', cellBackground: '#333' },
      },
      roster: atlasInput().roster,
    }, over);
  }
  test('a valid classic input passes; cards injected + sanitized', () => {
    const r = validateModInput(classicInput(), OPTS);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
    // spaceCount 12 -> moveTo 24 dropped (out of range), 11 kept
    const moves = r.normalized.map.cards.chance.filter(c => c.action === 'moveTo').map(c => c.value);
    expect(moves).not.toContain(24);
  });
});
