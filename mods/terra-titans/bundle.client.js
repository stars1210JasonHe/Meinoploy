// Terra Titans mod — Tier B bundle (CLIENT only). Layers image-bearing fields over Tier A.
//
// NEVER import this from Game.js / server.js / the sim / tests — it pulls the keyArt PNG and
// the globe vendor lib, which `node -r esm` cannot load. App.js (Stage 3.8) imports this.
//
// v1 ships NO leader portraits (final pixel art TBD) — `portraits` is empty and the client
// CHARACTERS carry `portrait: null`, so App.js's portraitHtml falls back to a colored
// initial per leader. keyArt + the Terra real-city asset pack + the globe lib are reused
// from Dominion as placeholders.
import { terraTitansData } from './bundle.data';
import { CHARACTERS } from './characters';

// Reuse Dominion's hero key art as a placeholder until Terra Titans gets its own.
import keyArt from '../dominion/keyart.png';
// The globe world reuses the same real-city asset pack (city photos + world bg).
import { TERRA_ASSETS } from '../dominion/atlas/terra-assets';
import { getGlobe } from '../dominion/atlas/globe-lib';

export const terraTitansClient = Object.assign({}, terraTitansData, {
  // Override Tier-A `characters` (CHARACTERS_DATA, no portrait field) with the client
  // CHARACTERS array (each carries `portrait: null` → colored-initial placeholder).
  characters: CHARACTERS,
  // No portraits yet — initials fallback. (Map kept for App.js shape parity.)
  portraits: {},
  keyArt: keyArt,
  // atlasAssets is keyed by world id; the Terra Titans globe world's id is 'terra-titans'.
  atlasAssets: { 'terra-titans': TERRA_ASSETS },
  getGlobe: getGlobe,
});

export default terraTitansClient;
