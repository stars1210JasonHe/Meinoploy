// src/__tests__/mcp-session.test.js
// Session core over Local() seat clients (no network): REST via fake fetch,
// clients via a factory bound to a shared Local() game. Covers join flows
// (incl. 409-credential reuse + REST-probe guardrail), cursor arithmetic
// (exclusive, sentinel -1, gap on BOTH paths), and state projection wiring.
import { Client } from 'boardgame.io/client';
import { Local } from 'boardgame.io/multiplayer';
import { createSession, McpToolError } from '../mcp/session';
import { buildSeatGame } from './helpers/seatClients';
import { MODS } from '../../mods/index';
import { RULES } from '../../mods/active-rules';

const CHAR_IDS = MODS.dominion.characters.map(c => c.id);

function memoryCredStore() {
  let data = {};
  return { load: () => data, save: (d) => { data = d; }, _peek: () => data };
}

// Fake bgio lobby REST (mirrors src/Lobby.js's contract).
function fakeLobby() {
  const matches = {}; let nextId = 1;
  return {
    matches,
    fetchImpl: async (url, opts) => {
      const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
      let m;
      if ((m = url.match(/\/games\/monopoly\/create$/))) {
        const body = JSON.parse(opts.body);
        const matchID = `m${nextId++}`;
        matches[matchID] = { matchID, players: Array.from({ length: body.numPlayers }, (_, i) => ({ id: i })), createdAt: 1 };
        return json(200, { matchID });
      }
      if ((m = url.match(/\/games\/monopoly\/([^/]+)\/join$/))) {
        const match = matches[m[1]];
        if (!match) return json(404, { error: 'not found' });
        const body = JSON.parse(opts.body);
        const seatRow = match.players[Number(body.playerID)];
        if (seatRow.name) return json(409, { error: 'Player not available' });
        seatRow.name = body.playerName;
        seatRow.credentials = `cred-${m[1]}-${body.playerID}`;
        return json(200, { playerCredentials: seatRow.credentials });
      }
      if ((m = url.match(/\/games\/monopoly\/([^/]+)$/))) {
        const match = matches[m[1]];
        return match ? json(200, match) : json(404, { error: 'not found' });
      }
      if (url.match(/\/games\/monopoly$/)) return json(200, { matches: Object.values(matches) });
      throw new Error('fakeLobby: unhandled ' + url);
    },
  };
}

// Client factory over a SHARED Local()-master seatGame — the session's client
// is seat `playerID` on the same match the driver client plays.
function makeHarness() {
  const seatGame = buildSeatGame({ enforceSeats: true });
  const transport = Local();
  const lobby = fakeLobby();
  const clients = [];
  const clientFactory = ({ playerID, numPlayers }) => {
    const c = Client({ game: seatGame, numPlayers, multiplayer: transport, playerID, debug: false });
    clients.push(c);
    return c;
  };
  const driver = (playerID, numPlayers = 2) => clientFactory({ playerID, numPlayers });
  return { lobby, clientFactory, driver, cleanup: () => clients.forEach(c => c.stop && c.stop()) };
}

const flush = () => new Promise(r => setTimeout(r, 30)); // Local() master microtask settle

describe('session preconditions', () => {
  test('tools before join throw McpToolError', async () => {
    const h = makeHarness();
    const s = createSession({ serverUrl: 'http://x', fetchImpl: h.lobby.fetchImpl,
      clientFactory: h.clientFactory, credStore: memoryCredStore(), setActiveModImpl: () => {} });
    expect(() => s.getState()).toThrow(McpToolError);
    expect(() => s.getEvents({})).toThrow(/no active session/i);
    h.cleanup();
  });
});

