import { emitMod } from '../createmod/emit';

const NORM_ATLAS = {
  id: 'ancient-empires', name: 'Ancient Empires', tagline: 'x', version: '1.0.0', mapType: 'atlas',
  world: { id: 'ancient-empires', movementMode: 'atlas', places: [], hubs: [], winPaths: ['dominion'] },
  roster: [{ id: 'a', name: 'A', title: 'T', stats: {}, passive: {}, color: '#1' }],
  lore: { a: { background: 'b', joining: 'j', style: ['s'], relationships: [{ target: 'x', description: 'd' }], themeSummary: 't' } },
  portraits: [{ id: 'cyrus-the-great', path: '/abs/cyrus-the-great.png' }],
};
const NORM_CLASSIC = { ...NORM_ATLAS, id: 'steam-barons', mapType: 'classic', world: undefined, map: { id: 'steam-barons', spaceCount: 12 }, portraits: [] };

describe('emitMod', () => {
  test('produces the full Tier-A/B file set', () => {
    const { files } = emitMod(NORM_ATLAS);
    const paths = files.map(f => f.path);
    expect(paths).toEqual([
      'mods/ancient-empires/ancient-empires.data.json',
      'mods/ancient-empires/characters-data.js',
      'mods/ancient-empires/lore.js',
      'mods/ancient-empires/bundle.data.js',
      'mods/ancient-empires/characters.js',
      'mods/ancient-empires/bundle.client.js',
    ]);
  });
  test('data.json round-trips with world for atlas', () => {
    const { files } = emitMod(NORM_ATLAS);
    const json = files.find(f => f.path.endsWith('.data.json'));
    const data = JSON.parse(json.contents);
    expect(data.world.id).toBe('ancient-empires');
    expect(data.map).toBeUndefined();
  });
  test('atlas bundle wires worlds:[world]/maps:[], classic the inverse', () => {
    expect(emitMod(NORM_ATLAS).files.find(f => f.path.endsWith('bundle.data.js')).contents).toContain('worlds: [data.world]');
    expect(emitMod(NORM_CLASSIC).files.find(f => f.path.endsWith('bundle.data.js')).contents).toContain('maps: [data.map]');
  });
  test('copies map portrait source -> deterministic portraits/<charId><ext>', () => {
    const { copies } = emitMod(NORM_ATLAS);
    expect(copies).toEqual([{ from: '/abs/cyrus-the-great.png', to: 'mods/ancient-empires/portraits/cyrus-the-great.png' }]);
  });
  test('no portraits -> empty copy list', () => {
    expect(emitMod(NORM_CLASSIC).copies).toEqual([]);
  });
});
