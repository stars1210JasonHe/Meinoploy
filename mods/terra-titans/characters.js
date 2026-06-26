// Terra Titans Mod — Character data for the CLIENT (with portraits).
//
// Pixel-art portraits (341x341): generated as one 4x4 grid, then sliced and
// palette-quantized to a GBC-style limited palette (see scratchpad/pixelate.py).
// Imported as ES modules so Parcel processes them (NOT string paths). Mirrors
// Dominion's PORTRAIT_MAP pattern.

import { CHARACTERS_DATA, getCharacterById, getStartingMoney } from './characters-data';

import hammurabi from './portraits/hammurabi.png';
import cyrusTheGreat from './portraits/cyrus-the-great.png';
import chandraguptaMaurya from './portraits/chandragupta-maurya.png';
import caoCao from './portraits/cao-cao.png';
import liuBei from './portraits/liu-bei.png';
import alexanderTheGreat from './portraits/alexander-the-great.png';
import juliusCaesar from './portraits/julius-caesar.png';
import mansaMusa from './portraits/mansa-musa.png';
import suleiman from './portraits/suleiman.png';
import genghisKhan from './portraits/genghis-khan.png';
import taejo from './portraits/taejo.png';
import tokugawaIeyasu from './portraits/tokugawa-ieyasu.png';
import pachacuti from './portraits/pachacuti.png';
import moctezumaI from './portraits/moctezuma-i.png';
import moshoeshoeI from './portraits/moshoeshoe-i.png';
import cleopatraVii from './portraits/cleopatra-vii.png';

const PORTRAIT_MAP = {
  'hammurabi': hammurabi,
  'cyrus-the-great': cyrusTheGreat,
  'chandragupta-maurya': chandraguptaMaurya,
  'cao-cao': caoCao,
  'liu-bei': liuBei,
  'alexander-the-great': alexanderTheGreat,
  'julius-caesar': juliusCaesar,
  'mansa-musa': mansaMusa,
  'suleiman': suleiman,
  'genghis-khan': genghisKhan,
  'taejo': taejo,
  'tokugawa-ieyasu': tokugawaIeyasu,
  'pachacuti': pachacuti,
  'moctezuma-i': moctezumaI,
  'moshoeshoe-i': moshoeshoeI,
  'cleopatra-vii': cleopatraVii,
};

export const CHARACTERS = CHARACTERS_DATA.map(char => ({
  ...char,
  portrait: PORTRAIT_MAP[char.id] || null,
}));

// Re-export helpers
export { getCharacterById, getStartingMoney };
