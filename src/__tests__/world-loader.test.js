import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';
import { ATLAS_DEFAULTS, computePlaceValues, expandWorld, aggregateTraits, validateWorld, loadWorld, declutterPositions } from '../world-loader';
import { MINI_WORLD } from '../../mods/dominion/atlas/fixtures/mini-world';

describe('archetype library', () => {
  const REQUIRED = ['downtown','port','industrial','financial-district','tech-hub','market',
                    'residential','landmark','transit-hub','wilderness','frontier','capital-hub'];
  test('contains the 12 Phase-I archetypes', () => {
    REQUIRED.forEach(id => expect(ARCHETYPES[id]).toBeDefined());
  });
  test('every archetype has valid shape', () => {
    const VALID_ROLES = ['property','transit','tax','chance','community'];
    Object.entries(ARCHETYPES).forEach(([id, a]) => {
      expect(a.id).toBe(id);
      expect(typeof a.name).toBe('string');
      expect(Array.isArray(a.spaceSlots)).toBe(true);
      expect(a.spaceSlots.length).toBeGreaterThanOrEqual(1);
      a.spaceSlots.forEach(s => expect(VALID_ROLES).toContain(s.role));
      expect(typeof a.statLean).toBe('object');
      expect(['low','mid','high']).toContain(a.tierHint);
    });
  });
  test('capital-hub is the hub archetype and has a property pair', () => {
    // hubs must still be buildable places: >=2 property slots (decision 7)
    const hub = ARCHETYPES['capital-hub'];
    expect(hub.spaceSlots.filter(s => s.role === 'property').length).toBeGreaterThanOrEqual(2);
  });
});

describe('computePlaceValues', () => {
  const places = [
    { id: 'megacity', data: { population: 30000000, gdp: 1000000, fame: 95 } },
    { id: 'town',     data: { population: 50000,    gdp: 800,     fame: 20 } },
    { id: 'village',  data: { population: 800,      gdp: 5,       fame: 5 } },
  ];
  test('preserves real-world ordering and stays in the price band', () => {
    const v = computePlaceValues(places, ATLAS_DEFAULTS.normalization);
    expect(v.megacity).toBeGreaterThan(v.town);
    expect(v.town).toBeGreaterThan(v.village);
    expect(v.megacity).toBe(ATLAS_DEFAULTS.normalization.priceBand.max);
    expect(v.village).toBe(ATLAS_DEFAULTS.normalization.priceBand.min);
  });
  test('single place maps to band midpoint', () => {
    const v = computePlaceValues([places[0]], ATLAS_DEFAULTS.normalization);
    expect(v.megacity).toBe(Math.round((60 + 400) / 2 / 10) * 10);
  });
  test('missing data fields default to 0 (no NaN)', () => {
    const v = computePlaceValues([{ id: 'x', data: {} }, places[0]], ATLAS_DEFAULTS.normalization);
    expect(Number.isFinite(v.x)).toBe(true);
  });
});

describe('expandWorld', () => {
  const ex = expandWorld(MINI_WORLD, ARCHETYPES, ATLAS_DEFAULTS);
  test('dense sequential space ids grouped by place', () => {
    ex.spaces.forEach((s, i) => expect(s.id).toBe(i));
    // capital-hub(3) + downtown(3) + port(3) + market(3) = 12
    expect(ex.spaces.length).toBe(12);
    expect(ex.placeOf[0]).toBe('rome');
  });
  test('internal chain edges + connector edges (exit -> entry)', () => {
    // rome spaces 0..2: 0->1, 1->2; rome exit(2) -> paris entry(3)
    expect(ex.edges[0]).toEqual([1]);
    expect(ex.edges[1]).toEqual([2]);
    expect(ex.edges[2]).toEqual([3]);
    // paris exit(5) branches to berlin entry(6) AND geneva entry(9)
    expect(ex.edges[5].sort()).toEqual([6, 9]);
  });
  test('roles map to engine types; prices/rents assigned to property spaces', () => {
    ex.spaces.forEach(s => {
      if (s.role === 'property') {
        expect(s.type).toBe('property');
        expect(s.price).toBeGreaterThan(0);
        expect(s.rent).toBeGreaterThan(0);
      }
      if (s.role === 'transit') expect(s.type).toBe('railroad');
    });
  });
  test('placeGroups contain only property spaces, >=2 each', () => {
    Object.values(ex.placeGroups).forEach(ids => {
      expect(ids.length).toBeGreaterThanOrEqual(2);
      ids.forEach(id => expect(ex.spaces[id].role).toBe('property'));
    });
  });
  test('hub entry space flagged', () => {
    expect(ex.spaces[0].isHub).toBe(true);
    expect(ex.hubs).toEqual([0]);
  });
  test('multi-archetype place merges slots in order', () => {
    const w = JSON.parse(JSON.stringify(MINI_WORLD));
    w.places[1].archetypes = ['downtown', 'tourism' in ARCHETYPES ? 'tourism' : 'landmark'];
    const ex2 = expandWorld(w, ARCHETYPES, ATLAS_DEFAULTS);
    const parisSpaces = ex2.spaces.filter(s => s.placeId === 'paris');
    expect(parisSpaces.length).toBe(ARCHETYPES['downtown'].spaceSlots.length + ARCHETYPES['landmark'].spaceSlots.length);
  });
});

