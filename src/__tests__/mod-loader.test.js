import { validateMod, loadMod } from '../mod-loader';

// Minimal valid mod config for testing
function validModConfig() {
  const spaces = [];
  // Build a valid 40-space board
  spaces.push({ id: 0, name: 'GO', type: 'go', color: null, price: 0, rent: 0 });
  spaces.push({ id: 1, name: 'Prop A1', type: 'property', color: '#AA0000', price: 60, rent: 4 });
  spaces.push({ id: 2, name: 'Community', type: 'community', color: null, price: 0, rent: 0 });
  spaces.push({ id: 3, name: 'Prop A2', type: 'property', color: '#AA0000', price: 60, rent: 4 });
  spaces.push({ id: 4, name: 'Tax', type: 'tax', color: null, price: 0, rent: 200 });
  spaces.push({ id: 5, name: 'Railroad 1', type: 'railroad', color: null, price: 200, rent: 25 });
  for (let i = 6; i <= 9; i++) {
    spaces.push({ id: i, name: `Prop B${i-5}`, type: 'property', color: '#00AA00', price: 100, rent: 8 });
  }
  spaces.push({ id: 10, name: 'Jail', type: 'jail', color: null, price: 0, rent: 0 });
  for (let i = 11; i <= 19; i++) {
    spaces.push({ id: i, name: `Space ${i}`, type: 'chance', color: null, price: 0, rent: 0 });
  }
  spaces.push({ id: 20, name: 'Parking', type: 'parking', color: null, price: 0, rent: 0 });
  for (let i = 21; i <= 29; i++) {
    spaces.push({ id: i, name: `Space ${i}`, type: 'community', color: null, price: 0, rent: 0 });
  }
  spaces.push({ id: 30, name: 'Go To Jail', type: 'goToJail', color: null, price: 0, rent: 0 });
  for (let i = 31; i <= 39; i++) {
    spaces.push({ id: i, name: `Space ${i}`, type: 'chance', color: null, price: 0, rent: 0 });
  }

  return {
    mod: { id: 'test', name: 'Test Mod', version: '1.0.0' },
    board: {
      spaces,
      colorGroups: {
        '#AA0000': [1, 3],
        '#00AA00': [6, 7, 8, 9],
      },
    },
    characters: {
      characters: [
        {
          id: 'hero',
          name: 'Hero',
          title: 'The Brave',
          color: '#ff0000',
          stats: { capital: 6, luck: 6, negotiation: 6, charisma: 6, tech: 6, stamina: 6 },
          passive: { id: 'financier', name: 'Gold Sense', description: 'Buy discount.' },
        },
        {
          id: 'villain',
          name: 'Villain',
          title: 'The Dark',
          color: '#000000',
          stats: { capital: 5, luck: 7, negotiation: 5, charisma: 7, tech: 5, stamina: 7 },
          passive: { id: 'shadow', name: 'Darkness', description: 'Hide money.' },
        },
      ],
    },
    cards: {
      chance: [
        { text: 'Go to GO!', action: 'moveTo', value: 0 },
        { text: 'Gain $100.', action: 'gain', value: 100 },
      ],
      community: [
        { text: 'Pay $50.', action: 'pay', value: 50 },
        { text: 'Go to Jail.', action: 'goToJail', value: 0 },
      ],
    },
  };
}

