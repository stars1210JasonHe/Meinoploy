// Sim --mod resolution helpers (pure; spec 2026-07-14 §1). cli.js executes
// main() at import time, so anything a test needs lives HERE, not there.

// Resolve a registered mod by id, failing loud with the available list.
export function resolveMod(registry, id) {
  const mod = registry[id];
  if (!mod) {
    throw new Error(`Unknown mod "${id}". Registered: ${Object.keys(registry).join(', ')}`);
  }
  return mod;
}

// Resolve --map NAME against the active mod:
//   null/'default' → the mod's first world, else its first MAP, else the mod's
//                    bundled default board. NOTE: generated classic mods reuse
//                    dominion's board object as `mod.board` (Tier-A structure) —
//                    their REAL board lives in maps[0], so maps win over board.
//   world id       → { world }
//   map id         → { mapJson }
//   legacy names   → dominion only, via the caller-supplied legacyWorlds table
//                    (classic/terra-* keep the pre---mod CLI behavior byte-identical)
// Returns { world, mapJson, modDefault, label }.
export function resolveMap(mod, name, legacyWorlds) {
  const worlds = mod.worlds || [];
  const maps = mod.maps || [];
  if (mod.id === 'dominion' && legacyWorlds && name != null && name in legacyWorlds) {
    return { world: legacyWorlds[name], mapJson: null, modDefault: false, label: name };
  }
  if (name == null || name === 'default') {
    if (worlds.length) return { world: worlds[0], mapJson: null, modDefault: false, label: worlds[0].id };
    if (maps.length) return { world: null, mapJson: maps[0], modDefault: false, label: maps[0].id };
    return { world: null, mapJson: null, modDefault: true, label: 'default' };
  }
  const w = worlds.find(x => x.id === name);
  if (w) return { world: w, mapJson: null, modDefault: false, label: w.id };
  const m = maps.find(x => x.id === name);
  if (m) return { world: null, mapJson: m, modDefault: false, label: m.id };
  const known = ['default']
    .concat(worlds.map(x => x.id), maps.map(x => x.id))
    .concat(mod.id === 'dominion' && legacyWorlds ? Object.keys(legacyWorlds) : []);
  throw new Error(`Unknown map "${name}" for mod "${mod.id}". Known: ${known.join(', ')}`);
}

function statSum(c) {
  const s = c.stats;
  return s.capital + s.luck + s.negotiation + s.charisma + s.tech + s.stamina;
}

export function fitScore(c, traits) {
  if (!traits || Object.keys(traits).length === 0) return statSum(c);
  let dot = 0;
  for (const stat in traits) dot += (c.stats[stat] || 0) * traits[stat];
  return dot;
}

// Best-fit vs worst-fit over ANY roster (was hardcoded to dominion's).
export function pickFitExtremes(roster, traits) {
  const scored = roster.map(c => ({ id: c.id, score: fitScore(c, traits) }));
  scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  return { best: scored[0], worst: scored[scored.length - 1] };
}

// Two stat-balanced strategy carriers for the camper/tourer question: the pair
// whose stat sums sit closest to the roster median (deterministic id tiebreak).
// Dominion's historical pair (cassian/renn, both sum-34) falls out naturally.
export function pickBalancedPair(roster) {
  if (roster.length < 2) throw new Error('pickBalancedPair: roster needs >= 2 characters');
  const scored = roster.map(c => ({ id: c.id, sum: statSum(c) }));
  const sums = scored.map(s => s.sum).sort((a, b) => a - b);
  const median = sums[Math.floor(sums.length / 2)];
  scored.sort((a, b) =>
    Math.abs(a.sum - median) - Math.abs(b.sum - median) || a.id.localeCompare(b.id));
  return [scored[0].id, scored[1].id];
}
