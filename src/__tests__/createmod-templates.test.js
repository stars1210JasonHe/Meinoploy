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

  // Review finding: `normalized.name` is an LLM-derived mod title (--from-book synthesis over
  // untrusted book text) interpolated RAW into every generator's `// ${normalized.name} — ...`
  // comment header. A newline in the name terminates the `//` comment early, turning the rest
  // of the string into executable JS spliced into a generated mods/<id>/*.js file that runs in
  // the game client. headerSafe() must collapse it to one line so the payload stays inert text.
  test('an LLM-derived name with an embedded newline cannot break out of the generated comment header', () => {
    const evil = { ...ATLAS_NORM, name: 'Evil\n});alert(1);//' };
    const parse = s => require('@babel/core').parseSync(s, { sourceType: 'module' });
    [charactersDataJs, loreJs, bundleDataJs, charactersJs, bundleClientJs].forEach(fn => {
      const src = fn(evil);
      const firstLine = src.split('\n')[0];
      expect(firstLine.startsWith('//')).toBe(true);
      expect(firstLine).toContain('Evil });alert(1);//'); // newline collapsed to a space, one line
      // the injected payload must never surface as its own top-level statement
      expect(src).not.toMatch(/^\}\);alert\(1\);/m);
      // and the generated file must still parse cleanly as a JS module (pre-fix, this throws:
      // the injected `});alert(1);` line is a syntax error on its own)
      expect(() => parse(src)).not.toThrow();
    });
  });

  test('dataJson carries the mod display name (SP3 name-resolution chain)', () => {
    const out = JSON.parse(dataJson({ name: '三国志', roster: [], lore: {}, map: { id: 'classic-map' } }));
    expect(out.name).toBe('三国志');
  });
});
