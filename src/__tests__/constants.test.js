import { PLAYER_COLORS } from '../constants';
import { BOARD_SPACES, CHANCE_CARDS, COMMUNITY_CARDS } from '../../mods/dominion';

describe('BOARD_SPACES', () => {
  test('has exactly 40 spaces', () => {
    expect(BOARD_SPACES).toHaveLength(40);
  });

  test('spaces have sequential IDs 0-39', () => {
    BOARD_SPACES.forEach((space, i) => {
      expect(space.id).toBe(i);
    });
  });

  test('corner spaces are correct types', () => {
    expect(BOARD_SPACES[0].type).toBe('go');
    expect(BOARD_SPACES[10].type).toBe('jail');
    expect(BOARD_SPACES[20].type).toBe('parking');
    expect(BOARD_SPACES[30].type).toBe('goToJail');
  });

  test('all properties have price > 0 and rent > 0', () => {
    const properties = BOARD_SPACES.filter(s => s.type === 'property');
    expect(properties.length).toBeGreaterThan(0);
    properties.forEach(p => {
      expect(p.price).toBeGreaterThan(0);
      expect(p.rent).toBeGreaterThan(0);
      expect(p.color).toBeTruthy();
    });
  });

  test('has 4 railroads at $200 each', () => {
    const railroads = BOARD_SPACES.filter(s => s.type === 'railroad');
    expect(railroads).toHaveLength(4);
    railroads.forEach(r => {
      expect(r.price).toBe(200);
    });
  });

  test('has 2 utilities at $150 each', () => {
    const utilities = BOARD_SPACES.filter(s => s.type === 'utility');
    expect(utilities).toHaveLength(2);
    utilities.forEach(u => {
      expect(u.price).toBe(150);
    });
  });

  test('has 3 Chance and 3 Community Chest spaces', () => {
    expect(BOARD_SPACES.filter(s => s.type === 'chance')).toHaveLength(3);
    expect(BOARD_SPACES.filter(s => s.type === 'community')).toHaveLength(3);
  });

  test('has 2 tax spaces', () => {
    const taxes = BOARD_SPACES.filter(s => s.type === 'tax');
    expect(taxes).toHaveLength(2);
    expect(taxes[0].rent).toBe(200); // Income Tax
    expect(taxes[1].rent).toBe(100); // Luxury Tax
  });
});

describe('CHANCE_CARDS', () => {
  test('has 10 cards', () => {
    expect(CHANCE_CARDS).toHaveLength(10);
  });

  const VALID_ACTIONS = ['moveTo', 'gain', 'pay', 'goToJail', 'payPercent', 'gainAll', 'gainPerProperty', 'freeUpgrade', 'downgrade', 'forceBuy'];

  test('all cards have text and action', () => {
    CHANCE_CARDS.forEach(card => {
      expect(card.text).toBeTruthy();
      expect(VALID_ACTIONS).toContain(card.action);
      expect(card.value).toBeDefined();
    });
  });
});

describe('COMMUNITY_CARDS', () => {
  test('has 10 cards', () => {
    expect(COMMUNITY_CARDS).toHaveLength(10);
  });

  const VALID_ACTIONS = ['moveTo', 'gain', 'pay', 'goToJail', 'payPercent', 'gainAll', 'gainPerProperty', 'freeUpgrade', 'downgrade', 'forceBuy'];

  test('all cards have text and action', () => {
    COMMUNITY_CARDS.forEach(card => {
      expect(card.text).toBeTruthy();
      expect(VALID_ACTIONS).toContain(card.action);
      expect(card.value).toBeDefined();
    });
  });
});

describe('PLAYER_COLORS', () => {
  test('has 10 colors', () => {
    expect(PLAYER_COLORS).toHaveLength(10);
  });
});
