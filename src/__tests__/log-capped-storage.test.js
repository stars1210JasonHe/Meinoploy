// src/__tests__/log-capped-storage.test.js
// Ticket: online-sync-slim — a live socket probe against a running match
// measured the server's per-match action log growing UNBOUNDED (510
// entries / 104KB sync frame mid-game, still growing) and the whole thing
// being re-sent to every client on every `sync` (reconnect). See
// src/server/log-capped-storage.js for the full measured rationale and
// server.js for the MEINOPOLY_MATCH_LOG_CAP env var doc.
//
// These tests run capMatchLog against a REAL boardgame.io/server Server()'s
// constructed `db` (an actual InMemory instance), NOT a hand-rolled fake —
// InMemory itself is not part of boardgame.io/server's public export list
// ({ FlatFile, Origins, Server, SocketIO }), so this is the only way to get
// one, and it means a future bgio bump that changes the storageAPI shape
// fails these tests loudly instead of silently un-capping in production.
import { Server } from 'boardgame.io/server';
import { capMatchLog } from '../server/log-capped-storage';
import { Monopoly } from '../Game';

// A fresh Server() per test — capMatchLog mutates its `db` in place, so
// reusing one instance across tests would compound wraps (e.g. a later
// cap=0 "legacy" test would inherit an earlier test's cap).
function realDb() {
  return Server({ games: [Monopoly], origins: ['*'] }).db;
}

// Synthetic deltalog entries — capMatchLog treats log entries as opaque
// array items (it only concats/slices), so these don't need to match
// boardgame.io's actual LogEntry shape; `_marker` is just how these tests
// identify which entries survived a cap.
function entries(fromInclusive, toExclusive) {
  const out = [];
  for (let i = fromInclusive; i < toExclusive; i++) out.push({ _marker: i });
  return out;
}
function markersOf(log) {
  return log.map((e) => e._marker);
}

describe('capMatchLog', () => {
  test('writing more than cap deltalog entries caps the stored log length and keeps the LAST entries', () => {
    const db = realDb();
    const matchID = 'm-over-cap';
    db.createMatch(matchID, { initialState: { x: 0 }, metadata: {} });
    capMatchLog(db, 5);

    for (let i = 0; i < 12; i++) {
      db.setState(matchID, { x: i }, entries(i, i + 1));
    }

    const { log } = db.fetch(matchID, { log: true });
    expect(log.length).toBe(5);
    expect(markersOf(log)).toEqual([7, 8, 9, 10, 11]); // newest 5 of 0..11
  });

  test('cap=0 is unlimited (legacy passthrough): db is returned untouched and the log is never trimmed', () => {
    const db = realDb();
    const matchID = 'm-uncapped';
    db.createMatch(matchID, { initialState: { x: 0 }, metadata: {} });

    const returned = capMatchLog(db, 0);
    expect(returned).toBe(db); // no wrapping happened at all

    for (let i = 0; i < 250; i++) {
      db.setState(matchID, { x: i }, entries(i, i + 1));
    }

    const { log } = db.fetch(matchID, { log: true });
    expect(log.length).toBe(250); // matches legacy InMemory behavior: no cap
  });

  test('fetch({log:true}) returns the capped list; state/metadata/initialState pass through untouched', () => {
    const db = realDb();
    const matchID = 'm-fetch-shape';
    db.createMatch(matchID, { initialState: { x: 0 }, metadata: { gameName: 'monopoly' } });
    capMatchLog(db, 3);

    for (let i = 0; i < 10; i++) {
      db.setState(matchID, { x: i }, entries(i, i + 1));
    }

    const result = db.fetch(matchID, { state: true, metadata: true, log: true, initialState: true });
    expect(result.log.length).toBe(3);
    expect(markersOf(result.log)).toEqual([7, 8, 9]);
    expect(result.state).toEqual({ x: 9 });
    expect(result.metadata).toEqual({ gameName: 'monopoly' });
    expect(result.initialState).toEqual({ x: 0 });
  });

  test('fetch without {log: true} does not attach a log field', () => {
    const db = realDb();
    const matchID = 'm-no-log-requested';
    db.createMatch(matchID, { initialState: { x: 0 }, metadata: {} });
    capMatchLog(db, 3);
    db.setState(matchID, { x: 1 }, entries(0, 1));

    const result = db.fetch(matchID, { state: true });
    expect(result.log).toBeUndefined();
  });

  test('a batched deltalog (multiple entries in one setState call) is capped correctly too', () => {
    const db = realDb();
    const matchID = 'm-batched';
    db.createMatch(matchID, { initialState: { x: 0 }, metadata: {} });
    capMatchLog(db, 4);

    db.setState(matchID, { x: 1 }, entries(0, 3)); // 3 entries in one write
    db.setState(matchID, { x: 2 }, entries(3, 8)); // 5 more -> 8 total, cap to 4

    const { log } = db.fetch(matchID, { log: true });
    expect(log.length).toBe(4);
    expect(markersOf(log)).toEqual([4, 5, 6, 7]);
  });

  test('wipe() clears the tracked capped-log entry so recreating the same matchID starts clean', () => {
    const db = realDb();
    const matchID = 'm-wipe';
    db.createMatch(matchID, { initialState: { x: 0 }, metadata: {} });
    capMatchLog(db, 5);
    for (let i = 0; i < 8; i++) db.setState(matchID, { x: i }, entries(i, i + 1));
    expect(db.fetch(matchID, { log: true }).log.length).toBe(5);

    db.wipe(matchID);
    db.createMatch(matchID, { initialState: { x: 0 }, metadata: {} });
    expect(db.fetch(matchID, { log: true }).log).toEqual([]); // not leaking the old capped array
  });

  test('a storageAPI missing setState/fetch throws loudly instead of silently no-op-ing', () => {
    expect(() => capMatchLog({}, 5)).toThrow(/does not expose the expected setState\/fetch/);
  });

  test('non-finite/negative cap values are also treated as legacy passthrough', () => {
    expect(capMatchLog({ marker: 'x' }, NaN)).toEqual({ marker: 'x' });
    expect(capMatchLog({ marker: 'x' }, -3)).toEqual({ marker: 'x' });
  });
});

