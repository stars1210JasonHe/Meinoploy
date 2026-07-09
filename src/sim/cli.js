// Atlas Balance Sim — CLI entry (plan D6). Run via `npm run sim -- <args>`.
//
//   --games N        number of games per pairing (default 200)
//   --map NAME       'classic' (default) | 'terra-circuit'
//   --seed S         base seed string (default '1'); per-game seed = `${seed}:${i}`
//   --maxTurns N     per-game turn cap (default 300)
//   --chars a,b      explicit two character ids for the character pairing; omit to
//                    auto-pick best-fit vs worst-fit by stat/trait alignment
//   --strategy s     route strategy for the CHARACTER pairing on atlas maps
//                    ('camper' default). The STRATEGY pairing (camper vs tourer)
//                    is run automatically on atlas maps regardless.
//   --duel-policy p  duelPolicy for BOTH contestants in every tournament this
//                    run drives ('never' default, matching bot.js's
//                    DEFAULT_POLICY — a no-op unless the active mod has
//                    RULES.duel.enabled). 'always' | 'strength' also accepted
//                    (see src/sim/bot.js DEFAULT_POLICY.duelPolicy).
//
// Prints, for each fairness question the map supports:
//   1. best-fit vs worst-fit CHARACTER win% (both maps)
//   2. camper vs tourer STRATEGY win% (atlas maps only — meaningless on a loop)
// each with a 95% CI and a PASS/FAIL on the 60/40 gate, plus (Task 7 of the
// duel mechanism) a per-character duel-cashflow table whenever any duel
// occurred during the run — silent otherwise, so duel-free runs are unchanged.

import { runTournament, runStrategyTournament } from './tournament';
import { CHARACTERS_DATA } from '../../mods/dominion/characters-data';
import { loadWorld } from '../world-loader';
import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';
import { TERRA_CIRCUIT } from '../../mods/dominion/atlas/worlds/terra-circuit';
import { TERRA_GLOBE } from '../../mods/dominion/atlas/worlds/terra-globe';
import { TERRA_TITANS } from '../../mods/dominion/atlas/worlds/terra-titans';

// Map registry — name → atlas world object (null = classic).
const WORLDS = {
  classic: null,
  'terra-circuit': TERRA_CIRCUIT,
  'terra-globe': TERRA_GLOBE,
  'terra-titans': TERRA_TITANS,
};

// --- arg parsing (no deps) -----------------------------------------------------
function parseArgs(argv) {
  const out = {
    games: 200,
    map: 'classic',
    seed: '1',
    maxTurns: 300,
    chars: null,
    strategy: 'camper',
    duelPolicy: 'never',
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    switch (key) {
      case 'games': out.games = parseInt(val, 10); i++; break;
      case 'map': out.map = val; i++; break;
      case 'seed': out.seed = String(val); i++; break;
      case 'maxTurns': out.maxTurns = parseInt(val, 10); i++; break;
      case 'chars': out.chars = val.split(',').map(s => s.trim()); i++; break;
      case 'strategy': out.strategy = val; i++; break;
      case 'duel-policy': out.duelPolicy = val; i++; break;
      default: break;
    }
  }
  return out;
}

// --- character fit scoring -----------------------------------------------------
// "Fit" = dot product of a character's stats with the map's trait leans. Higher =
// the character's strengths align with what the map rewards. With traits not yet
// affecting gameplay this is a raw-balance proxy (spec D4 acknowledges this).
// Classic has no traits → fall back to total-stat extremes (highest vs lowest sum),
// which is still a meaningful balance probe.
function statSum(c) {
  const s = c.stats;
  return s.capital + s.luck + s.negotiation + s.charisma + s.tech + s.stamina;
}

function fitScore(c, traits) {
  if (!traits || Object.keys(traits).length === 0) return statSum(c);
  let dot = 0;
  for (const stat in traits) dot += (c.stats[stat] || 0) * traits[stat];
  return dot;
}

function pickFitExtremes(traits) {
  const scored = CHARACTERS_DATA.map(c => ({ id: c.id, score: fitScore(c, traits) }));
  scored.sort((a, b) => b.score - a.score);
  return { best: scored[0], worst: scored[scored.length - 1] };
}

// --- table rendering -----------------------------------------------------------
function pct(x) { return (x * 100).toFixed(1) + '%'; }

function printTournament(title, result) {
  console.log('\n=== ' + title + ' ===');
  console.log(`map=${result.world}  games=${result.games}  decisive=${result.decisive}  draws=${result.draws}  seed=${result.seed}`);
  const w = Math.max.apply(null, result.table.map(r => r.label.length).concat([8]));
  console.log('  ' + 'contestant'.padEnd(w) + '   win%     95% CI            wins');
  result.table.forEach(r => {
    const ci = `[${pct(r.ciLow)}, ${pct(r.ciHigh)}]`;
    console.log('  ' + r.label.padEnd(w) + '   ' + pct(r.winPct).padStart(6) + '   ' + ci.padEnd(18) + r.wins);
  });
  const g = result.gate;
  const verdict = g.pass ? 'PASS' : 'FAIL';
  let line = `  GATE 60/40: ${verdict}  (leader ${g.leader} ${pct(g.maxWinPct)}, threshold ${pct(g.threshold)})`;
  if (g.ciStraddles50) line += '  [CI straddles 50% — not statistically separated]';
  console.log(line);
  printDuelStats(result.duelTable);
}

