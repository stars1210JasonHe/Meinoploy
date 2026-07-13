/**
 * bot-driver — PURE core for the interactive local-bots app layer.
 *
 * Covers: deriveActingSeat (mirrors match.js's auction special-case, extended
 * to duel/trade per Game.js's real envelope shapes), BOT_STYLES/policyForSeat
 * (partial policies over sim/bot's DEFAULT_POLICY), BOT_DELAYS (frozen pacing
 * constants), and createBotDriver (single-flight + epoch-guarded paced
 * stepper). All G/ctx fixtures below mirror the REAL field names verified
 * against src/Game.js (see task-1-report.md for line references) — no
 * invented shapes.
 */
import {
  deriveActingSeat,
  BOT_STYLES,
  BOT_DELAYS,
  policyForSeat,
  createBotDriver,
} from '../bot-driver';

// --- small G/ctx fixture builders -------------------------------------------
function makeG(overrides) {
  return Object.assign(
    {
      phase: 'play',
      auction: null,
      duel: null,
      trade: null,
      hasRolled: false,
      awaitingRoute: false,
      players: [
        { id: '0', character: { id: 'char-a' } },
        { id: '1', character: { id: 'char-b' } },
        { id: '2', character: { id: 'char-c' } },
      ],
    },
    overrides
  );
}
function makeCtx(overrides) {
  return Object.assign({ currentPlayer: '0', gameover: undefined }, overrides);
}

describe('deriveActingSeat', () => {
  test('normal play: no auction/duel/trade -> ctx.currentPlayer', () => {
    const G = makeG({});
    const ctx = makeCtx({ currentPlayer: '1' });
    expect(deriveActingSeat(G, ctx)).toBe('1');
  });

  // Mirrors match.js:126-129 — the acting bidder, not ctx.currentPlayer.
  test('auction: current bidder seat (not ctx.currentPlayer)', () => {
    const G = makeG({
      auction: {
        propertyId: 5,
        currentBid: 0,
        bidders: [{ playerId: '2', passed: false }, { playerId: '0', passed: false }],
        currentBidderIndex: 1,
      },
    });
    const ctx = makeCtx({ currentPlayer: '2' });
    expect(deriveActingSeat(G, ctx)).toBe('0');
  });

  // Mirrors Game.js:548-550 — duel 'offer' phase is the CHALLENGER's decision,
  // and the challenger is already ctx.currentPlayer (set at duel creation), so
  // this falls through to the default branch.
  test('duel offer phase: challenger is ctx.currentPlayer already (default branch)', () => {
    const G = makeG({
      duel: { phase: 'offer', propertyId: 5, ownerId: '0', challengerId: '1', rent: 40 },
    });
    const ctx = makeCtx({ currentPlayer: '1' });
    expect(deriveActingSeat(G, ctx)).toBe('1');
  });

  // Mirrors Game.js:1934-1936 (respondDuel) / 1981-1983 (declineDuel) —
  // requireActor(G, ctx, G.duel.ownerId): the DEFENDER (owner) acts during
  // the response phase, while ctx.currentPlayer is still the challenger.
  test('duel response phase: owner seat is the acting defender', () => {
    const G = makeG({
      duel: { phase: 'response', propertyId: 5, ownerId: '0', challengerId: '1', rent: 40 },
    });
    const ctx = makeCtx({ currentPlayer: '1' });
    expect(deriveActingSeat(G, ctx)).toBe('0');
  });

  // Mirrors Game.js:1741-1743 (acceptTrade) / 1813-1815 (rejectTrade) —
  // requireActor(G, ctx, G.trade.targetPlayerId).
  test('pending trade: target seat is the acting seat', () => {
    const G = makeG({
      trade: {
        proposerId: '0',
        targetPlayerId: '2',
        offeredProperties: [1],
        requestedProperties: [2],
        offeredMoney: 0,
        requestedMoney: 0,
      },
    });
    const ctx = makeCtx({ currentPlayer: '0' });
    expect(deriveActingSeat(G, ctx)).toBe('2');
  });

  test('coerces numeric seat ids to strings (matches Game.js String(i) convention)', () => {
    const G = makeG({
      auction: {
        bidders: [{ playerId: 0, passed: false }],
        currentBidderIndex: 0,
      },
    });
    const ctx = makeCtx({ currentPlayer: 0 });
    expect(deriveActingSeat(G, ctx)).toBe('0');
  });
});

