// Mod Loader — loads a mod from JSON config files
// Usage: const mod = loadMod(modConfig) where modConfig contains parsed JSON objects

// Default rules (used as fallback for any missing keys in rules.json)
const DEFAULT_RULES = {
  core: {
    baseStartingMoney: 1500,
    goSalary: 200,
    jailPosition: 10,
    jailFine: 50,
    jailMaxTurns: 3,
    boardSize: 40,
    doublesJailThreshold: 3,
    mortgageRate: 0.5,
    unmortgageRate: 0.55,
    maxBuildingLevel: 4,
    monopolyRentMultiplier: 2,
    diceSides: 6,
    maxTurns: 0,
    freeParkingPot: false,
  },
  buildings: {
    names: ['Vacant', 'House', 'Hotel', 'Skyscraper', 'Landmark'],
    icons: ['', '\u{1F3E0}', '\u{1F3E8}', '\u{1F3D9}\uFE0F', '\u{1F3DB}\uFE0F'],
    upgradeCostMultipliers: [0.5, 0.75, 1.0, 1.5],
    rentMultipliers: [1, 3, 7, 12, 20],
    evenBuildingRule: true,
    sellbackRate: 0.5,
  },
  rent: {
    railroadBase: 25,
    railroadExponent: 2,
    utilityMultiplierSingle: 4,
    utilityMultiplierBoth: 10,
  },
  seasons: {
    enabled: true,
    changeInterval: 10,
    list: [
      { id: 'summer', name: 'Summer', icon: '\u2600\uFE0F', priceMod: 1.0, rentMod: 1.0, taxMod: 1.0 },
      { id: 'autumn', name: 'Autumn', icon: '\u{1F342}', priceMod: 0.90, rentMod: 1.0, taxMod: 1.0 },
      { id: 'winter', name: 'Winter', icon: '\u2744\uFE0F', priceMod: 1.0, rentMod: 1.20, taxMod: 2.0 },
      { id: 'spring', name: 'Spring', icon: '\u{1F338}', priceMod: 1.10, rentMod: 1.0, taxMod: 1.0 },
    ],
  },
  stats: {
    capital: { startingMoneyBonus: 50 },
    negotiation: { buyDiscountPerPoint: 0.01, buyDiscountMax: 0.10 },
    tech: { upgradeDiscountPerPoint: 0.02, upgradeDiscountMax: 0.20 },
    charisma: { rentDiscountPerPoint: 0.01, rentDiscountMax: 0.10 },
    luck: { redrawThreshold: 8, redrawCount: 1 },
    stamina: { rerollThreshold: 7, rerollCount: 1 },
  },
  passives: {
    financier: { buyDiscount: 0.10, negativeEventReduction: 0.20 },
    pioneer: { upgradeCostDiscount: 0.20 },
    enforcer: { regulatedRentBonus: 0.20 },
    arbitrageur: { bankruptcyBonus: 100 },
    idealist: { goBonus: 50 },
    breaker: { monopolyRentReduction: 0.25 },
    speculator: { extraRedraws: 1 },
    merchant: { unlimitedRedraws: true },
    operator: { allianceIncomeShare: 0.10, votingInfluenceBonus: 1 },
    shadow: { hideMoney: true },
  },
  trading: {
    enabled: true,
    allowMoneyInTrade: true,
    allowMortgagedProperties: false,
    canTradeInJail: false,
  },
  auction: {
    enabled: true,
    startingBid: 1,
    minimumIncrement: 1,
    auctionOnPass: true,
  },
  turnTimer: {
    enabled: false,
    durationSeconds: 120,
  },
  display: {
    playerColors: [
      '#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6',
      '#1abc9c', '#e67e22', '#2c3e50', '#d35400', '#8e44ad',
    ],
    playerTokens: [
      '\u{1F534}', '\u{1F535}', '\u{1F7E2}', '\u{1F7E1}', '\u{1F7E3}',
      '\u{26AA}', '\u{1F7E0}', '\u{26AB}', '\u{1F7E4}', '\u{1F7E6}',
    ],
  },
};

const VALID_SPACE_TYPES = ['go', 'property', 'railroad', 'utility', 'tax', 'chance', 'community', 'jail', 'parking', 'goToJail'];
const VALID_CARD_ACTIONS = ['moveTo', 'gain', 'pay', 'goToJail', 'payPercent', 'gainAll', 'gainPerProperty', 'freeUpgrade', 'downgrade', 'forceBuy'];
const VALID_PASSIVE_IDS = ['financier', 'pioneer', 'operator', 'speculator', 'enforcer', 'arbitrageur', 'merchant', 'idealist', 'breaker', 'shadow'];
const STAT_NAMES = ['capital', 'luck', 'negotiation', 'charisma', 'tech', 'stamina'];

// Deep merge: target gets values from source for missing keys
function deepMerge(target, source) {
  const result = { ...source };
  for (const key of Object.keys(target)) {
    if (target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
        && source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = target[key];
    }
  }
  return result;
}

