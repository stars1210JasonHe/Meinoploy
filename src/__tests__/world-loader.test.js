import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';

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