describe('BOT_DELAYS', () => {
  test('exact frozen values', () => {
    expect(BOT_DELAYS).toEqual({ think: 700, postRoll: 1100, charPick: 600, animPoll: 150 });
    expect(Object.isFrozen(BOT_DELAYS)).toBe(true);
  });
});

describe('BOT_STYLES / policyForSeat', () => {
  test('at least 3 named, frozen partial-policy presets including builder/hoarder/duelist', () => {
    expect(Object.isFrozen(BOT_STYLES)).toBe(true);
    expect(BOT_STYLES.length).toBeGreaterThanOrEqual(3);
    const ids = BOT_STYLES.map(s => s.id);
    expect(ids).toEqual(expect.arrayContaining(['builder', 'hoarder', 'duelist']));
    expect(new Set(ids).size).toBe(ids.length); // distinct names

    // Partial: every key present must be a real DEFAULT_POLICY key, but not
    // every style need set every key (that's the caller's resolvePolicy job).
    const knownKeys = new Set([
      'cashBuffer', 'buildAggression', 'auctionMaxFraction', 'payJailFine',
      'useRedraws', 'routeStrategy', 'duelPolicy',
    ]);
    BOT_STYLES.forEach(style => {
      expect(typeof style.id).toBe('string');
      expect(typeof style.policy).toBe('object');
      Object.keys(style.policy).forEach(k => expect(knownKeys.has(k)).toBe(true));
    });
  });

  test('policyForSeat is a deterministic round-robin over BOT_STYLES', () => {
    for (let i = 0; i < BOT_STYLES.length; i++) {
      expect(policyForSeat(String(i))).toEqual(BOT_STYLES[i].policy);
    }
    // wraps around
    expect(policyForSeat(String(BOT_STYLES.length))).toEqual(BOT_STYLES[0].policy);
    expect(policyForSeat(String(BOT_STYLES.length + 1))).toEqual(BOT_STYLES[1].policy);
    // repeat calls are stable (deterministic, not random)
    expect(policyForSeat('2')).toEqual(policyForSeat('2'));
  });
});

