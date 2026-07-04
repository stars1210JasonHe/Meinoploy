// Prompt builders + STRICT structured-output schemas. Strict-mode rules (spec): every object
// sets additionalProperties:false and lists ALL properties in required; no oneOf; no minItems
// (count minimums live in prompt text + offline validation); id fields carry the kebab pattern.
import { createHash } from 'crypto';
import { ARCHETYPES } from '../../../mods/dominion/atlas/archetypes';
import { IMPLEMENTED_PASSIVES } from '../validate';
import { STAT_KEYS } from '../smart/roster';

export const KEBAB_PATTERN = '^[a-z0-9-]+$';
const ARCHETYPE_IDS = Object.keys(ARCHETYPES);

const str = () => ({ type: 'string' });
const num = () => ({ type: 'number' });
const int = () => ({ type: 'integer' });
const arr = items => ({ type: 'array', items });
const obj = props => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(props),
  properties: props,
});

const langLine = lang => lang === 'zh'
  ? 'All names, titles, descriptions and prose MUST be written in Chinese (中文).'
  : 'All names, titles, descriptions and prose MUST be written in English.';

// ── map stage (TARGET-INDEPENDENT: extracts ALL candidates; targets apply only later) ──
const MAP_SYSTEM = 'You extract structured candidates from a book excerpt for a board-game mod. '
  + 'Report EVERY named character and place you can find in this excerpt, with per-excerpt mention counts. '
  + 'Use the most complete name as canonicalName and list shorter/other forms as aliases.';

const MAP_SCHEMA = obj({
  characters: arr(obj({
    canonicalName: str(),
    aliases: arr(str()),
    roleHints: str(),
    traits: arr(str()),
    relationships: arr(obj({ target: str(), nature: str() })),
    mentions: int(),
  })),
  places: arr(obj({
    canonicalName: str(),
    aliases: arr(str()),
    kind: { type: 'string', enum: ['city', 'region', 'fortress', 'landmark', 'other'] },
    regionHints: str(),
    mentions: int(),
  })),
  themes: arr(str()),
});

export function buildMapPrompt(chunkText, lang) {
  return {
    name: 'extract_candidates',
    system: MAP_SYSTEM,
    user: `${langLine(lang)}\n\nBOOK EXCERPT:\n${chunkText}`,
    schema: MAP_SCHEMA,
  };
}

export const MAP_CACHE_KEY = createHash('sha256')
  .update(MAP_SYSTEM + JSON.stringify(MAP_SCHEMA))
  .digest('hex')
  .slice(0, 16);

// ── synthesis: world (two variants: geo default, pos for --map-image) ──
function worldSchema(withImage) {
  const placeProps = {
    id: { type: 'string', pattern: KEBAB_PATTERN },
    realName: str(),
    archetypes: arr({ type: 'string', enum: ARCHETYPE_IDS }),
    data: obj({ population: num(), gdp: num(), fame: num() }),
  };
  if (withImage) {
    placeProps.pos = obj({ x: num(), y: num() });
    // true when the place had no readable label on the map and was placed from book directions
    placeProps.interpolated = { type: 'boolean' };
  } else placeProps.geo = obj({ lat: num(), lng: num() });
  return obj({
    modId: { type: 'string', pattern: KEBAB_PATTERN },
    modTitle: str(),
    tagline: str(),
    renderMode: { type: 'string', enum: withImage ? ['flat'] : ['globe', 'flat'] },
    victory: obj({ maxTurns: int(), params: obj({ groupsToWin: int() }) }),
    places: arr(obj(placeProps)),
  });
}

export function buildWorldPrompt(cut, themes, lang, { mapImage } = {}) {
  const placeList = cut.places.map(p =>
    `- ${p.canonicalName} (mentions ${p.mentions}; kind ${p.kind || 'city'}; hints: ${(p.regionHints || []).join('; ') || 'none'})`).join('\n');
  const geoRule = mapImage
    ? 'A world map image is attached. For each listed place output pos {x,y} as PERCENTAGES (0-100) '
      + 'aligned to that image: read labels off the map where visible; place unlabeled entries by the '
      + 'book\'s stated directions relative to labeled ones.'
    : 'For real-world places output their REAL coordinates. For fictional places INVENT a coherent '
      + 'layout from the book\'s stated directions (north/south, coasts, distances) as geo {lat,lng}.';
  return {
    name: 'synthesize_world',
    system: 'You design the world of a Monopoly-like board-game mod from book-derived facts. '
      + 'Emit EXACTLY one entry per listed place — no more, no fewer. Assign each place ONE archetype '
      + 'that fits its role in the book. Invent plausible data (population, gdp in $B, fame 0-100) for '
      + 'fictional places; use real-ish figures for real ones. modId is a romanized kebab-ASCII slug of the title.',
    user: `${langLine(lang)}\n${geoRule}\nBook themes: ${themes.join(', ') || 'n/a'}\n\nPLACES (emit exactly these, one entry each):\n${placeList}`,
    schema: worldSchema(!!mapImage),
  };
}

