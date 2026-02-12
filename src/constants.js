// Engine constants — re-exported from active mod's rules config
// App.js imports from here for backward compatibility.
// All values are defined in mods/dominion/rules.js.

import { RULES } from '../mods/dominion';

export const BUILDING_NAMES = RULES.buildings.names;
export const BUILDING_ICONS = RULES.buildings.icons;
export const UPGRADE_COST_MULTIPLIERS = RULES.buildings.upgradeCostMultipliers;
export const RENT_MULTIPLIERS = RULES.buildings.rentMultipliers;

export const SEASONS = RULES.seasons.list;
export const SEASON_CHANGE_INTERVAL = RULES.seasons.changeInterval;

export const PLAYER_COLORS = RULES.display.playerColors;
export const PLAYER_TOKENS = RULES.display.playerTokens;
