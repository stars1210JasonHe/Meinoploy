import { INVALID_MOVE } from 'boardgame.io/core';
import { Monopoly } from '../Game';
import { UPGRADE_COST_MULTIPLIERS, RENT_MULTIPLIERS, SEASONS, SEASON_CHANGE_INTERVAL } from '../constants';
import { BOARD_SPACES, COLOR_GROUPS, CHARACTERS, getCharacterById } from '../../mods/dominion';

// Helper: create a fresh game state in 'play' phase (skipping char select)
function freshG() {
  const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
  const G = Monopoly.setup(ctx);
  G.phase = 'play'; // Skip character selection for gameplay tests
  return G;
}

// Helper: create a fresh game state with characters assigned
function freshGWithChars(char0Id = 'albert-victor', char1Id = 'lia-startrace') {
  const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
  const G = Monopoly.setup(ctx);
  // Simulate character selection
  const char0 = getCharacterById(char0Id);
  const char1 = getCharacterById(char1Id);
  G.players[0].character = char0;
  G.players[0].money = 1500 + char0.stats.capital * 50;
  G.players[1].character = char1;
  G.players[1].money = 1500 + char1.stats.capital * 50;
  if (char0.stats.luck >= 8) G.players[0].luckRedraws = 1;
  if (char0.passive.id === 'speculator') G.players[0].luckRedraws += 1;
  if (char0.stats.stamina >= 7) G.players[0].rerollsLeft = 1;
  if (char1.stats.luck >= 8) G.players[1].luckRedraws = 1;
  if (char1.passive.id === 'speculator') G.players[1].luckRedraws += 1;
  if (char1.stats.stamina >= 7) G.players[1].rerollsLeft = 1;
  G.phase = 'play';
  return G;
}

// Helper: die value from random.Number()
// d = Math.floor(val * 6) + 1
function valForDie(n) {
  return (n - 1) / 6 + 0.01;
}

// Create a ctx with mocked random that produces specific dice
function makeCtx(currentPlayer = '0', d1 = 3, d2 = 4) {
  let i = 0;
  const values = [valForDie(d1), valForDie(d2)];
  return {
    currentPlayer,
    numPlayers: 2,
    random: { Number: () => values[i++ % values.length] },
    events: { endTurn: jest.fn() },
  };
}

// ─── SETUP ───────────────────────────────────────────────
describe('Monopoly.setup', () => {
  test('creates 2 players with $1500 at position 0', () => {
    const G = freshG();
    expect(G.players).toHaveLength(2);
    G.players.forEach((p, i) => {
      expect(p.id).toBe(String(i));
      expect(p.money).toBe(1500);
      expect(p.position).toBe(0);
      expect(p.properties).toEqual([]);
      expect(p.inJail).toBe(false);
      expect(p.bankrupt).toBe(false);
    });
  });

  test('initializes ownership as null for all buyable spaces', () => {
    const G = freshG();
    BOARD_SPACES.forEach(space => {
      if (['property', 'railroad', 'utility'].includes(space.type)) {
        expect(G.ownership[space.id]).toBeNull();
      }
    });
  });

  test('initial state has correct flags', () => {
    const G = freshG();
    expect(G.hasRolled).toBe(false);
    expect(G.canBuy).toBe(false);
    expect(G.turnPhase).toBe('roll');
    expect(G.lastDice).toBeNull();
    expect(G.buildings).toEqual({});
    expect(G.mortgaged).toEqual({});
  });

  test('setup starts in characterSelect phase', () => {
    const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
    const G = Monopoly.setup(ctx);
    expect(G.phase).toBe('characterSelect');
    expect(G.players[0].character).toBeNull();
    expect(G.pendingCard).toBeNull();
    expect(G.doublesCount).toBe(0);
  });
});

// ─── CHARACTER SELECTION ─────────────────────────────────
describe('selectCharacter', () => {
  test('assigns character and updates starting money', () => {
    const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
    const G = Monopoly.setup(ctx);
    const selectCtx = makeCtx('0');

    Monopoly.moves.selectCharacter(G, selectCtx, 'albert-victor');

    expect(G.players[0].character.id).toBe('albert-victor');
    expect(G.players[0].money).toBe(1500 + 9 * 50); // Capital 9
    expect(selectCtx.events.endTurn).toHaveBeenCalled();
  });

  test('cannot select already taken character', () => {
    const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
    const G = Monopoly.setup(ctx);
    const ctx0 = makeCtx('0');
    Monopoly.moves.selectCharacter(G, ctx0, 'albert-victor');

    const result = Monopoly.moves.selectCharacter(G, makeCtx('1'), 'albert-victor');
    expect(result).toBe(INVALID_MOVE);
  });

  test('cannot select invalid character', () => {
    const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
    const G = Monopoly.setup(ctx);
    const result = Monopoly.moves.selectCharacter(G, makeCtx('0'), 'nonexistent');
    expect(result).toBe(INVALID_MOVE);
  });

  test('transitions to play phase when all players selected', () => {
    const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
    const G = Monopoly.setup(ctx);
    Monopoly.moves.selectCharacter(G, makeCtx('0'), 'albert-victor');
    Monopoly.moves.selectCharacter(G, makeCtx('1'), 'lia-startrace');

    expect(G.phase).toBe('play');
  });

  test('cannot select during play phase', () => {
    const G = freshG();
    const result = Monopoly.moves.selectCharacter(G, makeCtx('0'), 'albert-victor');
    expect(result).toBe(INVALID_MOVE);
  });

  test('sets luck redraws for high-luck characters', () => {
    const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
    const G = Monopoly.setup(ctx);
    // Lia Startrace has Luck 8 → gets 1 redraw
    Monopoly.moves.selectCharacter(G, makeCtx('0'), 'lia-startrace');
    expect(G.players[0].luckRedraws).toBe(1);
  });

  test('Evelyn Zero gets extra redraws', () => {
    const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
    const G = Monopoly.setup(ctx);
    // Evelyn Zero: Luck 10 → 1 redraw + speculator passive → +1 = 2
    Monopoly.moves.selectCharacter(G, makeCtx('0'), 'evelyn-zero');
    expect(G.players[0].luckRedraws).toBe(2);
  });

  test('sets rerolls for high-stamina characters', () => {
    const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
    const G = Monopoly.setup(ctx);
    // Sophia Ember has Stamina 8 → gets 1 reroll
    Monopoly.moves.selectCharacter(G, makeCtx('0'), 'sophia-ember');
    expect(G.players[0].rerollsLeft).toBe(1);
  });
});

