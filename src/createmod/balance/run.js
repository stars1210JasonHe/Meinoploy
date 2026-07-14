// Create-Mod balance — real-sim assembly (spec §1-2). Bridges a NOT-YET-
// REGISTERED normalized mod input into the engine + sim: builds a mod-like
// object (roster closures + dominion board/cards/rules — exactly what emit
// will write), activates it via Game.setActiveModObject, and runs the melee
// on the mod's real board (world OR classic map.json via the sim's mapJson
// ingest). The optimizer's evaluate() re-activates per candidate roster.
import { setActiveModObject } from '../../Game';
import { runMeleeTournament, runTournament } from '../../sim/tournament';
import { pickFitExtremes } from '../../sim/mod-resolve';
import { deepClone } from '../../mod-loader';
import { RULES as DOMINION_RULES } from '../../../mods/dominion/rules';
import { BOARD_SPACES, COLOR_GROUPS } from '../../../mods/dominion/board';
import { CHANCE_CARDS, COMMUNITY_CARDS } from '../../../mods/dominion/cards';
import { loadWorld } from '../../world-loader';
import { ARCHETYPES } from '../../../mods/dominion/atlas/archetypes';
import { runAutoBalance } from './optimizer';

// Mirror characters-data.js's generated formula (create-mod emits the same).
function startingMoneyOf(char) {
  return DOMINION_RULES.core.baseStartingMoney
    + char.stats.capital * DOMINION_RULES.stats.capital.startingMoneyBonus;
}

export function buildModLike(normalized, roster) {
  const chars = roster || normalized.roster;
  return {
    id: normalized.id || 'createmod-balance-preview',
    rules: DOMINION_RULES,
    characters: chars,
    board: { spaces: BOARD_SPACES, colorGroups: COLOR_GROUPS },
    cards: { chance: CHANCE_CARDS, community: COMMUNITY_CARDS },
    getCharacterById: id => chars.find(c => c.id === id),
    getStartingMoney: startingMoneyOf,
  };
}

function activate(normalized, roster) {
  const modLike = buildModLike(normalized, roster);
  setActiveModObject(modLike, deepClone(modLike.rules));
}

function meleeFor(normalized, roster, games, seed, maxTurns) {
  activate(normalized, roster);
  return runMeleeTournament({
    roster: roster.map(c => c.id),
    games,
    seed,
    world: normalized.world || null,
    mapJson: normalized.map || null,
    maxTurns,
  });
}

function flagsOf(melee) {
  const flags = {};
  for (const r of melee.rows) if (r.flag) flags[r.charId] = r.flag;
  return flags;
}

function spreadOf(melee) {
  if (!melee.rows.length) return 0;
  return melee.rows[0].winPct - melee.rows[melee.rows.length - 1].winPct;
}

// Run the creation-time balance pass. Returns everything the CLI/report needs;
// when autoBalance is on and moves were applied, `tunedRoster` is non-null and
// the caller writes it back into `normalized.roster` BEFORE emit.
export function runCreateModBalance(normalized, opts) {
  const {
    games = 100, searchGames = 60, seed = '1',
    autoBalance = false, maxIterations = 8, maxEvals = 80,
    log = console.log,
  } = opts || {};
  const maxTurns = (normalized.world && normalized.world.victory && normalized.world.victory.maxTurns)
    || (normalized.map && normalized.map.victory && normalized.map.victory.maxTurns)
    || 150;

  const baseRoster = normalized.roster;
  const melee = meleeFor(normalized, baseRoster, games, `${seed}:melee`, maxTurns);
  log(`[balance] melee: seats=${melee.seats} games=${melee.games} flags=${Object.keys(flagsOf(melee)).length}`);

  // 1v1 fit gate on the REAL roster (the old slice ran two DOMINION characters
  // as a proxy — it measured the map, not the mod).
  let gate = null;
  if (baseRoster.length >= 2) {
    const traits = normalized.world ? loadWorld(normalized.world, ARCHETYPES).traits : null;
    const ext = pickFitExtremes(baseRoster, traits);
    activate(normalized, baseRoster);
    const res = runTournament({
      world: normalized.world || null,
      mapJson: normalized.map || null,
      contestants: [
        { label: `best-fit:${ext.best.id}`, charId: ext.best.id, policy: {} },
        { label: `worst-fit:${ext.worst.id}`, charId: ext.worst.id, policy: {} },
      ],
      games: Math.min(games, 100), baseSeed: `${seed}:gate`, maxTurns,
    });
    gate = res.gate;
    log(`[balance] gate 60/40: ${gate.pass ? 'PASS' : 'FAIL'} (leader ${gate.leader} ${(gate.maxWinPct * 100).toFixed(1)}%)`);
  }

  let auto = null;
  let tunedRoster = null;
  let verifyMelee = null;
  if (autoBalance && Object.keys(flagsOf(melee)).length > 0) {
    const evaluate = (roster, ctx) => {
      const m = meleeFor(normalized, roster, searchGames, ctx.seed, maxTurns);
      return { rows: m.rows, flags: flagsOf(m), spread: spreadOf(m) };
    };
    log(`[balance] auto-balance: search-games=${searchGames} max-evals=${maxEvals} (budget <= ${maxEvals} melee runs)`);
    auto = runAutoBalance({
      roster: baseRoster, evaluate,
      maxIterations, maxEvals, seed: `${seed}:auto`,
    });
    auto.ran = true;
    if (auto.appliedMoves.length) {
      tunedRoster = auto.roster;
      // fresh-seed verification at the full budget
      verifyMelee = meleeFor(normalized, tunedRoster, games, `${seed}:verify`, maxTurns);
      log(`[balance] auto-balance applied ${auto.appliedMoves.length} move(s); verify flags=${Object.keys(flagsOf(verifyMelee)).length}`);
    } else {
      log('[balance] auto-balance: no improving single-point move found (stall)');
    }
  }

  return { melee, gate, auto, tunedRoster, verifyMelee, flags: flagsOf(melee) };
}