// Validate and return errors array (empty = valid)
export function validateMod(modConfig) {
  const errors = [];

  // Board validation
  if (!modConfig.board) {
    errors.push('board.json is required');
  } else {
    const spaces = modConfig.board.spaces;
    if (!Array.isArray(spaces) || spaces.length !== 40) {
      errors.push('board.json must have exactly 40 spaces');
    } else {
      spaces.forEach((s, i) => {
        if (s.id !== i) errors.push(`Space ${i}: id must be ${i}, got ${s.id}`);
        if (!VALID_SPACE_TYPES.includes(s.type)) errors.push(`Space ${i}: invalid type "${s.type}"`);
        if (s.type === 'property' && !s.color) errors.push(`Space ${i}: properties must have a color`);
        if (s.type === 'property' && (!s.price || s.price <= 0)) errors.push(`Space ${i}: properties must have price > 0`);
        if (s.type === 'property' && (!s.rent || s.rent <= 0)) errors.push(`Space ${i}: properties must have rent > 0`);
      });
      // Check corners
      if (spaces[0].type !== 'go') errors.push('Space 0 must be type "go"');
      if (spaces[10].type !== 'jail') errors.push('Space 10 must be type "jail"');
      if (spaces[20].type !== 'parking') errors.push('Space 20 must be type "parking"');
      if (spaces[30].type !== 'goToJail') errors.push('Space 30 must be type "goToJail"');
    }

    // Color groups validation
    const groups = modConfig.board.colorGroups;
    if (!groups || typeof groups !== 'object') {
      errors.push('board.json must have colorGroups');
    } else {
      for (const [color, ids] of Object.entries(groups)) {
        ids.forEach(id => {
          const space = spaces && spaces[id];
          if (!space) errors.push(`colorGroup ${color}: space ${id} does not exist`);
          else if (space.color !== color) errors.push(`colorGroup ${color}: space ${id} has color "${space.color}"`);
        });
      }
    }
  }

  // Characters validation
  if (!modConfig.characters) {
    errors.push('characters.json is required');
  } else {
    const chars = modConfig.characters.characters;
    if (!Array.isArray(chars) || chars.length < 2 || chars.length > 10) {
      errors.push('characters.json must have 2-10 characters');
    } else {
      const ids = new Set();
      chars.forEach((c, i) => {
        if (!c.id) errors.push(`Character ${i}: missing id`);
        if (ids.has(c.id)) errors.push(`Character ${i}: duplicate id "${c.id}"`);
        ids.add(c.id);
        if (!c.name) errors.push(`Character ${i}: missing name`);
        if (!c.stats) errors.push(`Character ${i}: missing stats`);
        else {
          STAT_NAMES.forEach(stat => {
            const val = c.stats[stat];
            if (val === undefined || val < 1 || val > 10) {
              errors.push(`Character ${c.id}: stat "${stat}" must be 1-10, got ${val}`);
            }
          });
        }
        if (!c.passive || !c.passive.id) errors.push(`Character ${c.id}: missing passive.id`);
        else if (!VALID_PASSIVE_IDS.includes(c.passive.id)) {
          errors.push(`Character ${c.id}: invalid passive.id "${c.passive.id}". Valid: ${VALID_PASSIVE_IDS.join(', ')}`);
        }
      });
    }
  }

  // Cards validation
  if (!modConfig.cards) {
    errors.push('cards.json is required');
  } else {
    ['chance', 'community'].forEach(deck => {
      const cards = modConfig.cards[deck];
      if (!Array.isArray(cards) || cards.length === 0) {
        errors.push(`cards.json: "${deck}" must be a non-empty array`);
      } else {
        cards.forEach((card, i) => {
          if (!card.text) errors.push(`${deck}[${i}]: missing text`);
          if (!VALID_CARD_ACTIONS.includes(card.action)) {
            errors.push(`${deck}[${i}]: invalid action "${card.action}"`);
          }
          if (card.value === undefined) errors.push(`${deck}[${i}]: missing value`);
        });
      }
    });
  }

  return errors;
}

// Load a mod from parsed JSON config objects
// modConfig = { mod, board, characters, cards, rules?, lore?, portraitMap? }
// portraitMap = { 'character-id': importedImageUrl, ... } (optional, client-side only)
export function loadMod(modConfig) {
  // Validate first
  const errors = validateMod(modConfig);
  if (errors.length > 0) {
    throw new Error('Mod validation failed:\n  - ' + errors.join('\n  - '));
  }

  // Board
  const BOARD_SPACES = modConfig.board.spaces;
  const COLOR_GROUPS = modConfig.board.colorGroups;

  // Characters (without portraits — server-safe)
  const CHARACTERS_DATA = modConfig.characters.characters;
  const getCharacterById = (id) => CHARACTERS_DATA.find(c => c.id === id);

  // Characters with portraits (client-side)
  const portraitMap = modConfig.portraitMap || {};
  const CHARACTERS = CHARACTERS_DATA.map(c => ({
    ...c,
    portrait: portraitMap[c.id] || null,
  }));

  // Cards
  const CHANCE_CARDS = modConfig.cards.chance;
  const COMMUNITY_CARDS = modConfig.cards.community;

  // Rules (merge with defaults)
  const userRules = modConfig.rules || {};
  const RULES = deepMerge(userRules, DEFAULT_RULES);

  // Lore
  const CHARACTER_LORE = modConfig.lore || {};
  const getLoreById = (id) => CHARACTER_LORE[id] || null;

  // Helper
  const getStartingMoney = (character) => {
    return RULES.core.baseStartingMoney + character.stats.capital * RULES.stats.capital.startingMoneyBonus;
  };

  return {
    BOARD_SPACES,
    COLOR_GROUPS,
    CHARACTERS,
    CHARACTERS_DATA,
    CHANCE_CARDS,
    COMMUNITY_CARDS,
    RULES,
    CHARACTER_LORE,
    getCharacterById,
    getStartingMoney,
    getLoreById,
  };
}
