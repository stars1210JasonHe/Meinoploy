// Dominion mod — Tier B bundle (CLIENT only). Layers image-bearing fields over Tier A.
//
// NEVER import this from Game.js / server.js / the sim / tests — it pulls PNG/JPG and the
// globe vendor lib, which `node -r esm` cannot load. App.js (Stage 2) imports this.
//
// It spreads the Tier A data bundle and adds the client-only static assets.
import { dominionData } from './bundle.data';

// Portraits: characters.js attaches portraits per character via an internal PORTRAIT_MAP
// and exports the merged CHARACTERS array (each char gets a `.portrait` pngUrl). We rebuild
// the id→pngUrl map here so the bundle exposes `portraits` directly.
import { CHARACTERS } from './characters';

import keyArt from './keyart.png';
import { TERRA_ASSETS } from './atlas/terra-assets';
import { getGlobe } from './atlas/globe-lib';

const portraits = {};
CHARACTERS.forEach(function (c) {
  portraits[c.id] = c.portrait || null;
});

export const dominionClient = Object.assign({}, dominionData, {
  // Override the Tier-A `characters` (CHARACTERS_DATA, no images) with the portrait-merged
  // CHARACTERS array so App.js can read `activeMod.characters` directly with `.portrait` set —
  // byte-identical to what App.js used to import from the `../mods/dominion` barrel.
  characters: CHARACTERS,
  portraits: portraits,
  keyArt: keyArt,
  // Both Terra worlds reuse the same real-city asset pack (city photos + world bg).
  atlasAssets: { 'terra-circuit': TERRA_ASSETS, 'terra-globe': TERRA_ASSETS },
  getGlobe: getGlobe,
});

export default dominionClient;
