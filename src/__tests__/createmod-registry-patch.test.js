import { patchRegistries, unpatchRegistries } from '../createmod/registry-patch';

const INDEX = `import { deepClone } from '../src/mod-loader';
import { dominionData } from './dominion/bundle.data';
import { terraTitansData } from './terra-titans/bundle.data';

export const MODS = {
  dominion: dominionData,
  'terra-titans': terraTitansData,
};
`;
const APP = `import dominionMod from '../mods/dominion/bundle.client';
import terraTitansMod from '../mods/terra-titans/bundle.client';
const MODS = [dominionMod, terraTitansMod];
`;

function parses(src) {
  return () => require('@babel/core').parseSync(src, { sourceType: 'module' });
}

describe('patchRegistries — hyphenated id', () => {
  test('adds camelId import + entry to both files and they parse', () => {
    const r = patchRegistries('ancient-empires', { indexSrc: INDEX, appSrc: APP });
    expect(r.changed).toBe(true);
    expect(r.indexSrc).toContain("import { ancientEmpiresData } from './ancient-empires/bundle.data';");
    expect(r.indexSrc).toContain("'ancient-empires': ancientEmpiresData,");
    expect(r.appSrc).toContain("import ancientEmpiresMod from '../mods/ancient-empires/bundle.client';");
    expect(r.appSrc).toContain('const MODS = [dominionMod, terraTitansMod, ancientEmpiresMod];');
    expect(parses(r.indexSrc)).not.toThrow();
    expect(parses(r.appSrc)).not.toThrow();
  });
  test('is idempotent (re-running adds no duplicates)', () => {
    const once = patchRegistries('ancient-empires', { indexSrc: INDEX, appSrc: APP });
    const twice = patchRegistries('ancient-empires', { indexSrc: once.indexSrc, appSrc: once.appSrc });
    expect(twice.changed).toBe(false);
    expect(twice.indexSrc).toBe(once.indexSrc);
    expect(twice.appSrc).toBe(once.appSrc);
  });
  test('missing anchor throws', () => {
    expect(() => patchRegistries('x', { indexSrc: 'nope', appSrc: APP })).toThrow(/anchor/);
    expect(() => patchRegistries('x', { indexSrc: INDEX, appSrc: 'nope' })).toThrow(/anchor/);
  });
});

describe('unpatchRegistries — byte-identical revert', () => {
  test('patch then unpatch restores the originals exactly', () => {
    const p = patchRegistries('ancient-empires', { indexSrc: INDEX, appSrc: APP });
    const u = unpatchRegistries('ancient-empires', { indexSrc: p.indexSrc, appSrc: p.appSrc });
    expect(u.indexSrc).toBe(INDEX);
    expect(u.appSrc).toBe(APP);
  });
  test('unpatch of a missing id is a no-op (changed=false)', () => {
    const u = unpatchRegistries('not-there', { indexSrc: INDEX, appSrc: APP });
    expect(u.changed).toBe(false);
    expect(u.indexSrc).toBe(INDEX);
  });
});
