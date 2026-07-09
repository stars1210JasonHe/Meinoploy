// Terra Titans mod — content guard tests (Stage 3.4–3.8).
// Server-safe imports only (Tier-A bundle.data + characters-data + lore — NO PNGs).
import { terraTitansData } from '../../mods/terra-titans/bundle.data';
import { CHARACTERS_DATA, getCharacterById, getStartingMoney } from '../../mods/terra-titans/characters-data';
import { CHARACTER_LORE, getLoreById } from '../../mods/terra-titans/lore';
import { MODS } from '../../mods/index';

// The 8 passive ids that actually FIRE in the engine. `operator` and `shadow` are
// config-only (dead) and must NEVER appear on a Terra Titans leader — a dead passive would
// silently do nothing in-game. This test is the tripwire that catches that regression.
const IMPLEMENTED_PASSIVES = [
  'financier', 'pioneer', 'speculator', 'enforcer',
  'idealist', 'breaker', 'arbitrageur', 'merchant',
];
const DEAD_PASSIVES = ['operator', 'shadow'];

describe('Terra Titans mod content', () => {
  test('registry exposes dominion + terra-titans', () => {
    expect(Object.keys(MODS)).toEqual(expect.arrayContaining(['dominion', 'terra-titans']));
  });

  test('ships exactly 16 leaders', () => {
    expect(CHARACTERS_DATA).toHaveLength(16);
    expect(terraTitansData.characters).toHaveLength(16);
    expect(MODS['terra-titans'].characters).toHaveLength(16);
  });

  test('every leader passive.id is an IMPLEMENTED engine effect (no dead passives)', () => {
    for (const c of CHARACTERS_DATA) {
      expect(IMPLEMENTED_PASSIVES).toContain(c.passive.id);
      expect(DEAD_PASSIVES).not.toContain(c.passive.id);
    }
  });

  test('all 8 implemented passive ids are actually used', () => {
    const used = new Set(CHARACTERS_DATA.map(c => c.passive.id));
    for (const id of IMPLEMENTED_PASSIVES) expect(used.has(id)).toBe(true);
  });

  test('leader ids and colors are unique', () => {
    const ids = CHARACTERS_DATA.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const colors = CHARACTERS_DATA.map(c => c.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  test('each leader has 6 stats and a flavored passive name + description', () => {
    for (const c of CHARACTERS_DATA) {
      expect(Object.keys(c.stats).sort()).toEqual(
        ['capital', 'charisma', 'luck', 'negotiation', 'stamina', 'tech']
      );
      expect(typeof c.passive.name).toBe('string');
      expect(c.passive.name.length).toBeGreaterThan(0);
      expect(typeof c.passive.description).toBe('string');
      expect(c.passive.description.length).toBeGreaterThan(0);
    }
  });

  test('Alexander has stamina >= 7 so the engine stamina reroll fires', () => {
    const alex = getCharacterById('alexander-the-great');
    expect(alex).toBeDefined();
    expect(alex.stats.stamina).toBeGreaterThanOrEqual(7);
  });

  test('getStartingMoney uses the Dominion economy formula', () => {
    // baseStartingMoney 1500 + capital * 50. Mansa Musa capital 10 -> 2000.
    expect(getStartingMoney(getCharacterById('mansa-musa'))).toBe(2000);
  });

  test('extends Dominion economy with duels enabled', () => {
    const ttRules = terraTitansData.rules;
    const domRules = MODS.dominion.rules;
    // Separate objects (terra-titans has its own rules)
    expect(ttRules).not.toBe(domRules);
    // But inherit core economy from Dominion
    expect(ttRules.core.baseStartingMoney).toBe(domRules.core.baseStartingMoney);
    expect(ttRules.buildings).toEqual(domRules.buildings);
    // And enable duels (the terra-titans difference)
    expect(ttRules.duel.enabled).toBe(true);
    expect(domRules.duel.enabled).toBe(false);
  });

  test('bundles the Terra Titans globe world and no map.json boards', () => {
    expect(terraTitansData.maps).toEqual([]);
    expect(terraTitansData.worlds).toHaveLength(1);
    expect(terraTitansData.worlds[0].id).toBe('terra-titans');
    expect(terraTitansData.worlds[0].renderMode).toBe('globe');
  });

  test('lore: every leader has a complete, modal-safe lore entry', () => {
    for (const c of CHARACTERS_DATA) {
      const lore = getLoreById(c.id);
      expect(lore).toBeTruthy();
      // showLoreModal calls .map on style + relationships and .replace on themeSummary;
      // if any are missing the lore modal throws at runtime. Guard the shape here.
      expect(Array.isArray(lore.style)).toBe(true);
      expect(lore.style.length).toBeGreaterThan(0);
      expect(Array.isArray(lore.relationships)).toBe(true);
      expect(lore.relationships.length).toBeGreaterThan(0);
      lore.relationships.forEach(r => {
        expect(typeof r.target).toBe('string');
        expect(typeof r.description).toBe('string');
      });
      expect(typeof lore.themeSummary).toBe('string');
      expect(typeof lore.background).toBe('string');
      expect(typeof lore.joining).toBe('string');
    }
  });

  test('lore table has exactly the 16 leader ids', () => {
    expect(Object.keys(CHARACTER_LORE).sort()).toEqual(CHARACTERS_DATA.map(c => c.id).sort());
  });
});
