import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';
import { ATLAS_DEFAULTS, computePlaceValues } from '../world-loader';

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
