import { expandFacts } from '../createmod/smart/index';
import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';

const ROSTER = [
  { id: 'a', name: 'A', passive: 'enforcer' },
  { id: 'b', name: 'B', passive: 'pioneer' },
];

function atlasFacts() {
  return {
    id: 'test-smart', name: 'Test Smart', tagline: 't', mapType: 'atlas', seed: 's1',
    world: {
      renderMode: 'globe',
      victory: { maxTurns: 150, params: { groupsToWin: 2 } },
      places: [
        { id: 'aa', realName: 'Aa', archetypes: ['market'], geo: { lat: 40, lng: -74 }, data: { population: 2000000, gdp: 200, fame: 72 } },
        { id: 'bb', realName: 'Bb', archetypes: ['market'], geo: { lat: 51, lng: 0 }, data: { population: 2000000, gdp: 200, fame: 71 } },
        { id: 'cc', realName: 'Cc', archetypes: ['market'], geo: { lat: 35, lng: 139 }, data: { population: 2000000, gdp: 200, fame: 70 } },
        { id: 'dd', realName: 'Dd', archetypes: ['market'], geo: { lat: -33, lng: 151 }, data: { population: 2000000, gdp: 200, fame: 69 } },
      ],
    },
    roster: ROSTER,
  };
}

function classicFacts() {
  return {
    id: 'test-smart-c', name: 'Test Smart C', mapType: 'classic',
    board: { groups: [
      { name: 'G0', color: 'red', places: ['P1', 'P2'] },
      { name: 'G1', color: 'blue', places: ['P3', 'P4'] },
    ] },
    roster: ROSTER,
  };
}

describe('expandFacts', () => {
  test('atlas: exact SP1 input shape with derived connectors + hubs', () => {
    const input = expandFacts(atlasFacts(), { ARCHETYPES });
    expect(input.mapType).toBe('atlas');
    expect(input.map).toBeUndefined();
    expect(input.world.id).toBe('test-smart');
    expect(input.world.movementMode).toBe('atlas');
    expect(input.world.renderMode).toBe('globe');
    expect(input.world.winPaths).toEqual(['dominion', 'wealth', 'survival']);
    expect(input.world.victory).toEqual({ maxTurns: 150, params: { groupsToWin: 2 } });
    input.world.places.forEach(p => {
      expect(Object.keys(p.connectors).length).toBeGreaterThanOrEqual(1);
    });
    expect(input.world.hubs.length).toBeGreaterThanOrEqual(1);
    expect(input.roster).toHaveLength(2);
  });

  test('classic: derived map, no world', () => {
    const input = expandFacts(classicFacts(), { ARCHETYPES });
    expect(input.world).toBeUndefined();
    expect(input.map.layout).toEqual({ type: 'circle' });
    expect(input.map.id).toBeUndefined(); // SP1 normalizeClassicMap fills id/name
  });

  test('atlas defaults: winPaths triple + victory {200, groupsToWin 2} when omitted', () => {
    const f = atlasFacts();
    delete f.world.victory;
    const input = expandFacts(f, { ARCHETYPES });
    expect(input.world.victory).toEqual({ maxTurns: 200, params: { groupsToWin: 2 } });
  });

  test('guards throw with actionable messages', () => {
    expect(() => expandFacts({ id: 'x', name: 'X', mapType: 'hex', roster: ROSTER }, { ARCHETYPES }))
      .toThrow(/mapType/);
    expect(() => expandFacts({ id: 'x', name: 'X', mapType: 'atlas', roster: ROSTER }, { ARCHETYPES }))
      .toThrow(/world\.places/);
    expect(() => expandFacts({ id: 'x', name: 'X', mapType: 'classic', roster: ROSTER }, { ARCHETYPES }))
      .toThrow(/board\.groups/);
    expect(() => expandFacts({ ...classicFacts(), roster: [] }, { ARCHETYPES }))
      .toThrow(/roster/);
  });

  test('determinism: same facts + seed -> deep-equal; explicit seed overrides facts.seed', () => {
    expect(expandFacts(atlasFacts(), { ARCHETYPES })).toEqual(expandFacts(atlasFacts(), { ARCHETYPES }));
    const a = expandFacts(atlasFacts(), { ARCHETYPES, seed: 'other' });
    const b = expandFacts(atlasFacts(), { ARCHETYPES, seed: 'other' });
    expect(a).toEqual(b);
  });
});
