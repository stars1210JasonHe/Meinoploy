// Golden-message capture harness (Task 2 of the engine-events migration).
//
// This is the PRE-migration baseline: it drives the REAL (unmigrated) Game.js
// reducer through deterministic scripted scenarios and freezes every
// `G.messages` snapshot into fixtures/golden-messages.json. Tasks 3-6 migrate
// all `G.messages` call sites in Game.js to a typed-event system with the HARD
// requirement that message text stays byte-identical; this file (re-run in
// ASSERT mode, unchanged) is the executable proof of that byte-identity.
//
// Modes:
//   GOLDEN_CAPTURE=1 npx jest golden-messages --no-coverage   -> writes the fixture
//   npx jest golden-messages --no-coverage                    -> asserts against it
//
// See .superpowers/sdd/task-2-brief.md and task-2-report.md for the full
// scenario rationale, seed-hunting method, and per-scenario notes.
import fs from 'fs';
import path from 'path';
import {
  makeClient, playScript, ifCanBuy, ifPendingCard,
} from './helpers/drive';

const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'golden-messages.json');

// --- Scenario-specific dynamic steps (deterministic given the baked seed) ---

// build-mortgage: propose + accept a trade for `pid` from whoever currently
// owns it; a no-op if player 0 already owns it. Which of the three light-blue
// properties each seat ends up with is fixed by the seed, so this always
// resolves the same way for a given seed.
function proposeForProperty(pid) {
  return (client) => {
    const owner = client.getState().G.ownership[pid];
    if (owner !== '0' && owner !== null && owner !== undefined) {
      client.moves.proposeTrade({
        targetPlayerId: owner, offeredProperties: [], requestedProperties: [pid],
        offeredMoney: 100, requestedMoney: 0,
      });
    }
  };
}
function acceptIfTrade(client) {
  if (client.getState().G.trade) client.moves.acceptTrade();
}

// bankruptcy: drain player 0 down to $1 via a money-only trade so the very
// next rent/tax hit bankrupts them. Player 0's money at this point is fixed
// by the seed, so the drained amount is deterministic.
function drainToOneDollar(client) {
  const m = client.getState().G.players[0].money;
  client.moves.proposeTrade({
    targetPlayerId: '1', offeredProperties: [], requestedProperties: [],
    offeredMoney: m - 1, requestedMoney: 0,
  });
}

// One "normal" turn: roll, resolve whatever prompt it produced, end turn.
// Used for filler rounds where the scenario doesn't care about the outcome.
function round() {
  return [['rollDice'], ifCanBuy('buyProperty'), ifPendingCard('acceptCard'), ['endTurn']];
}

function propose(targetPlayerId, offeredMoney) {
  return (client) => client.moves.proposeTrade({
    targetPlayerId, offeredProperties: [], requestedProperties: [],
    offeredMoney, requestedMoney: 0,
  });
}

