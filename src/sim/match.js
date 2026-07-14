// Atlas Balance Sim — single-game driver (plan D1/D2/D5).
//
// Runs ONE full game on the real boardgame.io reducer via the vanilla Client
// (synchronous: move() then getState() reflects immediately — proven by the
// spike). Handles: atlas map ingestion, character select, the turn loop
// (dispatching the bot's decided moves), the turn cap with a net-worth tiebreak,
// and returns a structured result.
//
// MAP INGESTION CAVEAT (D2): setActiveMap() mutates Game.js module globals, so two
// games on different maps cannot run concurrently — the second would clobber the
// first's board. runMatch sets the active map BEFORE constructing its Client and
// the tournament runs games SERIALLY. Do not parallelize match runs.

import { Client } from 'boardgame.io/client';
import { Monopoly, setActiveMap, setActiveMod } from '../Game';
import { loadWorld } from '../world-loader';
import { loadMap } from '../map-loader';
import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';
import classicMapJson from '../../mods/dominion/maps/classic/map.json';
import { decideMoves, decideRoute, resolvePolicy } from './bot';
import { rankStandings } from './standings';
import { RULES } from '../../mods/active-rules';

// Hard safety cap on the dispatch loop per game so a logic bug can never hang the
// process. Set well above any plausible real game length (turns * moves-per-turn).
const MAX_DISPATCH_STEPS = 200000;

// Final-review Fix 2b (cashflow truncation): RULES.core.eventLogCap (200) is
// tuned for a REAL client's memory/UI display, not for a sim game that can run
// hundreds of turns and thousands of engine events. tournament.js's
// accumulateDuelStats scans runMatch's returned `events` (== the final G.events
// snapshot) for the WHOLE game's duel_initiated/duel_resolved pairs — with the
// default cap, any duel that happened more than ~200 events before the game
// ended is silently missing from that snapshot, undercounting the cashflow
// table. Raising the cap to effectively unlimited for sim matches only fixes
// this at the source instead of teaching the accumulator to special-case a
// truncated log. Same one-shot-process RULES mutation idiom as cli.js's
// `RULES.duel.enabled = true` override (module-singleton, no restore needed —
// every sim invocation is its own process/run); harmless to set on every game
// (idempotent), so it lives at the top of ingestMap (real per-game setup)
// rather than gated behind a "first call only" check.
function raiseEventLogCapForSim() {
  RULES.core.eventLogCap = 1e9;
}

// Ingest a map so Monopoly.setup reads the right board. CRITICAL: we EXPLICITLY
// assert the board every game rather than relying on Game.js's module globals —
// a prior atlas game leaves Terra's board active, so a later game would silently
// run on the wrong board (observed). Mirrors App.setMap(). Exported for tests.
//
// sim --mod wave (spec 2026-07-14 §1):
//   { modId }   assert the ACTIVE MOD first — the engine validates
//               selectCharacter against the active mod's roster and reads its
//               RULES, so any non-dominion game needs this regardless of map
//               source. setActiveMod resets RULES from the pristine clone
//               (wiping run-level overrides like the CLI's duel flag), so it
//               re-runs ONLY when the asserted mod actually changes.
//   { world }   atlas world object (loadWorld)
//   { mapJson } classic map.json object (loadMap) — NEW; the old ingest
//               hardcoded dominion's classic map.json for every non-world
//               game, CLOBBERING any other mod's board.
//   modId only  the mod's own default board (setActiveMod reseeds _pendingMap).
//   (none)      legacy dominion classic (byte-identical old behavior).
// Back-compat: a bare atlas world object (pre-wave callers) still works.
let _lastModAsserted = null;
export function ingestMap(source) {
  const src = source && (source.world || source.mapJson || source.modId !== undefined)
    ? source
    : { world: source || null };
  if (src.modId && src.modId !== _lastModAsserted) {
    setActiveMod(src.modId);
    _lastModAsserted = src.modId;
  }
  raiseEventLogCapForSim();
  if (src.world) {
    const mapData = loadWorld(src.world, ARCHETYPES);
    setActiveMap(mapData);
    return mapData;
  }
  if (src.mapJson) {
    const mapData = loadMap(src.mapJson);
    setActiveMap(mapData);
    return mapData;
  }
  if (src.modId) return null; // mod default board, seeded by setActiveMod above
  const mapData = loadMap(classicMapJson);
  setActiveMap(mapData);
  return mapData;
}

// Drive character selection: each seat (in turn order) selects its assigned char.
// selectCharacter ends that seat's turn internally; after the last, phase→'play'.
// Characters must be DISTINCT — the engine rejects a duplicate selection, which
// would silently strand the game in characterSelect. Fail loud instead.
function selectCharacters(client, charIds) {
  const distinct = new Set(charIds);
  if (distinct.size !== charIds.length) {
    throw new Error('runMatch: charIds must be distinct (engine rejects duplicate character selection): ' + charIds.join(', '));
  }
  for (let i = 0; i < charIds.length; i++) {
    const cur = client.getState().ctx.currentPlayer;
    client.moves.selectCharacter(charIds[parseInt(cur)]);
  }
  if (client.getState().G.phase !== 'play') {
    throw new Error('runMatch: character selection did not reach the play phase');
  }
}

