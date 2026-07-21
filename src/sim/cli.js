// Mod Balance Sim — CLI entry (plan D6 + sim --mod wave 2026-07-14).
// Run via `npm run sim -- <args>`, e.g. `npm run sim -- --mod sanguo-excerpt`.
//
//   --mod ID         any registered mod (default 'dominion'); roster, rules and
//                    maps resolve from the mods/index.js registry
//   --seats N        melee seat cap (default 8; rosters above it rotate windows)
//   --games N        number of games per pairing/melee (default 200)
//   --map NAME       mod world id | mod map id | 'default'; dominion keeps the
//                    legacy names: 'classic' (default) | 'terra-circuit' | ...
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
//   --persuasion-policy p  persuasionPolicy (MT2-SP5 direction C2) for BOTH
//                    contestants in every tournament this run drives ('never'
//                    default, matching bot.js's DEFAULT_POLICY — same
//                    default-off convention as --duel-policy). 'always' |
//                    'valueful' also accepted (see src/sim/bot.js
//                    DEFAULT_POLICY.persuasionPolicy). Unlike --duel-policy,
//                    this never needs to force a RULES flag on — every mod's
//                    RULES.persuasion.enabled already defaults to true.
//                    Only the rent-refund (求情) and — when --duel-policy
//                    also makes a bot a challenger — duel-taunt (叫阵) seams
//                    are reachable; trade lobby (游说) is unreachable (the
//                    sim bot never proposes trades).
//
// Prints, for each fairness question the map supports:
//   1. best-fit vs worst-fit CHARACTER win% (both maps)
//   2. camper vs tourer STRATEGY win% (atlas maps only — meaningless on a loop)
// each with a 95% CI and a PASS/FAIL on the 60/40 gate, plus (Task 7 of the
// duel mechanism) a per-character duel-cashflow table whenever any duel
// occurred during the run — silent otherwise, so duel-free runs are unchanged.

import { runTournament, runStrategyTournament, runMeleeTournament } from './tournament';
import { ingestMap } from './match';
import { resolveMod, resolveMap, pickFitExtremes, pickBalancedPair } from './mod-resolve';
import { MODS } from '../../mods';
import { loadWorld } from '../world-loader';
import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';
import { TERRA_CIRCUIT } from '../../mods/dominion/atlas/worlds/terra-circuit';
import { TERRA_GLOBE } from '../../mods/dominion/atlas/worlds/terra-globe';
import { TERRA_TITANS } from '../../mods/dominion/atlas/worlds/terra-titans';
import { RULES } from '../../mods/active-rules';

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
    mod: 'dominion',
    games: 200,
    map: null, // resolved against the mod (dominion defaults to legacy 'classic')
    seed: '1',
    maxTurns: 300,
    chars: null,
    strategy: 'camper',
    duelPolicy: 'never',
    persuasionPolicy: 'never',
    seats: 8, // melee seat cap
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    switch (key) {
      case 'mod': out.mod = val; i++; break;
      case 'games': out.games = parseInt(val, 10); i++; break;
      case 'map': out.map = val; i++; break;
      case 'seed': out.seed = String(val); i++; break;
      case 'maxTurns': out.maxTurns = parseInt(val, 10); i++; break;
      case 'chars': out.chars = val.split(',').map(s => s.trim()); i++; break;
      case 'strategy': out.strategy = val; i++; break;
      case 'duel-policy': out.duelPolicy = val; i++; break;
      case 'persuasion-policy': out.persuasionPolicy = val; i++; break;
      case 'seats': out.seats = parseInt(val, 10); i++; break;
      default: break;
    }
  }
  return out;
}