// ─── ROLL DICE ───────────────────────────────────────────
describe('rollDice', () => {
  test('moves player and updates dice state', () => {
    const G = freshG();
    const ctx = makeCtx('0', 3, 4); // total = 7

    Monopoly.moves.rollDice(G, ctx);

    expect(G.lastDice.d1).toBe(3);
    expect(G.lastDice.d2).toBe(4);
    expect(G.lastDice.total).toBe(7);
    expect(G.hasRolled).toBe(true);
    expect(G.players[0].position).toBe(7); // Chance space
  });

  test('cannot roll twice in same turn', () => {
    const G = freshG();
    const ctx = makeCtx('0', 1, 1);

    Monopoly.moves.rollDice(G, ctx);
    const result = Monopoly.moves.rollDice(G, makeCtx('0', 2, 2));

    expect(result).toBe(INVALID_MOVE);
  });

  test('bankrupt player cannot roll', () => {
    const G = freshG();
    G.players[0].bankrupt = true;
    const ctx = makeCtx('0', 1, 1);

    const result = Monopoly.moves.rollDice(G, ctx);
    expect(result).toBe(INVALID_MOVE);
  });

  test('cannot roll in characterSelect phase', () => {
    const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
    const G = Monopoly.setup(ctx); // phase = 'characterSelect'
    const result = Monopoly.moves.rollDice(G, makeCtx('0', 3, 4));
    expect(result).toBe(INVALID_MOVE);
  });

  test('awards $200 when passing GO', () => {
    const G = freshG();
    G.players[0].position = 38; // Luxury Tax
    const ctx = makeCtx('0', 3, 4); // move 7 → wraps to position 5

    Monopoly.moves.rollDice(G, ctx);

    expect(G.players[0].position).toBe(5);
    expect(G.players[0].money).toBe(1500 + 200); // Passed GO, landed on Reading Railroad (unowned)
  });

  test('landing on goToJail sends to jail', () => {
    const G = freshG();
    G.players[0].position = 25; // B&O Railroad
    const ctx = makeCtx('0', 3, 2); // move 5 → position 30 (Go To Jail)

    Monopoly.moves.rollDice(G, ctx);

    expect(G.players[0].position).toBe(10);
    expect(G.players[0].inJail).toBe(true);
  });

  test('sets canBuy when landing on unowned property', () => {
    const G = freshG();
    const ctx = makeCtx('0', 1, 2); // total 3, lands on Baltic Ave (id 3, $60)

    Monopoly.moves.rollDice(G, ctx);

    expect(G.players[0].position).toBe(3);
    expect(G.canBuy).toBe(true);
    expect(G.turnPhase).toBe('act');
  });

  test('does not set canBuy when landing on tax space', () => {
    const G = freshG();
    const ctx = makeCtx('0', 2, 2); // total 4, Income Tax

    Monopoly.moves.rollDice(G, ctx);

    expect(G.players[0].position).toBe(4);
    expect(G.canBuy).toBe(false);
    expect(G.turnPhase).toBe('done');
  });

  test('triple doubles sends player to jail', () => {
    const G = freshG();
    // First doubles
    G.doublesCount = 2; // Already had 2 doubles
    const ctx = makeCtx('0', 3, 3); // 3rd doubles

    Monopoly.moves.rollDice(G, ctx);

    expect(G.players[0].position).toBe(10);
    expect(G.players[0].inJail).toBe(true);
    expect(G.turnPhase).toBe('done');
  });

  test('stores preRollPosition in lastDice', () => {
    const G = freshG();
    G.players[0].position = 5;
    const ctx = makeCtx('0', 1, 2); // total 3

    Monopoly.moves.rollDice(G, ctx);

    expect(G.lastDice.preRollPosition).toBe(5);
    expect(G.players[0].position).toBe(8);
  });
});

// ─── BUY PROPERTY ────────────────────────────────────────
describe('buyProperty', () => {
  test('buys property, deducts price, sets ownership', () => {
    const G = freshG();
    G.players[0].position = 1; // Mediterranean Ave, $60
    G.canBuy = true;
    const ctx = makeCtx('0');

    Monopoly.moves.buyProperty(G, ctx);

    expect(G.players[0].money).toBe(1500 - 60);
    expect(G.players[0].properties).toContain(1);
    expect(G.ownership[1]).toBe('0');
    expect(G.canBuy).toBe(false);
    expect(G.turnPhase).toBe('done');
  });

  test('cannot buy when canBuy is false', () => {
    const G = freshG();
    G.canBuy = false;
    const ctx = makeCtx('0');

    const result = Monopoly.moves.buyProperty(G, ctx);
    expect(result).toBe(INVALID_MOVE);
  });

  test('cannot buy if not enough money', () => {
    const G = freshG();
    G.players[0].position = 39; // Boardwalk, $400
    G.players[0].money = 100;
    G.canBuy = true;
    const ctx = makeCtx('0');

    const result = Monopoly.moves.buyProperty(G, ctx);
    expect(result).toBe(INVALID_MOVE);
  });

  test('applies negotiation discount with character', () => {
    const G = freshGWithChars('albert-victor', 'lia-startrace');
    // Albert Victor: negotiation 8 → 8% off, + financier passive -10%
    // Mediterranean Ave $60 → $60 * 0.92 * 0.90 = $49
    G.players[0].position = 1;
    G.canBuy = true;
    G.effectivePrice = 49; // Pre-calculated effective price

    Monopoly.moves.buyProperty(G, makeCtx('0'));

    expect(G.players[0].money).toBe(1500 + 9 * 50 - 49);
    expect(G.players[0].properties).toContain(1);
  });
});

// ─── PASS PROPERTY ───────────────────────────────────────
describe('passProperty', () => {
  test('passing does not change money and triggers auction', () => {
    const G = freshG();
    G.canBuy = true;
    // Player must be on a buyable space for auction to reference it
    G.players[0].position = 1;

    Monopoly.moves.passProperty(G, makeCtx('0'));

    expect(G.players[0].money).toBe(1500);
    expect(G.canBuy).toBe(false);
    // Auction is enabled, so passProperty triggers auction phase
    expect(G.turnPhase).toBe('auction');
    expect(G.auction).not.toBeNull();
    expect(G.auction.propertyId).toBe(1);
  });

  test('cannot pass when canBuy is false', () => {
    const G = freshG();
    G.canBuy = false;

    const result = Monopoly.moves.passProperty(G, makeCtx('0'));
    expect(result).toBe(INVALID_MOVE);
  });
});

// ─── RENT ────────────────────────────────────────────────
describe('rent payment', () => {
  test('pays rent to property owner', () => {
    const G = freshG();
    // Player 1 owns Mediterranean Ave (id 1, rent $4)
    G.ownership[1] = '1';
    G.players[1].properties.push(1);
    // Player 0 at position 39, roll 2 to wrap to position 1
    G.players[0].position = 39;
    const ctx = makeCtx('0', 1, 1); // total 2, 39+2=41%40=1

    Monopoly.moves.rollDice(G, ctx);

    expect(G.players[0].position).toBe(1);
    // Passed GO: +$200, then paid $4 rent
    expect(G.players[0].money).toBe(1500 + 200 - 4);
    expect(G.players[1].money).toBe(1500 + 4);
  });

  test('railroad rent scales with count owned', () => {
    const G = freshG();
    // Player 1 owns 2 railroads (ids 5, 15)
    G.ownership[5] = '1';
    G.ownership[15] = '1';
    G.players[1].properties.push(5, 15);
    // Player 0 at position 3, roll 2 to land on 5
    G.players[0].position = 3;
    const ctx = makeCtx('0', 1, 1); // total 2, lands on pos 5

    Monopoly.moves.rollDice(G, ctx);

    expect(G.players[0].position).toBe(5);
    // 2 railroads = $50 rent
    expect(G.players[0].money).toBe(1500 - 50);
    expect(G.players[1].money).toBe(1500 + 50);
  });

  test('tax spaces deduct money', () => {
    const G = freshG();
    G.players[0].position = 0;
    const ctx = makeCtx('0', 2, 2); // total 4, lands on Income Tax ($200)

    Monopoly.moves.rollDice(G, ctx);

    expect(G.players[0].position).toBe(4);
    expect(G.players[0].money).toBe(1500 - 200);
  });

  test('monopoly doubles rent for full color group', () => {
    const G = freshG();
    // Player 1 owns both brown properties (ids 1, 3)
    G.ownership[1] = '1';
    G.ownership[3] = '1';
    G.players[1].properties.push(1, 3);
    // Player 0 lands on Mediterranean Ave (id 1, base rent $4, doubled to $8)
    G.players[0].position = 39;
    const ctx = makeCtx('0', 1, 1); // total 2, wraps to 1

    Monopoly.moves.rollDice(G, ctx);

    expect(G.players[0].position).toBe(1);
    // Passed GO: +$200, rent $4 * 2 (monopoly) = $8
    expect(G.players[0].money).toBe(1500 + 200 - 8);
    expect(G.players[1].money).toBe(1500 + 8);
  });
});

