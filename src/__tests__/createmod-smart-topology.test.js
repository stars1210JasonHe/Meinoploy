import { deriveTopology } from '../createmod/smart/topology';
import { makeRng } from '../createmod/smart/index';
import { validateWorld } from '../world-loader';
import { normalizeAtlasWorld } from '../createmod/validate';
import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';

// Data must be FULLY EQUAL across places: computePlaceValues min-max normalizes, so ANY
// spread pins the top place to price 400 and the bottom to 60 — at n=3 the top place would
// then hold >0.35 of board value and validateWorld would report a value-share error that has
// nothing to do with topology. Equal data -> equal prices -> share = slots_p/totalSlots
// (1/n <= 1/3 < 0.35 for single-archetype sets). The anchor stays deterministic via the
// spec's fame tie-break (lowest id wins -> always p00).
const EQ_DATA = { population: 2000000, gdp: 200, fame: 70 };

function mkPlaces(n, archetypesFor) {
  return Array.from({ length: n }, (_, i) => ({
    id: 'p' + String(i).padStart(2, '0'),
    realName: 'P' + i,
    archetypes: archetypesFor ? archetypesFor(i) : ['market'],
    geo: { lat: -50 + ((i * 137) % 100), lng: -170 + ((i * 73) % 340) },
    data: { ...EQ_DATA },
  }));
}

function assemble(places, { connectorsByPlace, hubs }) {
  return normalizeAtlasWorld({
    id: 't', name: 'T', movementMode: 'atlas',
    places: places.map(p => ({ ...p, connectors: connectorsByPlace[p.id] })),
    hubs,
    winPaths: ['dominion', 'wealth', 'survival'],
  }, ARCHETYPES);
}

describe('deriveTopology', () => {
  [3, 6, 12, 40].forEach(n => {
    test(`n=${n}: derived world passes validateWorld with zero errors`, () => {
      const places = mkPlaces(n);
      const topo = deriveTopology(places, { ARCHETYPES, rng: makeRng('t' + n) });
      expect(topo.hubs.length).toBeGreaterThanOrEqual(1);
      const errors = validateWorld(assemble(places, topo), ARCHETYPES);
      expect(errors).toEqual([]);
    });
  });

  test('multi-archetype place (6 slots) still satisfies hub-reach', () => {
    // 12 places; one is a double-archetype (6 slots) — the case a closed-form bound missed.
    const places = mkPlaces(12, i => (i === 5 ? ['market', 'downtown'] : ['market']));
    const topo = deriveTopology(places, { ARCHETYPES, rng: makeRng('multi') });
    const errors = validateWorld(assemble(places, topo), ARCHETYPES);
    expect(errors).toEqual([]);
  });

  test('n<3 throws', () => {
    expect(() => deriveTopology(mkPlaces(2), { ARCHETYPES, rng: makeRng('x') }))
      .toThrow(/needs >=3 places/);
  });

  test('deterministic: same input + seed -> deep-equal', () => {
    const places = mkPlaces(12);
    const a = deriveTopology(places, { ARCHETYPES, rng: makeRng('same') });
    const b = deriveTopology(places, { ARCHETYPES, rng: makeRng('same') });
    expect(a).toEqual(b);
  });

  test('does not mutate the input places', () => {
    const places = mkPlaces(6);
    deriveTopology(places, { ARCHETYPES, rng: makeRng('mut') });
    expect(places[0].connectors).toBeUndefined();
  });
});