// Duel-cashflow table (Task 7 of the duel mechanism): per-character
// duelsInitiated/duelsWon/rentWaived/rentDoubledPaid, folded across the whole
// run. Silent (prints nothing) when duelTable is null — i.e. every duel-free
// run (RULES.duel.enabled off, or every contestant's duelPolicy is 'never')
// leaves this function's output identical to before Task 7 existed.
function printDuelStats(duelTable) {
  if (!duelTable || duelTable.length === 0) return;
  console.log('  --- duel cashflow ---');
  const w = Math.max.apply(null, duelTable.map(r => r.charId.length).concat([9]));
  console.log('  ' + 'character'.padEnd(w) + '   initiated   won   rentWaived   rentDoubledPaid');
  duelTable.forEach(r => {
    console.log(
      '  ' + r.charId.padEnd(w) + '   '
      + String(r.duelsInitiated).padStart(9) + '   '
      + String(r.duelsWon).padStart(3) + '   '
      + ('$' + r.rentWaived).padStart(10) + '   '
      + ('$' + r.rentDoubledPaid).padStart(15)
    );
  });
}

// --- main ----------------------------------------------------------------------
function main() {
  const args = parseArgs(process.argv.slice(2));
  const world = WORLDS[args.map];
  if (world === undefined) {
    console.error(`Unknown map "${args.map}". Known: ${Object.keys(WORLDS).join(', ')}`);
    process.exit(1);
  }
  const isAtlas = !!world;
  const traits = isAtlas ? loadWorld(world, ARCHETYPES).traits : null;

  console.log('Atlas Balance Simulator');
  console.log(`map=${args.map}  games=${args.games}  baseSeed=${args.seed}  maxTurns=${args.maxTurns}`);

  // --- Question 1: best-fit vs worst-fit CHARACTER (charId varies; policy held) ---
  let bestId, worstId;
  if (args.chars && args.chars.length === 2) {
    [bestId, worstId] = args.chars;
  } else {
    const ext = pickFitExtremes(traits);
    bestId = ext.best.id;
    worstId = ext.worst.id;
  }
  const charStrategy = isAtlas ? args.strategy : 'camper'; // strategy is a no-op on loop
  const charResult = runTournament({
    world,
    contestants: [
      { label: `best-fit:${bestId}`, charId: bestId, policy: { routeStrategy: charStrategy, duelPolicy: args.duelPolicy } },
      { label: `worst-fit:${worstId}`, charId: worstId, policy: { routeStrategy: charStrategy, duelPolicy: args.duelPolicy } },
    ],
    games: args.games,
    baseSeed: args.seed,
    maxTurns: args.maxTurns,
  });
  printTournament('CHARACTER: best-fit vs worst-fit', charResult);

  // --- Question 2: camper vs tourer STRATEGY (routeStrategy varies) ---
  // Only meaningful on atlas maps (loop maps have <=1 route choice). The two seats
  // need DISTINCT characters (the engine forbids picking the same one twice), so a
  // SINGLE fixed assignment would confound strategy with character strength.
  // runStrategyTournament removes that: it runs both character→strategy assignments
  // and tallies by STRATEGY, so the character edge nets out (see tournament.js).
  if (isAtlas) {
    const charX = 'cassian-echo';      // two distinct, stat-balanced (sum 34) carriers;
    const charY = 'renn-chainbreaker'; // identity is averaged out by the swap, not relied on.
    const stratResult = runStrategyTournament({
      world,
      charA: charX,
      charB: charY,
      strategyA: 'camper',
      strategyB: 'tourer',
      policyBase: { duelPolicy: args.duelPolicy },
      games: args.games,
      baseSeed: args.seed,
      maxTurns: args.maxTurns,
    });
    printTournament('STRATEGY: camper vs tourer (character-confound removed via swap)', stratResult);
    // Show the per-assignment split so the confound-removal is visible.
    const sub = stratResult.subTournaments;
    if (sub) {
      const fmt = rows => rows.map(r => `${r.label} ${pct(r.winPct)}`).join('  |  ');
      console.log(`    sub [${charX}=camper, ${charY}=tourer]: ${fmt(sub.charAisStrategyA)}`);
      console.log(`    sub [${charY}=camper, ${charX}=tourer]: ${fmt(sub.charBisStrategyA)}`);
    }
  } else {
    console.log('\n(STRATEGY camper-vs-tourer skipped: loop map has no route forks — strategy is a no-op.)');
  }

  console.log('\nNote: bot is a fixed "greedy-developer" baseline; conclusions are bounded by bot quality.');
  console.log('Traits do not yet affect gameplay, so character fit measures RAW stat balance today.');
}

main();