describe('validateMod', () => {
  test('valid mod returns no errors', () => {
    const errors = validateMod(validModConfig());
    expect(errors).toHaveLength(0);
  });

  test('missing board returns error', () => {
    const config = validModConfig();
    delete config.board;
    const errors = validateMod(config);
    expect(errors).toContain('board.json is required');
  });

  test('wrong number of spaces returns error', () => {
    const config = validModConfig();
    config.board.spaces = config.board.spaces.slice(0, 10);
    const errors = validateMod(config);
    expect(errors.some(e => e.includes('exactly 40'))).toBe(true);
  });

  test('wrong corner types return errors', () => {
    const config = validModConfig();
    config.board.spaces[0].type = 'property';
    const errors = validateMod(config);
    expect(errors.some(e => e.includes('Space 0 must be type "go"'))).toBe(true);
  });

  test('property without color returns error', () => {
    const config = validModConfig();
    config.board.spaces[1].color = null;
    const errors = validateMod(config);
    expect(errors.some(e => e.includes('must have a color'))).toBe(true);
  });

  test('missing characters returns error', () => {
    const config = validModConfig();
    delete config.characters;
    const errors = validateMod(config);
    expect(errors).toContain('characters.json is required');
  });

  test('duplicate character IDs return error', () => {
    const config = validModConfig();
    config.characters.characters[1].id = 'hero';
    const errors = validateMod(config);
    expect(errors.some(e => e.includes('duplicate id'))).toBe(true);
  });

  test('invalid passive ID returns error', () => {
    const config = validModConfig();
    config.characters.characters[0].passive.id = 'nonexistent';
    const errors = validateMod(config);
    expect(errors.some(e => e.includes('invalid passive.id'))).toBe(true);
  });

  test('stat out of range returns error', () => {
    const config = validModConfig();
    config.characters.characters[0].stats.capital = 11;
    const errors = validateMod(config);
    expect(errors.some(e => e.includes('must be 1-10'))).toBe(true);
  });

  test('invalid card action returns error', () => {
    const config = validModConfig();
    config.cards.chance[0].action = 'explode';
    const errors = validateMod(config);
    expect(errors.some(e => e.includes('invalid action'))).toBe(true);
  });

  test('missing cards returns error', () => {
    const config = validModConfig();
    delete config.cards;
    const errors = validateMod(config);
    expect(errors).toContain('cards.json is required');
  });
});

describe('loadMod', () => {
  test('loads valid mod and returns all expected exports', () => {
    const mod = loadMod(validModConfig());
    expect(mod.BOARD_SPACES).toHaveLength(40);
    expect(mod.COLOR_GROUPS['#AA0000']).toEqual([1, 3]);
    expect(mod.CHARACTERS).toHaveLength(2);
    expect(mod.CHARACTERS_DATA).toHaveLength(2);
    expect(mod.CHANCE_CARDS).toHaveLength(2);
    expect(mod.COMMUNITY_CARDS).toHaveLength(2);
    expect(mod.RULES).toBeDefined();
    expect(mod.getCharacterById).toBeInstanceOf(Function);
    expect(mod.getStartingMoney).toBeInstanceOf(Function);
    expect(mod.getLoreById).toBeInstanceOf(Function);
  });

  test('getCharacterById returns correct character', () => {
    const mod = loadMod(validModConfig());
    const hero = mod.getCharacterById('hero');
    expect(hero.name).toBe('Hero');
    expect(mod.getCharacterById('nonexistent')).toBeUndefined();
  });

  test('getStartingMoney uses rules config', () => {
    const mod = loadMod(validModConfig());
    const hero = mod.getCharacterById('hero');
    // default: 1500 + capital(6) * 50 = 1800
    expect(mod.getStartingMoney(hero)).toBe(1800);
  });

  test('rules merge with defaults', () => {
    const config = validModConfig();
    config.rules = { core: { goSalary: 300 } };
    const mod = loadMod(config);
    expect(mod.RULES.core.goSalary).toBe(300); // overridden
    expect(mod.RULES.core.baseStartingMoney).toBe(1500); // default kept
    expect(mod.RULES.buildings.names).toHaveLength(5); // default kept
  });

  test('portrait map attaches to characters', () => {
    const config = validModConfig();
    config.portraitMap = { 'hero': 'http://example.com/hero.png' };
    const mod = loadMod(config);
    expect(mod.CHARACTERS[0].portrait).toBe('http://example.com/hero.png');
    expect(mod.CHARACTERS[1].portrait).toBeNull(); // no portrait
  });

  test('throws on invalid mod', () => {
    const config = validModConfig();
    delete config.board;
    expect(() => loadMod(config)).toThrow('Mod validation failed');
  });

  test('lore is optional', () => {
    const mod = loadMod(validModConfig());
    expect(mod.getLoreById('hero')).toBeNull();

    const config2 = validModConfig();
    config2.lore = { hero: { nameZh: 'Test', background: 'Story' } };
    const mod2 = loadMod(config2);
    expect(mod2.getLoreById('hero').nameZh).toBe('Test');
  });
});
