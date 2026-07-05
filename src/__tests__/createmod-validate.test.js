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

  describe('fit-bounds for geo-derived layouts', () => {
    const CHINA = [
      { id: 'luoyang', archetypes: ['downtown'], geo: { lat: 34.6197, lng: 112.454 } },
      { id: 'youzhou', archetypes: ['downtown'], geo: { lat: 40, lng: 116 } },
      { id: 'qingzhou', archetypes: ['port'], geo: { lat: 36.5, lng: 118.5 } },
    ];
    test('regional cluster is refit to span the board with padding', () => {
      const w = normalizeAtlasWorld({ renderMode: 'flat', places: CHINA }, ARCH);
      const xs = w.places.map(p => p.pos.x), ys = w.places.map(p => p.pos.y);
      const spanX = Math.max(...xs) - Math.min(...xs);
      const spanY = Math.max(...ys) - Math.min(...ys);
      expect(Math.max(spanX, spanY)).toBeCloseTo(100 - 2 * 12, 5); // FIT_PADDING default
      for (const p of w.places) {
        expect(p.pos.x).toBeGreaterThanOrEqual(12);
        expect(p.pos.x).toBeLessThanOrEqual(88);
        expect(p.pos.y).toBeGreaterThanOrEqual(12);
        expect(p.pos.y).toBeLessThanOrEqual(88);
      }
    });
    test('aspect ratio and relative order are preserved (uniform scale)', () => {
      const w = normalizeAtlasWorld({ renderMode: 'flat', places: CHINA }, ARCH);
      const raw = CHINA.map(p => ({ x: (p.geo.lng + 180) / 360 * 100, y: (90 - p.geo.lat) / 180 * 100 }));
      const rawSpanX = Math.max(...raw.map(r => r.x)) - Math.min(...raw.map(r => r.x));
      const rawSpanY = Math.max(...raw.map(r => r.y)) - Math.min(...raw.map(r => r.y));
      const xs = w.places.map(p => p.pos.x), ys = w.places.map(p => p.pos.y);
      const spanX = Math.max(...xs) - Math.min(...xs);
      const spanY = Math.max(...ys) - Math.min(...ys);
      expect(spanX / spanY).toBeCloseTo(rawSpanX / rawSpanY, 5);
      // luoyang is west of youzhou which is west of qingzhou — order survives
      expect(w.places[0].pos.x).toBeLessThan(w.places[1].pos.x);
      expect(w.places[1].pos.x).toBeLessThan(w.places[2].pos.x);
    });
    test('any explicit pos disables the refit entirely', () => {
      const places = [CHINA[0], CHINA[1], { id: 'aligned', archetypes: ['port'], pos: { x: 33, y: 44 } }];
      const w = normalizeAtlasWorld({ renderMode: 'flat', places }, ARCH);
      expect(w.places[2].pos).toEqual({ x: 33, y: 44 });
      expect(w.places[0].pos.x).toBeCloseTo((112.454 + 180) / 360 * 100, 5); // raw projection kept
    });
    test('fitPadding is configurable per world', () => {
      const w = normalizeAtlasWorld({ renderMode: 'flat', fitPadding: 30, places: CHINA }, ARCH);
      const xs = w.places.map(p => p.pos.x), ys = w.places.map(p => p.pos.y);
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      expect(span).toBeCloseTo(100 - 2 * 30, 5);
    });
    test('identical points are split apart around the center (degenerate bbox)', () => {
      const w = normalizeAtlasWorld({ renderMode: 'flat', places: [
        { id: 'a', archetypes: ['downtown'], geo: { lat: 34.72, lng: 113.66 } },
        { id: 'b', archetypes: ['port'], geo: { lat: 34.72, lng: 113.66 } },
      ] }, ARCH);
      const [a, b] = w.places.map(p => p.pos);
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(8 - 0.01); // MIN_SEPARATION
      expect((a.x + b.x) / 2).toBeCloseTo(50, 0);
      expect((a.y + b.y) / 2).toBeCloseTo(50, 0);
    });
  });

  describe('de-overlap for geo-derived layouts', () => {
    // Real failure shape: a capital with stacked landmarks + one far outlier
    // squeezing the main cluster (三国演义 acceptance run, 2026-07-05).
    const CROWDED = [
      { id: 'capital', archetypes: ['downtown'], geo: { lat: 34.62, lng: 112.45 } },
      { id: 'gate', archetypes: ['port'], geo: { lat: 34.62, lng: 112.45 } },
      { id: 'hill', archetypes: ['port'], geo: { lat: 34.63, lng: 112.47 } },
      { id: 'pass', archetypes: ['port'], geo: { lat: 34.72, lng: 113.66 } },
      { id: 'north', archetypes: ['downtown'], geo: { lat: 40, lng: 116 } },
      { id: 'outlier-south', archetypes: ['downtown'], geo: { lat: 25, lng: 102.7 } },
    ];
    const allPairDistances = places => {
      const out = [];
      for (let i = 0; i < places.length; i++)
        for (let j = i + 1; j < places.length; j++)
          out.push(Math.hypot(places[i].pos.x - places[j].pos.x, places[i].pos.y - places[j].pos.y));
      return out;
    };
    test('every pair ends at least MIN_SEPARATION apart, inside the margin', () => {
      const w = normalizeAtlasWorld({ renderMode: 'flat', places: CROWDED }, ARCH);
      for (const d of allPairDistances(w.places)) expect(d).toBeGreaterThanOrEqual(8 - 0.01);
      for (const p of w.places) {
        expect(p.pos.x).toBeGreaterThanOrEqual(12 - 1e-9);
        expect(p.pos.x).toBeLessThanOrEqual(88 + 1e-9);
        expect(p.pos.y).toBeGreaterThanOrEqual(12 - 1e-9);
        expect(p.pos.y).toBeLessThanOrEqual(88 + 1e-9);
      }
    });
    test('is deterministic', () => {
      const a = normalizeAtlasWorld({ renderMode: 'flat', places: CROWDED }, ARCH);
      const b = normalizeAtlasWorld({ renderMode: 'flat', places: CROWDED }, ARCH);
      expect(a.places.map(p => p.pos)).toEqual(b.places.map(p => p.pos));
    });
    test('already well-separated layouts are untouched by the relax pass', () => {
      const SPREAD = [
        { id: 'a', archetypes: ['downtown'], geo: { lat: 0, lng: -120 } },
        { id: 'b', archetypes: ['port'], geo: { lat: 40, lng: 0 } },
        { id: 'c', archetypes: ['port'], geo: { lat: -40, lng: 120 } },
      ];
      const w = normalizeAtlasWorld({ renderMode: 'flat', places: SPREAD }, ARCH);
      // fit ran (bbox → margin) but no pair is under MIN_SEPARATION, so the
      // relax loop must exit on iteration 1 with the fitted positions intact
      const spans = allPairDistances(w.places);
      for (const d of spans) expect(d).toBeGreaterThan(8);
      const again = normalizeAtlasWorld({ renderMode: 'flat', places: SPREAD }, ARCH);
      expect(again.places.map(p => p.pos)).toEqual(w.places.map(p => p.pos));
    });
    test('minSeparation is configurable and 0 disables the pass', () => {
      const w = normalizeAtlasWorld({ renderMode: 'flat', minSeparation: 0, places: [
        { id: 'a', archetypes: ['downtown'], geo: { lat: 34.62, lng: 112.45 } },
        { id: 'b', archetypes: ['port'], geo: { lat: 34.62, lng: 112.45 } },
        { id: 'c', archetypes: ['port'], geo: { lat: 40, lng: 116 } },
      ] }, ARCH);
      expect(w.places[0].pos).toEqual(w.places[1].pos); // stack allowed when disabled
      const wide = normalizeAtlasWorld({ renderMode: 'flat', minSeparation: 20, places: [
        { id: 'a', archetypes: ['downtown'], geo: { lat: 34.62, lng: 112.45 } },
        { id: 'b', archetypes: ['port'], geo: { lat: 34.62, lng: 112.45 } },
        { id: 'c', archetypes: ['port'], geo: { lat: 40, lng: 116 } },
      ] }, ARCH);
      for (const d of allPairDistances(wide.places)) expect(d).toBeGreaterThanOrEqual(20 - 0.01);
    });
    test('explicit pos anywhere disables both refit and de-overlap', () => {
      const w = normalizeAtlasWorld({ renderMode: 'flat', places: [
        { id: 'a', archetypes: ['downtown'], geo: { lat: 34.62, lng: 112.45 } },
        { id: 'b', archetypes: ['port'], geo: { lat: 34.62, lng: 112.45 } },
        { id: 'aligned', archetypes: ['port'], pos: { x: 33, y: 44 } },
      ] }, ARCH);
      expect(w.places[0].pos).toEqual(w.places[1].pos); // raw projection, still stacked
      expect(w.places[2].pos).toEqual({ x: 33, y: 44 });
    });
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
  test('globe world: a place with neither pos nor geo errors (renderability guard)', () => {
    const bad = atlasInput();
    bad.world.renderMode = 'globe';
    delete bad.world.places[0].geo; // place has no pos either -> cannot derive geo -> cannot render
    const r = validateModInput(bad, OPTS);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/requires pos.*or geo|globe.*requires geo/i);
  });
  test('globe world: a pos-only place is accepted (geo is derived from pos, not an error)', () => {
    const ok = atlasInput();
    ok.world.renderMode = 'globe';
    ok.world.places[0].pos = { x: 30, y: 40 };
    delete ok.world.places[0].geo; // pos present -> normalize derives geo -> renderable
    const r = validateModInput(ok, OPTS);
    expect(r.errors.join(' ')).not.toMatch(/requires geo|requires pos/i);
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
    expect(r.warnings.join(' ')).toMatch(/omits cards on a 12-space board/);
  });
});
