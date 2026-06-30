import { toCamelId, dataJson, bundleDataJs, charactersJs, charactersDataJs, loreJs, bundleClientJs } from '../createmod/templates';

describe('toCamelId', () => {
  test('hyphenated id becomes camelCase', () => {
    expect(toCamelId('terra-titans')).toBe('terraTitans');
    expect(toCamelId('ancient-empires')).toBe('ancientEmpires');
  });
  test('single-word id is unchanged', () => {
    expect(toCamelId('dominion')).toBe('dominion');
  });
  test('multi-segment and digit segments', () => {
    expect(toCamelId('a-b-c')).toBe('aBC');
    expect(toCamelId('mod-2-x')).toBe('mod2X');
  });
});

const ATLAS_NORM = {
  id: 'ancient-empires', name: 'Ancient Empires', tagline: 'Old powers vie.', version: '1.0.0',
  mapType: 'atlas',
  world: { id: 'ancient-empires', name: 'Ancient Empires', movementMode: 'atlas', renderMode: 'globe', places: [], hubs: [], winPaths: ['dominion'] },
  roster: [{ id: 'hammurabi', name: 'Hammurabi', title: 'The Lawgiver', stats: { capital: 6, luck: 3, negotiation: 6, charisma: 5, tech: 5, stamina: 9 }, passive: { id: 'enforcer', name: 'Code of Law', description: 'x' }, color: '#b5651d' }],
  lore: { hammurabi: { background: 'b', joining: 'j', style: ['s'], relationships: [{ target: 'x', description: 'd' }], themeSummary: 't' } },
  portraits: [],
};
const CLASSIC_NORM = { ...ATLAS_NORM, id: 'steam-barons', name: 'Steam Barons', mapType: 'classic', world: undefined, map: { id: 'steam-barons', name: 'Steam Barons', spaceCount: 12 } };

describe('templates', () => {
  test('dataJson round-trips and carries world for atlas, map for classic', () => {
    const a = JSON.parse(dataJson(ATLAS_NORM));
    expect(a.world.id).toBe('ancient-empires');
    expect(a.map).toBeUndefined();
    expect(a.roster).toHaveLength(1);
    const c = JSON.parse(dataJson(CLASSIC_NORM));
    expect(c.map.id).toBe('steam-barons');
    expect(c.world).toBeUndefined();
  });

  test('bundleDataJs uses camelId named export and parses', () => {
    const src = bundleDataJs(ATLAS_NORM);
    expect(src).toContain('export const ancientEmpiresData =');
    expect(src).toContain('worlds: [data.world]');
    expect(src).toContain('maps: []');
    const csrc = bundleDataJs(CLASSIC_NORM);
    expect(csrc).toContain('maps: [data.map]');
    expect(csrc).toContain('worlds: []');
    // parses as a module body (strip imports/exports for new Function smoke parse)
    expect(() => require('@babel/core').parseSync(src, { sourceType: 'module' })).not.toThrow();
  });

  test('charactersJs builds PORTRAIT_MAP with camelCharId imports', () => {
    const withPortrait = { ...ATLAS_NORM, portraits: [{ id: 'cyrus-the-great', path: 'portraits/cyrus-the-great.png' }] };
    const src = charactersJs(withPortrait);
    expect(src).toContain("import cyrusTheGreat from './portraits/cyrus-the-great.png';");
    expect(src).toContain("'cyrus-the-great': cyrusTheGreat,");
  });

  test('charactersJs with no portraits still parses (empty PORTRAIT_MAP)', () => {
    const src = charactersJs(ATLAS_NORM);
    expect(() => require('@babel/core').parseSync(src, { sourceType: 'module' })).not.toThrow();
  });

  test('all generated JS parses as modules', () => {
    const parse = s => require('@babel/core').parseSync(s, { sourceType: 'module' });
    [charactersDataJs, loreJs, bundleClientJs].forEach(fn => {
      expect(() => parse(fn(ATLAS_NORM))).not.toThrow();
    });
  });
});
