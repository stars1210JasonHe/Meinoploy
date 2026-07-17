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
    eventLogCap: 200,
  },

  // ── Map Affinity (Atlas traits) ─────────────────────────
  // A map's trait leans give a character a ONE-TIME, stat-scaled cash head-start at
  // character select (spec §5: "soft / one-time-leaning, validated by sim"). The
  // bonus = max(0, round(fit * cashPerFit)) where fit = Σ stat·trait. Floored at 0 so
  // a map can only FAVOR, never punish. cashPerFit is the single tuning knob — set so
  // a map's best-fit character is favored but stays under the 60/40 sim gate. Maps
  // without traits (classic) get fit 0 → no bonus. 0 disables affinity entirely.
  affinity: {
    cashPerFit: 5000,
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
      // Rent-collection bonus (owner-side, mirrors charisma's payer-side
      // discount). Hook: calculateRent — applies to the property OWNER's
      // negotiation stat, always (no building-level gate).
      rentCollectedBonusPerPoint: 0.015,
      rentCollectedBonusMax: 0.135,
    },
    tech: {
      upgradeDiscountPerPoint: 0.02,
      upgradeDiscountMax: 0.20,
      // Building-rent bonus (owner-side). Hook: calculateRent — applies to
      // the property OWNER's tech stat, only when the space's building
      // level >= 1 (gated per spec §1.2).
      buildingRentBonusPerPoint: 0.02,
      buildingRentBonusMax: 0.18,
    },
    charisma: {
      rentDiscountPerPoint: 0.01,
      rentDiscountMax: 0.10,
    },
    luck: {
      // Card-gain amplifier (spec §1.3): positive money from chance/community
      // 'gain' family card actions (gain / gainAll per-recipient share /
      // gainPerProperty) scales up by this rate per point of the RECEIVING
      // player's luck, capped. Hook: Game.js's getLuckGainBonus(), used in
      // applyCard's gain/gainAll/gainPerProperty branches.
      cardGainBonusPerPoint: 0.03,
      cardGainBonusMax: 0.27,
      // Free card redraws now scale continuously instead of an all-or-nothing
      // threshold: luckRedraws = floor(luck / redrawDivisor). Replaces the old
      // redrawThreshold/redrawCount pair (their only consumer was
      // selectCharacter in Game.js). speculator's extraRedraws still adds on
      // top, unchanged.
      redrawDivisor: 3,
    },
    stamina: {
      rerollThreshold: 7,
      rerollCount: 1,
      // Loss reduction (spec §1.4): negative money hits from TAX spaces and
      // card pay/payPercent actions are reduced by this rate per point of the
      // PAYING player's stamina, capped. Does NOT touch rent (charisma's
      // lane) or duels (stamina is already the duel stat). Hook: Game.js's
      // getStaminaLossReduction(), used in the tax handler + applyCard's
      // pay/payPercent branches.
      lossReductionPerPoint: 0.03,
      lossReductionMax: 0.24,
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

  // ── Rent Duel System ────────────────────────────────────
  duel: {
    enabled: false,
    loseMultiplier: 2,
    cooldownTurns: 3,
    diceCount: 2,
    statPrimary: 'stamina',
    statSecondary: 'luck',
    secondaryDivisor: 2,
    tieGoesToDefender: true,
  },

  // ── Victory Conditions ──────────────────────────────────
  // primary: how the winner is decided.
  //   'survival' — last non-bankrupt player wins (last standing).
  //   'wealth'   — highest net worth (used at the turn cap, or as a tie-break).
  //   'monopoly' — first player to own `groupsToWin` full color groups wins instantly.
  // maxTurns: 0 = no turn cap (falls back to core.maxTurns); >0 caps the game and
  //   ranks players by net worth (mortgage-corrected) when reached.
  // Per-map `victory` in map.json overrides these defaults; the game-start selector
  // can override per session. The resolved config is stored in G.victory (per-match).
  victory: {
    primary: 'survival',
    maxTurns: 0,
    groupsToWin: 3,
    // Phase B scaffolding (weighted wealth/influence/stability) — not yet scored.
    weights: { wealth: 1, influence: 0, stability: 0 },
  },

  // ── Turn Timer (placeholder) ────────────────────────────
  turnTimer: {
    enabled: false,
    durationSeconds: 120,
  },

  // ── Dialogue System (MT2-SP4 direction B, "记忆宿敌") ─────
  // Consumed by src/dialogue/memory.js (attitude ledger + turn digest, pure/
  // deterministic, zero engine changes) and, later, character-ai.js/App.js/
  // bot-driver.js (T2-T4). Every field here has a matching fallback in
  // src/mod-loader.js's DEFAULT_RULES so a mod with no `dialogue` block at
  // all still resolves a complete config (see src/dialogue/memory.js's
  // DEFAULT_DIALOGUE_RULES for a THIRD, independent fallback layer).
  dialogue: {
    // Recent-history window a turn digest considers, from BOTH ends:
    // maxEvents caps the raw event count, maxSeasons caps how many
    // season_changed boundaries back it may reach ("rolling ~2 season
    // cycles" per spec) — whichever is more restrictive wins. maxSeasons: 0
    // disables the season-side restriction (count window alone applies).
    digestWindow: {
      maxEvents: 60,
      maxSeasons: 2,
    },
    // Attitude ledger per-event deltas (AttitudeLedger.applyEvent's rule
    // table — see src/dialogue/memory.js for exactly which event.data
    // fields each row reads).
    weights: {
      duelLostGrudge: 2,          // lost a duel to X
      bankruptedByGrudge: 3,      // went bankrupt, creditor was X
      tradeAcceptedTrust: 1,      // completed a trade with X (symmetric)
      bigRentGrudge: 1,           // paid >= rentGrudgeThreshold rent to X
      forceBuyVictimGrudge: 2,    // X hostile-took-over a property from you
    },
    caps: { grudge: 10, trust: 10 },        // both axes clamp to [0, cap]
    decayPerSeason: { grudge: 1, trust: 1 }, // toward 0, applied on season_changed
    rentGrudgeThreshold: 200,
    // Chip display tiers (T3, code-driven, keyless): value >= tiers[0] => ▲,
    // >= tiers[1] => ▲▲, >= tiers[2] => ▲▲▲.
    attitudeDisplay: {
      grudgeTiers: [3, 6, 9],
      trustTiers: [3, 6, 9],
    },
    // Gates for later tasks; T1 itself does not read these.
    botAttitudeEnabled: true, // T4: bot-driver.js trade-response tilt (local bot paths only, sim stays pure)
    banterEnabled: true,      // T2/T3: duel/auction/trade banter reply-pairs
    diaryEnabled: true,       // T2: once-per-season-change LLM diary line
    // T2 diary tuning: diaryPromptLines caps how many of a character's own
    // past diary entries get RE-FED into a prompt each time (readability +
    // token cost); diaryHistoryCap caps how many are RETAINED in the store
    // (save-envelope size) — independent knobs, retention can exceed prompt use.
    diaryPromptLines: 3,
    diaryHistoryCap: 12,
    // T2 ($3 hard cap, owner decision item 0): character-ai.js's per-session
    // spend guard. costBudgetUSD is the primary fuse (cumulative estimated
    // USD, from the conservative/over-estimate-only callPriceUSD table);
    // maxCallsPerSession is an INDEPENDENT second fuse (raw call count) —
    // either alone stops every further LLM call for the rest of the game.
    costBudgetUSD: 3.0,
    maxCallsPerSession: 400,
    callPriceUSD: {
      reaction: 0.001,
      diary: 0.001,
      banter: 0.001,
      intro: 0.001,
      chat: 0.01,
    },
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
