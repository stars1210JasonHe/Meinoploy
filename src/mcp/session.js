// src/mcp/session.js — session state machine (spec §1 tools 1-4, 8; Task 9
// adds make_move/wait). ONE active session per process; all failures that are
// NOT game answers throw McpToolError (tool layer -> isError:true).
import { stateView, stateDigest } from './view';
import { getLegalMoves } from './legal-moves';

export class McpToolError extends Error {}

const credKey = (serverUrl, matchID, seat) => `${serverUrl}|${matchID}|${seat}`;

export function createSession({ serverUrl, fetchImpl, clientFactory, credStore, setActiveModImpl, moveTimeoutMs = 1500, syncTimeoutMs = 5000, log = () => {} }) {
  let active = null; // { client, matchID, seat, cursor, aligned }

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

    // internals for tests / Task 9
    _client() { return active && active.client; },
    _active() { return active; },
    _current() { return requireSession(); },
  };
}