describe('aggregateTraits', () => {
  test('averages statLean over places and clamps', () => {
    // 6 tech-hub places (+0.05 tech each) -> mean +0.05... then a stacked world:
    const stacked = Array.from({ length: 6 }, (_, i) => ({ id: 'p' + i, archetypes: ['tech-hub'] }));
    const t = aggregateTraits(stacked, ARCHETYPES, 0.12);
    expect(t.tech).toBeCloseTo(0.05); // mean of identical leans = the lean
  });
  test('clamp engages on explicit overrides', () => {
    const places = [{ id: 'a', archetypes: ['tech-hub'] }];
    const t = aggregateTraits(places, ARCHETYPES, 0.12, { tech: 0.5, luck: -0.5 });
    expect(t.tech).toBe(0.12);
    expect(t.luck).toBe(-0.12);
  });
  test('neutral world -> empty traits (no zero-noise keys)', () => {
    const t = aggregateTraits([], ARCHETYPES, 0.12);
    expect(Object.keys(t).length).toBe(0);
  });
});

describe('validateWorld', () => {
  const clone = w => JSON.parse(JSON.stringify(w));
  test('valid fixture -> no errors', () => {
    expect(validateWorld(MINI_WORLD, ARCHETYPES)).toEqual([]);
  });
  test('unknown archetype ref', () => {
    const w = clone(MINI_WORLD); w.places[0].archetypes = ['nope'];
    expect(validateWorld(w, ARCHETYPES).join()).toMatch(/archetype/i);
  });
  test('unresolvable connector target', () => {
    const w = clone(MINI_WORLD); w.places[1].connectors.e = 'atlantis';
    expect(validateWorld(w, ARCHETYPES).join()).toMatch(/connector/i);
  });
  test('dead end: a place with no outgoing connector', () => {
    const w = clone(MINI_WORLD); delete w.places[3].connectors; // geneva exit has 0 out-edges
    expect(validateWorld(w, ARCHETYPES).join()).toMatch(/outgoing/i);
  });
  test('no hubs', () => {
    const w = clone(MINI_WORLD); w.hubs = [];
    expect(validateWorld(w, ARCHETYPES).join()).toMatch(/hub/i);
  });
  test('hub unreachable within N steps', () => {
    // long one-way tail: rome->paris->berlin->rome plus a chain hanging off geneva that never returns
    const w = clone(MINI_WORLD);
    // wholesale assignment REPLACES the fixture's atlasConfig — carry its
    // valueShareCap so this test fails for the reach reason only
    w.atlasConfig = { hubReachSteps: 2, valueShareCap: 0.5 }; // tighten N so the valid loop now violates it
    const errors = validateWorld(w, ARCHETYPES);
    expect(errors.join()).toMatch(/reach/i);
    expect(errors.join()).not.toMatch(/valueShareCap/);
  });
  test('size caps', () => {
    const w = clone(MINI_WORLD); w.size = { maxPlaces: 2, maxSpaces: 96 };
    expect(validateWorld(w, ARCHETYPES).join()).toMatch(/maxPlaces/i);
  });
  test('unscored win path rejected', () => {
    const w = clone(MINI_WORLD); w.winPaths = ['wealth', 'influence'];
    expect(validateWorld(w, ARCHETYPES).join()).toMatch(/influence/i);
  });
  test('winPaths gate cannot be self-whitelisted via atlasConfig', () => {
    const w = clone(MINI_WORLD);
    // carry the fixture's valueShareCap so this fails for the winPaths reason only
    w.atlasConfig = { valueShareCap: 0.5, winPaths: ['influence'] }; // attempted override of the gate
    w.winPaths = ['influence'];
    const errors = validateWorld(w, ARCHETYPES);
    expect(errors.join()).toMatch(/influence/i);
    expect(errors.length).toBe(1);
  });
  test('value-share cap', () => {
    const w = clone(MINI_WORLD);
    w.atlasConfig = { valueShareCap: 0.10 }; // REPLACES fixture override; 4 places -- someone necessarily exceeds 10%
    expect(validateWorld(w, ARCHETYPES).join()).toMatch(/value/i);
  });
  test('value-share cap counts summed property-slot prices, not placeValue', () => {
    // Paris gets 2x downtown -> 6 of the board's 13 property slots. Its summed
    // prices (2400/4160 ~ 58%) exceed the default 0.35 cap, while its
    // placeValue share (400/1250 = 32%) does NOT -- the metric counts slots.
    const w = clone(MINI_WORLD);
    delete w.atlasConfig; // fall back to the 0.35 default cap
    w.places[1].archetypes = ['downtown', 'downtown'];
    const errors = validateWorld(w, ARCHETYPES);
    expect(errors.join()).toMatch(/value/i);
    expect(errors.join()).toMatch(/paris/i);
    expect(errors.length).toBe(1); // fails for exactly the value-share reason
  });
  test('zero buildable places errors', () => {
    // all archetypes swapped for a 1-property mutant -- build inline mutant archetype lib
    const MUTANT = { solo: { id:'solo', name:'Solo', sprite:'', tierHint:'low',
      spaceSlots: [{ role:'property' }, { role:'chance' }], statLean: {} } };
    const w = clone(MINI_WORLD); w.places.forEach(p => { p.archetypes = ['solo']; });
    expect(validateWorld(w, MUTANT).join()).toMatch(/buildable/i);
  });
  test('groupsToWin must be <= buildable set count', () => {
    const w = clone(MINI_WORLD); w.victory = { params: { groupsToWin: 99 } };
    expect(validateWorld(w, ARCHETYPES).join()).toMatch(/groupsToWin/i);
  });
  test('duplicate place ids', () => {
    const w = clone(MINI_WORLD); w.places[1].id = 'rome';
    expect(validateWorld(w, ARCHETYPES).join()).toMatch(/duplicate/i);
  });
  test('moveTo card targeting a nonexistent node', () => {
    const w = clone(MINI_WORLD);
    w.cards = { chance: [{ text: 'Go!', action: 'moveTo', value: 999 }], community: [{ text: 'ok', action: 'gain', value: 50 }] };
    expect(validateWorld(w, ARCHETYPES).join()).toMatch(/moveTo/i);
  });
});