describe('join flows', () => {
  test('create + join + first sync: phase characterSelect, creds persisted, mod aligned', async () => {
    const h = makeHarness();
    const creds = memoryCredStore();
    const aligned = [];
    const s = createSession({ serverUrl: 'http://x', fetchImpl: h.lobby.fetchImpl,
      clientFactory: h.clientFactory, credStore: creds, setActiveModImpl: id => aligned.push(id) });
    const { matchID } = await s.createMatch({ numPlayers: 2 });
    const r = await s.joinMatch({ matchID, seat: 0 }); // NUMERIC seat — must coerce
    await flush();
    expect(r).toMatchObject({ ok: true, seat: '0', matchID });
    expect(creds._peek()[`http://x|${matchID}|0`]).toMatch(/^cred-/);
    expect(aligned).toEqual(['dominion']); // G.activeModId stamped by Task 2
    expect(s.getState().phase).toBe('characterSelect');
    h.cleanup();
  });

  test('joining a GONE match: clean error via REST probe (auto-vivify guardrail)', async () => {
    const h = makeHarness();
    const creds = memoryCredStore();
    creds.save({ 'http://x|ghost|0': 'cred-ghost-0' }); // stale session-file entry
    const s = createSession({ serverUrl: 'http://x', fetchImpl: h.lobby.fetchImpl,
      clientFactory: h.clientFactory, credStore: creds, setActiveModImpl: () => {} });
    await expect(s.joinMatch({ matchID: 'ghost', seat: 0 })).rejects.toThrow(/not found|gone/i);
    h.cleanup();
  });

  test('409 + cached credentials -> rejoin succeeds (restart recovery)', async () => {
    const h = makeHarness();
    const creds = memoryCredStore();
    const mk = () => createSession({ serverUrl: 'http://x', fetchImpl: h.lobby.fetchImpl,
      clientFactory: h.clientFactory, credStore: creds, setActiveModImpl: () => {} });
    const s1 = mk();
    const { matchID } = await s1.createMatch({ numPlayers: 2 });
    await s1.joinMatch({ matchID, seat: '0' });
    await flush();
    s1.close(); // simulate MCP-server restart (creds survive in the store)
    const s2 = mk();
    const r = await s2.joinMatch({ matchID, seat: '0' }); // REST join now 409s
    await flush();
    expect(r.ok).toBe(true);
    h.cleanup();
  });

  test('409 WITHOUT cached credentials -> clear error', async () => {
    const h = makeHarness();
    const s1 = createSession({ serverUrl: 'http://x', fetchImpl: h.lobby.fetchImpl,
      clientFactory: h.clientFactory, credStore: memoryCredStore(), setActiveModImpl: () => {} });
    const { matchID } = await s1.createMatch({ numPlayers: 2 });
    await s1.joinMatch({ matchID, seat: '0' });
    const s2 = createSession({ serverUrl: 'http://x', fetchImpl: h.lobby.fetchImpl,
      clientFactory: h.clientFactory, credStore: memoryCredStore(), setActiveModImpl: () => {} });
    await expect(s2.joinMatch({ matchID, seat: '0' })).rejects.toThrow(/occupied|409|not available/i);
    h.cleanup();
  });

  test('createMatch numPlayers bounds 2..10', async () => {
    const h = makeHarness();
    const s = createSession({ serverUrl: 'http://x', fetchImpl: h.lobby.fetchImpl,
      clientFactory: h.clientFactory, credStore: memoryCredStore(), setActiveModImpl: () => {} });
    await expect(s.createMatch({ numPlayers: 1 })).rejects.toThrow(/2\.\.10|between/i);
    await expect(s.createMatch({ numPlayers: 11 })).rejects.toThrow(/2\.\.10|between/i);
    h.cleanup();
  });
});

describe('event cursor (exclusive, sentinel -1)', () => {
  async function joined() {
    const h = makeHarness();
    const s = createSession({ serverUrl: 'http://x', fetchImpl: h.lobby.fetchImpl,
      clientFactory: h.clientFactory, credStore: memoryCredStore(), setActiveModImpl: () => {} });
    const { matchID } = await s.createMatch({ numPlayers: 2 });
    await s.joinMatch({ matchID, seat: '0' });
    await flush();
    return { h, s };
  }

  test('empty log: latestSeq null, no gap; first event (seq 0) IS delivered', async () => {
    const { h, s } = await joined();
    const r0 = s.getEvents({});
    expect(r0).toMatchObject({ events: [], latestSeq: null, gap: false, oldestAvailableSeq: null });
    // Drive seat 0's own pick through the session's client (character_selected = seq 0).
    s._client().moves.selectCharacter(CHAR_IDS[0]);
    await flush();
    const r1 = s.getEvents({});
    expect(r1.events.length).toBeGreaterThan(0);
    expect(r1.events[0].seq).toBe(0); // seq-0 landmine (round-3 Critical): NOT swallowed
    h.cleanup();
  });

  test('parameterless advances cursor; explicit sinceSeq is a pure read; sinceSeq:-1 = full history', async () => {
    const { h, s } = await joined();
    s._client().moves.selectCharacter(CHAR_IDS[0]);
    await flush();
    const first = s.getEvents({});
    expect(first.events.length).toBeGreaterThan(0);
    expect(s.getEvents({}).events).toEqual([]); // cursor advanced
    const replay = s.getEvents({ sinceSeq: -1 });  // pure read, full history
    expect(replay.events[0].seq).toBe(0);
    expect(s.getEvents({}).events).toEqual([]);   // pure read did NOT move the cursor
    h.cleanup();
  });
});

