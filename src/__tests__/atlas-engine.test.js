import { Monopoly, setActiveMap } from '../Game';
import { loadWorld } from '../world-loader';
import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';
import { MINI_WORLD } from '../../mods/dominion/atlas/fixtures/mini-world';
import { RULES } from '../../mods/dominion/rules';

// boardgame.io v0.45 positional API: moves are called directly as
// Monopoly.moves.name(G, ctx, ...args) with a hand-built ctx.
function makeCtx(diceQueue, currentPlayer = '0') {
  // diceQueue: array of raw Number() outputs; rollTwoDice maps n -> floor(n*6)+1
  const q = diceQueue.slice();
  return {
    currentPlayer,
    numPlayers: 2,
    random: { Number: () => (q.length ? q.shift() : 0.0) },
    events: { endTurn: () => {} },
  };
}

// d1, d2 as die faces (1-6) -> raw queue values
function dice(d1, d2) { return [(d1 - 1) / 6 + 0.01, (d2 - 1) / 6 + 0.01]; }

function atlasG() {
  setActiveMap(loadWorld(MINI_WORLD, ARCHETYPES));
  const G = Monopoly.setup({ numPlayers: 2, playOrder: ['0', '1'] });
  G.phase = 'play'; // skip character select (characters stay null)
  return G;
}

// TRI_WORLD: hubville(capital-hub) → taxton(industrial) → techton(tech-hub) → hubville
// capital-hub: property,property,community → ids 0,1,2 (0 = hub)
// industrial:  property,property,tax       → ids 3,4,5 (5 = tax)
// tech-hub:    property,property,chance    → ids 6,7,8 (8 = chance)
const TRI_WORLD = {
  id: 'tri', name: 'Tri World', movementMode: 'atlas',
  places: [
    { id: 'hubville', archetypes: ['capital-hub'], realName: 'Hubville',
      pos: { x: 50, y: 80 }, data: { population: 1000000, gdp: 90000, fame: 70 },
      connectors: { n: 'taxton' } },
    { id: 'taxton', archetypes: ['industrial'], realName: 'Taxton',
      pos: { x: 30, y: 40 }, data: { population: 800000, gdp: 60000, fame: 40 },
      connectors: { e: 'techton' } },
    { id: 'techton', archetypes: ['tech-hub'], realName: 'Techton',
      pos: { x: 70, y: 30 }, data: { population: 1200000, gdp: 120000, fame: 60 },
      connectors: { s: 'hubville' } },
  ],
  hubs: ['hubville'],
  winPaths: ['wealth'],
  atlasConfig: { valueShareCap: 0.5 },
};

function triG() {
  setActiveMap(loadWorld(TRI_WORLD, ARCHETYPES));
  const G = Monopoly.setup({ numPlayers: 2, playOrder: ['0', '1'] });
  G.phase = 'play';
  return G;
}

describe('atlas board plumbing', () => {
  test('G.board carries movementMode, edges, hubs, traits, winPaths from loadWorld', () => {
    const G = atlasG();
    expect(G.board.movementMode).toBe('atlas');
    expect(G.board.edges[5]).toEqual([6, 9]);   // paris exit forks to berlin/geneva
    expect(G.board.hubs).toEqual([0]);          // rome entry
    expect(G.board.winPaths).toEqual(['wealth', 'dominion']);
    expect(typeof G.board.traits).toBe('object');
    expect(G.board.jail).toBe(null);            // no jail node on atlas maps
  });

  test('players start with distanceTraveled 0', () => {
    const G = atlasG();
    expect(G.players[0].distanceTraveled).toBe(0);
  });

  test('transit (railroad) spaces are in the ownership table', () => {
    const G = atlasG();
    expect(G.ownership[8]).toBe(null); // berlin transit, buyable
  });

  test('tax landing charges space.taxAmount (loader contract)', () => {
    const G = triG();
    G.players[0].position = 3;
    const money = G.players[0].money;
    const taxAmount = G.board.spaces[5].taxAmount;
    expect(taxAmount).toBeGreaterThan(0);
    Monopoly.moves.rollDice(G, makeCtx(dice(1, 1), '0'), [4, 5]);
    expect(G.players[0].money).toBe(money - taxAmount);
  });

  test('landing on a chance space with an empty deck does not crash', () => {
    const G = triG();
    G.players[0].position = 6;
    Monopoly.moves.rollDice(G, makeCtx(dice(1, 1), '0'), [7, 8]);
    expect(G.messages.join(' ')).toMatch(/deck is empty/i);
    expect(G.pendingCard).toBe(null);
  });
});

