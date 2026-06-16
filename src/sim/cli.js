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
//
// Prints, for each fairness question the map supports:
//   1. best-fit vs worst-fit CHARACTER win% (both maps)
//   2. camper vs tourer STRATEGY win% (atlas maps only — meaningless on a loop)
// each with a 95% CI and a PASS/FAIL on the 60/40 gate.

import { runTournament } from './tournament';
import { CHARACTERS_DATA } from '../../mods/dominion/characters-data';
import { loadWorld } from '../world-loader';
import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';
import { TERRA_CIRCUIT } from '../../mods/dominion/atlas/worlds/terra-circuit';

// Map registry — name → atlas world object (null = classic).
const WORLDS = {
  classic: null,
  'terra-circuit': TERRA_CIRCUIT,
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
      { label: `best-fit:${bestId}`, charId: bestId, policy: { routeStrategy: charStrategy } },
      { label: `worst-fit:${worstId}`, charId: worstId, policy: { routeStrategy: charStrategy } },
    ],
    games: args.games,
    baseSeed: args.seed,
    maxTurns: args.maxTurns,
  });
  printTournament('CHARACTER: best-fit vs worst-fit', charResult);

  // --- Question 2: camper vs tourer STRATEGY (routeStrategy varies) ---
  // Only meaningful on atlas maps (loop maps have <=1 route choice). The two seats
  // need DISTINCT characters (the engine forbids picking the same one twice), so we
  // use two stat-balanced, equal-stat-sum (34) characters to minimize the residual
  // character confound — strategy is the intended variable. Seat rotation already
  // de-biases turn order. (A perfectly char-isolated test is impossible in a single
  // game; this is the closest available proxy.)
  if (isAtlas) {
    const camperChar = 'cassian-echo';     // sum 34, balanced 6/5/6/6/6/5
    const tourerChar = 'renn-chainbreaker'; // sum 34, balanced 5/5/4/6/7/7
    const stratResult = runTournament({
      world,
      contestants: [
        { label: `camper:${camperChar}`, charId: camperChar, policy: { routeStrategy: 'camper' } },
        { label: `tourer:${tourerChar}`, charId: tourerChar, policy: { routeStrategy: 'tourer' } },
      ],
      games: args.games,
      baseSeed: args.seed,
      maxTurns: args.maxTurns,
    });
    printTournament('STRATEGY: camper vs tourer', stratResult);
  } else {
    console.log('\n(STRATEGY camper-vs-tourer skipped: loop map has no route forks — strategy is a no-op.)');
  }

  console.log('\nNote: bot is a fixed "greedy-developer" baseline; conclusions are bounded by bot quality.');
  console.log('Traits do not yet affect gameplay, so character fit measures RAW stat balance today.');
}

main();
