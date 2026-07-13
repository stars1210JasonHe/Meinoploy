// bot-soak.test.js — headless full-game soak (Task 3 of the local-bots plan).
//
// Drives a REAL 3-seat game (1 human-proxy seat + 2 bot seats) through
// createBotDriver (src/bot-driver.js, Task 1) end-to-end on the real
// boardgame.io reducer. Uses INJECTED zero-delay manual timers (the driver's
// own setTimeoutImpl/clearTimeoutImpl deps — see bot-driver.js's doc comment:
// "injectable so tests can use jest.useFakeTimers() transparently, or swap a
// custom scheduler") instead of jest.useFakeTimers() on the whole suite — the
// task-3 brief is explicit that boardgame.io internals may need real timers,
// so a manual per-test timer queue (same fake-timer-harness SHAPE as
// bot-driver.test.js, just hand-rolled instead of jest's) is the narrower tool.
//
// Setup mirrors src/sim/match.js's own ingest (read first, per the brief):
// loadMap(classicMapJson) + setActiveMap() BEFORE constructing the Client, and
// a seeded game via Object.assign({}, Monopoly, { seed }) — v0.45 seeds the
// GAME DEF, not the Client option (match.js's own documented deviation from
// the original spike's claim: passing `seed` as a Client option leaves each
// Client with a fresh random seed).
//
// The vanilla local Client's notifySubscribers() is a synchronous forEach
// (verified in node_modules/boardgame.io/dist/cjs/client-*.js — see
// task-2-report.md's own root-cause writeup for the reentrancy bug this caused
// in the INTERACTIVE app's dispatch dep). That bug does not apply here: this
// test never calls client.subscribe() at all, so there is nothing to reenter —
// dispatch() calls client.moves[name](...args) directly with no setTimeout(...,
// 0) deferral (App.js's deferral is a fix for ITS OWN render re-entrancy, not a
// property the driver or the engine requires).
import { Client } from 'boardgame.io/client';
import { Monopoly, setActiveMap } from '../Game';
import { loadMap } from '../map-loader';
import classicMapJson from '../../mods/dominion/maps/classic/map.json';
import { createBotDriver, deriveActingSeat, policyForSeat } from '../bot-driver';
import { decideMoves, decideRoute as decideBotRoute } from '../sim/bot';
import { CHARACTERS_DATA } from '../../mods/dominion/characters-data';

// A tiny manual timer queue. createBotDriver's setTimeoutImpl/clearTimeoutImpl
// deps route here instead of the real clock: delays are recorded (virtual time
// only advances when a callback fires) but never actually waited on —
// flushNext() runs the earliest-scheduled callback immediately, so a real
// 700-1100ms bot pace (BOT_DELAYS) collapses to microseconds across a full
// game. NOT jest.useFakeTimers() — this is a hand-rolled queue scoped to just
// the driver's own two deps, per the brief's explicit instruction.
function makeManualTimerQueue() {
  let nextId = 1;
  let virtualNow = 0;
  const pending = [];
  return {
    setTimeoutImpl(fn, delay) {
      const id = nextId++;
      pending.push({ id, time: virtualNow + (delay || 0), fn });
      return id;
    },
    clearTimeoutImpl(id) {
      const idx = pending.findIndex(p => p.id === id);
      if (idx !== -1) pending.splice(idx, 1);
    },
    size() {
      return pending.length;
    },
    // Runs the single earliest-scheduled pending callback (ties broken by
    // insertion order). Returns false if the queue was empty.
    flushNext() {
      if (pending.length === 0) return false;
      pending.sort((a, b) => a.time - b.time || a.id - b.id);
      const next = pending.shift();
      virtualNow = next.time;
      next.fn();
      return true;
    },
  };
}

const TARGET_TURNS = 30;
const MAX_STEPS = 20000; // bounded flush-step budget — a hang fails loud here, not via a real wall-clock timeout
const PROGRESS_WINDOW = 1000; // steps; totalTurns must strictly increase across every window this wide

