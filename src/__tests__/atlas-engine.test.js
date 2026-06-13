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

describe('chained pendingCard: atlas moveTo onto a card space', () => {
  // TRI_WORLD plus an authored chance deck — landing on space 8 (techton's
  // chance space) draws a real card instead of hitting an empty deck.
  const CARD_WORLD = {
    ...TRI_WORLD,
    id: 'tri-cards',
    cards: { chance: [{ text: 'Pay up', action: 'pay', value: 50 }], community: [] },
  };

  function cardG() {
    setActiveMap(loadWorld(CARD_WORLD, ARCHETYPES));
    const G = Monopoly.setup({ numPlayers: 2, playOrder: ['0', '1'] });
    G.phase = 'play';
    return G;
  }

  test('acceptCard keeps the newly drawn card pending instead of vaporizing it', () => {
    const G = cardG();
    // luckRedraws makes the drawn 'pay' card redraw-eligible, so handleLanding
    // PENDS it (turnPhase 'card') instead of auto-applying.
    G.players[0].luckRedraws = 1;
    G.pendingCard = { card: { text: 'Go', action: 'moveTo', value: 8 }, deck: 'chance' };
    G.turnPhase = 'card';

    Monopoly.moves.acceptCard(G, makeCtx([0.0], '0'));
    expect(G.players[0].position).toBe(8);
    expect(G.pendingCard).not.toBe(null);
    expect(G.pendingCard.card.action).toBe('pay');
    expect(G.turnPhase).toBe('card');

    // The chained card resolves normally on the second accept.
    const money = G.players[0].money;
    Monopoly.moves.acceptCard(G, makeCtx([], '0'));
    expect(G.players[0].money).toBe(money - 50);
    expect(G.pendingCard).toBe(null);
  });

  test('redrawCard keeps a chained card pending too', () => {
    const G = cardG();
    G.players[0].luckRedraws = 2; // one spent on the redraw, one pends the chained draw
    G.pendingCard = { card: { text: 'Busted!', action: 'goToJail' }, deck: 'chance' };
    G.turnPhase = 'card';

    // Redraw swaps goToJail for the deck's moveTo-free 'pay' card... but to
    // exercise the chain we author the redraw deck draw as moveTo via a
    // two-card deck: index 0 = moveTo onto the chance space.
    G.board.chanceCards = [
      { text: 'Go', action: 'moveTo', value: 8 },
      { text: 'Pay up', action: 'pay', value: 50 },
    ];
    // First Number() picks the redraw (index 0 = moveTo), second picks the
    // landing draw (0.9 → index 1 = pay).
    Monopoly.moves.redrawCard(G, makeCtx([0.0, 0.9], '0'));
    expect(G.players[0].position).toBe(8);
    expect(G.pendingCard).not.toBe(null);
    expect(G.pendingCard.card.action).toBe('pay');
    expect(G.turnPhase).toBe('card');
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

  test('bankruptcy fires when the salary refund drives money to zero or below', () => {
    const G = atlasG();
    G.players[0].rerollsLeft = 1;
    G.players[0].position = 10;
    // Opponent owns the landing target: landing charges rent (no buy offer,
    // so useReroll stays legal) and the player is solvent only thanks to the
    // mid-route hub salary — the reroll refund must trigger bankruptcy.
    G.ownership[1] = '1';
    G.players[1].properties.push(1);
    const rent = G.board.spaces[1].rent;
    expect(rent).toBeGreaterThan(0);
    G.players[0].money = rent; // refund leaves exactly $0
    Monopoly.moves.rollDice(G, makeCtx(dice(1, 2), '0'), [11, 0, 1]); // through the hub
    expect(G.players[0].bankrupt).toBe(false);
    expect(G.players[0].money).toBe(RULES.core.goSalary); // rent paid, salary collected
    Monopoly.moves.useReroll(G, makeCtx([], '0'));
    expect(G.players[0].bankrupt).toBe(true);
  });
});

describe('atlas place-set monopoly rent', () => {
  function ownGroup(G, playerId, ids) {
    ids.forEach(id => { G.ownership[id] = playerId; G.players[Number(playerId)].properties.push(id); });
  }

  test('owning a full atlas place-group doubles base rent (no buildings)', () => {
    const G = atlasG();
    ownGroup(G, '1', [6, 7]);
    G.players[0].character = null;
    G.players[1].character = null;
    const rent = G.board.spaces[6].rent;
    const ownerBefore = G.players[1].money;
    const payerBefore = G.players[0].money;
    G.players[0].position = 4;
    Monopoly.moves.rollDice(G, makeCtx(dice(1, 1), '0'), [5, 6]);
    // monopoly => rent doubled (season neutral, no character discounts)
    const paid = payerBefore - G.players[0].money;
    expect(paid).toBe(rent * RULES.core.monopolyRentMultiplier);
    expect(G.players[1].money - ownerBefore).toBe(paid);
  });

  test('partial group ownership does NOT double rent', () => {
    const G = atlasG();
    G.ownership[6] = '1'; G.players[1].properties.push(6); // owns 6 but not 7
    G.players[0].character = null; G.players[1].character = null;
    const rent = G.board.spaces[6].rent;
    const payerBefore = G.players[0].money;
    G.players[0].position = 4;
    Monopoly.moves.rollDice(G, makeCtx(dice(1, 1), '0'), [5, 6]);
    expect(payerBefore - G.players[0].money).toBe(rent);
  });

  test('breaker passive reduces monopoly rent on an atlas full group', () => {
    const G = atlasG();
    function ownGroup(G, playerId, ids) { ids.forEach(id => { G.ownership[id] = playerId; G.players[Number(playerId)].properties.push(id); }); }
    ownGroup(G, '1', [6, 7]);
    G.players[1].character = null;
    // visitor (player 0) has the breaker passive
    G.players[0].character = {
      id: 'renn', name: 'Renn', passive: { id: 'breaker' },
      stats: { capital: 0, luck: 0, negotiation: 0, charisma: 0, tech: 0, stamina: 0 },
    };
    const rent = G.board.spaces[6].rent;
    const full = rent * RULES.core.monopolyRentMultiplier;
    const expected = Math.floor(full * (1 - RULES.passives.breaker.monopolyRentReduction));
    const payerBefore = G.players[0].money;
    G.players[0].position = 4;
    Monopoly.moves.rollDice(G, makeCtx(dice(1, 1), '0'), [5, 6]);
    expect(payerBefore - G.players[0].money).toBe(expected);
  });
});

describe('atlas place-set building', () => {
  function ownGroup(G, playerId, ids) {
    ids.forEach(id => { G.ownership[id] = playerId; G.players[Number(playerId)].properties.push(id); });
  }
  function buildReadyG() {
    const G = atlasG();
    G.hasRolled = true;            // upgrade/sell require hasRolled
    G.players[0].character = null;
    G.players[0].money = 100000;   // plenty to build
    ownGroup(G, '0', [3, 4, 5]);   // paris place-group fully owned
    return G;
  }

  test('can build on a fully-owned atlas place-group', () => {
    const G = buildReadyG();
    const res = Monopoly.moves.upgradeProperty(G, makeCtx([], '0'), 3);
    expect(res).toBeUndefined();           // not INVALID_MOVE
    expect(G.buildings[3]).toBe(1);
  });

  test('cannot build without owning the full place-group', () => {
    const G = atlasG();
    G.hasRolled = true; G.players[0].character = null; G.players[0].money = 100000;
    G.ownership[3] = '0'; G.players[0].properties.push(3); // owns 3 only
    expect(Monopoly.moves.upgradeProperty(G, makeCtx([], '0'), 3)).toBe('INVALID_MOVE');
    expect(G.buildings[3]).toBeUndefined();
  });

  test('even-build: cannot exceed the group minimum level by more than 1', () => {
    const G = buildReadyG();
    Monopoly.moves.upgradeProperty(G, makeCtx([], '0'), 3); // 3 -> L1
    // 3 is now L1, 4 and 5 are L0 -> upgrading 3 again must be blocked (uneven)
    expect(Monopoly.moves.upgradeProperty(G, makeCtx([], '0'), 3)).toBe('INVALID_MOVE');
    expect(G.buildings[3]).toBe(1);
    // but 4 (at the min) may be built
    expect(Monopoly.moves.upgradeProperty(G, makeCtx([], '0'), 4)).toBeUndefined();
    expect(G.buildings[4]).toBe(1);
  });

  test('cannot build if any group member is mortgaged', () => {
    const G = buildReadyG();
    G.mortgaged[5] = true;
    expect(Monopoly.moves.upgradeProperty(G, makeCtx([], '0'), 3)).toBe('INVALID_MOVE');
  });

  test('cannot mortgage a property whose group has buildings', () => {
    const G = buildReadyG();
    Monopoly.moves.upgradeProperty(G, makeCtx([], '0'), 3); // build on 3
    // now mortgaging 4 (same group, which has a building on 3) must be blocked
    expect(Monopoly.moves.mortgageProperty(G, makeCtx([], '0'), 4)).toBe('INVALID_MOVE');
  });

  test('sell: can only sell from the highest level in the group', () => {
    const G = buildReadyG();
    G.buildings[3] = 2; G.buildings[4] = 1; G.buildings[5] = 1; // 3 is highest
    expect(Monopoly.moves.sellBuilding(G, makeCtx([], '0'), 4)).toBe('INVALID_MOVE'); // 4 below max
    expect(Monopoly.moves.sellBuilding(G, makeCtx([], '0'), 3)).toBeUndefined();      // 3 at max
    expect(G.buildings[3]).toBe(1);
  });
});

describe('atlas freeUpgrade card', () => {
  function ownGroup(G, playerId, ids) {
    ids.forEach(id => { G.ownership[id] = playerId; G.players[Number(playerId)].properties.push(id); });
  }
  function applyFreeUpgrade(G) {
    G.pendingCard = { card: { text: 'Free upgrade!', action: 'freeUpgrade' }, deck: 'chance' };
    G.turnPhase = 'card';
    Monopoly.moves.acceptCard(G, makeCtx([], '0'));
  }

  test('freeUpgrade upgrades the cheapest property in a fully-owned atlas group', () => {
    const G = atlasG();
    G.players[0].character = null;
    ownGroup(G, '0', [3, 4, 5]); // paris fully owned, all L0
    applyFreeUpgrade(G);
    // exactly one property in the group should now be at L1
    const levels = [3, 4, 5].map(id => G.buildings[id] || 0);
    expect(levels.filter(l => l === 1).length).toBe(1);
    expect(G.messages.join(' ')).toMatch(/Free upgrade/i);
  });

  test('freeUpgrade is a no-op when no full group is owned', () => {
    const G = atlasG();
    G.players[0].character = null;
    G.ownership[3] = '0'; G.players[0].properties.push(3); // partial
    applyFreeUpgrade(G);
    expect(G.buildings[3]).toBeUndefined();
    expect(G.messages.join(' ')).toMatch(/No properties eligible/i);
  });
});

describe('atlas dominion victory (winPaths "dominion" -> monopoly win)', () => {
  function ownGroup(G, playerId, ids) {
    ids.forEach(id => { G.ownership[id] = playerId; G.players[Number(playerId)].properties.push(id); });
  }

  test('endIf returns a dominion win when a player owns groupsToWin full place-groups', () => {
    const G = atlasG();
    // atlas worlds set victory.primary from winPaths[0]; force the dominion path
    G.victory = { primary: 'dominion', maxTurns: 0, groupsToWin: 2 };
    ownGroup(G, '0', [0, 1]);   // rome place-group
    ownGroup(G, '0', [6, 7]);   // berlin place-group -> 2 full groups
    const result = Monopoly.endIf(G, { currentPlayer: '0', numPlayers: 2 });
    expect(result).toBeDefined();
    expect(result.winner).toBe('0');
    expect(result.reason).toBe('dominion');
  });

  test('no dominion win below groupsToWin', () => {
    const G = atlasG();
    G.victory = { primary: 'dominion', maxTurns: 0, groupsToWin: 3 };
    ownGroup(G, '0', [0, 1]);
    ownGroup(G, '0', [6, 7]); // only 2 full groups, need 3
    // both players still solvent so no survival win either
    const result = Monopoly.endIf(G, { currentPlayer: '0', numPlayers: 2 });
    expect(result).toBeUndefined();
  });
});
