// Create-Mod smart-builder — orchestrator + seeded PRNG. Pure (no fs/images).
// expandFacts (added by a later task) is the only public entry the CLI calls.

import { deriveTopology } from './topology';
import { deriveRoster } from './roster';
import { deriveClassicBoard } from './board';

// mulberry32 seeded from a 32-bit string hash. The ONLY randomness source in smart/*
// (Math.random/Date.now are forbidden — they break same-seed reproducibility).
export function makeRng(seedString) {
  const s = String(seedString);
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Facts -> near-final SP1 input (the exact shape validateModInput consumes). Pure +
// deterministic; SP1's normalizeInput still owns world.size, pos-from-geo, map.id/name,
// and lore stubs — this function must not duplicate those.
export function expandFacts(facts, opts) {
  const { ARCHETYPES, seed } = opts || {};
  if (!facts || typeof facts !== 'object') throw new Error('facts must be an object');
  if (facts.mapType !== 'atlas' && facts.mapType !== 'classic') {
    throw new Error(`facts.mapType must be "atlas" or "classic" (got "${facts.mapType}")`);
  }
  if (!Array.isArray(facts.roster) || facts.roster.length === 0) {
    throw new Error('facts.roster must be a non-empty array');
  }
  if (facts.mapType === 'atlas' && !(facts.world && Array.isArray(facts.world.places))) {
    throw new Error('atlas facts require world.places');
  }
  if (facts.mapType === 'classic' && !(facts.board && Array.isArray(facts.board.groups))) {
    throw new Error('classic facts require board.groups');
  }

  const rng = makeRng(seed !== undefined ? seed : (facts.seed !== undefined ? facts.seed : facts.id));
  const roster = deriveRoster(facts.roster, { rng });
  const out = {
    id: facts.id,
    name: facts.name,
    tagline: facts.tagline,
    version: facts.version,
    mapType: facts.mapType,
    reuse: facts.reuse,
    roster,
  };
  if (facts.mapType === 'atlas') {
    const { connectorsByPlace, hubs } = deriveTopology(facts.world.places, { ARCHETYPES, rng });
    out.world = {
      id: facts.id,
      name: facts.name,
      movementMode: 'atlas',
      renderMode: facts.world.renderMode !== undefined ? facts.world.renderMode : 'globe',
      places: facts.world.places.map(p => Object.assign({}, p, { connectors: connectorsByPlace[p.id] })),
      hubs,
      winPaths: facts.world.winPaths || ['dominion', 'wealth', 'survival'],
      victory: facts.world.victory || { maxTurns: 200, params: { groupsToWin: 2 } },
    };
  } else {
    out.map = deriveClassicBoard(facts.board, { rng });
  }
  return out;
}
