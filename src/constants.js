// Engine constants — derived from the active mod's live RULES object.
// App.js imports from here for backward compatibility.
//
// These are read once at import in App.js (destructured), so they would FREEZE at the
// default mod's values. To support runtime mod switching, they are `export let` and
// re-derived from the live RULES by refreshConstants(), which setActiveMod() calls after it
// mutates RULES in place. (Live-binding of reassigned `export let` through Parcel's
// destructured imports is verified in Stage 2; the engine/tests read these directly.)
import { RULES } from '../mods/active-rules';

export let BUILDING_NAMES = RULES.buildings.names;
export let BUILDING_ICONS = RULES.buildings.icons;
export let UPGRADE_COST_MULTIPLIERS = RULES.buildings.upgradeCostMultipliers;
export let RENT_MULTIPLIERS = RULES.buildings.rentMultipliers;

export let SEASONS = RULES.seasons.list;
export let SEASON_CHANGE_INTERVAL = RULES.seasons.changeInterval;

export let PLAYER_COLORS = RULES.display.playerColors;
export let PLAYER_TOKENS = RULES.display.playerTokens;

// Re-derive every exported constant from the live (possibly just-mutated) RULES object.
// Called by setActiveMod() after it swaps RULES in place.
export function refreshConstants() {
  BUILDING_NAMES = RULES.buildings.names;
  BUILDING_ICONS = RULES.buildings.icons;
  UPGRADE_COST_MULTIPLIERS = RULES.buildings.upgradeCostMultipliers;
  RENT_MULTIPLIERS = RULES.buildings.rentMultipliers;

  SEASONS = RULES.seasons.list;
  SEASON_CHANGE_INTERVAL = RULES.seasons.changeInterval;

  PLAYER_COLORS = RULES.display.playerColors;
  PLAYER_TOKENS = RULES.display.playerTokens;
}
