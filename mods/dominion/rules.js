// Dominion Mod — Game Rules Configuration
// All configurable game rules for the Dominion mod.
// Game.js reads from this object; edit here to tweak gameplay.

export const RULES = {

  // ── Core Rules ──────────────────────────────────────────
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
    maxTurns: 0,              // 0 = unlimited; positive integer = turn limit (highest assets wins)
    freeParkingPot: false,    // true = taxes/fines accumulate; landing on parking collects pot
  },

  // ── Building System ─────────────────────────────────────
  buildings: {
    names: ['Vacant', 'House', 'Hotel', 'Skyscraper', 'Landmark'],
    icons: ['', '\u{1F3E0}', '\u{1F3E8}', '\u{1F3D9}\uFE0F', '\u{1F3DB}\uFE0F'],
    upgradeCostMultipliers: [0.5, 0.75, 1.0, 1.5],
    rentMultipliers: [1, 3, 7, 12, 20],
    evenBuildingRule: true,
    sellbackRate: 0.5,        // refund percentage when selling a building
  },

  // ── Rent Formulas ───────────────────────────────────────
  rent: {
    railroadBase: 25,
    railroadExponent: 2,
    utilityMultiplierSingle: 4,
    utilityMultiplierBoth: 10,
  },

  // ── Season System ───────────────────────────────────────
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

  // ── Stat-Driven Mechanics ───────────────────────────────
  stats: {
    capital: {
      startingMoneyBonus: 50,
    },
    negotiation: {
      buyDiscountPerPoint: 0.01,
      buyDiscountMax: 0.10,
    },
    tech: {
      upgradeDiscountPerPoint: 0.02,
      upgradeDiscountMax: 0.20,
    },
    charisma: {
      rentDiscountPerPoint: 0.01,
      rentDiscountMax: 0.10,
    },
    luck: {
      redrawThreshold: 8,
      redrawCount: 1,
    },
    stamina: {
      rerollThreshold: 7,
      rerollCount: 1,
    },
  },

  // ── Passive Ability Values ──────────────────────────────
  passives: {
    financier: {
      buyDiscount: 0.10,
      negativeEventReduction: 0.20,
    },
    pioneer: {
      upgradeCostDiscount: 0.20,
    },
    enforcer: {
      regulatedRentBonus: 0.20,
    },
    arbitrageur: {
      bankruptcyBonus: 100,
    },
    idealist: {
      goBonus: 50,
    },
    breaker: {
      monopolyRentReduction: 0.25,
    },
    speculator: {
      extraRedraws: 1,
    },
    merchant: {
      unlimitedRedraws: true,
    },
    operator: {
      allianceIncomeShare: 0.10,
      votingInfluenceBonus: 1,
    },
    shadow: {
      hideMoney: true,
    },
  },

  // ── Trading ─────────────────────────────────────────────
  trading: {
    enabled: true,
    allowMoneyInTrade: true,
    allowMortgagedProperties: false,
    canTradeInJail: false,
  },

  // ── Auctions ────────────────────────────────────────────
  auction: {
    enabled: true,
    startingBid: 1,
    minimumIncrement: 1,
    auctionOnPass: true,
  },

  // ── Turn Timer (placeholder) ────────────────────────────
  turnTimer: {
    enabled: false,
    durationSeconds: 120,
  },

  // ── Player Display ──────────────────────────────────────
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