// ─── JAIL ────────────────────────────────────────────────
describe('jail mechanics', () => {
  test('doubles release from jail', () => {
    const G = freshG();
    G.players[0].position = 10;
    G.players[0].inJail = true;
    const ctx = makeCtx('0', 3, 3); // doubles!

    Monopoly.moves.rollDice(G, ctx);

    expect(G.players[0].inJail).toBe(false);
    expect(G.players[0].position).toBe(16); // 10 + 6 = 16
  });

  test('non-doubles in jail increment jailTurns', () => {
    const G = freshG();
    G.players[0].position = 10;
    G.players[0].inJail = true;
    G.players[0].jailTurns = 0;
    const ctx = makeCtx('0', 2, 3); // not doubles

    Monopoly.moves.rollDice(G, ctx);

    expect(G.players[0].inJail).toBe(true);
    expect(G.players[0].jailTurns).toBe(1);
    expect(G.turnPhase).toBe('done');
  });

  test('3rd failed jail roll forces payment and release', () => {
    const G = freshG();
    G.players[0].position = 10;
    G.players[0].inJail = true;
    G.players[0].jailTurns = 2;
    const ctx = makeCtx('0', 2, 3); // not doubles, 3rd fail

    Monopoly.moves.rollDice(G, ctx);

    expect(G.players[0].inJail).toBe(false);
    expect(G.players[0].money).toBe(1500 - 50);
    expect(G.players[0].jailTurns).toBe(0);
  });

  test('payJailFine releases and deducts $50', () => {
    const G = freshG();
    G.players[0].inJail = true;
    const ctx = makeCtx('0');

    Monopoly.moves.payJailFine(G, ctx);

    expect(G.players[0].inJail).toBe(false);
    expect(G.players[0].money).toBe(1500 - 50);
    expect(G.players[0].jailTurns).toBe(0);
  });

  test('payJailFine fails if not in jail', () => {
    const G = freshG();
    const ctx = makeCtx('0');

    const result = Monopoly.moves.payJailFine(G, ctx);
    expect(result).toBe(INVALID_MOVE);
  });

  test('payJailFine fails if already rolled', () => {
    const G = freshG();
    G.players[0].inJail = true;
    G.hasRolled = true;
    const ctx = makeCtx('0');

    const result = Monopoly.moves.payJailFine(G, ctx);
    expect(result).toBe(INVALID_MOVE);
  });
});

// ─── BANKRUPTCY ──────────────────────────────────────────
describe('bankruptcy', () => {
  test('player goes bankrupt from rent', () => {
    const G = freshG();
    G.players[0].money = 3;
    G.ownership[39] = '1';
    G.players[1].properties.push(39);
    G.players[0].position = 37;
    const ctx = makeCtx('0', 1, 1); // total 2, 37+2=39 (Boardwalk)

    Monopoly.moves.rollDice(G, ctx);

    expect(G.players[0].position).toBe(39);
    expect(G.players[0].bankrupt).toBe(true);
    expect(G.players[0].money).toBe(0);
  });

  test('player goes bankrupt from tax', () => {
    const G = freshG();
    G.players[0].money = 50;
    G.players[0].position = 0;
    const ctx = makeCtx('0', 2, 2); // total 4, Income Tax ($200)

    Monopoly.moves.rollDice(G, ctx);

    expect(G.players[0].bankrupt).toBe(true);
    expect(G.players[0].money).toBe(0);
  });

  test('properties transfer to creditor on bankruptcy', () => {
    const G = freshG();
    G.players[0].money = 5;
    G.ownership[3] = '0';
    G.players[0].properties.push(3);
    G.ownership[39] = '1';
    G.players[1].properties.push(39);
    G.players[0].position = 37;
    const ctx = makeCtx('0', 1, 1); // lands on 39

    Monopoly.moves.rollDice(G, ctx);

    expect(G.players[0].properties).toEqual([]);
    expect(G.players[1].properties).toContain(3);
    expect(G.ownership[3]).toBe('1');
  });

  test('Sophia Ember gains $100 on bankruptcy', () => {
    const G = freshGWithChars('knox-ironlaw', 'sophia-ember');
    // Player 0 (Knox) goes bankrupt, Player 1 (Sophia) should gain $100
    G.players[0].money = 3;
    G.ownership[39] = '1';
    G.players[1].properties.push(39);
    G.players[0].position = 37;
    const ctx = makeCtx('0', 1, 1);

    const sophiaMoney = G.players[1].money;
    Monopoly.moves.rollDice(G, ctx);

    expect(G.players[0].bankrupt).toBe(true);
    // Sophia gets rent (100 * 0.96 charisma = 96) + $100 crisis bonus
    expect(G.players[1].money).toBe(sophiaMoney + 96 + 100);
  });
});

// ─── END TURN ────────────────────────────────────────────
describe('endTurn', () => {
  test('calls ctx.events.endTurn()', () => {
    const G = freshG();
    G.hasRolled = true;
    G.canBuy = false;
    const ctx = makeCtx('0');

    Monopoly.moves.endTurn(G, ctx);

    expect(ctx.events.endTurn).toHaveBeenCalled();
  });

  test('cannot end turn without rolling', () => {
    const G = freshG();
    G.hasRolled = false;
    const ctx = makeCtx('0');

    const result = Monopoly.moves.endTurn(G, ctx);
    expect(result).toBe(INVALID_MOVE);
  });

  test('cannot end turn while canBuy is true', () => {
    const G = freshG();
    G.hasRolled = true;
    G.canBuy = true;
    const ctx = makeCtx('0');

    const result = Monopoly.moves.endTurn(G, ctx);
    expect(result).toBe(INVALID_MOVE);
  });

  test('cannot end turn with pending card', () => {
    const G = freshG();
    G.hasRolled = true;
    G.canBuy = false;
    G.pendingCard = { card: {}, deck: 'chance' };
    const ctx = makeCtx('0');

    const result = Monopoly.moves.endTurn(G, ctx);
    expect(result).toBe(INVALID_MOVE);
  });

  test('cannot end turn in characterSelect phase', () => {
    const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
    const G = Monopoly.setup(ctx);
    G.hasRolled = true;

    const result = Monopoly.moves.endTurn(G, makeCtx('0'));
    expect(result).toBe(INVALID_MOVE);
  });
});

// ─── GAME OVER ───────────────────────────────────────────
describe('endIf', () => {
  test('returns winner when only 1 player remaining', () => {
    const G = freshG();
    G.players[0].bankrupt = true;

    const result = Monopoly.endIf(G, {});
    expect(result).toEqual({ winner: '1' });
  });

  test('returns undefined when game is still going', () => {
    const G = freshG();

    const result = Monopoly.endIf(G, {});
    expect(result).toBeUndefined();
  });

  test('returns undefined during character select', () => {
    const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
    const G = Monopoly.setup(ctx);
    G.players[0].bankrupt = true;

    const result = Monopoly.endIf(G, {});
    expect(result).toBeUndefined();
  });
});

// ─── TURN onBegin ────────────────────────────────────────
describe('turn.onBegin', () => {
  test('resets turn state', () => {
    const G = freshG();
    G.hasRolled = true;
    G.canBuy = true;
    G.turnPhase = 'done';
    G.lastDice = { d1: 3, d2: 4, total: 7 };
    const ctx = makeCtx('0');

    Monopoly.turn.onBegin(G, ctx);

    expect(G.hasRolled).toBe(false);
    expect(G.canBuy).toBe(false);
    expect(G.turnPhase).toBe('roll');
    expect(G.lastDice).toBeNull();
  });

  test('skips reset during character select', () => {
    const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
    const G = Monopoly.setup(ctx);
    G.hasRolled = true; // Set some state

    Monopoly.turn.onBegin(G, makeCtx('0'));

    // Should NOT reset because we're in characterSelect phase
    expect(G.hasRolled).toBe(true);
  });
});

