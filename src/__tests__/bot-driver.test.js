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
  stateModalBotMode,
  BOT_STYLES,
  BOT_DELAYS,
  policyForSeat,
  createBotDriver,
  decideTradeResponse,
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

// Adversarial-review scope fix for the manage/modal bot-gate ticket: the pure
// decision renderStateModal delegates to. Reviewer noted zero E2E covers the
// human-proposes-to-bot flow, so this pure seam is the load-bearing coverage.
describe('stateModalBotMode', () => {
  // Seat '2' is the bot in most cases below; '0'/'1' human.
  const botIs2 = (seat) => seat === '2';

  test('human acting seat -> full (gate never engages)', () => {
    const G = makeG({});
    expect(stateModalBotMode(G, makeCtx({ currentPlayer: '0' }), botIs2)).toBe('full');
  });

  test('bot current player (own turn / own card prompt) -> hidden', () => {
    const G = makeG({});
    expect(stateModalBotMode(G, makeCtx({ currentPlayer: '2' }), botIs2)).toBe('hidden');
  });

  test('auction with a BOT current bidder -> hidden, even on a human turn', () => {
    const G = makeG({
      auction: {
        propertyId: 5,
        currentBid: 0,
        bidders: [{ playerId: '0', passed: false }, { playerId: '2', passed: false }],
        currentBidderIndex: 1,
      },
    });
    expect(stateModalBotMode(G, makeCtx({ currentPlayer: '0' }), botIs2)).toBe('hidden');
  });

  test('HUMAN-proposed trade pending on a BOT target -> trade-cancel-only (the flagged scenario)', () => {
    const G = makeG({
      turnPhase: 'trade',
      trade: {
        proposerId: '0', targetPlayerId: '2',
        offeredProperties: [1], requestedProperties: [2],
        offeredMoney: 0, requestedMoney: 0,
      },
    });
    expect(stateModalBotMode(G, makeCtx({ currentPlayer: '0' }), botIs2)).toBe('trade-cancel-only');
  });

  test('human-proposed trade to a HUMAN target -> full (no gate)', () => {
    const G = makeG({
      turnPhase: 'trade',
      trade: {
        proposerId: '0', targetPlayerId: '1',
        offeredProperties: [1], requestedProperties: [2],
        offeredMoney: 0, requestedMoney: 0,
      },
    });
    expect(stateModalBotMode(G, makeCtx({ currentPlayer: '0' }), botIs2)).toBe('full');
  });

  test('BOT-proposed trade on a BOT target -> hidden (no human owns anything in the modal)', () => {
    const bothBots = (seat) => seat === '1' || seat === '2';
    const G = makeG({
      turnPhase: 'trade',
      trade: {
        proposerId: '1', targetPlayerId: '2',
        offeredProperties: [1], requestedProperties: [2],
        offeredMoney: 0, requestedMoney: 0,
      },
    });
    expect(stateModalBotMode(G, makeCtx({ currentPlayer: '1' }), bothBots)).toBe('hidden');
  });

  test('defensive: G.trade set but turnPhase not trade -> hidden (modal trade branch would not render anyway)', () => {
    const G = makeG({
      turnPhase: 'done',
      trade: {
        proposerId: '0', targetPlayerId: '2',
        offeredProperties: [1], requestedProperties: [2],
        offeredMoney: 0, requestedMoney: 0,
      },
    });
    expect(stateModalBotMode(G, makeCtx({ currentPlayer: '0' }), botIs2)).toBe('hidden');
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

  // === Finding 1 fix: error recovery ==========================================
  // Before this fix, a throw from any injected dep inside act()/
  // actCharacterSelect() skipped the `finish()` call that follows it,
  // permanently wedging `scheduled = true` — every later onUpdate() would
  // then silently no-op forever (the bot's whole turn freezes with no
  // recovery). The fix wraps each step body in try/catch/finally: the catch
  // reports the error via onError(err) (default console.error) instead of
  // swallowing it, and the finally unconditionally releases the single-flight
  // flag so the driver can always take its NEXT step.
  describe('error recovery (Finding 1)', () => {
    test('throwing decide(): single-flight resets, onError is called, a later onUpdate() schedules again', () => {
      const { deps, dispatched } = makeHarness({});
      const boom = new Error('decide exploded');
      deps.decide = jest.fn()
        .mockImplementationOnce(() => { throw boom; })
        .mockReturnValueOnce([['endTurn']]);
      deps.onError = jest.fn();
      const driver = createBotDriver(deps);

      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(dispatched.length).toBe(0); // decide() threw before any dispatch
      expect(deps.onError).toHaveBeenCalledTimes(1);
      expect(deps.onError).toHaveBeenCalledWith(boom);

      // single-flight was released by the finally -> a later onUpdate() can
      // schedule and successfully take the NEXT step.
      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(dispatched).toEqual([['endTurn']]);
      expect(deps.decide).toHaveBeenCalledTimes(2);
    });

    test('throwing dispatch(): single-flight resets, onError is called, a later onUpdate() schedules again', () => {
      const { deps, dispatched } = makeHarness({});
      const boom = new Error('dispatch exploded');
      let calls = 0;
      deps.dispatch = jest.fn((name, ...args) => {
        calls++;
        if (calls === 1) throw boom;
        dispatched.push([name, ...args]);
      });
      deps.onError = jest.fn();
      const driver = createBotDriver(deps);

      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(dispatched.length).toBe(0);
      expect(deps.onError).toHaveBeenCalledTimes(1);
      expect(deps.onError).toHaveBeenCalledWith(boom);

      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(dispatched).toEqual([['endTurn']]);
    });

    test('throwing getCharacterIds() during character-select: single-flight resets, onError is called, recovers', () => {
      const state = {
        G: makeG({ phase: 'characterSelect', players: [{ id: '0', character: null }] }),
        ctx: makeCtx({ currentPlayer: '0' }),
      };
      const dispatched = [];
      const boom = new Error('roster exploded');
      const deps = {
        getState: () => state,
        dispatch: (name, ...args) => dispatched.push([name, ...args]),
        decide: jest.fn(),
        decideRoute: jest.fn(),
        isBot: () => true,
        animBusy: () => false,
        getCharacterIds: jest.fn(() => { throw boom; }),
        onError: jest.fn(),
      };
      const driver = createBotDriver(deps);

      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.charPick);
      expect(dispatched.length).toBe(0);
      expect(deps.onError).toHaveBeenCalledWith(boom);

      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.charPick);
      expect(deps.getCharacterIds).toHaveBeenCalledTimes(2);
    });

    test('onError defaults to console.error when not supplied', () => {
      const { deps } = makeHarness({});
      const boom = new Error('kaboom');
      deps.decide = jest.fn(() => { throw boom; });
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const driver = createBotDriver(deps);
      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(spy).toHaveBeenCalledWith(boom);
      spy.mockRestore();
    });
  });

  // === Fix wave 2: the WHOLE scheduled chain is error-guarded =================
  // Re-review PROVED (with reproductions) that fix wave 1's per-function
  // try/catch/finally (inside act()/actCharacterSelect() only) left
  // waitForAnim() and beginStep() themselves completely unguarded — both ran
  // outside any try/catch, either as the synchronous prefix onUpdate() calls
  // directly, or as the body of an animPoll recheck timer. animBusy()
  // throwing (sync first check, or a later deferred recheck) and getState()
  // throwing (inside beginStep's own delay-choosing callback) each escaped
  // uncaught, never called onError, and left `scheduled` wedged true forever
  // — the exact bug this wave exists to close. The fix routes every timer
  // callback AND the synchronous onUpdate() entry through one guardedStep()
  // helper (see src/bot-driver.js), which is now the sole place that
  // catches, reports via onError, and releases the single-flight flag.
  describe('error recovery (fix wave 2 — full scheduled chain)', () => {
    test('decideRoute() throwing inside the G.awaitingRoute branch: onError + recovery', () => {
      const { deps, dispatched } = makeHarness({ G: { hasRolled: true, awaitingRoute: true } });
      const boom = new Error('decideRoute exploded');
      deps.decideRoute = jest.fn()
        .mockImplementationOnce(() => { throw boom; })
        .mockReturnValueOnce(['route-x']);
      deps.onError = jest.fn();
      const driver = createBotDriver(deps);

      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(dispatched.length).toBe(0); // decideRoute() threw before any dispatch
      expect(deps.onError).toHaveBeenCalledTimes(1);
      expect(deps.onError).toHaveBeenCalledWith(boom);

      // single-flight was released -> a later onUpdate() schedules and
      // succeeds on the next step.
      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(dispatched).toEqual([['commitRoute', ['route-x']]]);
      expect(deps.decideRoute).toHaveBeenCalledTimes(2);
    });

    test('dispatch() throwing inside the G.trade branch: onError + recovery, and lastActionWasRoll resets despite the throw (Minor fix)', () => {
      const { deps, dispatched, state } = makeHarness({ G: { hasRolled: false } });
      deps.decide = jest.fn().mockReturnValueOnce([['rollDice']]);
      // deps are captured once at createBotDriver() construction (a stable
      // DI closure) — the throwing dispatch() must be wired up BEFORE
      // construction, not by reassigning deps.dispatch afterward (a stale
      // reference the driver would never see; same pitfall task-1-report.md
      // already flags for the postRoll/stuck-guard tests above).
      const boom = new Error('trade dispatch exploded');
      let tradeDispatchCalls = 0;
      deps.dispatch = jest.fn((name, ...args) => {
        if (name === 'acceptTrade' || name === 'rejectTrade') {
          tradeDispatchCalls++;
          if (tradeDispatchCalls === 1) throw boom;
        }
        dispatched.push([name, ...args]);
      });
      deps.onError = jest.fn(); // also wired up before construction, same reason
      const driver = createBotDriver(deps);

      // Step 1: a roll, so the driver's internal lastActionWasRoll flag
      // becomes true (drives the LONGER postRoll delay for the very next
      // step only).
      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(dispatched).toEqual([['rollDice']]);

      // Step 2: a trade now targets this bot (seat '0'); its dispatch()
      // (acceptTrade/rejectTrade) throws on the first attempt (see the
      // throwing deps.dispatch wired up above, before construction).
      state.G = makeG({
        hasRolled: true,
        board: { spaces: { 5: { price: 300 } } },
        mortgaged: {},
        trade: {
          proposerId: '1', targetPlayerId: '0',
          offeredProperties: [5], requestedProperties: [],
          offeredMoney: 0, requestedMoney: 0,
        },
      });

      driver.onUpdate();
      // lastActionWasRoll is still true entering this step -> postRoll delay.
      jest.advanceTimersByTime(BOT_DELAYS.postRoll);
      expect(dispatched).toEqual([['rollDice']]); // trade dispatch threw before push
      expect(deps.onError).toHaveBeenCalledTimes(1);
      expect(deps.onError).toHaveBeenCalledWith(boom);

      // Step 3 (recovery): if lastActionWasRoll had NOT been reset despite
      // step 2's throw (the Minor fix), this step would need the longer
      // postRoll delay and advancing only `think` below would be too short,
      // so this dispatch would still be missing. Advancing exactly `think`
      // and seeing the dispatch land proves the flag WAS reset.
      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(dispatched.length).toBe(2);
      expect(dispatched[1][0]).toBe('acceptTrade');
      expect(tradeDispatchCalls).toBe(2);
    });

    test('animBusy() throwing on the first synchronous check: onError + recovery, single-flight released', () => {
      const { deps, dispatched } = makeHarness({});
      const boom = new Error('animBusy exploded (sync)');
      deps.animBusy = jest.fn()
        .mockImplementationOnce(() => { throw boom; })
        .mockReturnValue(false);
      deps.onError = jest.fn();
      const driver = createBotDriver(deps);

      // The throw happens synchronously inside onUpdate() -> beginStep() ->
      // waitForAnim() -> animBusy(), before any timer is ever scheduled.
      driver.onUpdate();
      expect(dispatched.length).toBe(0);
      expect(deps.onError).toHaveBeenCalledTimes(1);
      expect(deps.onError).toHaveBeenCalledWith(boom);

      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(dispatched).toEqual([['endTurn']]);
    });

    test('animBusy() throwing on a DEFERRED animPoll recheck: onError + recovery, single-flight released', () => {
      const { deps, dispatched } = makeHarness({});
      const boom = new Error('animBusy exploded (deferred)');
      let calls = 0;
      deps.animBusy = jest.fn(() => {
        calls++;
        if (calls === 1) return true; // busy on the first synchronous check
        if (calls === 2) throw boom; // throws on the deferred animPoll recheck
        return false; // clear from here on (recovery)
      });
      deps.onError = jest.fn();
      const driver = createBotDriver(deps);

      driver.onUpdate();
      expect(dispatched.length).toBe(0); // still busy, no throw yet
      jest.advanceTimersByTime(BOT_DELAYS.animPoll);
      expect(deps.onError).toHaveBeenCalledTimes(1);
      expect(deps.onError).toHaveBeenCalledWith(boom);
      expect(dispatched.length).toBe(0);

      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(dispatched).toEqual([['endTurn']]);
    });

    test("getState() throwing inside beginStep's delay-choosing callback: onError + recovery", () => {
      const { deps, dispatched, state } = makeHarness({});
      const boom = new Error('getState exploded');
      deps.getState = jest.fn()
        .mockReturnValueOnce(state) // onUpdate()'s own pre-check read
        .mockImplementationOnce(() => { throw boom; }) // beginStep's cb read
        .mockReturnValue(state); // every call after that (recovery)
      deps.onError = jest.fn();
      const driver = createBotDriver(deps);

      driver.onUpdate();
      expect(dispatched.length).toBe(0);
      expect(deps.onError).toHaveBeenCalledTimes(1);
      expect(deps.onError).toHaveBeenCalledWith(boom);

      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(dispatched).toEqual([['endTurn']]);
    });
  });

  // === Finding 2 fix: trade-response dead path ================================
  // sim/bot.js's decideMoves has no G.trade branch (verified: src/sim/bot.js:
  // 195-252), so before this fix a bot targeted by a pending trade would fall
  // through decide()'s priority chain to endTurn, which the engine rejects
  // while G.trade is pending (Game.js keeps G.turnPhase === 'trade' until
  // acceptTrade/rejectTrade/cancelTrade resolves it) — an INVALID_MOVE
  // dispatched forever. createBotDriver now special-cases G.trade the same
  // way it already special-cased G.awaitingRoute: resolved directly via
  // decideTradeResponse(), before decide() is ever consulted.
  describe('createBotDriver: trade-response routing (Finding 2)', () => {
    test('pending trade targeting the acting bot resolves via decideTradeResponse; decide() is not consulted', () => {
      const { deps, dispatched } = makeHarness({
        G: {
          board: { spaces: { 5: { price: 300 } } },
          mortgaged: {},
          trade: {
            proposerId: '0', targetPlayerId: '1',
            offeredProperties: [5], requestedProperties: [],
            offeredMoney: 0, requestedMoney: 0,
          },
        },
        ctx: { currentPlayer: '0' },
      });
      const driver = createBotDriver(deps);
      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(dispatched).toEqual([['acceptTrade']]);
      expect(deps.decide).not.toHaveBeenCalled();
    });

    // "bot-not-target -> falls through to decide()": a contrived-but-valid
    // fixture (the real engine keeps auction/trade mutually exclusive —
    // proposeTrade rejects while G.auction is set, Game.js:1678 — but this
    // pure module doesn't itself enforce that) that exercises the driver's
    // own `seat === G.trade.targetPlayerId` guard in isolation: the acting
    // seat here is the AUCTION bidder ('2', higher precedence in
    // deriveActingSeat), which does not match G.trade.targetPlayerId ('1'),
    // so the trade branch must be skipped and decide() consulted normally.
    test('a pending trade NOT targeting the acting seat falls through to decide()', () => {
      const { deps, dispatched } = makeHarness({
        G: {
          auction: { bidders: [{ playerId: '2', passed: false }], currentBidderIndex: 0 },
          trade: {
            proposerId: '0', targetPlayerId: '1',
            offeredProperties: [], requestedProperties: [],
            offeredMoney: 0, requestedMoney: 0,
          },
        },
        ctx: { currentPlayer: '2' },
      });
      deps.decide = jest.fn(() => [['placeBid', 10]]);
      const driver = createBotDriver(deps);
      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(dispatched).toEqual([['placeBid', 10]]);
      expect(deps.decide).toHaveBeenCalledTimes(1);
    });

    // === T4 (MT2-SP4 direction B, bot linkage) — getDialogueLedger wiring ===
    // A net=+50 money-only trade (offeredMoney=50, requestedMoney=0) accepts
    // under the default threshold (0) with no attitude at all — the shared
    // baseline every sub-test below starts from.
    function makeTradeState(proposerId) {
      return {
        G: {
          board: { spaces: {} },
          mortgaged: {},
          trade: {
            proposerId, targetPlayerId: '1',
            offeredProperties: [], requestedProperties: [],
            offeredMoney: 50, requestedMoney: 0,
          },
        },
        ctx: { currentPlayer: '0' },
      };
    }

    test('getDialogueLedger wired with grudge toward the proposer: threshold tightens and flips accept -> reject', () => {
      const { deps, dispatched } = makeHarness(makeTradeState('0'));
      // grudge=5 * default grudgeThresholdPerPoint(15) = 75 > net(50).
      deps.getDialogueLedger = () => ({ '1': { '0': { grudge: 5, trust: 0 } } });
      const driver = createBotDriver(deps);
      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(dispatched).toEqual([['rejectTrade']]);
    });

    test('getDialogueLedger omitted (dep not provided): byte-identical to pre-T4 (accepts)', () => {
      const { deps, dispatched } = makeHarness(makeTradeState('0'));
      // deps.getDialogueLedger intentionally left unset.
      const driver = createBotDriver(deps);
      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(dispatched).toEqual([['acceptTrade']]);
    });

    test('getDialogueLedger returns a falsy ledger (RULES.dialogue.botAttitudeEnabled=false wiring shape): byte-identical to pre-T4 (accepts)', () => {
      const { deps, dispatched } = makeHarness(makeTradeState('0'));
      deps.getDialogueLedger = () => null;
      const driver = createBotDriver(deps);
      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(dispatched).toEqual([['acceptTrade']]);
    });

    test('seat-keyed lookup: attitude is read for (actingSeat, G.trade.proposerId) specifically, not any other pair in the ledger', () => {
      // Seat '1' holds a heavy grudge toward '0' (would reject the net=50
      // trade below) but NONE toward '2' — the proposer here is '2', so the
      // '0' entry must never be consulted.
      const { deps, dispatched } = makeHarness(makeTradeState('2'));
      deps.getDialogueLedger = () => ({ '1': { '0': { grudge: 10, trust: 0 } } });
      const driver = createBotDriver(deps);
      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(dispatched).toEqual([['acceptTrade']]); // missing pair -> {grudge:0,trust:0} -> unchanged threshold
    });

    // T4 fix wave (whole-branch review): RULES.dialogue.botTradeAttitude
    // must be LIVE-read via the getTradeAttitudeConfig dep, not silently
    // shadowed by DEFAULT_TRADE_POLICY's hand-mirrored constants — a mod
    // that overrides the magnitudes has to actually change bot behavior.
    test('getTradeAttitudeConfig override changes the threshold shift (mod config wins over the DEFAULT_TRADE_POLICY fallback)', () => {
      // grudge=1 on the net=+50 trade: default 15/pt -> threshold 15 <= 50
      // -> accept. A mod override of 60/pt -> threshold 60 > 50 -> reject.
      // Same ledger, same trade — ONLY the config dep differs.
      const ledger = { '1': { '0': { grudge: 1, trust: 0 } } };

      const base = makeHarness(makeTradeState('0'));
      base.deps.getDialogueLedger = () => ledger;
      // No getTradeAttitudeConfig -> DEFAULT_TRADE_POLICY fallback (15/pt).
      const baseDriver = createBotDriver(base.deps);
      baseDriver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(base.dispatched).toEqual([['acceptTrade']]);

      const overridden = makeHarness(makeTradeState('0'));
      overridden.deps.getDialogueLedger = () => ledger;
      overridden.deps.getTradeAttitudeConfig = () => ({ grudgeThresholdPerPoint: 60 }); // partial: other fields fall back
      const overriddenDriver = createBotDriver(overridden.deps);
      overriddenDriver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(overridden.dispatched).toEqual([['rejectTrade']]);
    });

    test('getTradeAttitudeConfig returning the default values is byte-identical to omitting the dep', () => {
      const ledger = { '1': { '0': { grudge: 1, trust: 0 } } };
      const { deps, dispatched } = makeHarness(makeTradeState('0'));
      deps.getDialogueLedger = () => ledger;
      deps.getTradeAttitudeConfig = () => ({
        grudgeThresholdPerPoint: 15, trustThresholdPerPoint: 15,
        maxGrudgeShift: 150, maxTrustShift: 150,
      });
      const driver = createBotDriver(deps);
      driver.onUpdate();
      jest.advanceTimersByTime(BOT_DELAYS.think);
      expect(dispatched).toEqual([['acceptTrade']]); // same as the fallback run above
    });
  });
});

