// Terra Titans Mod — Character data for the CLIENT.
//
// Unlike Dominion, this mod ships NO portrait PNGs yet — final pixel art will be
// commissioned later. We deliberately leave `portrait: null` so App.js's portraitHtml
// falls back to a colored initial (the placeholder), tinted by each leader's hex color.
// When portraits land, mirror Dominion's PORTRAIT_MAP pattern here.

import { CHARACTERS_DATA, getCharacterById, getStartingMoney } from './characters-data';

// No portrait imports — every leader renders as a colored-initial placeholder.
export const CHARACTERS = CHARACTERS_DATA.map(char => ({
  ...char,
  portrait: null,
}));

// Re-export helpers
export { getCharacterById, getStartingMoney };