// --- Scenario definitions -------------------------------------------------
// name -> { seed, numPlayers, script }. Seeds were found via seedHunt (see
// task-2-report.md) and are baked in — the whole point of this fixture is that
// replaying `script` against `seed` is fully deterministic forever.
const SCENARIOS = {
  // P0 buys on the first roll; P1's subsequent roll must show ONLY P1's line
  // (proves the roll-time reset buffer at Game.js's rollAndResolveJail).
  'two-turn-roll-buy': {
    seed: 1,
    numPlayers: 2,
    script: [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'],       // P0 lands on a buyable, unowned property
      ['buyProperty'],
      ['endTurn'],
      ['rollDice'],       // P1 — reset-buffer proof
    ],
  },

  // P0 buys a property; P1's first roll lands EXACTLY on it (rent). Several
  // more alternating turns later, a roll lands exactly on a tax space.
  'rent-and-tax': {
    seed: 96,
    numPlayers: 2,
    script: [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'],
      ['buyProperty'],
      ['endTurn'],
      ['rollDice'],       // P1 lands on P0's property -> rent paid
      ifCanBuy('buyProperty'),
      ifPendingCard('acceptCard'),
      ['endTurn'],
      ...round(), ...round(), ...round(), ...round(), ...round(), ...round(),
      ['rollDice'],       // lands exactly on a tax space
    ],
  },

  // Lia Startrace (luck 8, meets redrawThreshold): first roll draws a
  // redraw-eligible card (pauses in turnPhase 'card'); accept it as-is.
  'card-draw-accept': {
    seed: 14,
    numPlayers: 2,
    script: [
      ['selectCharacter', 'lia-startrace'],
      ['selectCharacter', 'renn-chainbreaker'],
      ['rollDice'],
      ['acceptCard'],
      ['endTurn'],
      ['rollDice'],
    ],
  },

  // Same precondition as card-draw-accept, but redraws instead of accepting.
  'card-redraw': {
    seed: 14,
    numPlayers: 2,
    script: [
      ['selectCharacter', 'lia-startrace'],
      ['selectCharacter', 'renn-chainbreaker'],
      ['rollDice'],
      ['redrawCard'],
      ['endTurn'],
      ['rollDice'],
    ],
  },

  // Knox Ironlaw (luck 3, no merchant passive): first roll draws a goToJail
  // card that applies IMMEDIATELY (no redraw pause). One turn later, payJailFine
  // covers the :1379 reset site — the message buffer resets to a single line.
  'jail-cycle': {
    seed: 34,
    numPlayers: 2,
    script: [
      ['selectCharacter', 'knox-ironlaw'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'],       // P0 -> chance card sends to jail, applied immediately
      ['endTurn'],
      ['rollDice'],       // P1's turn
      ifCanBuy('buyProperty'),
      ifPendingCard('acceptCard'),
      ['endTurn'],
      ['payJailFine'],    // P0's turn begins in jail; pays fine -> RESET (:1379)
      ['rollDice'],       // P0's real roll for the turn
      ifCanBuy('buyProperty'),
      ifPendingCard('acceptCard'),
      ['endTurn'],
    ],
  },

  // 3 players each grab one member of the light-blue group [6, 8, 9] on their
  // own first roll (fresh start at position 0). P0 then trades for the other
  // two, completing the monopoly, and exercises upgrade/mortgage/unmortgage/
  // sellBuilding.
  'build-mortgage': {
    seed: 72,
    numPlayers: 3,
    script: [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['selectCharacter', 'knox-ironlaw'],
      ['rollDice'], ifCanBuy('buyProperty'), ['endTurn'], // P0
      ['rollDice'], ifCanBuy('buyProperty'), ['endTurn'], // P1
      ['rollDice'], ifCanBuy('buyProperty'), ['endTurn'], // P2
      ['rollDice'], ifCanBuy('buyProperty'), ifPendingCard('acceptCard'), // P0, needs hasRolled for trades
      proposeForProperty(6), acceptIfTrade,
      proposeForProperty(8), acceptIfTrade,
      proposeForProperty(9), acceptIfTrade,
      ['mortgageProperty', 9],
      ['unmortgageProperty', 9],
      ['upgradeProperty', 6],
      ['sellBuilding', 6],
    ],
  },

  // Auction #1: P0 passes on a buy prompt, bids, P1 passes -> P0 wins.
  // Auction #2 (later turn): P0 lands on another unowned property, passes;
  // BOTH bidders pass with zero bids -> property stays unowned.
  'auction-lifecycle': {
    seed: 1,
    numPlayers: 2,
    script: [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'],
      ['passProperty'],  // -> auction #1
      ['placeBid', 2],
      ['passAuction'],   // P1 passes -> P0 wins
      ['endTurn'],
      ['rollDice'], ifCanBuy('buyProperty'), ifPendingCard('acceptCard'), ['endTurn'], // P1 filler turn
      ['rollDice'],
      ['passProperty'],  // -> auction #2
      ['passAuction'],   // P0 (bidders[0]) passes with no bid
      ['passAuction'],   // P1 passes -> zero bids, remains unowned
    ],
  },

  // Rent-triggered bankruptcy: P0's money is drained to $1 via a money-only
  // trade, then P0's next roll lands on a property P1 bought in the interim,
  // and the rent (> $1) bankrupts P0 (also exercises the arbitrageur bonus
  // message on Sophia).
  bankruptcy: {
    seed: 25,
    numPlayers: 2,
    script: [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'],
      ifCanBuy('buyProperty'),
      ifPendingCard('acceptCard'),
      drainToOneDollar,
      ['acceptTrade'],
      ['endTurn'],
      ['rollDice'], ifCanBuy('buyProperty'), ifPendingCard('acceptCard'), ['endTurn'], // P1 buys something
      ['rollDice'], // P0 lands on P1's new property -> rent -> bankrupt
    ],
  },

  // 9 full alternating turns after character selection cross the
  // changeInterval=10 boundary, appending a "Season changed to Autumn!" line.
  'season-change': {
    seed: 1,
    numPlayers: 2,
    script: (() => {
      const steps = [['selectCharacter', 'marcus-grayline'], ['selectCharacter', 'sophia-ember']];
      for (let i = 0; i < 9; i++) steps.push(...round());
      return steps;
    })(),
  },

  // Money-only trades (no property precondition needed): propose -> reject,
  // propose -> accept, propose -> cancel, all within P0's single turn.
  'trade-lifecycle': {
    seed: 1,
    numPlayers: 2,
    script: [
      ['selectCharacter', 'marcus-grayline'],
      ['selectCharacter', 'sophia-ember'],
      ['rollDice'],
      ifCanBuy('buyProperty'),
      ifPendingCard('acceptCard'),
      propose('1', 50),
      ['rejectTrade'],
      propose('1', 50),
      ['acceptTrade'],
      propose('1', 50),
      ['cancelTrade'],
    ],
  },
};

function runScenario(def) {
  const client = makeClient(def.numPlayers, def.seed);
  return playScript(client, def.script);
}

describe('golden-messages — pre-migration G.messages baseline', () => {
  const isCapture = process.env.GOLDEN_CAPTURE === '1';

  if (isCapture) {
    test('CAPTURE: run every scenario and write fixtures/golden-messages.json', () => {
      const fixture = {};
      for (const name of Object.keys(SCENARIOS)) {
        const def = SCENARIOS[name];
        const snapshots = runScenario(def);
        expect(snapshots.length).toBeGreaterThan(0);
        fixture[name] = { seed: def.seed, snapshots };
      }
      fs.mkdirSync(path.dirname(FIXTURE_PATH), { recursive: true });
      fs.writeFileSync(FIXTURE_PATH, JSON.stringify(fixture, null, 2) + '\n');
    });
  } else {
    const fixture = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));

    test.each(Object.keys(SCENARIOS))('%s matches the frozen golden snapshot', (name) => {
      const def = SCENARIOS[name];
      const frozen = fixture[name];
      expect(frozen).toBeDefined();
      expect(def.seed).toBe(frozen.seed);
      const snapshots = runScenario(def);
      expect(snapshots).toEqual(frozen.snapshots);
    });
  }
});