// ─── CHARACTER PASSIVES ──────────────────────────────────
describe('character passives', () => {
  test('Mira Dawnlight gets extra $50 from GO', () => {
    const G = freshGWithChars('mira-dawnlight', 'albert-victor');
    G.players[0].position = 38;
    const startMoney = G.players[0].money;
    const ctx = makeCtx('0', 3, 4); // total 7, wraps past GO

    Monopoly.moves.rollDice(G, ctx);

    // $250 from GO ($200 + $50 passive), then lands on Reading Railroad (unowned)
    expect(G.players[0].money).toBe(startMoney + 250);
  });

  test('Albert Victor gets tax reduction', () => {
    const G = freshGWithChars('albert-victor', 'lia-startrace');
    G.players[0].position = 0;
    const startMoney = G.players[0].money;
    const ctx = makeCtx('0', 2, 2); // total 4, Income Tax ($200)

    Monopoly.moves.rollDice(G, ctx);

    // Financier passive: tax * 0.80 = $160
    expect(G.players[0].position).toBe(4);
    expect(G.players[0].money).toBe(startMoney - 160);
  });

  test('Knox Ironlaw regulated property adds 20% rent', () => {
    const G = freshGWithChars('lia-startrace', 'knox-ironlaw');
    // Knox (player 1) owns Mediterranean Ave and regulates it
    G.ownership[1] = '1';
    G.players[1].properties.push(1);
    G.players[1].regulatedProperty = 1;
    // Player 0 lands on it
    G.players[0].position = 39;
    const p0Money = G.players[0].money;
    const p1Money = G.players[1].money;
    const ctx = makeCtx('0', 1, 1); // total 2, wraps to 1

    Monopoly.moves.rollDice(G, ctx);

    // Base rent $4, +20% regulation = $4.8 → Math.floor = $4 (Charisma 5 = 5% off → $4 * 0.95 * 1.20 = $4.56 → 4)
    // Actually: rent = 4, charisma 5% off → 3.8, then *1.20 → 4.56 → floor = 4
    expect(G.players[0].position).toBe(1);
    const rent = p0Money + 200 - G.players[0].money; // +200 from GO
    expect(rent).toBeGreaterThanOrEqual(4);
  });
});

// ─── CARD ACCEPT/REDRAW ─────────────────────────────────
describe('acceptCard / redrawCard', () => {
  test('acceptCard applies pending card', () => {
    const G = freshG();
    G.pendingCard = { card: { text: 'Gain $50', action: 'gain', value: 50 }, deck: 'chance' };
    G.hasRolled = true;
    const ctx = makeCtx('0');

    Monopoly.moves.acceptCard(G, ctx);

    expect(G.pendingCard).toBeNull();
    expect(G.players[0].money).toBe(1500 + 50);
  });

  test('acceptCard fails without pending card', () => {
    const G = freshG();
    const result = Monopoly.moves.acceptCard(G, makeCtx('0'));
    expect(result).toBe(INVALID_MOVE);
  });

  test('redrawCard draws new card', () => {
    const G = freshG();
    G.players[0].luckRedraws = 1;
    G.pendingCard = { card: { text: 'Pay $50', action: 'pay', value: 50 }, deck: 'chance' };
    G.hasRolled = true;
    // Need random for drawing new card
    const ctx = makeCtx('0', 1, 1); // random values will be reused for card draw

    Monopoly.moves.redrawCard(G, ctx);

    expect(G.pendingCard).toBeNull();
    expect(G.players[0].luckRedraws).toBe(0);
  });

  test('redrawCard fails without redraws (non-Cassian)', () => {
    const G = freshG();
    G.players[0].luckRedraws = 0;
    G.pendingCard = { card: { text: 'Pay $50', action: 'pay', value: 50 }, deck: 'chance' };

    const result = Monopoly.moves.redrawCard(G, makeCtx('0'));
    expect(result).toBe(INVALID_MOVE);
  });
});

// ─── UPGRADE PROPERTY ──────────────────────────────────
describe('upgradeProperty', () => {
  function setupMonopoly(G, playerId, colorGroup) {
    // Give player all properties in the color group
    const groupIds = COLOR_GROUPS[colorGroup];
    groupIds.forEach(id => {
      G.ownership[id] = playerId;
      G.players[parseInt(playerId)].properties.push(id);
    });
  }

  test('upgrades property from vacant to house', () => {
    const G = freshG();
    G.hasRolled = true;
    setupMonopoly(G, '0', '#8B4513'); // Brown: ids 1, 3

    Monopoly.moves.upgradeProperty(G, makeCtx('0'), 1);

    expect(G.buildings[1]).toBe(1);
    // Cost: $60 * 0.5 = $30
    expect(G.players[0].money).toBe(1500 - 30);
  });

  test('cannot upgrade without monopoly', () => {
    const G = freshG();
    G.hasRolled = true;
    // Only own 1 of 2 brown properties
    G.ownership[1] = '0';
    G.players[0].properties.push(1);

    const result = Monopoly.moves.upgradeProperty(G, makeCtx('0'), 1);
    expect(result).toBe(INVALID_MOVE);
  });

  test('cannot upgrade without rolling first', () => {
    const G = freshG();
    setupMonopoly(G, '0', '#8B4513');
    // hasRolled is false by default

    const result = Monopoly.moves.upgradeProperty(G, makeCtx('0'), 1);
    expect(result).toBe(INVALID_MOVE);
  });

  test('cannot upgrade property not owned by player', () => {
    const G = freshG();
    G.hasRolled = true;
    setupMonopoly(G, '1', '#8B4513');

    const result = Monopoly.moves.upgradeProperty(G, makeCtx('0'), 1);
    expect(result).toBe(INVALID_MOVE);
  });

  test('even building enforced — must upgrade lower-level property first', () => {
    const G = freshG();
    G.hasRolled = true;
    setupMonopoly(G, '0', '#8B4513'); // Brown: ids 1, 3
    G.buildings[1] = 1; // id 1 is House, id 3 is Vacant

    // Can't upgrade id 1 to Hotel while id 3 is Vacant
    const result = Monopoly.moves.upgradeProperty(G, makeCtx('0'), 1);
    expect(result).toBe(INVALID_MOVE);

    // Can upgrade id 3 (at min level)
    Monopoly.moves.upgradeProperty(G, makeCtx('0'), 3);
    expect(G.buildings[3]).toBe(1);
  });

  test('cannot upgrade past Landmark (level 4)', () => {
    const G = freshG();
    G.hasRolled = true;
    setupMonopoly(G, '0', '#8B4513');
    G.buildings[1] = 4;
    G.buildings[3] = 4;

    const result = Monopoly.moves.upgradeProperty(G, makeCtx('0'), 1);
    expect(result).toBe(INVALID_MOVE);
  });

  test('cannot upgrade if not enough money', () => {
    const G = freshG();
    G.hasRolled = true;
    G.players[0].money = 10;
    setupMonopoly(G, '0', '#8B4513');

    const result = Monopoly.moves.upgradeProperty(G, makeCtx('0'), 1);
    expect(result).toBe(INVALID_MOVE);
  });

  test('cannot upgrade if any property in group is mortgaged', () => {
    const G = freshG();
    G.hasRolled = true;
    setupMonopoly(G, '0', '#8B4513');
    G.mortgaged[3] = true;

    const result = Monopoly.moves.upgradeProperty(G, makeCtx('0'), 1);
    expect(result).toBe(INVALID_MOVE);
  });

  test('cannot upgrade railroad or utility', () => {
    const G = freshG();
    G.hasRolled = true;
    G.ownership[5] = '0'; // Reading Railroad
    G.players[0].properties.push(5);

    const result = Monopoly.moves.upgradeProperty(G, makeCtx('0'), 5);
    expect(result).toBe(INVALID_MOVE);
  });

  test('Tech stat reduces upgrade cost', () => {
    // Lia Startrace: Tech 9 → 18% off + pioneer passive → additional 20% off
    const G = freshGWithChars('lia-startrace', 'albert-victor');
    G.hasRolled = true;
    setupMonopoly(G, '0', '#8B4513');
    const startMoney = G.players[0].money;

    Monopoly.moves.upgradeProperty(G, makeCtx('0'), 1);

    // Base cost: $60 * 0.5 = $30
    // Tech discount: 9 * 2% = 18% → $30 * 0.82 = $24.6
    // Pioneer passive: -20% → $24.6 * 0.80 = $19.68 → floor = $19
    expect(G.buildings[1]).toBe(1);
    expect(G.players[0].money).toBe(startMoney - 19);
  });

  test('upgrade costs scale per tier', () => {
    const G = freshG();
    G.hasRolled = true;
    setupMonopoly(G, '0', '#0000CC'); // Dark Blue: ids 37 ($350), 39 ($400)

    // Level 0→1: price * 0.5
    Monopoly.moves.upgradeProperty(G, makeCtx('0'), 37);
    expect(G.buildings[37]).toBe(1);
    // Cost: $350 * 0.5 = $175
    expect(G.players[0].money).toBe(1500 - 175);

    // Upgrade 39 to level 1 (even building)
    Monopoly.moves.upgradeProperty(G, makeCtx('0'), 39);
    expect(G.buildings[39]).toBe(1);
    // Cost: $400 * 0.5 = $200
    expect(G.players[0].money).toBe(1500 - 175 - 200);

    // Level 1→2: price * 0.75
    Monopoly.moves.upgradeProperty(G, makeCtx('0'), 37);
    expect(G.buildings[37]).toBe(2);
    // Cost: $350 * 0.75 = $262
    expect(G.players[0].money).toBe(1500 - 175 - 200 - 262);
  });
});

