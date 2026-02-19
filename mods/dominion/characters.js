// Dominion Mod — Character data with portraits (client-side only)
// Imports pure data from characters-data.js and adds Parcel-processed portrait PNGs.

import { CHARACTERS_DATA, getCharacterById, getStartingMoney } from './characters-data';

import albertVictorHead from './portraits/Albert-Victor.png';
import liaStartraceHead from './portraits/Lia-Startrace.png';
import marcusGraylineHead from './portraits/Marcus-Grayline.png';
import evelynZeroHead from './portraits/Evelyn-Zero.png';
import knoxIronlawHead from './portraits/Knox-Ironlaw.png';
import sophiaEmberHead from './portraits/Sophia-Ember.png';
import cassianEchoHead from './portraits/Cassian-Echo.png';
import miraDawnlightHead from './portraits/Mira-Dawnlight.png';
import rennChainbreakerHead from './portraits/Renn-Chainbreaker.png';
import opheliaNightveilHead from './portraits/Ophelia-Nightveil.png';

const PORTRAIT_MAP = {
  'albert-victor': albertVictorHead,
  'lia-startrace': liaStartraceHead,
  'marcus-grayline': marcusGraylineHead,
  'evelyn-zero': evelynZeroHead,
  'knox-ironlaw': knoxIronlawHead,
  'sophia-ember': sophiaEmberHead,
  'cassian-echo': cassianEchoHead,
  'mira-dawnlight': miraDawnlightHead,
  'renn-chainbreaker': rennChainbreakerHead,
  'ophelia-nightveil': opheliaNightveilHead,
};

// Merge portrait URLs into character objects
export const CHARACTERS = CHARACTERS_DATA.map(char => ({
  ...char,
  portrait: PORTRAIT_MAP[char.id] || null,
}));

// Re-export helpers
export { getCharacterById, getStartingMoney };
