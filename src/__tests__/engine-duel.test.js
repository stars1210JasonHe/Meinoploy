import { Monopoly } from '../Game';
import { RULES } from '../../mods/active-rules';

describe('Duel mechanism — Game.js setup + state initialization', () => {
  test('G.duel initialized to null', () => {
    const ctx = { numPlayers: 2 };
    const G = Monopoly.setup(ctx);
    expect(G.duel).toBeNull();
  });

  test('each player has lastDuelTurn initialized to null', () => {
    const ctx = { numPlayers: 3 };
    const G = Monopoly.setup(ctx);
    G.players.forEach(p => {
      expect(p.lastDuelTurn).toBeNull();
    });
  });

  test('RULES.duel config bucket exists with all 8 keys', () => {
    expect(RULES.duel).toBeDefined();
    expect(RULES.duel).toHaveProperty('enabled');
    expect(RULES.duel).toHaveProperty('loseMultiplier');
    expect(RULES.duel).toHaveProperty('cooldownTurns');
    expect(RULES.duel).toHaveProperty('diceCount');
    expect(RULES.duel).toHaveProperty('statPrimary');
    expect(RULES.duel).toHaveProperty('statSecondary');
    expect(RULES.duel).toHaveProperty('secondaryDivisor');
    expect(RULES.duel).toHaveProperty('tieGoesToDefender');
  });

  test('RULES.duel has expected default values', () => {
    expect(RULES.duel.enabled).toBe(false);
    expect(RULES.duel.loseMultiplier).toBe(2);
    expect(RULES.duel.cooldownTurns).toBe(3);
    expect(RULES.duel.diceCount).toBe(2);
    expect(RULES.duel.statPrimary).toBe('stamina');
    expect(RULES.duel.statSecondary).toBe('luck');
    expect(RULES.duel.secondaryDivisor).toBe(2);
    expect(RULES.duel.tieGoesToDefender).toBe(true);
  });
});
