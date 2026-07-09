// Terra Titans Mod — Rules.
//
// v1 reuses Dominion's economy verbatim (same Monopoly mechanics; only the characters and
// the globe world differ). Extends BASE with duel.enabled = true for terra-titans-specific
// gameplay. PRISTINE-clone path in mods/index.js works with deep-clone isolation.
import { RULES as BASE } from '../dominion/rules';
export const RULES = { ...BASE, duel: { ...BASE.duel, enabled: true } };
