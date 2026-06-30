import { normalizeAtlasWorld, normalizeClassicMap } from '../createmod/validate';

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
