import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';
import { ATLAS_DEFAULTS, computePlaceValues, expandWorld, aggregateTraits, validateWorld } from '../world-loader';
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
    w.atlasConfig = { hubReachSteps: 2 }; // tighten N so the valid loop now violates it
    expect(validateWorld(w, ARCHETYPES).join()).toMatch(/reach/i);
  });
  test('size caps', () => {
    const w = clone(MINI_WORLD); w.size = { maxPlaces: 2, maxSpaces: 96 };
    expect(validateWorld(w, ARCHETYPES).join()).toMatch(/maxPlaces/i);
  });
  test('unscored win path rejected', () => {
    const w = clone(MINI_WORLD); w.winPaths = ['wealth', 'influence'];
    expect(validateWorld(w, ARCHETYPES).join()).toMatch(/influence/i);
  });
  test('value-share cap', () => {
    const w = clone(MINI_WORLD);
    w.atlasConfig = { valueShareCap: 0.10 }; // 4 places -- someone necessarily exceeds 10%
    expect(validateWorld(w, ARCHETYPES).join()).toMatch(/value/i);
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