describe('bot-driver headless soak (Task 3)', () => {
  test('a full 3-seat game (1 human-proxy + 2 bots) reaches >=30 totalTurns (or gameover), no hang, no INVALID_MOVE storm', () => {
    // === Ingest (mirrors src/sim/match.js's ingestMap) ========================
    setActiveMap(loadMap(classicMapJson));
    const seededGame = Object.assign({}, Monopoly, { seed: 'bot-soak-3p-classic-v1' });
    const numPlayers = 3;
    const client = Client({ game: seededGame, numPlayers, debug: false });
    client.start();

    // Bots occupy the LAST seats — same convention as App.js's
    // startGameWithPlayers (this soak doesn't depend on the exact split, just
    // needs at least one seat on each path: human-proxy AND driver-driven).
    const botSeatIds = new Set(['1', '2']);
    const isBot = (seat) => botSeatIds.has(String(seat));

    const characterIds = CHARACTERS_DATA.map(c => c.id);

    // === Tracked dispatch (mirrors match.js's safeDispatch/stateChanged) ======
    // boardgame.io v0.45 silently no-ops an INVALID_MOVE (client.moves[name](...)
    // returns the SAME state object instead of throwing) — this is the only way
    // to detect a rejected move from the outside.
    let dispatchCount = 0;
    let invalidMoveCount = 0;
    function stateChanged(before, after) {
      if (before === after) return false;
      const lb = before.log ? before.log.length : 0;
      const la = after.log ? after.log.length : 0;
      if (la !== lb) return true;
      return after.ctx.turn !== before.ctx.turn
        || after.ctx.currentPlayer !== before.ctx.currentPlayer
        || after.G.totalTurns !== before.G.totalTurns;
    }
    function dispatch(name, ...args) {
      dispatchCount++;
      const before = client.getState();
      const fn = client.moves[name];
      if (typeof fn !== 'function') {
        invalidMoveCount++;
        return;
      }
      fn(...args);
      const after = client.getState();
      if (!stateChanged(before, after)) invalidMoveCount++;
    }

    const timerQ = makeManualTimerQueue();
    const driverErrors = [];

    // === The driver under test (bot seats only — see createBotDriver's isBot dep) ===
    const driver = createBotDriver({
      getState: () => client.getState(),
      dispatch,
      // decide/decideRoute close over policyForSeat(seat) — bot-driver.js never
      // calls resolvePolicy itself (task-1-report.md's documented convention
      // for the wiring layer; App.js's _buildBotDriver follows the identical
      // pattern for the interactive app).
      decide: (G, ctx, seat) => decideMoves(G, ctx, seat, policyForSeat(seat)),
      decideRoute: (G, ctx, seat) => decideBotRoute(G, ctx, policyForSeat(seat)),
      isBot,
      animBusy: () => false, // headless — nothing ever animates
      setTimeoutImpl: timerQ.setTimeoutImpl,
      clearTimeoutImpl: timerQ.clearTimeoutImpl,
      getCharacterIds: () => characterIds,
      rngImpl: () => 0, // deterministic: character auto-pick always takes the first untaken candidate
      onError: (err) => { driverErrors.push(err); },
    });

    // Every onUpdate() call schedules AT MOST one pending timer: animBusy() is
    // always false here, so waitForAnim (bot-driver.js) resolves SYNCHRONOUSLY
    // via a direct callback rather than scheduling an animPoll recheck — the
    // only thing that ever lands in the queue is the single paced act() call.
    // Draining to empty after each onUpdate() is therefore always correct and
    // bounded (never an infinite drain), with a guard as a defensive backstop.
    function flushDriverChain() {
      let guard = 0;
      while (timerQ.size() > 0) {
        timerQ.flushNext();
        if (++guard > 100) {
          throw new Error('bot-soak: timer queue did not drain after 100 flushes — possible infinite re-scheduling loop in the driver');
        }
      }
    }

    // === Human-proxy seat ('0') =================================================
    // Per the brief: "dispatch the minimal legal action ... reuse decideMoves for
    // the proxy too if simpler; the point is BOT seats use the driver path." The
    // proxy calls sim/bot.js's decideMoves directly (DEFAULT_POLICY, via {}) and
    // dispatches exactly the first move tuple per step — the SAME "one move tuple
    // per step, re-derive fresh next time" contract createBotDriver itself uses
    // (see bot-driver.js's file-header comment) — so the proxy and the driver
    // advance the game through an identical dispatch shape; only the pacing
    // differs (the proxy is unpaced/synchronous, since nothing needs to watch it).
    function stepHumanProxyCharacterSelect(G) {
      const takenIds = new Set(G.players.filter(p => p.character).map(p => p.character.id));
      const candidate = characterIds.find(id => !takenIds.has(id));
      dispatch('selectCharacter', candidate);
    }
    function stepHumanProxyPlay(G, ctx, seat) {
      const moves = decideMoves(G, ctx, seat, {});
      if (!moves || moves.length === 0) {
        dispatch('endTurn'); // stuck-guard fallback — should not normally happen
        return;
      }
      const [name, ...args] = moves[0];
      dispatch(name, ...args);
    }

    // === Main drive loop =========================================================
    let steps = 0;
    let lastProgressStep = 0;
    let lastProgressTurns = 0;

    while (true) {
      const { G, ctx } = client.getState();
      if (ctx.gameover) break;
      if (G.phase === 'play' && G.totalTurns >= TARGET_TURNS) break;

      steps++;
      if (steps > MAX_STEPS) {
        throw new Error(
          `bot-soak: exceeded ${MAX_STEPS} steps without reaching ${TARGET_TURNS} totalTurns or gameover — ` +
          `likely a hang. Last state: phase=${G.phase}, totalTurns=${G.totalTurns}, ` +
          `currentPlayer=${ctx.currentPlayer}, dispatches=${dispatchCount}, invalidMoves=${invalidMoveCount}`
        );
      }

      if (G.phase === 'characterSelect') {
        if (isBot(ctx.currentPlayer)) {
          driver.onUpdate();
          flushDriverChain();
        } else {
          stepHumanProxyCharacterSelect(G);
        }
      } else {
        const actingSeat = deriveActingSeat(G, ctx);
        if (isBot(actingSeat)) {
          driver.onUpdate();
          flushDriverChain();
        } else {
          stepHumanProxyPlay(G, ctx, actingSeat);
        }
      }

      if (driverErrors.length > 0) {
        const first = driverErrors[0];
        throw new Error(`bot-soak: createBotDriver reported ${driverErrors.length} error(s) via onError; first: ${(first && first.stack) || first}`);
      }

      // Forward-progress guard: catches a silent stall (e.g. an INVALID_MOVE
      // storm that never trips MAX_STEPS because dispatches ARE happening, just
      // never advancing the game) well before the raw step cap would, with a
      // much more actionable failure message.
      if (steps - lastProgressStep >= PROGRESS_WINDOW) {
        const nowTurns = client.getState().G.totalTurns;
        if (nowTurns <= lastProgressTurns) {
          throw new Error(
            `bot-soak: no forward progress in totalTurns over ${PROGRESS_WINDOW} steps ` +
            `(stuck at totalTurns=${nowTurns}) — possible INVALID_MOVE storm or stall. ` +
            `dispatches=${dispatchCount}, invalidMoves=${invalidMoveCount}`
          );
        }
        lastProgressTurns = nowTurns;
        lastProgressStep = steps;
      }
    }

    // === Assertions ==============================================================
    const final = client.getState();
    expect(final.ctx.gameover || final.G.totalTurns >= TARGET_TURNS).toBeTruthy();
    if (!final.ctx.gameover) {
      expect(final.G.totalTurns).toBeGreaterThanOrEqual(TARGET_TURNS);
    }
    expect(driverErrors).toEqual([]);

    // No INVALID_MOVE storm. Some rejected dispatches can legitimately occur
    // (e.g. a state read that's gone stale by dispatch time in a fast-moving
    // cross-seat sequence — match.js's own "an INVALID_MOVE means our state
    // read is stale; re-loop" comment documents the same class of event), but a
    // STORM (most/all dispatches rejected) means something is fundamentally
    // stuck. 20% is generous slack while still catching a genuine storm.
    expect(dispatchCount).toBeGreaterThan(0);
    expect(invalidMoveCount / dispatchCount).toBeLessThan(0.2);
  });
});