describe('loadWorld', () => {
  test('throws on invalid world with the error list', () => {
    const w = JSON.parse(JSON.stringify(MINI_WORLD)); w.hubs = [];
    expect(() => loadWorld(w, ARCHETYPES)).toThrow(/hub/i);
  });
  test('returns a mapData-compatible object with atlas extensions', () => {
    const m = loadWorld(MINI_WORLD, ARCHETYPES);
    // existing mapData contract (subset App.js/Game.js already consume)
    expect(m.id).toBe('mini');
    expect(m.layoutType).toBe('custom');
    expect(m.spaces.length).toBe(m.spaceCount);
    expect(m.positions[0]).toBeDefined();
    expect(m.mapMechanics.priceMultiplier).toBe(1);
    expect(m.victory.primary).toBeDefined();
    expect(m.theme.boardBackground).toBeDefined();
    // atlas extensions
    expect(m.movementMode).toBe('atlas');
    expect(Object.keys(m.edges).length).toBe(m.spaceCount);
    expect(m.placeGroups).toBeDefined();
    expect(m.hubs).toEqual([0]);
    expect(m.traits).toBeDefined();
    expect(m.winPaths).toEqual(['wealth', 'dominion']);
    expect(m.schemaVersion).toBe('3.0-draft');
  });
  test('per-space positions derive from place pos', () => {
    const m = loadWorld(MINI_WORLD, ARCHETYPES);
    expect(m.positions[0].x).toBeCloseTo(50, 0); // rome entry near rome's pos
  });
});

