// Dominion mod — Tier A bundle (server/test-safe). NO image imports.
//
// This is the data bundle the engine, server, sim, and tests can safely import: it is a
// thin aggregator over TODAY's existing modules — it rewrites NO data. It mirrors the
// characters-data.js (server-safe) vs characters.js (client, with PNGs) split, one level up.
// The client adds image-bearing fields on top of this in bundle.client.js.

import { RULES } from './rules';
import { CHARACTERS_DATA, getCharacterById, getStartingMoney } from './characters-data';
import { BOARD_SPACES, COLOR_GROUPS } from './board';
import { CHANCE_CARDS, COMMUNITY_CARDS } from './cards';
import { CHARACTER_LORE, getLoreById } from './lore';

// Maps (map.json is plain data — safe under `node -r esm`).
import classicMapJson from './maps/classic/map.json';
import stuttgartMapJson from './maps/stuttgart-fracture-loop/map.json';
import outerRimMapJson from './maps/outer-rim-station/map.json';
import nightveilMapJson from './maps/nightveil-intrigue/map.json';

// Atlas worlds (plain JS data objects — no images).
import { TERRA_CIRCUIT } from './atlas/worlds/terra-circuit';
import { TERRA_GLOBE } from './atlas/worlds/terra-globe';

export const dominionData = {
  id: 'dominion',
  name: 'Dominion: Multi-dimensional World Property Council',
  version: '1.0.0',

  rules: RULES,
  characters: CHARACTERS_DATA,
  board: { spaces: BOARD_SPACES, colorGroups: COLOR_GROUPS },
  cards: { chance: CHANCE_CARDS, community: COMMUNITY_CARDS },
  lore: CHARACTER_LORE,

  getCharacterById,
  getStartingMoney,
  getLoreById,

  maps: [classicMapJson, stuttgartMapJson, outerRimMapJson, nightveilMapJson],
  worlds: [TERRA_CIRCUIT, TERRA_GLOBE],
};

export default dominionData;