describe('getEvents gap detection (real trim via RULES.core.eventLogCap)', () => {
  // RULES is a SHARED SINGLETON ("SHARED IDENTITY at load — do not rebind,
  // mutate in place", mods/active-rules.js) — save/restore in try/finally so
  // this test never leaks a shrunk cap into any other suite in the file.
  test('sinceSeq below the trimmed oldest reports gap:true with the real oldestAvailableSeq', async () => {
    const h = makeHarness();
    const s = createSession({ serverUrl: 'http://x', fetchImpl: h.lobby.fetchImpl,
      clientFactory: h.clientFactory, credStore: memoryCredStore(), setActiveModImpl: () => {} });
    const { matchID } = await s.createMatch({ numPlayers: 2 });
    await s.joinMatch({ matchID, seat: '0' });
    await flush();

    const orig = RULES.core.eventLogCap;
    try {
      RULES.core.eventLogCap = 1; // cap=1: every logEvent call trims the log to its last 1 entry
      const other = h.driver('1', 2);
      other.start();

      // Seat 0 selects (1 event: its own join line) — turn then passes to seat 1.
      s._client().moves.selectCharacter(CHAR_IDS[0]);
      await flush();
      // Seat 1 selects LAST (2 events: its own join line + the allSelected
      // transition, Game.js selectCharacter L1310+L1317) — 3 events logged
      // total across both selects, cap=1 trims after each push, so the log
      // ends holding only the final (allSelected) event: oldest === latest,
      // and oldest > 0 — a genuine trim, not an assumed one.
      other.moves.selectCharacter(CHAR_IDS[1]);
      await flush();

      const r = s.getEvents({ sinceSeq: -1 }); // pure read, well below any real oldest
      expect(r.gap).toBe(true);
      expect(r.oldestAvailableSeq).toBeGreaterThan(0);
      expect(r.latestSeq).toBeGreaterThanOrEqual(r.oldestAvailableSeq);
    } finally {
      RULES.core.eventLogCap = orig;
    }
    h.cleanup();
  });
});

describe('listMatches', () => {
  test('maps raw lobby REST into {matchID, players:[{id,name,occupied}], createdAt}', async () => {
    const h = makeHarness();
    const s = createSession({ serverUrl: 'http://x', fetchImpl: h.lobby.fetchImpl,
      clientFactory: h.clientFactory, credStore: memoryCredStore(), setActiveModImpl: () => {} });
    const m1 = await s.createMatch({ numPlayers: 2 });
    const m2 = await s.createMatch({ numPlayers: 3 });
    await s.joinMatch({ matchID: m1.matchID, seat: '0' }); // occupy seat 0 of match 1 only
    await flush();

    const list = await s.listMatches();
    expect(list).toHaveLength(2);

    const match1 = list.find(m => m.matchID === m1.matchID);
    const match2 = list.find(m => m.matchID === m2.matchID);
    expect(match1.createdAt).not.toBeNull();
    expect(match1.players).toHaveLength(2);
    expect(typeof match1.players[0].id).toBe('string');
    expect(match1.players[0]).toMatchObject({ id: '0', name: 'MCP Agent', occupied: true });
    expect(match1.players[1]).toMatchObject({ id: '1', name: null, occupied: false });

    expect(match2.players).toHaveLength(3);
    expect(match2.players.every(p => p.occupied === false && p.name === null)).toBe(true);
    h.cleanup();
  });
});