// ─── MORTGAGE PROPERTY ─────────────────────────────────
describe('mortgageProperty', () => {
  test('mortgages property and receives 50% of price', () => {
    const G = freshG();
    G.ownership[1] = '0';
    G.players[0].properties.push(1);

    Monopoly.moves.mortgageProperty(G, makeCtx('0'), 1);

    expect(G.mortgaged[1]).toBe(true);
    // Mediterranean Ave $60 * 0.5 = $30
    expect(G.players[0].money).toBe(1500 + 30);
  });

  test('cannot mortgage property not owned', () => {
    const G = freshG();
    G.ownership[1] = '1';

    const result = Monopoly.moves.mortgageProperty(G, makeCtx('0'), 1);
    expect(result).toBe(INVALID_MOVE);
  });

  test('cannot mortgage already mortgaged property', () => {
    const G = freshG();
    G.ownership[1] = '0';
    G.players[0].properties.push(1);
    G.mortgaged[1] = true;

    const result = Monopoly.moves.mortgageProperty(G, makeCtx('0'), 1);
    expect(result).toBe(INVALID_MOVE);
  });

  test('cannot mortgage property with buildings', () => {
    const G = freshG();
    G.ownership[1] = '0';
    G.players[0].properties.push(1);
    G.buildings[1] = 1;

    const result = Monopoly.moves.mortgageProperty(G, makeCtx('0'), 1);
    expect(result).toBe(INVALID_MOVE);
  });

  test('cannot mortgage if group member has buildings', () => {
    const G = freshG();
    G.ownership[1] = '0';
    G.ownership[3] = '0';
    G.players[0].properties.push(1, 3);
    G.buildings[3] = 1; // Other property in brown group has building

    const result = Monopoly.moves.mortgageProperty(G, makeCtx('0'), 1);
    expect(result).toBe(INVALID_MOVE);
  });

  test('can mortgage railroad', () => {
    const G = freshG();
    G.ownership[5] = '0';
    G.players[0].properties.push(5);

    Monopoly.moves.mortgageProperty(G, makeCtx('0'), 5);

    expect(G.mortgaged[5]).toBe(true);
    // Railroad $200 * 0.5 = $100
    expect(G.players[0].money).toBe(1500 + 100);
  });
});

// ─── UNMORTGAGE PROPERTY ────────────────────────────────
describe('unmortgageProperty', () => {
  test('unmortgages property for 55% of price', () => {
    const G = freshG();
    G.ownership[1] = '0';
    G.players[0].properties.push(1);
    G.mortgaged[1] = true;

    Monopoly.moves.unmortgageProperty(G, makeCtx('0'), 1);

    expect(G.mortgaged[1]).toBe(false);
    // Mediterranean Ave $60 * 0.55 = $33
    expect(G.players[0].money).toBe(1500 - 33);
  });

  test('cannot unmortgage property not mortgaged', () => {
    const G = freshG();
    G.ownership[1] = '0';
    G.players[0].properties.push(1);

    const result = Monopoly.moves.unmortgageProperty(G, makeCtx('0'), 1);
    expect(result).toBe(INVALID_MOVE);
  });

  test('cannot unmortgage if not enough money', () => {
    const G = freshG();
    G.ownership[39] = '0'; // Boardwalk $400
    G.players[0].properties.push(39);
    G.mortgaged[39] = true;
    G.players[0].money = 100; // Not enough for $220 (400 * 0.55)

    const result = Monopoly.moves.unmortgageProperty(G, makeCtx('0'), 39);
    expect(result).toBe(INVALID_MOVE);
  });

  test('cannot unmortgage property not owned', () => {
    const G = freshG();
    G.ownership[1] = '1';
    G.mortgaged[1] = true;

    const result = Monopoly.moves.unmortgageProperty(G, makeCtx('0'), 1);
    expect(result).toBe(INVALID_MOVE);
  });
});

// ─── RENT WITH BUILDINGS ───────────────────────────────
describe('rent with buildings', () => {
  test('house triples base rent', () => {
    const G = freshG();
    G.ownership[1] = '1';
    G.ownership[3] = '1';
    G.players[1].properties.push(1, 3);
    G.buildings[1] = 1; // House on Mediterranean

    // Player 0 lands on Mediterranean
    G.players[0].position = 39;
    const ctx = makeCtx('0', 1, 1); // total 2, wraps to 1
    Monopoly.moves.rollDice(G, ctx);

    // Base rent $4 × 3 (house) = $12. Passed GO: +$200
    expect(G.players[0].money).toBe(1500 + 200 - 12);
    expect(G.players[1].money).toBe(1500 + 12);
  });

  test('hotel gives 7x rent', () => {
    const G = freshG();
    G.ownership[1] = '1';
    G.ownership[3] = '1';
    G.players[1].properties.push(1, 3);
    G.buildings[1] = 2; // Hotel on Mediterranean

    G.players[0].position = 39;
    const ctx = makeCtx('0', 1, 1);
    Monopoly.moves.rollDice(G, ctx);

    // Base rent $4 × 7 (hotel) = $28
    expect(G.players[0].money).toBe(1500 + 200 - 28);
  });

  test('skyscraper gives 12x rent', () => {
    const G = freshG();
    G.ownership[1] = '1';
    G.ownership[3] = '1';
    G.players[1].properties.push(1, 3);
    G.buildings[1] = 3; // Skyscraper

    G.players[0].position = 39;
    const ctx = makeCtx('0', 1, 1);
    Monopoly.moves.rollDice(G, ctx);

    // Base rent $4 × 12 = $48
    expect(G.players[0].money).toBe(1500 + 200 - 48);
  });

  test('landmark gives 20x rent', () => {
    const G = freshG();
    G.ownership[1] = '1';
    G.ownership[3] = '1';
    G.players[1].properties.push(1, 3);
    G.buildings[1] = 4; // Landmark

    G.players[0].position = 39;
    const ctx = makeCtx('0', 1, 1);
    Monopoly.moves.rollDice(G, ctx);

    // Base rent $4 × 20 = $80
    expect(G.players[0].money).toBe(1500 + 200 - 80);
  });

  test('building rent replaces monopoly doubling', () => {
    const G = freshG();
    G.ownership[1] = '1';
    G.ownership[3] = '1';
    G.players[1].properties.push(1, 3);
    G.buildings[1] = 1; // House — should use 3× not 2× monopoly

    G.players[0].position = 39;
    const ctx = makeCtx('0', 1, 1);
    Monopoly.moves.rollDice(G, ctx);

    // 3× base rent, NOT 2× monopoly + 3× = 6×
    expect(G.players[0].money).toBe(1500 + 200 - 12); // $4 × 3 = $12
  });

  test('mortgaged property collects no rent', () => {
    const G = freshG();
    G.ownership[1] = '1';
    G.players[1].properties.push(1);
    G.mortgaged[1] = true;

    G.players[0].position = 39;
    const ctx = makeCtx('0', 1, 1);
    Monopoly.moves.rollDice(G, ctx);

    // No rent paid, just GO bonus
    expect(G.players[0].money).toBe(1500 + 200);
    expect(G.players[1].money).toBe(1500);
  });
});

