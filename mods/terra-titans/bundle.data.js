// Terra Titans mod — Tier A bundle (server/test-safe). NO image imports.
//
// Mirrors mods/dominion/bundle.data.js. v1 REUSES Dominion's economy (rules) and the loop
// board/color groups as an inert classic-board fallback (`board:` below) — only the 16
// historical-leader roster, the event card decks (ticket A2), and the Terra Titans globe world
// are mod-specific. `cards:` below is the Tier-A "mod default board" value: it is briefly
// installed by setActiveMod() and IMMEDIATELY overwritten by the setActiveMap(loadWorld(...))
// call every real terra-titans game makes (Terra Titans ships no map.json boards — `maps: []`
// below — only its world), so the deck that actually matters in play is
// `TERRA_TITANS.cards` (mods/dominion/atlas/worlds/terra-titans.js), which imports the SAME
// ./cards.js arrays. Kept in sync here anyway so this field is never stale/misleading if some
// future caller ever reads `terraTitansData.cards` directly. The client layers
// portraits/keyArt/atlas assets on top in bundle.client.js; this file stays PNG-free so
// `node -r esm` / the server can import it.

import { RULES } from './rules';
import { CHARACTERS_DATA, getCharacterById, getStartingMoney } from './characters-data';
import { BOARD_SPACES, COLOR_GROUPS } from '../dominion/board';
import { CHANCE_CARDS, COMMUNITY_CARDS } from './cards';
import { CHARACTER_LORE, getLoreById } from './lore';

// The 49-city globe world (plain JS data — no images).
import { TERRA_TITANS } from '../dominion/atlas/worlds/terra-titans';

export const terraTitansData = {
  id: 'terra-titans',
  name: 'Terra Titans',
  tagline: 'History’s greatest empire-builders contest a 49-city pixel Earth.',
  version: '1.0',

  rules: RULES,
  characters: CHARACTERS_DATA,
  board: { spaces: BOARD_SPACES, colorGroups: COLOR_GROUPS },
  cards: { chance: CHANCE_CARDS, community: COMMUNITY_CARDS },
  lore: CHARACTER_LORE,

  getCharacterById,
  getStartingMoney,
  getLoreById,

  maps: [],
  worlds: [TERRA_TITANS],
};

export default terraTitansData;
