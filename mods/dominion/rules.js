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
      // T1 (MT2-SP5 direction C2): failure-cost ledger deltas for a FAILED
      // (tier 0) persuasion attempt (src/persuasion/engine.js + Game.js
      // attemptPersuasion). Only rent/trade failures react here — duel
      // failures are a purely engine-mechanical next-duel dice flag, no
      // ledger row (see src/dialogue/memory.js applyEvent's
      // 'persuasion_resolved' case for the exact rationale). Kept here
      // (dialogue.weights), NOT under RULES.persuasion below — this is a
      // src/dialogue/memory.js AttitudeLedger concern; RULES.persuasion is
      // the separate engine-accounting/tier-effect namespace.
      persuasionRentFailGrudge: 1,   // target's grudge toward the actor, on a failed 求情
      persuasionTradeFailTrust: 1,   // target's trust toward the actor DROPS by this, on a failed 游说
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
    // T3: how long a speech bubble (portrait-chip-anchored, reaction/banter/
    // diary text) stays on screen before auto-dismissing, in ms. Bubbles are
    // gated by the SAME verbosity setting as reactions (characterAI.isEnabled())
    // — this only controls how long an ALREADY-shown bubble lingers.
    bubbleMs: 6000,
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
      // T2 (persuasion judge) — kept in lockstep with
      // src/dialogue/memory.js's DEFAULT_DIALOGUE_RULES.callPriceUSD block
      // for the full rationale (drift-guard covered).
      judge: 0.0005,
    },
    // T4 (bot linkage, src/bot-driver.js decideTradeResponse): magnitudes for
    // the attitude-aware trade-acceptance-threshold shift. High grudge toward
    // the trade proposer TIGHTENS the acceptance threshold (harder to accept
    // — requires a better deal); high trust RELAXES it (easier to accept).
    // Both are linear-per-point, hard-capped, and BOUNDED so relaxation can
    // never push the effective threshold below min(tradeAcceptThreshold, 0)
    // — a bot can never be talked into accepting a strictly-losing trade it
    // would otherwise reject on value, only into accepting a less-favorable
    // (but still non-losing, relative to its own base threshold) one. See
    // src/bot-driver.js's decideTradeResponse doc comment for the exact
    // formula and proof. LIVE-READ at runtime (T4 fix wave): App.js's
    // _buildBotDriver threads this block into the driver via its
    // getTradeAttitudeConfig dep, so per-mod overrides of these magnitudes
    // take real effect — bot-driver.js still does not import RULES itself
    // (zero import-time coupling to any mods/ package, same reasoning as
    // DEFAULT_TRADE_POLICY.mortgagedPropertyRate above it); its own
    // DEFAULT_TRADE_POLICY copy of these numbers is only the fallback for
    // unwired/pure callers. RULES.dialogue.botAttitudeEnabled (above) is
    // the actual on/off gate, read at the same App.js wiring layer.
    botTradeAttitude: {
      grudgeThresholdPerPoint: 15, // per grudge point (ledger range 0-caps.grudge)
      trustThresholdPerPoint: 15,  // per trust point (ledger range 0-caps.trust)
      maxGrudgeShift: 150,         // hard cap on total tightening
      maxTrustShift: 150,          // hard cap on total relaxation (before the bound's floor)
    },
  },

  // ── Persuasion System (MT2-SP5 direction C2, "舌战群儒") ────
  // Consumed by src/persuasion/engine.js (pure accounting/tier-effect core,
  // zero engine changes there) and src/Game.js's attemptPersuasion move
  // (the ONE engine seam — server-validated, seat-authorized, applies every
  // effect; the LLM judge added in T2 never mutates state directly). Every
  // field here has a matching fallback in src/mod-loader.js's DEFAULT_RULES
  // AND in src/persuasion/engine.js's own DEFAULT_PERSUASION_RULES (a THIRD,
  // independent layer — same three-copy drift-guard discipline as
  // RULES.dialogue above; persuasion.test.js's "defaults drift guard"
  // mirrors dialogue-memory.test.js's own).
  persuasion: {
    enabled: true,
    maxTextLength: 200,
    // Attempt accounting (design doc "Economic bounds"): once per
    // (kind, actor, target) for the whole game, PLUS a global per-actor cap
    // across every kind/target combined. Both consume the cap regardless of
    // whether the attempt succeeds or fails — attempts are not free
    // rerolls, the risk/reward lever the design centers on.
    perOpponentSeamLimit: 1,
    globalCapPerGame: 3,
    // Keyless fallback curve (T1's ONLY resolution path; T2's LLM judge
    // shares the SAME tier caps/accounting, per the design doc's "fairness
    // without a key" pillar — it just replaces this dice-like check with a
    // judged score). See src/persuasion/engine.js's rollTier for the exact
    // formula: a single ctx.random.Number() draw compared against cutpoints
    // derived from (persuader charisma - target charisma).
    charismaCheck: {
      baseTier1Chance: 0.45,
      baseTier2Chance: 0.15,
      perPointDiffBonus: 0.02,
      maxDiffBonus: 0.30,
    },
    // 求情 (rent mercy) — T1.5 REFUND model (追回制, owner decision): rent
    // transfers atomically at landing in every mod uniformly; this is the
    // fraction of the ALREADY-PAID rent refunded back (owner -> payer) on a
    // successful attempt, by tier, for the rest of the payer's turn.
    rent: {
      tierRefundPct: [0, 0.10, 0.20],
    },
    // 叫阵 (duel taunt): this-duel-only dice adjustment, by tier. lever picks
    // ONE side (design brief): 'targetMinus' (default) subtracts from the
    // property owner's roll; failureNextDuelPenalty is the engine-mechanical
    // failure cost (a next-duel dice debuff on the actor, consumed once).
    duel: {
      lever: 'targetMinus',
      tierAmounts: [0, 1, 2],
      failureNextDuelPenalty: 1,
    },
    // 游说 (trade lobby): threshold shift applied to the CURRENT G.trade
    // proposal's bot acceptance evaluation (src/bot-driver.js
    // decideTradeResponse), by tier. Negative = easier to accept. Vs a human
    // target this rides G.trade as pure flavor (T3 may surface it; nothing
    // forces a human's decision either way).
    trade: {
      tierShifts: [0, -25, -50],
    },
    // T2 (judge + fallback) — optional judged-score path. See
    // src/persuasion/engine.js DEFAULT_PERSUASION_RULES.judge for the full
    // rationale (this block must stay byte-identical, drift-guard covered).
    judge: {
      tierBands: [[0, 4], [5, 7], [8, 10]],
      clamp: {
        grudgeHostileThreshold: 6,
        grudgeHatredThreshold: 9,
      },
      timeoutMs: 8000,
    },
    // T3 (bot pleas, owner-as-judge) — kept in lockstep with
    // src/persuasion/engine.js's DEFAULT_PERSUASION_RULES.botPlea for the
    // full rationale (drift-guard covered, same three-copy discipline as
    // every other field in this block).
    botPlea: {
      enabled: true,
      probability: 0.35,
      timeoutSeconds: 12,
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
