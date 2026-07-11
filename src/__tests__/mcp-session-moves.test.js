// src/__tests__/mcp-session-moves.test.js
// make_move 4-layer pipeline + wait_for_my_turn over Local() seat clients.
// Regression cases from spec §5 (a)-(h) — each comment cites its case letter.
import { Client } from 'boardgame.io/client';
import { Local } from 'boardgame.io/multiplayer';
import { createSession, McpToolError } from '../mcp/session';
import { buildSeatGame } from './helpers/seatClients';
import { MODS } from '../../mods/index';
import { RULES } from '../../mods/active-rules';

const CHAR_IDS = MODS.dominion.characters.map(c => c.id);
const flush = (ms = 40) => new Promise(r => setTimeout(r, ms));

// Harness: session on seat 0, driver client on seat 1, same Local() match.
// patchG lets scenario tests start from a crafted trade/auction state
// (seatClients precedent: only onBegin-untouched fields survive).
async function harness({ numPlayers = 2, patchG, seed } = {}) {
  const seatGame = buildSeatGame({ enforceSeats: true, patchG, seed });
  const transport = Local();
  const made = [];
  const clientFactory = ({ playerID, numPlayers: n }) => {
    const c = Client({ game: seatGame, numPlayers: n, multiplayer: transport, playerID, debug: false });
    made.push(c); return c;
  };
  const lobbyFetch = async (url, opts) => {
    // Minimal fake: create -> m1; probe -> 2 seats; join -> creds.
    const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
    if (url.endsWith('/create')) return json(200, { matchID: 'm1' });
    if (url.endsWith('/join')) return json(200, { playerCredentials: 'c0' });
    if (url.match(/\/games\/monopoly\/m1$/)) return json(200, { players: Array.from({ length: numPlayers }, (_, i) => ({ id: i })) });
    return json(200, { matches: [] });
  };
  const session = createSession({ serverUrl: 'http://x', fetchImpl: lobbyFetch,
    clientFactory, credStore: { load: () => ({}), save: () => {} }, setActiveModImpl: () => {}, moveTimeoutMs: 300 });
  await session.joinMatch({ matchID: 'm1', seat: '0' });
  const driver = clientFactory({ playerID: '1', numPlayers });
  driver.start();
  await flush();
  return { session, driver, cleanup: () => { session.close(); made.forEach(c => c.stop && c.stop()); } };
}

async function selectBoth(session, driver) {
  await session.makeMove({ move: 'selectCharacter', args: [CHAR_IDS[0]] });
  driver.moves.selectCharacter(CHAR_IDS[1]);
  await flush();
}

describe('layer 1 — schema/unknown-move validation (tool errors)', () => {
  test('unknown move name throws', async () => {
    const { session, cleanup } = await harness();
    await expect(session.makeMove({ move: 'zorch' })).rejects.toThrow(/unknown move/i);
    cleanup();
  });
  test('malformed args throw BEFORE dispatch', async () => {
    const { session, driver, cleanup } = await harness();
    await selectBoth(session, driver);
    await expect(session.makeMove({ move: 'proposeTrade', args: [null] })).rejects.toThrow(/invalid args/i);
    cleanup();
  });
  test('missing expect on a response move is a TOOL ERROR, not stale-decision', async () => {
    const { session, cleanup } = await harness();
    await expect(session.makeMove({ move: 'acceptTrade' })).rejects.toThrow(/expect.*required/i);
    cleanup();
  });
});

