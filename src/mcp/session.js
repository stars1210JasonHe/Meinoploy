// src/mcp/session.js — session state machine (spec §1 tools 1-4, 8; Task 9
// adds make_move/wait). ONE active session per process; all failures that are
// NOT game answers throw McpToolError (tool layer -> isError:true).
import { stateView, stateDigest, canAct } from './view';
import { getLegalMoves } from './legal-moves';
import { MOVE_SCHEMAS, EXPECT_REQUIRED, decisionSeq, moveSignature } from './move-schemas';

export class McpToolError extends Error {}

const credKey = (serverUrl, matchID, seat) => `${serverUrl}|${matchID}|${seat}`;

export function createSession({ serverUrl, fetchImpl, clientFactory, credStore, setActiveModImpl, moveTimeoutMs = 1500, syncTimeoutMs = 5000, log = () => {} }) {
  let active = null; // { client, matchID, seat, cursor, aligned }
  let moveInFlight = false; // makeMove single-flight guard (Task 9)

  function closeActive() {
    // Named (not a method referenced via `this`) — joinMatch calls it and the
    // returned object may be destructured by the tool layer.
    if (active && active.client && active.client.stop) active.client.stop();
    active = null;
  }

  // Reusable one-shot waiter: resolves the first time `predicate(state)` is
  // truthy for a non-null bgio state, or rejects with McpToolError after
  // timeoutMs. Self-contained — does NOT touch active.onState (Task 9's
  // single listener slot); this owns a private subscription so joinMatch
  // (and later wait_for_my_turn, Task 9, with a canAct-based predicate) can
  // each call it independently of any other listener.
  // client.subscribe(fn) RETURNS an unsubscribe function (verified:
  // node_modules/boardgame.io client subscribe() "Return a handle that
  // allows the caller to unsubscribe"), and — once the client is running —
  // invokes fn SYNCHRONOUSLY with the current state as part of the
  // subscribe() call itself, before subscribe() returns. `unsubscribe` is
  // therefore declared with `let` (not `const`) and guarded via a `settled`
  // flag so a synchronous predicate match during that initial call doesn't
  // reference `unsubscribe` before it's assigned.
  function waitForState(client, predicate, timeoutMs) {
    return new Promise((resolve, reject) => {
      const initial = client.getState();
      if (initial && predicate(initial)) { resolve(initial); return; }

      let settled = false;
      let timer = null;
      let unsubscribe = null;

      function settle(fn, value) {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        if (unsubscribe) unsubscribe();
        fn(value);
      }

      unsubscribe = client.subscribe((state) => {
        if (state && predicate(state)) settle(resolve, state);
      });
      if (settled && unsubscribe) unsubscribe(); // predicate matched synchronously during subscribe() above

      timer = setTimeout(() => {
        settle(reject, new McpToolError(`timed out after ${timeoutMs}ms waiting for state`));
      }, timeoutMs);
    });
  }

  async function rest(path, opts) {
    let res;
    try {
      res = await fetchImpl(`${serverUrl}${path}`, opts);
    } catch (e) {
      throw new McpToolError(`game server unreachable at ${serverUrl} (${e.message}) — is 'npm run server' running?`);
    }
    return res;
  }

  function requireSession() {
    if (!active) throw new McpToolError("no active session — call join_match first");
    const state = active.client.getState();
    if (state === null) throw new McpToolError('joined but not yet synced — retry in a moment');
    return state;
  }

  function onSync(state) {
    if (!state || !active) return;
    // MCP-process mod alignment (spec §4): RULES-dependent projections must
    // evaluate under the match's mod, not this process's default (dominion).
    if (!active.aligned && state.G && state.G.activeModId) {
      active.aligned = true;
      try { setActiveModImpl(state.G.activeModId); } catch (e) { log('mod align failed:', e.message); }
    }
    // Cursor init (spec §1 tool 8): last-delivered sentinel; latest seq AT
    // JOIN or -1 on an empty log. Exclusive semantics; seq 0 is a REAL seq.
    if (active.cursor === undefined) {
      const ev = state.G.events;
      active.cursor = ev.length ? ev[ev.length - 1].seq : -1;
    }
    if (active.onState) active.onState(state); // Task 9 hooks (wait/move) — single listener slot
  }

  return {
    async listMatches() {
      const res = await rest('/games/monopoly');
      const data = await res.json();
      return (data.matches || []).map(m => ({
        matchID: m.matchID,
        players: (m.players || []).map(p => ({ id: String(p.id), name: p.name || null, occupied: !!p.name })),
        createdAt: m.createdAt || null,
      }));
    },

    async createMatch({ numPlayers }) {
      if (!Number.isInteger(numPlayers) || numPlayers < 2 || numPlayers > 10) {
        throw new McpToolError(`numPlayers must be an integer between 2..10 (got ${numPlayers})`);
      }
      const res = await rest('/games/monopoly/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numPlayers, setupData: { enforceSeats: true } }),
      });
      const data = await res.json();
      if (!data.matchID) throw new McpToolError('create failed: no matchID in response');
      return { matchID: data.matchID };
    },

    async joinMatch({ matchID, seat, name }) {
      seat = String(seat); // strict-equality landmine (spec §1 tool 3)
      // REST probe FIRST — NEVER socket-connect on cached creds alone: bgio's
      // onSync silently AUTO-CREATES a blank match for an unknown matchID
      // (round-2 guardrail).
      const probe = await rest(`/games/monopoly/${matchID}`);
      if (!probe.ok) {
        throw new McpToolError(`match ${matchID} not found (gone after a server restart?) — list_matches for live ones`);
      }
      const detail = await probe.json();
      const numPlayers = detail.players.length;

      const joinRes = await rest(`/games/monopoly/${matchID}/join`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerID: seat, playerName: name || 'MCP Agent' }),
      });
      let credentials;
      if (joinRes.ok) {
        credentials = (await joinRes.json()).playerCredentials;
        const all = credStore.load() || {};
        all[credKey(serverUrl, matchID, seat)] = credentials;
        credStore.save(all);
      } else if (joinRes.status === 409) {
        credentials = (credStore.load() || {})[credKey(serverUrl, matchID, seat)];
        if (!credentials) {
          throw new McpToolError(`seat ${seat} of ${matchID} is occupied (409) and no cached credentials exist — recovery impossible; join a free seat`);
        }
        log(`seat ${seat} occupied — reusing cached credentials (restart recovery)`);
      } else {
        throw new McpToolError(`join failed: HTTP ${joinRes.status}`);
      }

      if (active) closeActive();
      const client = clientFactory({ matchID, playerID: seat, credentials, numPlayers });
      active = { client, matchID, seat, cursor: undefined, aligned: false, onState: null };
      if (client.updateCredentials) client.updateCredentials(credentials);
      client.subscribe(onSync);
      client.start();
      // Await the FIRST real sync before reading phase (user-approved fix,
      // Task 8 review): Local()+InMemory syncs within the same tick, but a
      // real SocketIOTransport (Task 10, production) needs a handshake round
      // trip, so reading client.getState() immediately after start() would
      // read null/'syncing' on ~every production join. This also guarantees
      // onSync's cursor-init + mod-alignment have already run by the time
      // joinMatch resolves.
      await waitForState(client, (s) => !!s, syncTimeoutMs);
      const phase = client.getState().G.phase;
      return { ok: true, seat, matchID, phase };
    },

    getState() {
      const { G, ctx } = requireSession();
      return stateView(G, ctx, active.seat);
    },

    getStateDigest() {
      const { G, ctx } = requireSession();
      return stateDigest(G, ctx, active.seat);
    },

    listLegalMoves() {
      const { G, ctx } = requireSession();
      return getLegalMoves(G, ctx, active.seat);
    },

    getEvents({ sinceSeq } = {}) {
      const { G } = requireSession();
      const ev = G.events;
      const explicit = sinceSeq !== undefined && sinceSeq !== null;
      const effectiveStart = explicit ? sinceSeq : active.cursor;
      if (ev.length === 0) {
        // EXPLICIT empty-log branch (round-4): no null-coercion arithmetic.
        return { events: [], latestSeq: null, gap: false, oldestAvailableSeq: null };
      }
      const oldest = ev[0].seq;
      const latest = ev[ev.length - 1].seq;
      const gap = effectiveStart < oldest - 1; // exclusive: next-wanted = start+1
      const events = ev.filter(e => e.seq > effectiveStart);
      if (!explicit) active.cursor = latest; // parameterless advances; explicit is a pure read
      return { events, latestSeq: latest, gap, oldestAvailableSeq: oldest };
    },

    close() { closeActive(); },

    // make_move (spec §1 tool 7): 4-layer pipeline. Layer 1 (schema/unknown-
    // move/expect-shape) and layer 2's "expect.decisionSeq required" leg are
    // TOOL ERRORS (McpToolError, pre-dispatch). Layers 2-4 (stale-decision,
    // gameover, and the dispatch outcome itself) are GAME ANSWERS — return
    // values, never thrown. SINGLE-FLIGHT: attribution baselines (event-log
    // tail / ctx-delta) must not interleave across concurrent make_move calls.
    async makeMove({ move, args = [], expect } = {}) {
      const state = requireSession();
      if (moveInFlight) throw new McpToolError('move already in flight — await the previous make_move');

      // Layer 1: schema + unknown-move + expect presence/shape (tool errors).
      const schema = MOVE_SCHEMAS[move];
      if (!schema || typeof active.client.moves[move] !== 'function') {
        throw new McpToolError(`unknown move '${move}' — see list_legal_moves`);
      }
      const parsed = schema.safeParse(args);
      if (!parsed.success) {
        throw new McpToolError(`invalid args for ${move}: ${parsed.error.issues.map(i => i.message).join('; ')}`);
      }
      if (EXPECT_REQUIRED.has(move)) {
        if (!expect || typeof expect.decisionSeq !== 'number') {
          throw new McpToolError(`expect.decisionSeq is REQUIRED for ${move} — echo the value from list_legal_moves`);
        }
      }

      const { G: preG, ctx: preCtx } = state;
      // Layer 3 (before 2 deliberately: a finished game beats a stale decision).
      if (preCtx.gameover !== undefined && preCtx.gameover !== null) {
        return { accepted: false, reason: 'gameover', digest: stateDigest(preG, preCtx, active.seat) };
      }
      // Layer 2: decision correlation (fail closed on null).
      if (EXPECT_REQUIRED.has(move)) {
        const current = decisionSeq(preG);
        if (current === null || current !== expect.decisionSeq) {
          return { accepted: false, reason: 'stale-decision', digest: stateDigest(preG, preCtx, active.seat) };
        }
      }

      // Layer 4: bounded, attributed resolution.
      const seat = active.seat; // captured now (active is guaranteed non-null here) — close()
      // may null out `active` while this move is in flight (below), so every
      // later reference in this method uses this local, never `active.seat`.
      const signatures = moveSignature(move, preG, seat);
      const baseline = preG.events.length ? preG.events[preG.events.length - 1].seq : -1; // sentinel -1
      const preTurn = preCtx.turn;
      const preCurrent = preCtx.currentPlayer;

      moveInFlight = true;
      try {
        const result = await new Promise((resolve) => {
          let done = false;
          // Guarded deref (round-9 fix): close()/closeActive() sets `active =
          // null` and is NOT gated by moveInFlight — if close() runs after
          // dispatch but before this fires (e.g. the moveTimeoutMs timer, or a
          // late onSync from a lagging transport), `active` may already be
          // null here. Unconditionally writing `active.onState` would throw
          // INSIDE this callback, which — because it's invoked from a timer/
          // subscription, not from the `await` call stack — would leave the
          // `await new Promise(...)` permanently unsettled: `finally` below
          // never runs, `moveInFlight` never resets, and every subsequent
          // make_move wedges on "in flight" forever.
          const finish = (v) => { if (!done) { done = true; if (active) active.onState = null; resolve(v); } };
          const timer = setTimeout(() => finish({ accepted: false, reason: 'rejected-or-raced' }), moveTimeoutMs);
          active.onState = (st) => {
            if (!st) return;
            const { G, ctx } = st;
            if (signatures === null) {
              // endTurn: ctx-delta attribution (deterministic — no other seat
              // can act in any state where endTurn is legal).
              if (ctx.turn !== preTurn || ctx.currentPlayer !== preCurrent) {
                clearTimeout(timer);
                finish({ accepted: preCurrent === active.seat, reason: preCurrent === active.seat ? undefined : 'rejected-or-raced' });
              }
              return;
            }
            const tail = G.events.filter(e => e.seq > baseline);
            for (const sig of signatures) {
              if (tail.some(e => e.type === sig.type && e.actor === sig.actor)) {
                clearTimeout(timer);
                finish(sig.result === 'accepted'
                  ? { accepted: true }
                  : { accepted: false, reason: sig.result });
                return;
              }
            }
            // State changed WITHOUT our signature: someone else's action — keep
            // waiting until the timer decides (our frame may still arrive).
          };
          active.client.moves[move](...parsed.data);
          // A synchronous Local() master may already have applied it: re-run
          // the listener once against the current state.
          const now = active.client.getState();
          if (now) active.onState(now);
        });
        // `active` may be null here too (same close()-mid-flight race as
        // `finish` above) — fall back to the pre-dispatch `state` snapshot so
        // the digest still reflects a valid (if stale) G/ctx instead of
        // crashing on `active.client`.
        const st = (active && active.client.getState()) || state;
        return { ...result, digest: stateDigest(st.G, st.ctx, seat) };
      } finally {
        moveInFlight = false;
      }
    },

    // wait_for_my_turn (spec §1 tool 6): blocks until this seat can act, the
    // game ends, or timeoutMs elapses. Built on the existing waitForState
    // helper (own private subscription per call — see waitForState's header)
    // rather than the single active.onState slot, so concurrent waits each
    // resolve independently instead of clobbering one another.
    async waitForMyTurn({ timeoutMs = 25000 } = {}) {
      const state = requireSession();
      const clamped = Math.max(1000, Math.min(45000, Number(timeoutMs) || 25000));
      const check = (G, ctx) => {
        if (ctx.gameover !== undefined && ctx.gameover !== null) {
          return { yourTurn: false, reason: 'gameover', gameover: ctx.gameover };
        }
        if (canAct(ctx, active.seat)) {
          return { yourTurn: true, digest: stateDigest(G, ctx, active.seat) };
        }
        return null;
      };
      const immediate = check(state.G, state.ctx);
      if (immediate) return immediate; // already-true / already-gameover -> resolve NOW
      try {
        const st = await waitForState(active.client, (s) => check(s.G, s.ctx) !== null, clamped);
        return check(st.G, st.ctx);
      } catch (e) {
        return { yourTurn: false, reason: 'timeout' }; // waitForState only rejects on timeout
      }
    },

    // internals for tests / Task 9
    _client() { return active && active.client; },
    _active() { return active; },
    _current() { return requireSession(); },
  };
}