describe('declutterPositions (flat-atlas overlap fix)', () => {
  // Real overlapping-world fixture: the 19-place 三国 world that motivated this
  // (mods/sanguo-excerpt is uncommitted owner WIP — do NOT import from it; this
  // is a frozen copy of its place id/pos data only, read verbatim from
  // mods/sanguo-excerpt/sanguo-excerpt.data.json on 2026-07-12).
  const SANGUO_PLACES = [
    { id: 'luoyang',     pos: { x: 43.95139542306998,  y: 41.745307452649264 } },
    { id: 'jizhou',      pos: { x: 64.7422906871714,   y: 29.00684668071955 } },
    { id: 'youzhou',     pos: { x: 62.9810218296363,   y: 12 } },
    { id: 'zhuoxian',    pos: { x: 70.40201602480111,  y: 14.988117326229622 } },
    { id: 'hulaoguan',   pos: { x: 65.37020784768185,  y: 47.30700065397624 } },
    { id: 'chenliu',     pos: { x: 67.12295424481329,  y: 39.275439436338374 } },
    { id: 'yingchuan',   pos: { x: 57.27528698214765,  y: 49.50029459761153 } },
    { id: 'qingzhou',    pos: { x: 72.51851851851859,  y: 31.703703703703688 } },
    { id: 'sishuiguan',  pos: { x: 58.41863599098211,  y: 33.906988646336075 } },
    { id: 'zhongshan',   pos: { x: 56.69122493261428,  y: 25.83639450600389 } },
    { id: 'jiuchong',    pos: { x: 50.655599894566045, y: 35.8396734539795 } },
    { id: 'beimangshan', pos: { x: 59.54105739515649,  y: 41.82785792889575 } },
    { id: 'nanyang',     pos: { x: 50.73649629819217,  y: 54.902898160113914 } },
    { id: 'jiademen',    pos: { x: 51.690295554660516, y: 43.77247906681132 } },
    { id: 'anxixian',    pos: { x: 70.00097066188069,  y: 22.978058666242347 } },
    { id: 'dingzhou',    pos: { x: 54.34000963938084,  y: 17.419804338573876 } },
    { id: 'wancheng',    pos: { x: 59.08767940917528,  y: 57.29229265269514 } },
    { id: 'jianning',    pos: { x: 27.481481481481417, y: 88 } },
    { id: 'quyang',      pos: { x: 62.1116719988849,   y: 19.952624150037117 } },
  ];

  const MINX = 14, MINY = 9;
  function overlaps(a, b) {
    const dx = (a.x - b.x) / MINX, dy = (a.y - b.y) / MINY;
    return dx * dx + dy * dy < 1 - 1e-9;
  }

  test('sanguo fixture: zero elliptical overlaps after declutter', () => {
    const out = declutterPositions(SANGUO_PLACES);
    const ids = Object.keys(out);
    expect(ids).toHaveLength(SANGUO_PLACES.length);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        expect(overlaps(out[ids[i]], out[ids[j]])).toBe(false);
      }
    }
  });

  test('deterministic: same input -> identical output', () => {
    const a = declutterPositions(SANGUO_PLACES);
    const b = declutterPositions(SANGUO_PLACES.slice().reverse()); // input order must not matter
    expect(b).toEqual(a);
  });

  test('bounds clamped to [pad, 100-pad]', () => {
    const out = declutterPositions(SANGUO_PLACES);
    Object.values(out).forEach(p => {
      expect(p.x).toBeGreaterThanOrEqual(3);
      expect(p.x).toBeLessThanOrEqual(97);
      expect(p.y).toBeGreaterThanOrEqual(3);
      expect(p.y).toBeLessThanOrEqual(97);
    });
  });

  test('approximate geography preserved: west-of stays west-of for far pairs', () => {
    const out = declutterPositions(SANGUO_PLACES);
    // jianning (far SW outlier) stays west+south of the main cluster anchors
    expect(out.jianning.x).toBeLessThan(out.qingzhou.x);
    expect(out.jianning.y).toBeGreaterThan(out.youzhou.y);
  });

  test('degenerate: two coincident points get separated; single point unchanged', () => {
    const two = declutterPositions([
      { id: 'a', pos: { x: 50, y: 50 } }, { id: 'b', pos: { x: 50, y: 50 } },
    ]);
    expect(overlaps(two.a, two.b)).toBe(false);
    const one = declutterPositions([{ id: 'solo', pos: { x: 20, y: 30 } }]);
    expect(one.solo).toEqual({ x: 20, y: 30 });
  });

  test('non-overlapping input passes through unchanged', () => {
    const spread = [
      { id: 'a', pos: { x: 10, y: 10 } }, { id: 'b', pos: { x: 50, y: 50 } },
      { id: 'c', pos: { x: 90, y: 90 } },
    ];
    expect(declutterPositions(spread)).toEqual({ a: { x: 10, y: 10 }, b: { x: 50, y: 50 }, c: { x: 90, y: 90 } });
  });
});
