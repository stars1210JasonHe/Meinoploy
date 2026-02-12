// Dominion Mod — Event card decks

export const CHANCE_CARDS = [
  { text: 'Advance to GO! Collect $200.', action: 'moveTo', value: 0 },
  { text: 'Advance to Illinois Ave.', action: 'moveTo', value: 24 },
  { text: 'Advance to St. Charles Place.', action: 'moveTo', value: 11 },
  { text: 'Bank pays you dividend of $50.', action: 'gain', value: 50 },
  { text: 'Go to Jail. Do not pass GO.', action: 'goToJail', value: 0 },
  // Enhanced cards
  { text: 'Black Swan Event! Pay 10% of your total assets.', action: 'payPercent', value: 10 },
  { text: 'Market Boom! Collect $50 per property you own.', action: 'gainPerProperty', value: 50 },
  { text: 'Tech Breakthrough! Free upgrade on one of your properties.', action: 'freeUpgrade', value: 0 },
  { text: 'Hostile Takeover! Force-buy an opponent\'s cheapest property at 150% price.', action: 'forceBuy', value: 150 },
  { text: 'Stimulus Package! All players receive $100.', action: 'gainAll', value: 100 },
];

export const COMMUNITY_CARDS = [
  { text: 'Advance to GO! Collect $200.', action: 'moveTo', value: 0 },
  { text: 'Bank error in your favor. Collect $200.', action: 'gain', value: 200 },
  { text: 'Go to Jail. Do not pass GO.', action: 'goToJail', value: 0 },
  { text: 'Income tax refund. Collect $20.', action: 'gain', value: 20 },
  { text: 'Life insurance matures. Collect $100.', action: 'gain', value: 100 },
  // Enhanced cards
  { text: 'Tax Audit! Pay 15% of your total assets.', action: 'payPercent', value: 15 },
  { text: 'Infrastructure Grant! Free upgrade on a property.', action: 'freeUpgrade', value: 0 },
  { text: 'Market Crash! Your best building loses 1 level.', action: 'downgrade', value: 0 },
  { text: 'Insurance Payout! Collect $200.', action: 'gain', value: 200 },
  { text: 'Community Fund! All players receive $50.', action: 'gainAll', value: 50 },
];
