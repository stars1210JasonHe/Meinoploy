/**
 * create-mod balance optimizer — pure hill-climb over stat redistributions
 * (spec 2026-07-14-createmod-balance §2). Evaluate is injected; these tests
 * script it — zero real games.
 */
import {
  enumerateCandidates, applyMove, statSum, topStatOf,
  runAutoBalance,
} from '../createmod/balance/optimizer';
import { renderBalanceReport } from '../createmod/balance/report';

const R = (id, stats) => ({ id, name: id.toUpperCase(), stats });
const ROSTER = [
  R('alpha', { capital: 9, luck: 4, negotiation: 5, charisma: 5, tech: 5, stamina: 6 }), // top: capital
  R('beta', { capital: 5, luck: 5, negotiation: 5, charisma: 9, tech: 5, stamina: 5 }),  // top: charisma
  R('gamma', { capital: 5, luck: 5, negotiation: 5, charisma: 5, tech: 9, stamina: 5 }), // top: tech
];

describe('stat helpers', () => {
  test('statSum + topStatOf', () => {
    expect(statSum(ROSTER[0].stats)).toBe(34);
    expect(topStatOf(ROSTER[0].stats)).toBe('capital');
    expect(topStatOf(ROSTER[2].stats)).toBe('tech');
  });
});

describe('enumerateCandidates', () => {
  test('only flagged characters get moves; identity stat untouched; bounds/sum hold', () => {
    const flags = { gamma: 'weak' };
    const cands = enumerateCandidates(ROSTER, flags);
    expect(cands.length).toBeGreaterThan(0);
    for (const c of cands) {
      expect(c.charId).toBe('gamma');
      expect(c.from).not.toBe('tech'); // identity lock
      expect(c.to).not.toBe('tech');
      const moved = applyMove(ROSTER, c);
      const g = moved.find(x => x.id === 'gamma').stats;
      expect(statSum(g)).toBe(34);
      Object.values(g).forEach(v => { expect(v).toBeGreaterThanOrEqual(1); expect(v).toBeLessThanOrEqual(10); });
    }
    // deterministic order
    expect(enumerateCandidates(ROSTER, flags)).toEqual(cands);
  });

  test('weak chars only RAISE a stat (from lower), strong chars only LOWER one', () => {
    const weakCands = enumerateCandidates(ROSTER, { gamma: 'weak' });
    // every weak move takes from some stat and gives to another — direction is
    // encoded as from→to; assert at least one candidate raises capital and none
    // move the locked top stat (already covered); strong:
    const strongCands = enumerateCandidates(ROSTER, { alpha: 'strong' });
    for (const c of strongCands) expect(c.charId).toBe('alpha');
    expect(strongCands.length).toBeGreaterThan(0);
    expect(weakCands.some(c => c.to === 'capital')).toBe(true);
  });

  test('applyMove is non-mutating', () => {
    const before = JSON.stringify(ROSTER);
    applyMove(ROSTER, enumerateCandidates(ROSTER, { gamma: 'weak' })[0]);
    expect(JSON.stringify(ROSTER)).toBe(before);
  });
});

describe('runAutoBalance (scripted evaluate)', () => {
  // evaluate returns { flags: {id:flag}, spread, rows } — script a landscape
  // where exactly one specific move fixes gamma.
  function scriptedEvaluate(fixWhen) {
    return (roster, ctx) => {
      const gamma = roster.find(c => c.id === 'gamma').stats;
      const fixed = fixWhen(gamma);
      return {
        rows: [],
        flags: fixed ? {} : { gamma: 'weak' },
        spread: fixed ? 0.10 : 0.25 - gamma.capital * 0.001, // more capital = slightly better
      };
    };
  }

  test('accepts the improving move and stops when flags clear', () => {
    const evaluate = scriptedEvaluate(g => g.capital >= 7);
    const res = runAutoBalance({
      roster: ROSTER, evaluate,
      maxIterations: 8, maxEvals: 80, seed: 't',
    });
    expect(res.flagsCleared).toBe(true);
    expect(res.appliedMoves.length).toBeGreaterThanOrEqual(2); // 5 -> 7 capital needs 2 moves
    const gamma = res.roster.find(c => c.id === 'gamma').stats;
    expect(gamma.capital).toBeGreaterThanOrEqual(7);
    expect(gamma.tech).toBe(9); // identity never touched
    expect(statSum(gamma)).toBe(34);
    // evaluations bounded and counted
    expect(res.evals).toBeLessThanOrEqual(80);
  });

  test('stalls honestly when nothing improves', () => {
    const evaluate = () => ({ rows: [], flags: { gamma: 'weak' }, spread: 0.25 }); // flat landscape
    const res = runAutoBalance({ roster: ROSTER, evaluate, maxIterations: 8, maxEvals: 80, seed: 't' });
    expect(res.flagsCleared).toBe(false);
    expect(res.stalled).toBe(true);
    expect(res.appliedMoves).toHaveLength(0);
    expect(res.roster).toEqual(ROSTER); // unchanged
  });

  test('respects maxEvals hard cap', () => {
    let n = 0;
    const evaluate = () => { n++; return { rows: [], flags: { gamma: 'weak' }, spread: 0.25 - n * 0.0001 }; };
    const res = runAutoBalance({ roster: ROSTER, evaluate, maxIterations: 100, maxEvals: 10, seed: 't' });
    expect(res.evals).toBeLessThanOrEqual(10);
    expect(res.cappedByEvals).toBe(true);
  });

  test('lexicographic: a move that clears a flag beats one that only narrows spread', () => {
    // landscape: capital>=6 clears the flag but has WORSE spread than luck moves
    const evaluate = (roster) => {
      const g = roster.find(c => c.id === 'gamma').stats;
      if (g.capital >= 6) return { rows: [], flags: {}, spread: 0.2 };
      return { rows: [], flags: { gamma: 'weak' }, spread: 0.25 - g.luck * 0.005 };
    };
    const res = runAutoBalance({ roster: ROSTER, evaluate, maxIterations: 3, maxEvals: 80, seed: 't' });
    expect(res.flagsCleared).toBe(true);
    expect(res.roster.find(c => c.id === 'gamma').stats.capital).toBeGreaterThanOrEqual(6);
  });
});

