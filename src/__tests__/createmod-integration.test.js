import fs from 'fs';
import path from 'path';
import { validateModInput } from '../createmod/validate';
import { emitMod } from '../createmod/emit';
import { patchRegistries, unpatchRegistries } from '../createmod/registry-patch';
import { loadWorld } from '../world-loader';
import { loadMap } from '../map-loader';
import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';
import { CHANCE_CARDS, COMMUNITY_CARDS } from '../../mods/dominion/cards';
import { MODS } from '../../mods/index';

const OPTS = { ARCHETYPES, reusedCards: { chance: CHANCE_CARDS, community: COMMUNITY_CARDS } };
const ATLAS = JSON.parse(fs.readFileSync(path.join(__dirname, '../../examples/create-mod/ancient-empires.atlas.json'), 'utf8'));
const CLASSIC = JSON.parse(fs.readFileSync(path.join(__dirname, '../../examples/create-mod/steam-barons.classic.json'), 'utf8'));

describe('create-mod integration (pure pipeline)', () => {
  test('atlas fixture: geo-only places get pos derived; loadWorld does not throw', () => {
    const r = validateModInput(ATLAS, OPTS);
    expect(r.errors).toEqual([]);
    // fixture has NO pos; normalize must derive it
    expect(ATLAS.world.places[0].pos).toBeUndefined();
    expect(r.normalized.world.places[0].pos).toBeDefined();
    expect(() => loadWorld(r.normalized.world, ARCHETYPES)).not.toThrow();
  });

  test('classic fixture: loadMap does not throw; cards injected', () => {
    const r = validateModInput(CLASSIC, OPTS);
    expect(r.errors).toEqual([]);
    expect(() => loadMap(r.normalized.map)).not.toThrow();
    expect(r.normalized.map.cards.chance.length).toBeGreaterThan(0);
  });

  test('registry patch on both fixtures keeps mods/index.js + App.js parseable, then unpatch reverts', () => {
    const indexSrc = fs.readFileSync(path.join(__dirname, '../../mods/index.js'), 'utf8');
    const appSrc = fs.readFileSync(path.join(__dirname, '../../src/App.js'), 'utf8');
    const p1 = patchRegistries('ancient-empires', { indexSrc, appSrc });
    const p2 = patchRegistries('steam-barons', { indexSrc: p1.indexSrc, appSrc: p1.appSrc });
    const parse = s => require('@babel/core').parseSync(s, { sourceType: 'module' });
    expect(() => parse(p2.indexSrc)).not.toThrow();
    expect(() => parse(p2.appSrc)).not.toThrow();
    const u1 = unpatchRegistries('steam-barons', p2);
    const u2 = unpatchRegistries('ancient-empires', u1);
    expect(u2.indexSrc).toBe(indexSrc);
    expect(u2.appSrc).toBe(appSrc);
  });

  // Loads the EMITTED Tier-A wrapper (catches wrong relative paths / export names that
  // string-matching misses). Writes into a real temp dir under mods/ so `../dominion/*`
  // resolves, requires the emitted bundle.data.js, asserts the executed wiring, cleans up.
  test('emitted bundle.data.js loads and wires correctly', () => {
    const r = validateModInput(ATLAS, OPTS);
    // Re-id to a throwaway id so this temp tree NEVER collides with the committed
    // mods/ancient-empires from the acceptance task (the finally-rmSync would delete it).
    const norm = JSON.parse(JSON.stringify(r.normalized));
    norm.id = 'zz-itest-mod';
    const { files } = emitMod(norm);
    const dir = path.join(__dirname, '../../mods', 'zz-itest-mod');
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const f of files) fs.writeFileSync(path.join(__dirname, '../..', f.path), f.contents);
      const mod = require(path.join(dir, 'bundle.data.js'));
      const data = mod.zzItestModData || mod.default;
      expect(data.id).toBe('zz-itest-mod');
      expect(data.maps).toEqual([]);
      expect(data.worlds).toHaveLength(1);
      expect(data.worlds[0].id).toBe('ancient-empires');     // the WORLD id is independent of mod id
      expect(data.rules).toBe(MODS.dominion.rules);          // reused economy
      expect(typeof data.getStartingMoney).toBe('function');
      expect(data.characters).toHaveLength(3);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