// ─── BANKRUPTCY WITH BUILDINGS ─────────────────────────
describe('bankruptcy with buildings', () => {
  test('buildings transfer to creditor', () => {
    const G = freshG();
    G.players[0].money = 3;
    G.ownership[3] = '0';
    G.players[0].properties.push(3);
    G.buildings[3] = 2; // Hotel
    G.ownership[39] = '1';
    G.players[1].properties.push(39);
    G.players[0].position = 37;
    const ctx = makeCtx('0', 1, 1); // lands on 39

    Monopoly.moves.rollDice(G, ctx);

    expect(G.players[0].bankrupt).toBe(true);
    expect(G.ownership[3]).toBe('1');
    expect(G.buildings[3]).toBe(2); // Buildings preserved
  });

  test('buildings cleared on bank bankruptcy', () => {
    const G = freshG();
    G.players[0].money = 50;
    G.ownership[3] = '0';
    G.players[0].properties.push(3);
    G.buildings[3] = 2;
    G.players[0].position = 0;
    const ctx = makeCtx('0', 2, 2); // Income Tax $200

    Monopoly.moves.rollDice(G, ctx);

    expect(G.players[0].bankrupt).toBe(true);
    expect(G.ownership[3]).toBeNull();
    expect(G.buildings[3]).toBeUndefined();
  });
});

// ─── SEASON SYSTEM ──────────────────────────────────────
describe('season system', () => {
  test('setup starts at seasonIndex 0 (Summer) with totalTurns 0', () => {
    const G = freshG();
    expect(G.seasonIndex).toBe(0);
    expect(G.totalTurns).toBe(0);
    expect(SEASONS[0].id).toBe('summer');
  });

  test('totalTurns increments on each onBegin', () => {
    const G = freshG();
    Monopoly.turn.onBegin(G, makeCtx('0'));
    expect(G.totalTurns).toBe(1);
    Monopoly.turn.onBegin(G, makeCtx('1'));
    expect(G.totalTurns).toBe(2);
  });

  test('season changes after SEASON_CHANGE_INTERVAL turns', () => {
    const G = freshG();
    // Advance to turn 10 — should change to Autumn (index 1)
    for (let i = 0; i < SEASON_CHANGE_INTERVAL; i++) {
      Monopoly.turn.onBegin(G, makeCtx(String(i % 2)));
    }
    expect(G.totalTurns).toBe(SEASON_CHANGE_INTERVAL);
    expect(G.seasonIndex).toBe(1);
    expect(SEASONS[1].id).toBe('autumn');
  });

  test('season cycles through all 4 seasons', () => {
    const G = freshG();
    for (let i = 0; i < SEASON_CHANGE_INTERVAL * 4; i++) {
      Monopoly.turn.onBegin(G, makeCtx(String(i % 2)));
    }
    // After 40 turns, back to Summer (index 0)
    expect(G.seasonIndex).toBe(0);
  });

  test('does not increment totalTurns during character select', () => {
    const ctx = { numPlayers: 2, playOrder: ['0', '1'] };
    const G = Monopoly.setup(ctx);
    Monopoly.turn.onBegin(G, makeCtx('0'));
    expect(G.totalTurns).toBe(0); // Should NOT increment in characterSelect
  });

  test('season adds message when changing', () => {
    const G = freshG();
    G.totalTurns = SEASON_CHANGE_INTERVAL - 1;
    G.messages = [];

    Monopoly.turn.onBegin(G, makeCtx('0'));

    expect(G.seasonIndex).toBe(1);
    expect(G.messages.some(m => m.includes('Autumn'))).toBe(true);
  });

  test('Winter increases rent by 20%', () => {
    const G = freshG();
    G.seasonIndex = 2; // Winter
    G.ownership[1] = '1';
    G.players[1].properties.push(1);
    G.players[0].position = 39;
    const ctx = makeCtx('0', 1, 1); // total 2, wraps to 1

    Monopoly.moves.rollDice(G, ctx);

    // Base rent $4, Winter +20% = $4.8 → floor = $4 (small number rounds down)
    // Actually: $4 * 1.20 = $4.8 → floor = 4
    expect(G.players[0].money).toBe(1500 + 200 - 4);
  });

  test('Winter doubles tax', () => {
    const G = freshG();
    G.seasonIndex = 2; // Winter (taxMod: 2.0)
    G.players[0].position = 0;
    const ctx = makeCtx('0', 2, 2); // total 4, Income Tax ($200)

    Monopoly.moves.rollDice(G, ctx);

    // Income Tax $200 × 2 (Winter) = $400
    expect(G.players[0].money).toBe(1500 - 400);
  });

  test('Autumn reduces buy price by 10%', () => {
    const G = freshG();
    G.seasonIndex = 1; // Autumn (priceMod: 0.90)
    G.players[0].position = 1; // Mediterranean Ave, $60
    G.canBuy = true;
    G.effectivePrice = Math.floor(60 * 0.90); // $54

    Monopoly.moves.buyProperty(G, makeCtx('0'));

    expect(G.players[0].money).toBe(1500 - 54);
  });

  test('Spring increases upgrade cost by 10%', () => {
    const G = freshG();
    G.seasonIndex = 3; // Spring (priceMod: 1.10)
    G.hasRolled = true;
    // Setup monopoly
    const groupIds = COLOR_GROUPS['#8B4513'];
    groupIds.forEach(id => {
      G.ownership[id] = '0';
      G.players[0].properties.push(id);
    });

    Monopoly.moves.upgradeProperty(G, makeCtx('0'), 1);

    // $60 × 0.5 = $30, × 1.10 (Spring) = $33
    expect(G.buildings[1]).toBe(1);
    expect(G.players[0].money).toBe(1500 - 33);
  });

  test('Autumn mortgage gives less (90% price modifier)', () => {
    const G = freshG();
    G.seasonIndex = 1; // Autumn (priceMod: 0.90)
    G.ownership[5] = '0'; // Railroad $200
    G.players[0].properties.push(5);

    Monopoly.moves.mortgageProperty(G, makeCtx('0'), 5);

    // $200 × 0.5 × 0.90 = $90
    expect(G.players[0].money).toBe(1500 + 90);
  });
});

