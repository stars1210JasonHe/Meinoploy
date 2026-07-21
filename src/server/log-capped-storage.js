// src/server/log-capped-storage.js — caps the boardgame.io per-match action
// log on the SERVER side. server.js is the only caller; this module holds
// the logic (mirrors the src/mcp/ split: the entry script wires it in, the
// behavior lives under src/).
//
// WHY (measured, live socket probe against a running match — see
// server.js's MEINOPOLY_MATCH_LOG_CAP doc comment for the exact numbers):
// boardgame.io's InMemory storage
// (node_modules/boardgame.io/dist/cjs/server.js ~L2368 `class InMemory
// extends Sync`) accumulates EVERY move's deltalog forever — setState()
// does `log.concat(deltalog)` with no cap (~L2398-2402), and
// fetch(matchID, {log:true}) (~L2417) returns the whole array. A live probe
// measured a 510-entry / 104KB sync frame mid-game, still growing — nothing
// ever trims it, so both server memory and reconnect payload size grow
// unbounded for the life of a match. The whole array is re-sent to EVERY
// client on every `sync` (i.e. every reconnect —
// node_modules/boardgame.io/dist/cjs/master-5c931fba.js `onSync` ~L273-329
// fetches {log:true} and puts it straight on the sync payload). Reconnect
// (leave+rejoin) is also the shipped workaround for the A1 browser-freeze
// ticket, so a fat sync frame is not hypothetical.
//
// The log is not used for anything gameplay-critical on the client: the
// client transport (node_modules/boardgame.io/dist/cjs/client-cadd28ea.js
// ~L288-290) just assigns `this.log = action.log || []` on SYNC and never
// feeds it into the reducer (the SYNC branch returns `action.state`
// untouched) — its only consumer is boardgame.io's own debug panel, which
// every Meinopoly client disables (`debug: false`). Undo/redo is powered by
// `state._undo`, not this log. Verified: nothing under src/ or scripts/
// reads `client.log` / a synced `state.log` from a real multiplayer client
// (src/sim/match.js's `.log` reads are against a LOCAL, non-multiplayer
// client and are unrelated). So trimming the SERVER-side log is invisible
// to every real client this project ships.
//
// APPROACH: boardgame.io/server's public exports are only
// `{ FlatFile, Origins, Server, SocketIO }` — InMemory (the class this repo
// actually gets: DBFromEnv() picks it whenever FLATFILE_DIR is unset, which
// is always true here) is NOT exported, so we cannot subclass or
// `new` it ourselves. Instead we MONKEY-PATCH the storageAPI instance the
// `Server()` call already constructed (`server.db`) in place: we replace
// its OWN `setState`/`fetch`/`wipe` methods (shadowing the prototype
// methods, closing over the ORIGINAL bound methods) rather than building a
// wrapper object and reassigning `server.db` — Koa's `app.context.db` and
// the lobby REST router both captured the original object reference at
// `Server()` construction time, so anything short of mutating that same
// object in place would silently miss those call sites.
//
// A future boardgame.io upgrade could change the public export list, the
// Sync interface shape, or how onSync/onUpdate call it. Because this patches
// the PUBLIC storageAPI method boundary (not private fields) and throws if
// that boundary isn't there, a breaking change surfaces as a loud failure
// (constructor throw, or a wrong shape caught by the unit test that runs
// this against a REAL `boardgame.io/server` Server()'s constructed `db`)
// rather than a silent, un-capped no-op.

/**
 * Mutates `db` (a real boardgame.io storageAPI instance) in place so its
 * per-match log is capped to the last `cap` entries. Returns `db` for
 * convenience/chaining.
 *
 * @param {object} db - storageAPI instance (e.g. `Server(...).db`).
 * @param {number} cap - keep the newest `cap` log entries per match.
 *   `cap <= 0` (or non-finite) is a no-op: `db` is returned UNCHANGED, byte
 *   for byte the legacy unbounded behavior (this is what
 *   MEINOPOLY_MATCH_LOG_CAP=0 selects).
 */
export function capMatchLog(db, cap) {
  const n = Math.floor(Number(cap));
  if (!Number.isFinite(n) || n <= 0) return db; // legacy passthrough — db untouched

  if (typeof db.setState !== 'function' || typeof db.fetch !== 'function') {
    // A bgio bump that renames/removes these would otherwise silently leave
    // the log uncapped — fail loudly instead (see file header).
    throw new Error(
      'capMatchLog: db does not expose the expected setState/fetch methods ' +
      '(boardgame.io storageAPI shape changed? see src/server/log-capped-storage.js)'
    );
  }

  const originalSetState = db.setState.bind(db);
  const originalFetch = db.fetch.bind(db);
  // Lives alongside (not inside) db — deliberately NOT db's own log storage,
  // so db's internal accumulation (InMemory's `this.log` Map) never grows:
  // we stop forwarding deltalog to it below, so this Map becomes the only
  // place a per-match log accumulates, and it's capped.
  const logs = new Map(); // matchID -> capped array (newest `n` entries)

  db.setState = (matchID, state, deltalog) => {
    if (deltalog && deltalog.length > 0) {
      const merged = (logs.get(matchID) || []).concat(deltalog);
      logs.set(matchID, merged.length > n ? merged.slice(-n) : merged);
    }
    return originalSetState(matchID, state, undefined);
  };

  db.fetch = (matchID, opts) => {
    const result = originalFetch(matchID, opts);
    const attachCappedLog = (r) => {
      if (opts && opts.log) r.log = logs.get(matchID) || [];
      return r;
    };
    return result && typeof result.then === 'function'
      ? result.then(attachCappedLog)
      : attachCappedLog(result);
  };

  if (typeof db.wipe === 'function') {
    const originalWipe = db.wipe.bind(db);
    db.wipe = (matchID) => {
      logs.delete(matchID); // don't leak our capped array across match lifetimes
      return originalWipe(matchID);
    };
  }

  return db;
}