// Run one full game. Returns { winner, reason, standings, turns, capped }.
//   world:    atlas world object, or null for the classic map.
//   charIds:  per-seat character id array (length === numPlayers).
//   policies: per-seat policy object array (length === numPlayers).
//   seed:     boardgame.io PRNG seed (string) — full reproducibility.
//   maxTurns: hard turn cap; on cap, highest standings.score wins (D5 tiebreak).
export function runMatch(spec) {
  const { world = null, mapJson = null, modId = null, charIds, policies, seed, maxTurns = 300 } = spec;
  const numPlayers = charIds.length;

  ingestMap({ world, mapJson, modId });

  // SEED FIDELITY FIX (deviation from the spike's claim): in boardgame.io v0.45 the
  // `seed` *Client option* is NOT threaded into the game PRNG — passing it there
  // leaves each Client with a fresh RANDOM seed (observed: same Client `seed` →
  // different first rolls). The deterministic seed lives on the GAME definition
  // (state.plugins.random.data.seed). We spread Monopoly into a fresh object with
  // `seed` set (NOT mutating the imported engine — sim is a pure consumer) so every
  // game with the same seed string replays identically. Verified: same seed → same
  // first roll → identical match result.
  const seededGame = Object.assign({}, Monopoly, { seed: String(seed) });
  const client = Client({ game: seededGame, numPlayers, debug: false });
  client.start();

  selectCharacters(client, charIds);

  const pols = policies.map(p => resolvePolicy(p));

  let capped = false;
  let steps = 0;
  while (true) {
    const state = client.getState();
    // gameover set by endIf (survival / dominion / engine maxTurns).
    if (state.ctx.gameover) break;

    const G = state.G;
    const ctx = state.ctx;

    // --- Turn cap (D5): independent of the engine's own victory.maxTurns so the
    // sim ALWAYS terminates and applies the net-worth tiebreak even on maps with
    // no terminator. Checked at the top of each loop iteration.
    if (maxTurns > 0 && G.totalTurns >= maxTurns) {
      capped = true;
      break;
    }

    // --- Auctions can require a NON-current seat to act (the active bidder). Drive
    // the bidder that the engine is currently waiting on, not ctx.currentPlayer.
    let actingSeat = ctx.currentPlayer;
    if (G.auction) {
      actingSeat = G.auction.bidders[G.auction.currentBidderIndex].playerId;
    }

    const moves = decideMoves(G, ctx, actingSeat, pols[parseInt(actingSeat)]);
    if (!moves || moves.length === 0) {
      // Bot is stuck (should not happen) — force-end to avoid a hang.
      if (!safeDispatch(client, 'endTurn')) break;
    } else {
      let progressed = false;
      for (let m = 0; m < moves.length; m++) {
        const [name, ...args] = moves[m];
        if (name === 'commitRoute' && args[0] === null) {
          // Deferred route: rollOnly already dispatched in this same move list, so
          // re-read state to get the post-roll dice total, then pick the branch.
          const post = client.getState();
          // rollOnly may have ended the turn early (jail no-doubles / triple
          // doubles): no route to commit. Skip the commit in that case.
          if (!post.G.awaitingRoute) { progressed = true; break; }
          const route = decideRoute(post.G, post.ctx, pols[parseInt(actingSeat)]);
          if (safeDispatch(client, 'commitRoute', route)) progressed = true;
          break;
        }
        if (safeDispatch(client, name, ...args)) progressed = true;
        else break; // an INVALID_MOVE means our state read is stale; re-loop
      }
      if (!progressed) {
        // No move advanced state — break the loop defensively to avoid a hang.
        break;
      }
    }

    if (++steps > MAX_DISPATCH_STEPS) {
      capped = true;
      break;
    }
  }

  return buildResult(client, capped, maxTurns);
}

// Dispatch a move; boardgame.io v0.45 silently no-ops an INVALID_MOVE (state
// unchanged). Return true if the move actually changed state (we can detect that
// via a cheap log/turn check), false otherwise so the caller can re-read & retry.
function safeDispatch(client, name, ...args) {
  const before = client.getState();
  const fn = client.moves[name];
  if (typeof fn !== 'function') return false;
  fn(...args);
  const after = client.getState();
  return after !== before && stateChanged(before, after);
}

// Cheap structural change detector: a real move bumps the boardgame.io log length
// (every accepted move appends a log entry) or flips the turn/phase. INVALID_MOVE
// returns the prior state object unchanged.
function stateChanged(before, after) {
  if (before === after) return false;
  const lb = before.log ? before.log.length : 0;
  const la = after.log ? after.log.length : 0;
  if (la !== lb) return true;
  // Fallback: compare turn counters / current player.
  return after.ctx.turn !== before.ctx.turn
    || after.ctx.currentPlayer !== before.ctx.currentPlayer
    || after.G.totalTurns !== before.G.totalTurns;
}

// Assemble the final result. If the engine already declared a gameover, trust it.
// Otherwise (we broke on the sim turn cap), rank by net worth and pick the leader.
function buildResult(client, capped, maxTurns) {
  const state = client.getState();
  const G = state.G;
  const over = state.ctx.gameover;
  if (over && !capped) {
    return {
      winner: over.winner,
      reason: over.reason,
      standings: over.standings,
      turns: G.totalTurns,
      capped: false,
      // Full engine event log (Task 7 of the duel mechanism): lets tournament.js
      // scan for duel_initiated/duel_resolved post-game without the sim owning
      // any engine knowledge itself. Purely additive — no existing consumer of
      // runMatch's result reads/asserts against its key set, so this cannot
      // regress prior sim behavior.
      events: G.events,
    };
  }
  // Sim turn cap (or engine gameover coinciding with cap): net-worth tiebreak over
  // the still-active players (D5). Bankrupt players are excluded from contention.
  const active = G.players.filter(p => !p.bankrupt);
  const standings = rankStandings(G, active.length ? active : G.players);
  return {
    winner: standings.length ? standings[0].id : null,
    reason: 'maxTurns',
    standings,
    turns: G.totalTurns,
    capped: true,
    events: G.events,
  };
}