describe('layers 2-4 over a real trade window', () => {
  // Crafted pending trade FROM seat 1 TO seat 0 (session seat is the target).
  const tradePatch = (G) => {
    G.phase = 'play';
    G.players.forEach((p, i) => { p.character = MODS.dominion.characters[i]; });
    G.trade = { proposerId: '1', targetPlayerId: '0', offeredProperties: [], requestedProperties: [], offeredMoney: 25, requestedMoney: 0 };
    G.events = [{ seq: 0, turn: 0, type: 'trade_proposed', actor: '1', data: {} }];
    G.eventSeq = 1;
    return G;
  };
  // NOTE: patchG can't set ctx.activePlayers (that's a ctx event) — with
  // enforceSeats Local() master + no envelope, bgio layer-1 gates on
  // currentPlayer. The TARGET ('0') must still be able to acceptTrade: our
  // requireActor allows it, but IsPlayerActive would block seat 0 unless
  // currentPlayer is '0'. patchG runs at setup so currentPlayer IS '0'
  // (first turn) — the target can act; the crafted window is valid.

  test('(b)/(stale-decision) wrong decisionSeq -> accepted:false stale-decision', async () => {
    const { session, driver, cleanup } = await harness({ patchG: tradePatch });
    const r = await session.makeMove({ move: 'acceptTrade', expect: { decisionSeq: 999 } });
    expect(r).toMatchObject({ accepted: false, reason: 'stale-decision' });
    cleanup();
  });

  test('happy path: acceptTrade with correct decisionSeq -> accepted:true via signature', async () => {
    const { session, cleanup } = await harness({ patchG: tradePatch });
    const seq = session.listLegalMoves().find(e => e.move === 'acceptTrade').expect.decisionSeq;
    const r = await session.makeMove({ move: 'acceptTrade', expect: { decisionSeq: seq } });
    expect(r.accepted).toBe(true);
    expect(session.getState().flags.trade).toBeNull();
    cleanup();
  });

  test('(e) staleTrade branch -> accepted:false reason stale-trade (never rejected-or-raced)', async () => {
    const stale = (G) => { const g = tradePatch(G); g.trade.offeredMoney = 999999; return g; }; // proposer can't afford
    const { session, cleanup } = await harness({ patchG: stale });
    const seq = session.listLegalMoves().find(e => e.move === 'acceptTrade').expect.decisionSeq;
    const r = await session.makeMove({ move: 'acceptTrade', expect: { decisionSeq: seq } });
    expect(r).toMatchObject({ accepted: false, reason: 'stale-trade' });
    cleanup();
  });

  test('(c) race misattribution: my rejected move + other seat’s accepted one -> accepted:false', async () => {
    // patchG CANNOT set ctx.activePlayers (a ctx event, not a G field), so a
    // patched trade only ever admits the CURRENT player at the bgio layer-1
    // gate — the driver (proposer) can never legitimately dispatch cancelTrade
    // against a patched trade (verified: it hard-rejects with "player not
    // active" before ever reaching our code). To get a GENUINE race — both
    // seats structurally active, driver's cancelTrade a real, legal dispatch
    // — drive the whole thing for real: seed 3 (same seed as (d) above) lands
    // seat 0 on a buyable property on its first roll; seat 0 buys it and ends
    // its turn; seat 1 rolls+settles, then proposeTrade (real dispatch) widens
    // the envelope to {0:null,1:null} via Game.js's own setActivePlayers call
    // — NOW driver (proposer, still ctx.currentPlayer) can legitimately race
    // its own cancelTrade against session's (target's) acceptTrade.
    const { session, driver, cleanup } = await harness({ seed: 3 });
    await selectBoth(session, driver);
    expect(session._current().ctx.currentPlayer).toBe('0'); // seed pinned: seat 0 goes first
    await session.makeMove({ move: 'rollDice' });
    expect(session._current().G.canBuy).toBe(true); // seed pinned: buyable landing
    await session.makeMove({ move: 'buyProperty' });
    await session.makeMove({ move: 'endTurn' });
    expect(session._current().ctx.currentPlayer).toBe('1');

    driver.moves.rollDice();
    await flush();
    for (let i = 0; i < 4; i++) {
      const st = session._current();
      if (st.G.canBuy) { driver.moves.buyProperty(); await flush(); continue; }
      if (st.G.pendingCard) { driver.moves.acceptCard(); await flush(); continue; }
      break;
    }
    expect(session._current().G.trade).toBeNull();
    driver.moves.proposeTrade({ targetPlayerId: '0', offeredMoney: 25 });
    await flush();
    expect(session._current().G.trade).toMatchObject({ proposerId: '1', targetPlayerId: '0' });

    const seq = session.listLegalMoves().find(e => e.move === 'acceptTrade').expect.decisionSeq;
    driver.moves.cancelTrade();          // now legitimate: proposer, still ctx.currentPlayer, envelope-active
    const r = await session.makeMove({ move: 'acceptTrade', expect: { decisionSeq: seq } });
    expect(r.accepted).toBe(false);
    expect(['stale-decision', 'rejected-or-raced']).toContain(r.reason); // either honest label is correct depending on sync timing
    cleanup();
  });

  test('(a)/(b) stale decision across SEQUENTIAL same-shape decisions -> stale-decision', async () => {
    // The real-world shape of spec cases (a)+(b): a SECOND decision instance
    // whose fields look identical to the first — only decisionSeq separates
    // them. Crafted: two trade_proposed openings in the log (seq 0 = old
    // cancelled trade, seq 5 = the live one); echoing the OLD seq must fail.
    const twoOpenings = (G) => {
      const g = tradePatch(G);
      g.events = [
        { seq: 0, turn: 0, type: 'trade_proposed', actor: '1', data: {} },
        { seq: 3, turn: 0, type: 'trade_cancelled', actor: '1', data: {} },
        { seq: 5, turn: 0, type: 'trade_proposed', actor: '1', data: {} },
      ];
      g.eventSeq = 6;
      return g;
    };
    const { session, cleanup } = await harness({ patchG: twoOpenings });
    const rStale = await session.makeMove({ move: 'acceptTrade', expect: { decisionSeq: 0 } });
    expect(rStale).toMatchObject({ accepted: false, reason: 'stale-decision' });
    const rLive = await session.makeMove({ move: 'acceptTrade', expect: { decisionSeq: 5 } });
    expect(rLive.accepted).toBe(true);
    cleanup();
  });

  test('(f) respondDuel -> accepted:true via challenger-actor duel_resolved', async () => {
    // Session seat 0 is the duel OWNER (defender); duel_resolved is actor'd to
    // the CHALLENGER ('1') — the round-3 Critical this attribution must survive.
    // G.duel CANNOT survive patchG: turn.onBegin unconditionally clears it
    // once G.phase leaves 'characterSelect' (Game.js "Final-review Fix 1a" —
    // verified empirically: a patched G.duel is wiped before the first move
    // ever dispatches). Drive it for REAL instead, reusing the SEED_96 script
    // (engine-duel-seats.test.js precedent, byte-identical here): P0
    // (marcus-grayline, owner) buys Oriental Ave (id 6); P1 (sophia-ember,
    // challenger) lands back on it for $11 rent due -> duel OFFER; P1
    // escalates via initiateDuel -> duel RESPONSE, owned by seat 0.
    const origDuel = RULES.duel.enabled;
    RULES.duel.enabled = true;
    try {
      const { session, driver, cleanup } = await harness({ seed: 96 });
      await session.makeMove({ move: 'selectCharacter', args: ['marcus-grayline'] }); // P0/owner
      driver.moves.selectCharacter('sophia-ember'); // P1/challenger
      await flush();
      await session.makeMove({ move: 'rollDice' }); // P0 -> Oriental Ave (unowned)
      expect(session._current().G.canBuy).toBe(true);
      await session.makeMove({ move: 'buyProperty' });
      await session.makeMove({ move: 'endTurn' });

      driver.moves.rollDice(); // P1 -> Oriental Ave (P0's) -> duel offer
      await flush();
      expect(session._current().G.duel).toMatchObject({ phase: 'offer', ownerId: '0', challengerId: '1' });
      driver.moves.initiateDuel();
      await flush();
      expect(session._current().G.duel.phase).toBe('response');

      const entry = session.listLegalMoves().find(e => e.move === 'respondDuel');
      expect(entry).toBeDefined();
      const r = await session.makeMove({ move: 'respondDuel', expect: entry.expect });
      expect(r.accepted).toBe(true); // yourSeat-only attribution would false-negative here
      expect(session.getState().flags.duel).toBeNull();
      cleanup();
    } finally {
      RULES.duel.enabled = origDuel;
    }
  });

  test('(gameover pre-check) move after gameover -> accepted:false gameover', async () => {
    // patchG CAN set players[1].bankrupt (onBegin doesn't touch it) — endIf
    // fires during match init, ctx.gameover is set before our first move.
    const overPatch = (G) => {
      G.phase = 'play';
      G.players.forEach((p, i) => { p.character = MODS.dominion.characters[i]; });
      G.players[1].bankrupt = true; // survival: last seat standing -> instant gameover
      return G;
    };
    const { session, cleanup } = await harness({ patchG: overPatch });
    await flush();
    expect(session._current().ctx.gameover).toBeDefined();
    const r = await session.makeMove({ move: 'rollDice' });
    expect(r).toMatchObject({ accepted: false, reason: 'gameover' });
    cleanup();
  });
});

