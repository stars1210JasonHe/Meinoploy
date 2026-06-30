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