// --- character fit scoring: moved to ./mod-resolve (pickFitExtremes over any
// roster; classic maps fall back to stat-sum extremes as before). --------------

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
// Melee table (sim --mod wave): per-character win rate vs the 1/seats baseline.
function printMelee(result, charNameById) {
  console.log('\n=== MELEE: full roster, per-character win rates ===');
  console.log(`seats=${result.seats}  games=${result.games}  baseline=${pct(1 / result.seats)}`);
  const w = Math.max.apply(null, result.rows.map(r => (charNameById[r.charId] || r.charId).length).concat([9]));
  console.log('  ' + 'character'.padEnd(w) + '   played   wins   win%     95% CI            flag');
  result.rows.forEach(r => {
    const name = charNameById[r.charId] || r.charId;
    const ci = `[${pct(r.ciLow)}, ${pct(r.ciHigh)}]`;
    console.log('  ' + name.padEnd(w) + '   '
      + String(r.games).padStart(6) + '   '
      + String(r.wins).padStart(4) + '   '
      + pct(r.winPct).padStart(6) + '   '
      + ci.padEnd(18)
      + (r.flag ? r.flag.toUpperCase() : ''));
  });
  const flagged = result.rows.filter(r => r.flag);
  console.log(flagged.length
    ? `  BALANCE: ${flagged.length} character(s) outside the baseline band — see flags above.`
    : '  BALANCE: no character significantly above/below the baseline band.');
  printDuelStats(result.duelTable);
}

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

  // --mod resolution (sim --mod wave): roster/rules/maps come from the registry.
  let mod, resolved;
  try {
    mod = resolveMod(MODS, args.mod);
    const mapName = args.map != null ? args.map : (mod.id === 'dominion' ? 'classic' : null);
    resolved = resolveMap(mod, mapName, WORLDS);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
  const { world, mapJson } = resolved;
  // dominion runs never pass modId → the legacy classic-map ingest path stays
  // byte-identical to the pre---mod CLI. Non-dominion runs always assert their
  // mod (roster validation + rules live on the active mod).
  const modId = mod.id === 'dominion' ? null : mod.id;
  const roster = mod.characters;
  // Prime the ingest ONCE before run-level RULES overrides (duel flag below) —
  // ingestMap's memo then never re-runs setActiveMod (which would reset RULES
  // from pristine) mid-run.
  ingestMap({ modId, world, mapJson });

  const isAtlas = !!world;
  const traits = isAtlas ? loadWorld(world, ARCHETYPES).traits : null;

  // Final-review Minor 5: fail loud on a typo'd --duel-policy instead of
  // silently falling through to bot.js's 'strength' branch (decideMoves'
  // duel-response logic treats anything that isn't 'never'/'always' as
  // 'strength' — see src/sim/bot.js), which would produce a misleading run
  // instead of an error.
  const VALID_DUEL_POLICIES = ['never', 'always', 'strength'];
  if (!VALID_DUEL_POLICIES.includes(args.duelPolicy)) {
    console.error(`Unknown --duel-policy "${args.duelPolicy}". Known: ${VALID_DUEL_POLICIES.join(', ')}`);
    process.exit(1);
  }

  // --duel-policy selects the BOTS' behavior, but duels are also gated by
  // RULES.duel.enabled — and this CLI never calls setActiveMod (the --map flag
  // picks an atlas WORLD, e.g. terra-titans, which is unrelated to the
  // terra-titans MOD that flips duel.enabled on). Without this, --duel-policy
  // silently runs zero duels against Dominion's default RULES.duel.enabled=false.
  // One-shot CLI process — no restore needed.
  if (args.duelPolicy && args.duelPolicy !== 'never') {
    RULES.duel.enabled = true;
    console.log(`Note: --duel-policy=${args.duelPolicy} forces RULES.duel.enabled=true for this run.`);
  }

  // Same fail-loud discipline as --duel-policy above (MT2-SP5 direction C2,
  // T4) — a typo'd --persuasion-policy must not silently fall through to
  // bot.js's decideMoves treating it as an implicit 'never' (persuasionPolicy
  // is checked with strict === comparisons throughout bot.js, so an unknown
  // string WOULD silently behave as 'never' rather than erroring — catch it
  // here instead of producing a misleading run).
  const VALID_PERSUASION_POLICIES = ['never', 'always', 'valueful'];
  if (!VALID_PERSUASION_POLICIES.includes(args.persuasionPolicy)) {
    console.error(`Unknown --persuasion-policy "${args.persuasionPolicy}". Known: ${VALID_PERSUASION_POLICIES.join(', ')}`);
    process.exit(1);
  }

  console.log('Mod Balance Simulator');
  console.log(`mod=${mod.id} (${mod.name})  map=${resolved.label}  games=${args.games}  baseSeed=${args.seed}  maxTurns=${args.maxTurns}`);

  const charNameById = {};
  roster.forEach(c => { charNameById[c.id] = c.name; });

  // --- Question 0 (sim --mod wave): MELEE — every character's win rate ---
  if (roster.length >= 2) {
    const melee = runMeleeTournament({
      roster: roster.map(c => c.id),
      games: args.games,
      seed: args.seed,
      world, mapJson, modId,
      maxTurns: args.maxTurns,
      maxSeats: args.seats,
      policy: { routeStrategy: isAtlas ? args.strategy : 'camper', duelPolicy: args.duelPolicy, persuasionPolicy: args.persuasionPolicy },
    });
    printMelee(melee, charNameById);
  }

  // --- Question 1: best-fit vs worst-fit CHARACTER (charId varies; policy held) ---
  let bestId, worstId;
  if (args.chars && args.chars.length === 2) {
    [bestId, worstId] = args.chars;
  } else {
    const ext = pickFitExtremes(roster, traits);
    bestId = ext.best.id;
    worstId = ext.worst.id;
  }
  const charStrategy = isAtlas ? args.strategy : 'camper'; // strategy is a no-op on loop
  const charResult = runTournament({
    world, mapJson, modId,
    contestants: [
      { label: `best-fit:${bestId}`, charId: bestId, policy: { routeStrategy: charStrategy, duelPolicy: args.duelPolicy, persuasionPolicy: args.persuasionPolicy } },
      { label: `worst-fit:${worstId}`, charId: worstId, policy: { routeStrategy: charStrategy, duelPolicy: args.duelPolicy, persuasionPolicy: args.persuasionPolicy } },
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
  if (isAtlas && roster.length >= 2) {
    // Two distinct, stat-balanced carriers from THIS mod's roster (was
    // hardcoded to dominion's cassian/renn — which don't exist on other mods);
    // identity is averaged out by the swap, not relied on.
    const [charX, charY] = pickBalancedPair(roster);
    const stratResult = runStrategyTournament({
      world, mapJson, modId,
      charA: charX,
      charB: charY,
      strategyA: 'camper',
      strategyB: 'tourer',
      policyBase: { duelPolicy: args.duelPolicy, persuasionPolicy: args.persuasionPolicy },
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