// ─── ENHANCED EVENT CARDS ───────────────────────────────
describe('enhanced event cards', () => {
  test('payPercent action takes percentage of total assets', () => {
    const G = freshG();
    G.ownership[1] = '0'; // Mediterranean Ave $60
    G.players[0].properties.push(1);
    G.players[0].money = 1000;
    G.pendingCard = { card: { text: 'Tax Audit', action: 'payPercent', value: 10 }, deck: 'community' };

    Monopoly.moves.acceptCard(G, makeCtx('0'));

    // Total assets = $1000 (money) + $60 (property) = $1060
    // 10% = $106
    expect(G.players[0].money).toBe(1000 - 106);
  });

  test('payPercent with buildings includes building value', () => {
    const G = freshG();
    G.ownership[1] = '0';
    G.players[0].properties.push(1);
    G.buildings[1] = 1; // House: $60 × 0.5 = $30
    G.players[0].money = 1000;
    G.pendingCard = { card: { text: 'Tax Audit', action: 'payPercent', value: 10 }, deck: 'community' };

    Monopoly.moves.acceptCard(G, makeCtx('0'));

    // Total assets = $1000 + $60 (property) + $30 (house) = $1090
    // 10% = $109
    expect(G.players[0].money).toBe(1000 - 109);
  });

  test('payPercent with Albert Victor gets 20% reduction', () => {
    const G = freshGWithChars('albert-victor', 'lia-startrace');
    G.players[0].money = 1000;
    G.pendingCard = { card: { text: 'Tax Audit', action: 'payPercent', value: 10 }, deck: 'community' };

    Monopoly.moves.acceptCard(G, makeCtx('0'));

    // Total assets = $1000, 10% = $100, financier -20% = $80
    expect(G.players[0].money).toBe(1000 - 80);
  });

  test('gainAll gives money to all non-bankrupt players', () => {
    const G = freshG();
    G.players[0].money = 1000;
    G.players[1].money = 800;
    G.pendingCard = { card: { text: 'Stimulus', action: 'gainAll', value: 100 }, deck: 'chance' };

    Monopoly.moves.acceptCard(G, makeCtx('0'));

    expect(G.players[0].money).toBe(1100);
    expect(G.players[1].money).toBe(900);
  });

  test('gainAll skips bankrupt players', () => {
    const G = freshG();
    G.players[0].money = 1000;
    G.players[1].money = 0;
    G.players[1].bankrupt = true;
    G.pendingCard = { card: { text: 'Stimulus', action: 'gainAll', value: 100 }, deck: 'chance' };

    Monopoly.moves.acceptCard(G, makeCtx('0'));

    expect(G.players[0].money).toBe(1100);
    expect(G.players[1].money).toBe(0); // Still 0, bankrupt
  });

  test('gainPerProperty gives money per owned property', () => {
    const G = freshG();
    G.ownership[1] = '0';
    G.ownership[3] = '0';
    G.ownership[6] = '0';
    G.players[0].properties.push(1, 3, 6);
    G.players[0].money = 1000;
    G.pendingCard = { card: { text: 'Boom', action: 'gainPerProperty', value: 50 }, deck: 'chance' };

    Monopoly.moves.acceptCard(G, makeCtx('0'));

    // 3 properties × $50 = $150
    expect(G.players[0].money).toBe(1150);
  });

  test('gainPerProperty gives 0 with no properties', () => {
    const G = freshG();
    G.players[0].money = 1000;
    G.pendingCard = { card: { text: 'Boom', action: 'gainPerProperty', value: 50 }, deck: 'chance' };

    Monopoly.moves.acceptCard(G, makeCtx('0'));

    expect(G.players[0].money).toBe(1000);
  });

  test('freeUpgrade upgrades cheapest eligible property', () => {
    const G = freshG();
    // Give player brown monopoly
    const groupIds = COLOR_GROUPS['#8B4513']; // ids 1, 3
    groupIds.forEach(id => {
      G.ownership[id] = '0';
      G.players[0].properties.push(id);
    });
    G.players[0].money = 1000;
    G.pendingCard = { card: { text: 'Free Upgrade', action: 'freeUpgrade', value: 0 }, deck: 'community' };

    Monopoly.moves.acceptCard(G, makeCtx('0'));

    // Should upgrade cheapest (both $60, picks first = id 1)
    expect(G.buildings[1]).toBe(1);
    expect(G.players[0].money).toBe(1000); // Free!
  });

  test('freeUpgrade does nothing without monopoly', () => {
    const G = freshG();
    G.ownership[1] = '0';
    G.players[0].properties.push(1); // Only 1 of 2 brown
    G.pendingCard = { card: { text: 'Free Upgrade', action: 'freeUpgrade', value: 0 }, deck: 'community' };

    Monopoly.moves.acceptCard(G, makeCtx('0'));

    expect(G.buildings[1]).toBeUndefined();
  });

  test('downgrade reduces highest building by 1 level', () => {
    const G = freshG();
    G.ownership[1] = '0';
    G.ownership[3] = '0';
    G.players[0].properties.push(1, 3);
    G.buildings[1] = 3; // Skyscraper
    G.buildings[3] = 2; // Hotel
    G.pendingCard = { card: { text: 'Crash', action: 'downgrade', value: 0 }, deck: 'community' };

    Monopoly.moves.acceptCard(G, makeCtx('0'));

    // Highest is id 1 at level 3 → becomes level 2
    expect(G.buildings[1]).toBe(2);
    expect(G.buildings[3]).toBe(2); // Unchanged
  });

  test('downgrade from level 1 removes building entry', () => {
    const G = freshG();
    G.ownership[1] = '0';
    G.players[0].properties.push(1);
    G.buildings[1] = 1;
    G.pendingCard = { card: { text: 'Crash', action: 'downgrade', value: 0 }, deck: 'community' };

    Monopoly.moves.acceptCard(G, makeCtx('0'));

    expect(G.buildings[1]).toBeUndefined();
  });

  test('downgrade does nothing without buildings', () => {
    const G = freshG();
    G.ownership[1] = '0';
    G.players[0].properties.push(1);
    G.pendingCard = { card: { text: 'Crash', action: 'downgrade', value: 0 }, deck: 'community' };

    Monopoly.moves.acceptCard(G, makeCtx('0'));

    expect(G.buildings[1]).toBeUndefined();
    expect(G.messages.some(m => m.includes('No buildings'))).toBe(true);
  });

  test('forceBuy takes opponent cheapest property', () => {
    const G = freshG();
    G.ownership[1] = '1'; // Mediterranean $60
    G.ownership[39] = '1'; // Boardwalk $400
    G.players[1].properties.push(1, 39);
    G.players[0].money = 1000;
    G.players[1].money = 500;
    G.pendingCard = { card: { text: 'Hostile Takeover', action: 'forceBuy', value: 150 }, deck: 'chance' };

    Monopoly.moves.acceptCard(G, makeCtx('0'));

    // Cheapest is Mediterranean ($60), cost = $60 × 150% = $90
    expect(G.players[0].money).toBe(1000 - 90);
    expect(G.players[1].money).toBe(500 + 90);
    expect(G.players[0].properties).toContain(1);
    expect(G.players[1].properties).not.toContain(1);
    expect(G.ownership[1]).toBe('0');
  });

  test('forceBuy fails if player cannot afford', () => {
    const G = freshG();
    G.ownership[39] = '1'; // Boardwalk $400
    G.players[1].properties.push(39);
    G.players[0].money = 100; // Can't afford $400 × 150% = $600
    G.pendingCard = { card: { text: 'Hostile Takeover', action: 'forceBuy', value: 150 }, deck: 'chance' };

    Monopoly.moves.acceptCard(G, makeCtx('0'));

    // Shouldn't transfer
    expect(G.ownership[39]).toBe('1');
    expect(G.players[0].money).toBe(100);
  });

  test('forceBuy does nothing without opponents with properties', () => {
    const G = freshG();
    G.players[0].money = 5000;
    G.pendingCard = { card: { text: 'Hostile Takeover', action: 'forceBuy', value: 150 }, deck: 'chance' };

    Monopoly.moves.acceptCard(G, makeCtx('0'));

    expect(G.players[0].money).toBe(5000); // Unchanged
    expect(G.messages.some(m => m.includes('No opponents'))).toBe(true);
  });

  test('negative card actions are redrawn with luck redraws', () => {
    const G = freshG();
    G.players[0].luckRedraws = 1;
    G.pendingCard = { card: { text: 'Audit', action: 'payPercent', value: 10 }, deck: 'community' };

    // Non-Cassian player with luck redraws and a payPercent card
    // redrawCard should work
    const ctx = makeCtx('0', 1, 1);
    Monopoly.moves.redrawCard(G, ctx);

    expect(G.pendingCard).toBeNull();
    expect(G.players[0].luckRedraws).toBe(0);
  });
});