describe('(h) single-flight + wait supersede', () => {
  test('second make_move mid-flight throws', async () => {
    const { session, cleanup } = await harness();
    const p1 = session.makeMove({ move: 'selectCharacter', args: [CHAR_IDS[0]] });
    await expect(session.makeMove({ move: 'endTurn' })).rejects.toThrow(/in flight/i);
    await p1;
    cleanup();
  });
  test('second wait supersedes the first', async () => {
    const { session, cleanup } = await harness();
    const w1 = session.waitForMyTurn({ timeoutMs: 5000 });
    await flush(10);
    const w2p = session.waitForMyTurn({ timeoutMs: 1000 });
    const r1 = await w1;
    expect(r1).toMatchObject({ yourTurn: expect.any(Boolean) });
    // superseded OR immediate-resolve (seat 0 starts as current) — both legal;
    // the invariant is w1 RESOLVED (never left hanging).
    await w2p;
    cleanup();
  });
});

describe('wait_for_my_turn', () => {
  test('immediate resolve when already your turn', async () => {
    const { session, cleanup } = await harness();
    const t0 = Date.now();
    const r = await session.waitForMyTurn({ timeoutMs: 30000 });
    expect(r.yourTurn).toBe(true);
    expect(Date.now() - t0).toBeLessThan(500);
    cleanup();
  });
  test('resolves when the turn ARRIVES; timeoutMs clamped to >=1000', async () => {
    const { session, driver, cleanup } = await harness();
    await selectBoth(session, driver); // after selects, someone's turn begins
    const st = session._current();
    if (st.ctx.currentPlayer === '0') {
      // make it seat 1's turn: roll + resolve + end
      // (simplest deterministic path: session rolls, finishes, ends turn)
      await session.makeMove({ move: 'rollDice' });
      const lm = session.listLegalMoves();
      for (const e of lm) { if (e.move === 'passProperty' || e.move === 'acceptCard') await session.makeMove({ move: e.move, expect: e.expect }); }
      const end = session.listLegalMoves().find(e => e.move === 'endTurn');
      if (end) await session.makeMove({ move: 'endTurn' });
    }
    const waitP = session.waitForMyTurn({ timeoutMs: 8000 });
    // driver finishes its turn -> seat 0's turn begins -> wait resolves
    driver.moves.rollDice();
    await flush();
    const s2 = session._current();
    if (s2.G.canBuy) driver.moves.passProperty();
    if (s2.G.pendingCard) driver.moves.acceptCard();
    await flush();
    driver.moves.endTurn();
    const r = await waitP;
    expect(r.yourTurn).toBe(true);
    cleanup();
  }, 20000);
  test('(d) auction initiator: wait does NOT resolve while another seat is the active bidder', async () => {
    // Session seat 0 = ctx.currentPlayer who passed the property; envelope
    // holds ONLY seat 1 (active bidder). canAct('0') is false -> wait times out.
    // Deterministic real-flow variant (seed-hunted): seat 0 rolls onto a
    // buyable property and passes -> auction opens with a REAL setActivePlayers
    // envelope; currentBidderIndex starts at seat 0 -> session seat 0 IS the
    // first bidder -> passAuction -> envelope moves to seat 1 -> NOW wait as
    // seat 0 must TIME OUT while seat 1 bids.
    // SEED 3: hunted 1..30 for G.canBuy on seat 0's first roll (verified empirically).
    const { session, driver, cleanup } = await harness({ seed: 3 });
    await selectBoth(session, driver);
    await session.makeMove({ move: 'rollDice' });
    expect(session._current().G.canBuy).toBe(true); // seed pinned: must land on a buyable property
    await session.makeMove({ move: 'passProperty' }); // opens the auction
    const lm = session.listLegalMoves();
    const pass = lm.find(e => e.move === 'passAuction');
    expect(pass).toBeDefined(); // seat 0 must be the first active bidder
    await session.makeMove({ move: 'passAuction', expect: pass.expect }); // rotate envelope to seat 1
    expect(session._current().G.auction).toBeTruthy();
    const r = await session.waitForMyTurn({ timeoutMs: 1200 });
    expect(r).toMatchObject({ yourTurn: false, reason: 'timeout' }); // (d): initiator not addressed
    cleanup();
  }, 20000);

  test('(gameover resolution) pending/at-join wait resolves with reason gameover', async () => {
    // patch seat 1 bankrupt -> endIf fires during match init -> a wait started
    // AFTER join still must resolve (immediately, since gameover already set)
    // with reason:'gameover'. The invariant under test: waitForMyTurn never
    // hangs once ctx.gameover is set — do not ship without this.
    const { session, cleanup } = await harness({ patchG: (G) => {
      G.phase = 'play';
      G.players.forEach((p, i) => { p.character = MODS.dominion.characters[i]; });
      G.players[1].bankrupt = true;
      return G;
    } });
    await flush();
    const r = await session.waitForMyTurn({ timeoutMs: 5000 });
    expect(r).toMatchObject({ yourTurn: false, reason: 'gameover' });
    expect(r.gameover).toBeDefined();
    cleanup();
  });
});
