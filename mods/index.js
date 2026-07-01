// Mod registry — static, server/test-safe (Tier A only). NO image imports here.
//
// Parcel v1 forces all imports to be static, so every registered mod is bundled at build
// time; only WHICH mod is active is chosen at runtime (mirrors AVAILABLE_MAPS, one level up).
// The CLIENT registry (with portraits/keyart/atlas assets) lives in App.js, NOT here.
import { deepClone } from '../src/mod-loader';
import { dominionData } from './dominion/bundle.data';
import { terraTitansData } from './terra-titans/bundle.data';

// Tier-A data bundles, keyed by mod id.
import { ancientEmpiresData } from './ancient-empires/bundle.data';
import { steamBaronsData } from './steam-barons/bundle.data';
import { silkRoadData } from './silk-road/bundle.data';
import { gildedRailsData } from './gilded-rails/bundle.data';
export const MODS = {
  'gilded-rails': gildedRailsData,
  'silk-road': silkRoadData,
  'steam-barons': steamBaronsData,
  'ancient-empires': ancientEmpiresData,
  dominion: dominionData,
  'terra-titans': terraTitansData,
};

// PRISTINE deep-clone of each mod's rules, captured at registry load — BEFORE any
// setActiveMod can mutate the live RULES object. setActiveMod reseeds from THIS, never from
// the live (possibly mutated) RULES, so switching mods can never corrupt a mod's economy.
//
// IMPORTANT timing: the live RULES (mods/active-rules.js) shares identity with Dominion's
// source rules object. We clone it here at load, while it still holds Dominion's pristine
// values, so the clone is a true snapshot.
export const PRISTINE = {};
for (const id of Object.keys(MODS)) {
  PRISTINE[id] = deepClone(MODS[id].rules);
}