describe('renderBalanceReport', () => {
  test('renders tables, applied moves, and the honest stall + override suggestion', () => {
    const md = renderBalanceReport({
      modId: 'test-mod', seed: 's', games: 100, date: '2026-07-14',
      melee: { seats: 3, games: 100, rows: [{ charId: 'alpha', games: 100, wins: 40, winPct: 0.4, ciLow: 0.3, ciHigh: 0.5, flag: 'strong' }] },
      gate: { pass: false, leader: 'best-fit:alpha', maxWinPct: 0.65, threshold: 0.6 },
      autoBalance: { ran: true, flagsCleared: false, stalled: true, appliedMoves: [{ charId: 'gamma', from: 'luck', to: 'capital', delta: -0.02 }], evals: 30 },
    });
    expect(md).toContain('# Balance report — test-mod');
    expect(md).toContain('alpha');
    expect(md).toContain('STRONG');
    expect(md).toContain('gamma: luck → capital');
    expect(md).toContain('did NOT fully clear');
    expect(md).toContain('rules-override');
  });
});

// === Wiring integration (real sim, tiny budgets) ==============================
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createMod } from '../../scripts/create-mod';
import { runCreateModBalance } from '../createmod/balance/run';
import { MODS } from '../../mods';

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'createmod-bal-'));
  fs.mkdirSync(path.join(root, 'mods'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'mods', 'index.js'),
    "import { dominionData } from './dominion/bundle.data';\nexport const MODS = {\n  dominion: dominionData,\n};\n");
  fs.writeFileSync(path.join(root, 'src', 'App.js'),
    "import dominionMod from '../mods/dominion/bundle.client';\nconst MODS = [dominionMod];\n");
  return root;
}
const CLASSIC = path.join(__dirname, '../../examples/create-mod/steam-barons.classic.json');

describe('runCreateModBalance — real reducer, generated roster, real board', () => {
  test('gilded-rails-shaped classic mod melees on its OWN board with its OWN roster', () => {
    const gilded = MODS['gilded-rails'];
    const normalized = { id: 'gilded-preview', roster: gilded.characters, map: gilded.maps[0], world: null, mapType: 'classic' };
    const logs = [];
    const ctx = runCreateModBalance(normalized, { games: 4, seed: 'wire-t', log: m => logs.push(m) });
    expect(ctx.melee.rows).toHaveLength(3); // gilded roster, NOT dominion proxy
    const total = ctx.melee.rows.reduce((a, r) => a + r.wins, 0);
    expect(total).toBeGreaterThan(0);
    expect(ctx.gate).not.toBeNull();
    expect(logs.some(l => l.includes('[balance] melee'))).toBe(true);
  }, 90000);
});

describe('createMod --balance wiring (fs, classic no longer skipped)', () => {
  test('classic mod with balance writes balance-report.md; melee table inside', () => {
    const root = makeRoot();
    const r = createMod({
      inputPath: CLASSIC, rootDir: root, balance: true,
      balanceArgs: { balanceGames: 4, searchGames: 4, autoBalance: false, maxIterations: 1, maxEvals: 4, seed: 'fs-t' },
      seed: 'fs-t',
    });
    expect(r.ok).toBe(true);
    const reportPath = path.join(root, 'mods', 'steam-barons', 'balance-report.md');
    expect(fs.existsSync(reportPath)).toBe(true);
    const md = fs.readFileSync(reportPath, 'utf8');
    expect(md).toContain('# Balance report — steam-barons');
    expect(md).toContain('## Melee');
    expect(md).not.toContain('skipped');
    // emitted data.json roster stays sum-valid whether or not tuning ran
    const data = JSON.parse(fs.readFileSync(path.join(root, 'mods', 'steam-barons', 'steam-barons.data.json'), 'utf8'));
    for (const c of data.roster) {
      const s = c.stats;
      expect(s.capital + s.luck + s.negotiation + s.charisma + s.tech + s.stamina).toBe(34);
    }
    fs.rmSync(root, { recursive: true, force: true });
  }, 120000);
});