describe('atlas jail: in-place detention (no jail node)', () => {
  test('goToJail card detains the player where they stand', () => {
    const G = atlasG();
    G.players[0].position = 7;
    G.pendingCard = { card: { text: 'Busted!', action: 'goToJail' }, deck: 'chance' };
    G.turnPhase = 'card';
    Monopoly.moves.acceptCard(G, makeCtx([], '0'));
    expect(G.players[0].inJail).toBe(true);
    expect(G.players[0].jailTurns).toBe(0);
    expect(G.players[0].position).toBe(7); // did NOT teleport
  });

  test('triple doubles detains in place on atlas', () => {
    const G = atlasG();
    G.players[0].position = 3;
    G.doublesCount = 2; // two doubles already this turn
    Monopoly.moves.rollDice(G, makeCtx(dice(2, 2), '0'));
    expect(G.players[0].inJail).toBe(true);
    expect(G.players[0].position).toBe(3); // detained pre-move
  });
});

describe('atlas whole-route movement (D11)', () => {
  test('explicit route at the fork: both branches reachable', () => {
    const G = atlasG();
    G.players[0].position = 4;
    Monopoly.moves.rollDice(G, makeCtx(dice(1, 1), '0'), [5, 6]);
    expect(G.players[0].position).toBe(6);

    const G2 = atlasG();
    G2.players[0].position = 4;
    Monopoly.moves.rollDice(G2, makeCtx(dice(1, 1), '0'), [5, 9]);
    expect(G2.players[0].position).toBe(9);
  });

  test('invalid routes are INVALID_MOVE: non-edge hop, wrong length, too long', () => {
    const INVALID_MOVE = 'INVALID_MOVE';
    const G = atlasG();
    G.players[0].position = 4;
    expect(Monopoly.moves.rollDice(G, makeCtx(dice(1, 1), '0'), [5, 7])).toBe(INVALID_MOVE);
    const G2 = atlasG();
    G2.players[0].position = 4;
    expect(Monopoly.moves.rollDice(G2, makeCtx(dice(1, 1), '0'), [5])).toBe(INVALID_MOVE);
    const G3 = atlasG();
    G3.players[0].position = 4;
    expect(Monopoly.moves.rollDice(G3, makeCtx(dice(1, 1), '0'), [5, 6, 7])).toBe(INVALID_MOVE);
  });

  test('omitted route auto-walks the first edge at every fork', () => {
    const G = atlasG();
    G.players[0].position = 4;
    Monopoly.moves.rollDice(G, makeCtx(dice(1, 1), '0')); // total 2, no route
    expect(G.players[0].position).toBe(6); // edges[5][0] = 6 (berlin)
  });

  test('walking THROUGH the hub pays salary; distanceTraveled counts nodes', () => {
    const G = atlasG();
    G.players[0].position = 10; // geneva mid-chain
    const money = G.players[0].money;
    // 10→11→0(hub)→1 : 3 steps, passes hub mid-route
    Monopoly.moves.rollDice(G, makeCtx(dice(1, 2), '0'), [11, 0, 1]);
    expect(G.players[0].money - money).toBe(RULES.core.goSalary);
    expect(G.players[0].position).toBe(1);
    expect(G.players[0].distanceTraveled).toBe(3);
    expect(G.lastDice.salaryCollected).toBe(RULES.core.goSalary);
  });

  test('LANDING on the hub also pays salary (reach counts as pass)', () => {
    const G = atlasG();
    G.players[0].position = 10;
    const money = G.players[0].money;
    Monopoly.moves.rollDice(G, makeCtx(dice(1, 1), '0'), [11, 0]);
    expect(G.players[0].money - money).toBe(RULES.core.goSalary);
  });

  test('no hub on the route = no salary', () => {
    const G = atlasG();
    G.players[0].position = 3;
    const money = G.players[0].money;
    Monopoly.moves.rollDice(G, makeCtx(dice(1, 1), '0'), [4, 5]);
    // landing on unowned property 5 only OFFERS a buy — money unchanged
    expect(G.players[0].money - money).toBe(0);
    expect(G.lastDice.salaryCollected).toBe(0);
  });

  test('idealist passive: hub-pass bonus migrates from GO', () => {
    const G = atlasG();
    G.players[0].character = {
      id: 'test-idealist', name: 'Mira', passive: { id: 'idealist' },
      stats: { capital: 5, luck: 5, negotiation: 5, charisma: 5, tech: 5, stamina: 5 },
    };
    G.players[0].position = 11;
    const money = G.players[0].money;
    Monopoly.moves.rollDice(G, makeCtx(dice(1, 1), '0'), [0, 1]);
    expect(G.players[0].money - money)
      .toBe(RULES.core.goSalary + RULES.passives.idealist.goBonus);
  });

  test('landing on an unowned property offers the buy (handleLanding wired)', () => {
    const G = atlasG();
    G.players[0].position = 3;
    Monopoly.moves.rollDice(G, makeCtx(dice(1, 1), '0'), [4, 5]);
    expect(G.canBuy).toBe(true);
    expect(G.turnPhase).toBe('act');
    expect(G.effectivePrice).toBe(G.board.spaces[5].price); // no character, neutral season
  });

  test('doubles counting still works on atlas (jail via triple doubles)', () => {
    const G = atlasG();
    G.players[0].position = 0;
    Monopoly.moves.rollDice(G, makeCtx(dice(3, 3), '0'), [1, 2, 3, 4, 5, 6]);
    expect(G.doublesCount).toBe(1);
    expect(G.players[0].inJail).toBe(false);
  });
});

