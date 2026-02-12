// Engine constants — shared across all mods

// Building upgrade tiers
export const BUILDING_NAMES = ['Vacant', 'House', 'Hotel', 'Skyscraper', 'Landmark'];
export const BUILDING_ICONS = ['', '\u{1F3E0}', '\u{1F3E8}', '\u{1F3D9}\u{FE0F}', '\u{1F3DB}\u{FE0F}'];
export const UPGRADE_COST_MULTIPLIERS = [0.5, 0.75, 1.0, 1.5]; // cost to reach level 1,2,3,4
export const RENT_MULTIPLIERS = [1, 3, 7, 12, 20]; // rent multiplier at level 0,1,2,3,4

// Season system: cycles every 10 turns (Summer first = neutral start)
export const SEASONS = [
  { id: 'summer', name: 'Summer', icon: '\u{2600}\u{FE0F}', priceMod: 1.0, rentMod: 1.0, taxMod: 1.0 },
  { id: 'autumn', name: 'Autumn', icon: '\u{1F342}', priceMod: 0.90, rentMod: 1.0, taxMod: 1.0 },
  { id: 'winter', name: 'Winter', icon: '\u{2744}\u{FE0F}', priceMod: 1.0, rentMod: 1.20, taxMod: 2.0 },
  { id: 'spring', name: 'Spring', icon: '\u{1F338}', priceMod: 1.10, rentMod: 1.0, taxMod: 1.0 },
];
export const SEASON_CHANGE_INTERVAL = 10; // turns per season

// Player display
export const PLAYER_COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12'];
export const PLAYER_TOKENS = ['\u{1F534}', '\u{1F535}', '\u{1F7E2}', '\u{1F7E1}'];