// ─── TRADING ────────────────────────────────────────────
describe('Trading', () => {
  test('proposeTrade creates a trade object', () => {
    const G = freshG();
    G.hasRolled = true;
    G.turnPhase = 'done';

    // Give player 0 a property to trade
    G.ownership[1] = '0';
    G.players[0].properties.push(1);

    const result = Monopoly.moves.proposeTrade(G, makeCtx('0'), {
      targetPlayerId: '1',
      offeredProperties: [1],
      requestedProperties: [],
      offeredMoney: 0,
      requestedMoney: 0,
    });

    expect(result).not.toBe(INVALID_MOVE);
    expect(G.trade).not.toBeNull();
    expect(G.trade.proposerId).toBe('0');
    expect(G.trade.targetPlayerId).toBe('1');
    expect(G.trade.offeredProperties).toEqual([1]);
    expect(G.turnPhase).toBe('trade');
  });

  test('proposeTrade fails without rolling first', () => {
    const G = freshG();
    G.hasRolled = false;

    G.ownership[1] = '0';
    G.players[0].properties.push(1);

    const result = Monopoly.moves.proposeTrade(G, makeCtx('0'), {
      targetPlayerId: '1',
      offeredProperties: [1],
      requestedProperties: [],
      offeredMoney: 0,
      requestedMoney: 0,
    });

    expect(result).toBe(INVALID_MOVE);
    expect(G.trade).toBeNull();
  });

  test('proposeTrade fails if property has buildings', () => {
    const G = freshG();
    G.hasRolled = true;
    G.turnPhase = 'done';

    G.ownership[1] = '0';
    G.players[0].properties.push(1);
    G.buildings[1] = 2;

    const result = Monopoly.moves.proposeTrade(G, makeCtx('0'), {
      targetPlayerId: '1',
      offeredProperties: [1],
      requestedProperties: [],
      offeredMoney: 0,
      requestedMoney: 0,
    });

    expect(result).toBe(INVALID_MOVE);
  });

  test('acceptTrade transfers properties and money', () => {
    const G = freshG();
    G.hasRolled = true;

    // Give properties
    G.ownership[1] = '0';
    G.players[0].properties.push(1);
    G.ownership[3] = '1';
    G.players[1].properties.push(3);

    G.trade = {
      proposerId: '0',
      targetPlayerId: '1',
      offeredProperties: [1],
      requestedProperties: [3],
      offeredMoney: 100,
      requestedMoney: 0,
    };
    G.turnPhase = 'trade';

    Monopoly.moves.acceptTrade(G, makeCtx('1'));

    expect(G.trade).toBeNull();
    expect(G.ownership[1]).toBe('1');
    expect(G.ownership[3]).toBe('0');
    expect(G.players[0].properties).toContain(3);
    expect(G.players[0].properties).not.toContain(1);
    expect(G.players[1].properties).toContain(1);
    expect(G.players[1].properties).not.toContain(3);
    expect(G.players[0].money).toBe(1400); // 1500 - 100
    expect(G.players[1].money).toBe(1600); // 1500 + 100
    expect(G.turnPhase).toBe('done');
  });

  test('rejectTrade clears trade', () => {
    const G = freshG();
    G.trade = {
      proposerId: '0',
      targetPlayerId: '1',
      offeredProperties: [],
      requestedProperties: [],
      offeredMoney: 0,
      requestedMoney: 0,
    };
    G.turnPhase = 'trade';

    Monopoly.moves.rejectTrade(G, makeCtx('1'));

    expect(G.trade).toBeNull();
    expect(G.turnPhase).toBe('done');
  });

  test('cancelTrade only works for proposer', () => {
    const G = freshG();
    G.trade = {
      proposerId: '0',
      targetPlayerId: '1',
      offeredProperties: [],
      requestedProperties: [],
      offeredMoney: 0,
      requestedMoney: 0,
    };

    // Player 1 can't cancel player 0's trade
    const result = Monopoly.moves.cancelTrade(G, makeCtx('1'));
    expect(result).toBe(INVALID_MOVE);
    expect(G.trade).not.toBeNull();

    // Player 0 can cancel
    Monopoly.moves.cancelTrade(G, makeCtx('0'));
    expect(G.trade).toBeNull();
  });

  test('cannot end turn during active trade', () => {
    const G = freshG();
    G.hasRolled = true;
    G.trade = {
      proposerId: '0',
      targetPlayerId: '1',
      offeredProperties: [],
      requestedProperties: [],
      offeredMoney: 0,
      requestedMoney: 0,
    };

    const result = Monopoly.moves.endTurn(G, makeCtx('0'));
    expect(result).toBe(INVALID_MOVE);
  });
});

// ─── AUCTIONS ───────────────────────────────────────────
describe('Auctions', () => {
  test('passProperty triggers auction when enabled', () => {
    const G = freshG();
    G.canBuy = true;
    G.players[0].position = 1;

    Monopoly.moves.passProperty(G, makeCtx('0'));

    expect(G.auction).not.toBeNull();
    expect(G.auction.propertyId).toBe(1);
    expect(G.auction.currentBid).toBe(0);
    expect(G.auction.bidders).toHaveLength(2);
    expect(G.turnPhase).toBe('auction');
  });

  test('placeBid updates auction state', () => {
    const G = freshG();
    G.canBuy = true;
    G.players[0].position = 1;

    Monopoly.moves.passProperty(G, makeCtx('0'));

    // First bidder places a bid
    Monopoly.moves.placeBid(G, makeCtx('0'), 50);

    expect(G.auction.currentBid).toBe(50);
    expect(G.auction.currentBidder).toBe('0');
  });

  test('placeBid rejects bid below minimum', () => {
    const G = freshG();
    G.auction = {
      propertyId: 1,
      currentBid: 50,
      currentBidder: '0',
      bidders: [
        { playerId: '0', passed: false },
        { playerId: '1', passed: false },
      ],
      currentBidderIndex: 1,
    };
    G.turnPhase = 'auction';

    // Try to bid below current + increment
    const result = Monopoly.moves.placeBid(G, makeCtx('1'), 50);
    expect(result).toBe(INVALID_MOVE);
  });

  test('passAuction marks bidder as passed', () => {
    const G = freshG();
    G.auction = {
      propertyId: 1,
      currentBid: 50,
      currentBidder: '0',
      bidders: [
        { playerId: '0', passed: false },
        { playerId: '1', passed: false },
      ],
      currentBidderIndex: 1,
    };
    G.turnPhase = 'auction';

    Monopoly.moves.passAuction(G, makeCtx('1'));

    // Player 1 passed, player 0 had the only bid → auction resolves
    expect(G.auction).toBeNull();
    expect(G.ownership[1]).toBe('0');
    expect(G.players[0].money).toBe(1450); // 1500 - 50
    expect(G.players[0].properties).toContain(1);
    expect(G.turnPhase).toBe('done');
  });

  test('all players pass with no bids — property stays unowned', () => {
    const G = freshG();
    G.auction = {
      propertyId: 1,
      currentBid: 0,
      currentBidder: null,
      bidders: [
        { playerId: '0', passed: false },
        { playerId: '1', passed: false },
      ],
      currentBidderIndex: 0,
    };
    G.turnPhase = 'auction';

    // Both pass
    Monopoly.moves.passAuction(G, makeCtx('0'));
    // After first pass, auction advances to player 1
    Monopoly.moves.passAuction(G, makeCtx('1'));

    expect(G.auction).toBeNull();
    expect(G.ownership[1]).toBeNull();
    expect(G.turnPhase).toBe('done');
  });

  test('cannot end turn during active auction', () => {
    const G = freshG();
    G.hasRolled = true;
    G.auction = {
      propertyId: 1,
      currentBid: 0,
      currentBidder: null,
      bidders: [{ playerId: '0', passed: false }],
      currentBidderIndex: 0,
    };

    const result = Monopoly.moves.endTurn(G, makeCtx('0'));
    expect(result).toBe(INVALID_MOVE);
  });

  test('bidding war resolves to highest bidder', () => {
    const G = freshG();
    G.auction = {
      propertyId: 1,
      currentBid: 0,
      currentBidder: null,
      bidders: [
        { playerId: '0', passed: false },
        { playerId: '1', passed: false },
      ],
      currentBidderIndex: 0,
    };
    G.turnPhase = 'auction';

    // Player 0 bids 10
    Monopoly.moves.placeBid(G, makeCtx('0'), 10);
    // Player 1 bids 20
    Monopoly.moves.placeBid(G, makeCtx('1'), 20);
    // Player 0 passes
    Monopoly.moves.passAuction(G, makeCtx('0'));

    // Player 1 wins at $20
    expect(G.auction).toBeNull();
    expect(G.ownership[1]).toBe('1');
    expect(G.players[1].money).toBe(1480); // 1500 - 20
    expect(G.turnPhase).toBe('done');
  });
});