// === decideTradeResponse (Finding 2 fix) =====================================
// Pure function: net value to the acting seat = (incoming money + incoming
// properties' price sum) - (outgoing money + outgoing properties' price sum);
// accepts when net >= policy.tradeAcceptThreshold (default 0), else rejects.
// Mortgaged properties count at policy.mortgagedPropertyRate (default 0.5) of
// face price, mirroring Game.js's getTotalAssets valuation convention
// (Game.js:647-652, RULES.core.mortgageRate).
describe('decideTradeResponse', () => {
  // proposerId is always '0', targetPlayerId '1' — seat '1' (the target) is
  // the acting bot in every test unless noted otherwise.
  function makeTradeG(trade, mortgaged) {
    return {
      board: { spaces: { 1: { price: 200 }, 2: { price: 100 }, 3: { price: 300 } } },
      mortgaged: mortgaged || {},
      trade,
    };
  }

  test('accept-favorable: bot receives more value than it gives up', () => {
    const G = makeTradeG({
      proposerId: '0', targetPlayerId: '1',
      offeredProperties: [1], requestedProperties: [2], // bot gets pid1(200), gives pid2(100)
      offeredMoney: 0, requestedMoney: 0,
    });
    expect(decideTradeResponse(G, '1')).toEqual([['acceptTrade']]);
  });

  test('reject-unfavorable: bot gives up more value than it receives', () => {
    const G = makeTradeG({
      proposerId: '0', targetPlayerId: '1',
      offeredProperties: [2], requestedProperties: [1], // bot gets pid2(100), gives pid1(200)
      offeredMoney: 0, requestedMoney: 0,
    });
    expect(decideTradeResponse(G, '1')).toEqual([['rejectTrade']]);
  });

  test('mortgaged discount: an incoming mortgaged property is valued at half price, and this actually flips the decision at the margin', () => {
    // Property 1 (face 200) offered to the bot for 150 cash.
    //   Unmortgaged: incoming=200, outgoing=150 -> net=+50 -> accept.
    //   Mortgaged:   incoming=100 (200 * 0.5 default rate), outgoing=150 -> net=-50 -> reject.
    const trade = {
      proposerId: '0', targetPlayerId: '1',
      offeredProperties: [1], requestedProperties: [],
      offeredMoney: 0, requestedMoney: 150,
    };
    expect(decideTradeResponse(makeTradeG(trade, {}), '1')).toEqual([['acceptTrade']]);
    expect(decideTradeResponse(makeTradeG(trade, { 1: true }), '1')).toEqual([['rejectTrade']]);
  });

  test('respects a custom policy (tradeAcceptThreshold / mortgagedPropertyRate)', () => {
    // Break-even trade (net = 0): accepted under the default threshold (0),
    // rejected under a strictly-positive custom threshold.
    const trade = {
      proposerId: '0', targetPlayerId: '1',
      offeredProperties: [], requestedProperties: [],
      offeredMoney: 100, requestedMoney: 100,
    };
    const G = makeTradeG(trade, {});
    expect(decideTradeResponse(G, '1')).toEqual([['acceptTrade']]);
    expect(decideTradeResponse(G, '1', { tradeAcceptThreshold: 1 })).toEqual([['rejectTrade']]);
  });

  test('bot-not-target: called with the PROPOSER seat computes net from that seat\'s own perspective', () => {
    // From proposer '0' 's perspective: incoming = requestedProperties/Money,
    // outgoing = offeredProperties/Money (mirror image of the target's view).
    const trade = {
      proposerId: '0', targetPlayerId: '1',
      offeredProperties: [1], requestedProperties: [2], // proposer gives pid1(200), gets pid2(100)
      offeredMoney: 0, requestedMoney: 0,
    };
    const G = makeTradeG(trade, {});
    // Target's view (net=+100) says accept; proposer's view (net=-100) says reject.
    expect(decideTradeResponse(G, '1')).toEqual([['acceptTrade']]);
    expect(decideTradeResponse(G, '0')).toEqual([['rejectTrade']]);
  });

  // === T4 (MT2-SP4 direction B, bot linkage) ==================================
  // Attitude-aware acceptance threshold: effectiveThreshold =
  //   max(baseThreshold + grudgeShift - trustShift, min(baseThreshold, 0))
  // where grudgeShift/trustShift are linear-per-point (RULES.dialogue.
  // botTradeAttitude, mirrored locally as DEFAULT_TRADE_POLICY's
  // grudgeThresholdPerPoint/trustThresholdPerPoint) and each independently
  // capped at maxGrudgeShift/maxTrustShift. Money-only trades (empty
  // property arrays) below so `net` is exactly offeredMoney - requestedMoney
  // from the target's perspective — no board/price rounding to reason about.
  function makeMoneyTradeG(net) {
    const trade = {
      proposerId: '0', targetPlayerId: '1',
      offeredProperties: [], requestedProperties: [],
      offeredMoney: Math.max(net, 0), requestedMoney: Math.max(-net, 0),
    };
    return makeTradeG(trade, {});
  }

  describe('T4 — grudge tightens / trust relaxes (exact boundary values)', () => {
    test('grudge=1 (default rate 15/pt): threshold shifts 0 -> 15; net=15 accepts, net=14 rejects', () => {
      const attitude = { grudge: 1, trust: 0 };
      expect(decideTradeResponse(makeMoneyTradeG(15), '1', undefined, attitude)).toEqual([['acceptTrade']]);
      expect(decideTradeResponse(makeMoneyTradeG(14), '1', undefined, attitude)).toEqual([['rejectTrade']]);
    });

    test('trust=4 against a custom base threshold=100: shifts 100 -> 40; net=40 accepts, net=39 rejects', () => {
      const policy = { tradeAcceptThreshold: 100 };
      const attitude = { grudge: 0, trust: 4 };
      expect(decideTradeResponse(makeMoneyTradeG(40), '1', policy, attitude)).toEqual([['acceptTrade']]);
      expect(decideTradeResponse(makeMoneyTradeG(39), '1', policy, attitude)).toEqual([['rejectTrade']]);
    });

    test('combined grudge=8 + trust=3: shifts 0 -> +120 -45 = 75; net=75 accepts, net=74 rejects', () => {
      const attitude = { grudge: 8, trust: 3 };
      expect(decideTradeResponse(makeMoneyTradeG(75), '1', undefined, attitude)).toEqual([['acceptTrade']]);
      expect(decideTradeResponse(makeMoneyTradeG(74), '1', undefined, attitude)).toEqual([['rejectTrade']]);
    });

    test('grudge and trust at equal max magnitude cancel exactly (grudge=10, trust=10 -> threshold unchanged)', () => {
      const attitude = { grudge: 10, trust: 10 };
      // Unchanged base threshold (0): same boundary as the no-attitude case.
      expect(decideTradeResponse(makeMoneyTradeG(0), '1', undefined, attitude)).toEqual([['acceptTrade']]);
      expect(decideTradeResponse(makeMoneyTradeG(-1), '1', undefined, attitude)).toEqual([['rejectTrade']]);
    });
  });

  describe('T4 — shift magnitude caps (maxGrudgeShift / maxTrustShift)', () => {
    test('grudgeShift clamps at maxGrudgeShift even with an extreme per-point rate', () => {
      const policy = { grudgeThresholdPerPoint: 1000, maxGrudgeShift: 50 };
      const attitude = { grudge: 1, trust: 0 }; // 1 * 1000 = 1000, clamped to 50
      expect(decideTradeResponse(makeMoneyTradeG(50), '1', policy, attitude)).toEqual([['acceptTrade']]);
      expect(decideTradeResponse(makeMoneyTradeG(49), '1', policy, attitude)).toEqual([['rejectTrade']]);
    });

    test('trustShift clamps at maxTrustShift even with an extreme per-point rate', () => {
      const policy = { tradeAcceptThreshold: 200, trustThresholdPerPoint: 1000, maxTrustShift: 50 };
      const attitude = { grudge: 0, trust: 1 }; // 1 * 1000 = 1000, clamped to 50 -> threshold 200-50=150
      expect(decideTradeResponse(makeMoneyTradeG(150), '1', policy, attitude)).toEqual([['acceptTrade']]);
      expect(decideTradeResponse(makeMoneyTradeG(149), '1', policy, attitude)).toEqual([['rejectTrade']]);
    });

    test('negative/non-finite attitude axes contribute zero shift (defensive, not a sign flip)', () => {
      const bogus = { grudge: -5, trust: NaN };
      // Should behave exactly like {grudge:0, trust:0} -> threshold unchanged at 0.
      expect(decideTradeResponse(makeMoneyTradeG(0), '1', undefined, bogus)).toEqual([['acceptTrade']]);
      expect(decideTradeResponse(makeMoneyTradeG(-1), '1', undefined, bogus)).toEqual([['rejectTrade']]);
    });
  });

  // The plan's binding bound: "a bot must never accept a strictly-losing
  // trade it would otherwise reject on value (the attitude shifts the
  // margin requirement, never flips the sign of a bad deal)". Precisely:
  // for any net < floor = min(baseThreshold, 0) — i.e. a net value the
  // BASE (no-attitude) policy already rejects (net < baseThreshold) AND
  // that is itself a losing deal relative to the bot's own baseline
  // (net < 0 whenever baseThreshold >= 0, the default/common case) — the
  // attitude-adjusted decision must ALSO reject, no matter how much trust
  // is applied. Swept across a matrix of baseThreshold values (positive,
  // zero, and two negative/already-lenient configs) at MAXIMUM relaxation
  // (trust at the ledger cap) to prove the floor is a hard, un-crossable
  // bound, and that it is TIGHT (net === floor still accepts — trust isn't
  // being over-conservatively clipped either).
  describe('T4 — bound: never accept a strictly-losing trade it would otherwise reject on value', () => {
    test.each([
      [0],
      [50],
      [-20],
      [-100],
    ])('baseThreshold=%d: floor = min(baseThreshold, 0) is a tight floor under max trust', (baseThreshold) => {
      const policy = { tradeAcceptThreshold: baseThreshold };
      const attitude = { grudge: 0, trust: 10 }; // ledger cap (RULES.dialogue.caps.trust default 10)
      const floor = Math.min(baseThreshold, 0);
      expect(decideTradeResponse(makeMoneyTradeG(floor - 1), '1', policy, attitude)).toEqual([['rejectTrade']]);
      expect(decideTradeResponse(makeMoneyTradeG(floor), '1', policy, attitude)).toEqual([['acceptTrade']]);
    });

    test('grudge stacked on top of max trust cannot defeat the floor either (grudge only ever tightens)', () => {
      const attitude = { grudge: 10, trust: 10 }; // both at ledger cap
      const floor = 0; // baseThreshold defaults to 0
      expect(decideTradeResponse(makeMoneyTradeG(floor - 1), '1', undefined, attitude)).toEqual([['rejectTrade']]);
      expect(decideTradeResponse(makeMoneyTradeG(floor), '1', undefined, attitude)).toEqual([['acceptTrade']]);
    });

    test('a trade the base policy would ALREADY accept below zero (lenient negative baseThreshold) is unaffected by trust (never MORE lenient than base)', () => {
      // baseThreshold=-20 already accepts some losing deals; max trust must
      // not push the bar any further into negative territory than -20 itself.
      const policy = { tradeAcceptThreshold: -20 };
      const attitude = { grudge: 0, trust: 10 };
      expect(decideTradeResponse(makeMoneyTradeG(-20), '1', policy, attitude)).toEqual([['acceptTrade']]); // === base decision
      expect(decideTradeResponse(makeMoneyTradeG(-20), '1', policy, null)).toEqual([['acceptTrade']]); // base itself already accepts this
      expect(decideTradeResponse(makeMoneyTradeG(-21), '1', policy, attitude)).toEqual([['rejectTrade']]); // still below base's own floor
    });
  });

  // "botAttitudeEnabled=false OR null attitude -> byte-identical decisions
  // to today" (plan T4 deliverable). The wiring-level half of this
  // (RULES.dialogue.botAttitudeEnabled=false / getDialogueLedger
  // omitted-or-falsy at the createBotDriver level) is covered in the
  // "createBotDriver: trade-response routing" describe block above; this
  // block covers the pure-function half directly.
  describe('T4 — null/undefined attitude is a true identity (byte-identical to pre-T4 decideTradeResponse)', () => {
    const cases = [
      { name: 'favorable money-only', trade: { proposerId: '0', targetPlayerId: '1', offeredProperties: [], requestedProperties: [], offeredMoney: 120, requestedMoney: 20 }, mortgaged: {}, policy: undefined },
      { name: 'unfavorable money-only', trade: { proposerId: '0', targetPlayerId: '1', offeredProperties: [], requestedProperties: [], offeredMoney: 20, requestedMoney: 120 }, mortgaged: {}, policy: undefined },
      { name: 'break-even with custom threshold', trade: { proposerId: '0', targetPlayerId: '1', offeredProperties: [], requestedProperties: [], offeredMoney: 100, requestedMoney: 100 }, mortgaged: {}, policy: { tradeAcceptThreshold: 1 } },
      { name: 'mortgaged property, favorable unmortgaged / unfavorable mortgaged', trade: { proposerId: '0', targetPlayerId: '1', offeredProperties: [1], requestedProperties: [], offeredMoney: 0, requestedMoney: 150 }, mortgaged: { 1: true }, policy: undefined },
      { name: 'proposer-perspective (seat 0, not the target)', trade: { proposerId: '0', targetPlayerId: '1', offeredProperties: [1], requestedProperties: [2], offeredMoney: 0, requestedMoney: 0 }, mortgaged: {}, policy: undefined, seat: '0' },
    ];

    test.each(cases)('$name: omitted / undefined / null / zero-valued attitude all agree with the pre-T4 (3-arg) call', ({ trade, mortgaged, policy, seat }) => {
      const G = makeTradeG(trade, mortgaged);
      const actingSeat = seat || '1';
      const baseline = decideTradeResponse(G, actingSeat, policy); // pre-T4 call shape (3 args)
      expect(decideTradeResponse(G, actingSeat, policy, undefined)).toEqual(baseline);
      expect(decideTradeResponse(G, actingSeat, policy, null)).toEqual(baseline);
      expect(decideTradeResponse(G, actingSeat, policy, { grudge: 0, trust: 0 })).toEqual(baseline);
    });
  });
});
