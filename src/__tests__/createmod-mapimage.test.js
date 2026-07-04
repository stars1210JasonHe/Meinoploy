import { expandFacts } from '../createmod/smart/index';
import { emitMod } from '../createmod/emit';
import { bundleClientJs } from '../createmod/templates';
import { validateModInput } from '../createmod/validate';
import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';
import { CHANCE_CARDS, COMMUNITY_CARDS } from '../../mods/dominion/cards';

const FACTS = {
  id: 'img-mod', name: 'Img Mod', mapType: 'atlas', seed: 's',
  world: {
    renderMode: 'flat', mapImage: 'maps/westeros.png',
    victory: { maxTurns: 150, params: { groupsToWin: 2 } },
    places: [
      { id: 'aa', realName: 'Aa', archetypes: ['market'], geo: { lat: 10, lng: 10 }, data: { population: 1e6, gdp: 50, fame: 60 } },
      { id: 'bb', realName: 'Bb', archetypes: ['market'], geo: { lat: 20, lng: 40 }, data: { population: 1e6, gdp: 50, fame: 60 } },
      { id: 'cc', realName: 'Cc', archetypes: ['market'], geo: { lat: -10, lng: 80 }, data: { population: 1e6, gdp: 50, fame: 60 } },
      { id: 'dd', realName: 'Dd', archetypes: ['market'], geo: { lat: -30, lng: 120 }, data: { population: 1e6, gdp: 50, fame: 60 } },
    ],
  },
  roster: [
    { id: 'r1', name: 'R1', passive: 'enforcer' },
    { id: 'r2', name: 'R2', passive: 'pioneer' },
  ],
  lore: { r1: { background: 'REAL LORE', joining: 'j', style: ['s'], relationships: [{ target: 'R2', description: 'd' }], themeSummary: 't' } },
};

describe('SP4 pass-throughs', () => {
  test('facts.lore survives expandFacts and reaches SP1 normalize', () => {
    const input = expandFacts(FACTS, { ARCHETYPES });
    expect(input.lore.r1.background).toBe('REAL LORE');
    const r = validateModInput(input, { ARCHETYPES, reusedCards: { chance: CHANCE_CARDS, community: COMMUNITY_CARDS } });
    expect(r.errors).toEqual([]);
    expect(r.normalized.lore.r1.background).toBe('REAL LORE'); // not stubbed
  });
  test('world.mapImage survives expandFacts; absent stays absent', () => {
    expect(expandFacts(FACTS, { ARCHETYPES }).world.mapImage).toBe('maps/westeros.png');
    const bare = JSON.parse(JSON.stringify(FACTS));
    delete bare.world.mapImage;
    delete bare.lore;
    const out = expandFacts(bare, { ARCHETYPES });
    expect(out.world.mapImage).toBeUndefined();
    expect(out.lore).toBeUndefined();
  });
});

describe('SP1 mapImage asset chain', () => {
  const normalized = () => validateModInput(expandFacts(FACTS, { ARCHETYPES }),
    { ARCHETYPES, reusedCards: { chance: CHANCE_CARDS, community: COMMUNITY_CARDS } }).normalized;
  test('emit adds the worldbg copy with a FIXED target name', () => {
    const { copies } = emitMod(normalized());
    expect(copies).toContainEqual({ from: 'maps/westeros.png', to: 'mods/img-mod/worldbg.png' });
  });
  test('bundleClientJs imports worldbg and emits atlasAssets with cityImages:{}', () => {
    const src = bundleClientJs(normalized());
    expect(src).toContain("import worldBg from './worldbg.png';");
    expect(src).toContain("atlasAssets: { 'img-mod': { worldBg, cityImages: {} } }");
  });
  test('no mapImage -> template unchanged (atlasAssets: {})', () => {
    const bare = JSON.parse(JSON.stringify(FACTS));
    delete bare.world.mapImage;
    const norm = validateModInput(expandFacts(bare, { ARCHETYPES }),
      { ARCHETYPES, reusedCards: { chance: CHANCE_CARDS, community: COMMUNITY_CARDS } }).normalized;
    expect(bundleClientJs(norm)).toContain('atlasAssets: {}');
    expect(emitMod(norm).copies).toEqual([]);
  });
});
