import { normalizeAtlasWorld } from '../createmod/validate';

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