// === createBotDriver =========================================================
describe('createBotDriver', () => {
  function makeHarness(stateOverrides) {
    const state = { G: makeG(stateOverrides && stateOverrides.G), ctx: makeCtx(stateOverrides && stateOverrides.ctx) };
    const dispatched = [];
    const deps = {
      getState: () => state,
      dispatch: (name, ...args) => dispatched.push([name, ...args]),
      decide: jest.fn(() => [['endTurn']]),
      decideRoute: jest.fn(() => ['route-x']),
      isBot: () => true,
      animBusy: () => false,
    };
    return { state, dispatched, deps };
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  test('gameover: no-op, never schedules or dispatches', () => {
    const { deps, dispatched } = makeHarness({ ctx: { gameover: { winner: '0' } } });
    const driver = createBotDriver(deps);
    driver.onUpdate();
    jest.advanceTimersByTime(10000);
    expect(dispatched.length).toBe(0);
    expect(deps.decide).not.toHaveBeenCalled();
  });

  test('non-bot seat: no-op', () => {
    const { deps, dispatched } = makeHarness({});
    deps.isBot = () => false;
    const driver = createBotDriver(deps);
    driver.onUpdate();
    jest.advanceTimersByTime(10000);
    expect(dispatched.length).toBe(0);
  });

  test('single-flight: two onUpdate() calls before the timer fires -> one dispatch', () => {
    const { deps, dispatched } = makeHarness({});
    const driver = createBotDriver(deps);
    driver.onUpdate();
    driver.onUpdate(); // duplicate — must be swallowed
    jest.advanceTimersByTime(BOT_DELAYS.think);
    expect(dispatched.length).toBe(1);
    expect(dispatched[0]).toEqual(['endTurn']);
    expect(deps.decide).toHaveBeenCalledTimes(1);
  });

  test('epoch guard: stop() cancels a pending step', () => {
    const { deps, dispatched } = makeHarness({});
    const driver = createBotDriver(deps);
    driver.onUpdate();
    driver.stop();
    jest.advanceTimersByTime(10000);
    expect(dispatched.length).toBe(0);
  });

  test('one move tuple per step: decide() returning multiple tuples only dispatches the first', () => {
    const { deps, dispatched, state } = makeHarness({ G: { hasRolled: false } });
    deps.decide = jest.fn(() => [['payJailFine'], ['rollOnly'], ['commitRoute', null]]);
    const driver = createBotDriver(deps);
    driver.onUpdate();
    jest.advanceTimersByTime(BOT_DELAYS.think);
    expect(dispatched).toEqual([['payJailFine']]);
    // decide() is consulted exactly once for this step — the queued tail of
    // its own returned list is NOT separately drained here.
    expect(deps.decide).toHaveBeenCalledTimes(1);
    void state;
  });

  test('commitRoute deferral: after a rollOnly step, awaitingRoute routes to decideRoute + commitRoute (not decide())', () => {
    const { deps, dispatched, state } = makeHarness({ G: { hasRolled: false, awaitingRoute: false } });
    deps.decide = jest.fn(() => [['rollOnly']]);
    const driver = createBotDriver(deps);

    // Step 1: rollOnly dispatched.
    driver.onUpdate();
    jest.advanceTimersByTime(BOT_DELAYS.think);
    expect(dispatched).toEqual([['rollOnly']]);
    expect(deps.decide).toHaveBeenCalledTimes(1);

    // Engine resolved rollOnly into an atlas fork: mirror Game.js:1353-1356.
    state.G = makeG({ hasRolled: true, awaitingRoute: true });

    // Step 2 (mirrors the app's client.subscribe firing again post-dispatch).
    driver.onUpdate();
    jest.advanceTimersByTime(BOT_DELAYS.postRoll);

    expect(dispatched).toEqual([['rollOnly'], ['commitRoute', ['route-x']]]);
    expect(deps.decideRoute).toHaveBeenCalledTimes(1);
    // decide() must NOT be re-consulted while awaitingRoute is true — sim/bot's
    // decideMoves has no awaitingRoute branch (see src/sim/bot.js:195-252), so
    // calling it here would silently misbehave (match.js:139-148's rationale).
    expect(deps.decide).toHaveBeenCalledTimes(1);
  });

  test('postRoll delay: the step immediately after a roll waits longer than think', () => {
    const { deps, dispatched, state } = makeHarness({ G: { hasRolled: false } });
    // deps are captured once at createBotDriver() construction (a stable DI
    // closure, matching real usage) — sequence a single mock's return values
    // rather than reassigning deps.decide after construction.
    deps.decide = jest.fn()
      .mockReturnValueOnce([['rollDice']])
      .mockReturnValueOnce([['endTurn']]);
    const driver = createBotDriver(deps);
    driver.onUpdate();
    jest.advanceTimersByTime(BOT_DELAYS.think);
    expect(dispatched).toEqual([['rollDice']]);

    state.G = makeG({ hasRolled: true });
    driver.onUpdate();
    // Not yet elapsed at the shorter `think` delay.
    jest.advanceTimersByTime(BOT_DELAYS.think);
    expect(dispatched).toEqual([['rollDice']]);
    // Elapses once the remainder of `postRoll` passes.
    jest.advanceTimersByTime(BOT_DELAYS.postRoll - BOT_DELAYS.think);
    expect(dispatched).toEqual([['rollDice'], ['endTurn']]);
  });

  test('animBusy hold: dispatch waits until animBusy() clears, polling at animPoll', () => {
    const { deps, dispatched } = makeHarness({});
    let calls = 0;
    deps.animBusy = jest.fn(() => {
      calls++;
      return calls <= 2; // busy for first 2 checks, then clear
    });
    const driver = createBotDriver(deps);
    driver.onUpdate();

    jest.advanceTimersByTime(BOT_DELAYS.animPoll);
    expect(dispatched.length).toBe(0);
    jest.advanceTimersByTime(BOT_DELAYS.animPoll);
    expect(dispatched.length).toBe(0);
    // Anim now clear; the normal think delay still applies before acting.
    jest.advanceTimersByTime(BOT_DELAYS.think);
    expect(dispatched.length).toBe(1);
    expect(deps.animBusy.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  test('auction seat routing: driver acts for the current bidder, not ctx.currentPlayer', () => {
    const { deps, dispatched } = makeHarness({
      G: {
        auction: {
          bidders: [{ playerId: '2', passed: false }, { playerId: '0', passed: false }],
          currentBidderIndex: 0,
        },
      },
      ctx: { currentPlayer: '0' },
    });
    const seenSeats = [];
    deps.isBot = seat => { seenSeats.push(seat); return seat === '2'; };
    deps.decide = jest.fn((G, ctx, seat) => {
      expect(seat).toBe('2');
      return [['placeBid', 10]];
    });
    const driver = createBotDriver(deps);
    driver.onUpdate();
    jest.advanceTimersByTime(BOT_DELAYS.think);
    expect(dispatched).toEqual([['placeBid', 10]]);
    expect(seenSeats).toContain('2');
  });

  test('character-select: auto-picks a random untaken char after charPick delay', () => {
    const state = {
      G: makeG({
        phase: 'characterSelect',
        players: [{ id: '0', character: null }, { id: '1', character: null }],
      }),
      ctx: makeCtx({ currentPlayer: '0' }),
    };
    const dispatched = [];
    const deps = {
      getState: () => state,
      dispatch: (name, ...args) => dispatched.push([name, ...args]),
      decide: jest.fn(),
      decideRoute: jest.fn(),
      isBot: () => true,
      animBusy: () => false,
      getCharacterIds: () => ['alpha', 'beta', 'gamma'],
      rngImpl: () => 0, // always picks the first untaken candidate — deterministic
    };
    const driver = createBotDriver(deps);
    driver.onUpdate();
    jest.advanceTimersByTime(BOT_DELAYS.charPick);
    expect(dispatched).toEqual([['selectCharacter', 'alpha']]);
    expect(deps.decide).not.toHaveBeenCalled();
  });

  test('character-select: distinct picks across a full round (untaken filter excludes prior picks)', () => {
    const state = {
      G: makeG({
        phase: 'characterSelect',
        players: [{ id: '0', character: null }, { id: '1', character: null }, { id: '2', character: null }],
      }),
      ctx: makeCtx({ currentPlayer: '0' }),
    };
    const dispatched = [];
    const deps = {
      getState: () => state,
      dispatch: (name, ...args) => dispatched.push([name, ...args]),
      decide: jest.fn(),
      decideRoute: jest.fn(),
      isBot: () => true,
      animBusy: () => false,
      getCharacterIds: () => ['alpha', 'beta', 'gamma'],
      rngImpl: () => 0, // always picks index 0 of the REMAINING candidates
    };
    const driver = createBotDriver(deps);

    driver.onUpdate();
    jest.advanceTimersByTime(BOT_DELAYS.charPick);
    expect(dispatched[0]).toEqual(['selectCharacter', 'alpha']);

    // Mirrors Game.js:1290+1323 — selectCharacter records the pick and calls
    // ctx.events.endTurn(), advancing ctx.currentPlayer to the next seat.
    state.G.players[0].character = { id: 'alpha' };
    state.ctx.currentPlayer = '1';
    driver.onUpdate();
    jest.advanceTimersByTime(BOT_DELAYS.charPick);
    expect(dispatched[1]).toEqual(['selectCharacter', 'beta']);

    state.G.players[1].character = { id: 'beta' };
    state.ctx.currentPlayer = '2';
    driver.onUpdate();
    jest.advanceTimersByTime(BOT_DELAYS.charPick);
    expect(dispatched[2]).toEqual(['selectCharacter', 'gamma']);

    const picks = dispatched.map(d => d[1]);
    expect(new Set(picks).size).toBe(3); // all distinct
  });

  test('character-select: human seat (isBot false) is left alone', () => {
    const state = {
      G: makeG({ phase: 'characterSelect', players: [{ id: '0', character: null }] }),
      ctx: makeCtx({ currentPlayer: '0' }),
    };
    const dispatched = [];
    const deps = {
      getState: () => state,
      dispatch: (name, ...args) => dispatched.push([name, ...args]),
      decide: jest.fn(),
      decideRoute: jest.fn(),
      isBot: () => false,
      animBusy: () => false,
      getCharacterIds: () => ['alpha'],
    };
    const driver = createBotDriver(deps);
    driver.onUpdate();
    jest.advanceTimersByTime(10000);
    expect(dispatched.length).toBe(0);
  });

  test('stuck guard: empty decide() result dispatches nothing and releases single-flight', () => {
    const { deps, dispatched } = makeHarness({});
    // Same stable-mock-with-sequenced-returns rationale as the postRoll test above.
    deps.decide = jest.fn()
      .mockReturnValueOnce([])
      .mockReturnValueOnce([['endTurn']]);
    const driver = createBotDriver(deps);
    driver.onUpdate();
    jest.advanceTimersByTime(BOT_DELAYS.think);
    expect(dispatched.length).toBe(0);
    // single-flight was released, so a later onUpdate() can try again
    driver.onUpdate();
    jest.advanceTimersByTime(BOT_DELAYS.think);
    expect(dispatched).toEqual([['endTurn']]);
  });
});