describe('atlas moveTo: node-targeted teleport', () => {
  function pendCard(G, value) {
    G.pendingCard = { card: { text: 'Go somewhere', action: 'moveTo', value }, deck: 'chance' };
    G.turnPhase = 'card';
  }

  test('teleports to the node id and lands there', () => {
    const G = atlasG();
    G.players[0].position = 7;
    pendCard(G, 4); // paris II, unowned property
    Monopoly.moves.acceptCard(G, makeCtx([], '0'));
    expect(G.players[0].position).toBe(4);
    expect(G.canBuy).toBe(true); // landing applied
  });

  test('teleporting ONTO the hub pays salary once', () => {
    const G = atlasG();
    G.players[0].position = 7;
    const money = G.players[0].money;
    pendCard(G, 0);
    Monopoly.moves.acceptCard(G, makeCtx([], '0'));
    expect(G.players[0].position).toBe(0);
    expect(G.players[0].money - money).toBe(RULES.core.goSalary);
  });

  test('teleporting to a non-hub node pays nothing and adds no distance', () => {
    const G = atlasG();
    // Backward teleport (9 < 10): the classic "passed GO" back-pay heuristic
    // must NOT fire on a graph — node ids carry no loop order.
    G.players[0].position = 10;
    const money = G.players[0].money;
    pendCard(G, 9); // geneva I, unowned — buy OFFER only
    Monopoly.moves.acceptCard(G, makeCtx([], '0'));
    expect(G.players[0].money).toBe(money);
    expect(G.players[0].distanceTraveled).toBe(0);
  });
});

describe('useReroll snapshot restore', () => {
  test('atlas reroll refunds hub salary and restores position + distance', () => {
    const G = atlasG();
    G.players[0].rerollsLeft = 1;
    G.players[0].position = 10;
    // Pre-own the landing target so the roll doesn't open a buy offer
    // (useReroll is blocked while G.canBuy is set).
    G.ownership[1] = '0';
    G.players[0].properties.push(1);
    const money = G.players[0].money;
    Monopoly.moves.rollDice(G, makeCtx(dice(1, 2), '0'), [11, 0, 1]); // through the hub
    expect(G.players[0].money - money).toBe(RULES.core.goSalary);
    Monopoly.moves.useReroll(G, makeCtx([], '0'));
    expect(G.players[0].position).toBe(10);
    expect(G.players[0].money).toBe(money);          // salary refunded
    expect(G.players[0].distanceTraveled).toBe(0);   // distance restored
    expect(G.hasRolled).toBe(false);
  });
});