// ── synthesis: classic board ──
const BOARD_SCHEMA = obj({
  modId: { type: 'string', pattern: KEBAB_PATTERN },
  modTitle: str(),
  tagline: str(),
  groups: arr(obj({ name: str(), color: str(), places: arr(str()) })),
});

export function buildBoardPrompt(cut, themes, lang) {
  const placeList = cut.places.map(p => `- ${p.canonicalName} (mentions ${p.mentions})`).join('\n');
  return {
    name: 'synthesize_board',
    system: 'You design a classic ring board for a Monopoly-like mod from book-derived places/factions. '
      + 'Emit AT LEAST 2 groups, each with AT LEAST 2 property names, every group a DISTINCT CSS color. '
      + 'Every property name must trace to a listed place or faction. modId is a romanized kebab-ASCII slug.',
    user: `${langLine(lang)}\nBook themes: ${themes.join(', ') || 'n/a'}\n\nPLACES/FACTIONS:\n${placeList}`,
    schema: BOARD_SCHEMA,
  };
}

// ── synthesis: roster ──
function rosterSchema() {
  return obj({
    roster: arr(obj({
      id: { type: 'string', pattern: KEBAB_PATTERN },
      name: str(),
      title: str(),
      passive: { type: 'string', enum: IMPLEMENTED_PASSIVES },
      emphasis: { type: 'string', enum: STAT_KEYS },
    })),
  });
}

export function buildRosterPrompt(cutCharacters, lang, count) {
  const charList = cutCharacters.map(c =>
    `- ${c.canonicalName} (mentions ${c.mentions}; traits: ${(c.traits || []).join(', ') || 'n/a'})`).join('\n');
  return {
    name: 'synthesize_roster',
    system: 'You turn book characters into a board-game roster. Emit EXACTLY one entry per listed '
      + 'character — no more, no fewer. Pick the passive that best matches each personality and an '
      + 'emphasis stat. id is a romanized kebab-ASCII slug of the name (e.g. 曹操 -> cao-cao).',
    user: `${langLine(lang)}\n\nCHARACTERS (emit exactly these ${count} entries):\n${charList}`,
    schema: rosterSchema(),
  };
}

// ── synthesis: lore (ONE character per call — static single-entry schema) ──
const LORE_SCHEMA = obj({
  nameZh: str(), titleZh: str(), identity: str(), alignment: str(),
  background: str(), joining: str(), styleIntro: str(), style: arr(str()),
  styleOutro: str(),
  relationships: arr(obj({ target: str(), description: str() })),
  themeSummary: str(),
});

export function buildLorePrompt(member, evidence, rosterNames, lang) {
  return {
    name: 'synthesize_lore',
    system: 'You write the in-game lore entry for ONE board-game character, grounded in the book '
      + 'evidence provided. style must have at least 1 bullet; relationships at least 1 entry whose '
      + 'target is one of the OTHER roster members\' names. background/joining/themeSummary non-empty.',
    user: `${langLine(lang)}\nCHARACTER: ${member.name} (${member.title || ''})\n`
      + `OTHER ROSTER MEMBERS: ${rosterNames.join(', ')}\nBOOK EVIDENCE:\n${evidence}`,
    schema: LORE_SCHEMA,
  };
}

// ── repair: reuse the base call's schema, append the error list ──
export function buildRepairPrompt(basePrompt, errors) {
  return {
    name: basePrompt.name + '_repair',
    system: basePrompt.system,
    user: `${basePrompt.user}\n\nYOUR PREVIOUS OUTPUT FAILED VALIDATION with these errors:\n`
      + errors.map(e => `- ${e}`).join('\n')
      + '\nRe-emit the full output; change ONLY the failing entries.',
    schema: basePrompt.schema,
  };
}