describe('server.js wires MEINOPOLY_MATCH_LOG_CAP into the real server db', () => {
  const savedCap = process.env.MEINOPOLY_MATCH_LOG_CAP;
  afterEach(() => {
    if (savedCap === undefined) delete process.env.MEINOPOLY_MATCH_LOG_CAP;
    else process.env.MEINOPOLY_MATCH_LOG_CAP = savedCap;
  });

  test('requiring server.js with the env var set caps server.db to that value (does not bind a port)', () => {
    process.env.MEINOPOLY_MATCH_LOG_CAP = '3';
    let mod;
    jest.isolateModules(() => {
      mod = require('../../server.js');
    });
    const { server } = mod;
    const matchID = 'wiring-cap-3';
    server.db.createMatch(matchID, { initialState: { x: 0 }, metadata: {} });
    for (let i = 0; i < 10; i++) {
      server.db.setState(matchID, { x: i }, entries(i, i + 1));
    }
    expect(server.db.fetch(matchID, { log: true }).log.length).toBe(3);
  });

  test('MEINOPOLY_MATCH_LOG_CAP=0 disables the cap end-to-end (legacy)', () => {
    process.env.MEINOPOLY_MATCH_LOG_CAP = '0';
    let mod;
    jest.isolateModules(() => {
      mod = require('../../server.js');
    });
    const { server } = mod;
    const matchID = 'wiring-cap-0';
    server.db.createMatch(matchID, { initialState: { x: 0 }, metadata: {} });
    for (let i = 0; i < 250; i++) {
      server.db.setState(matchID, { x: i }, entries(i, i + 1));
    }
    expect(server.db.fetch(matchID, { log: true }).log.length).toBe(250);
  });

  test('parseMatchLogCap: default (unset) is 200', () => {
    let mod;
    jest.isolateModules(() => {
      delete process.env.MEINOPOLY_MATCH_LOG_CAP;
      mod = require('../../server.js');
    });
    expect(mod.parseMatchLogCap(undefined)).toBe(200);
  });

  test('parseMatchLogCap: garbage input warns and falls back to the default (does not silently disable the cap)', () => {
    let mod;
    jest.isolateModules(() => {
      mod = require('../../server.js');
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(mod.parseMatchLogCap('not-a-number')).toBe(200);
      expect(mod.parseMatchLogCap('-5')).toBe(200);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  test('parseMatchLogCap: "0" parses to 0 (unlimited) without warning', () => {
    let mod;
    jest.isolateModules(() => {
      mod = require('../../server.js');
    });
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(mod.parseMatchLogCap('0')).toBe(0);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
