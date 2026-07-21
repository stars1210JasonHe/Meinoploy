// Terra Titans Mod — Rules.
//
// v1 reuses Dominion's economy verbatim (same Monopoly mechanics; only the characters and
// the globe world differ). Extends BASE with duel.enabled = true for terra-titans-specific
// gameplay. PRISTINE-clone path in mods/index.js works with deep-clone isolation.
//
// passives.idealist.goBonus override (roster balance pass, 2026-07-21): root-caused via
// a driver-attribution probe (src/sim melee, 300 games, full event-log scan) — Chandragupta
// Maurya and Mansa Musa are the ONLY two idealist-passive leaders in this 16-leader roster,
// and idealist's flat per-hub-salary bonus was the ONLY economic channel with a clean
// nonzero-vs-zero split matching their STRONG melee flags exactly (measured ~$813-825/game
// guaranteed extra cash at the dominion-wide default of 50, from ~16.5 hub crossings/game —
// a frequency that is UNIFORM across the whole roster, so the edge is purely the flat bonus,
// not extra movement). The TERRA_TITANS globe world's hub cadence (~1 hub every 9 turns) is
// far denser than Dominion's single 40-space GO per lap, so the SAME passive value that is
// fine on Dominion's Mira Dawnlight compounds into a dominant edge here. Scoped to this mod
// only (NOT mods/dominion/rules.js) so Dominion's own idealist balance is untouched.
// Swept 50/25/20/15/10/5/0 (250-300 games/candidate); 10 is the smallest value that clears
// the melee STRONG flag on BOTH characters across 5 independent seeds (1-5, 300 games each,
// 0 flags on any character at any seed) — 25/20/15 still re-flagged on at least one seed.
import { RULES as BASE } from '../dominion/rules';
export const RULES = {
  ...BASE,
  duel: { ...BASE.duel, enabled: true },
  passives: { ...BASE.passives, idealist: { ...BASE.passives.idealist, goBonus: 10 } },
};
