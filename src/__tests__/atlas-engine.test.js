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

  // Un-skipped in Task 5: these need the atlas rollDice branch to move.
  test.skip('tax landing charges space.taxAmount (loader contract)', () => {
    const G = triG();
    G.players[0].position = 3;
    const money = G.players[0].money;
    const taxAmount = G.board.spaces[5].taxAmount;
    expect(taxAmount).toBeGreaterThan(0);
    Monopoly.moves.rollDice(G, makeCtx(dice(1, 1), '0'), [4, 5]);
    expect(G.players[0].money).toBe(money - taxAmount);
  });

  test.skip('landing on a chance space with an empty deck does not crash', () => {
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
