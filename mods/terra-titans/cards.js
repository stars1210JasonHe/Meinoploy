// Terra Titans Mod — Event card decks (ticket A2: the atlas world's decks were EMPTY —
// `mods/dominion/atlas/worlds/terra-titans.js` never set `world.cards`, so src/world-loader.js's
// `loadWorld()` fell back to `cards.chance || []` / `cards.community || []` and every chance/
// community landing on the live board silently no-op'd (`card_drawn` logged `empty:true`).
// `mods/terra-titans/cards.js` (this file, pre-fix) re-exported Dominion's cards, but that
// export was NEVER consumed by the real play path — bundle.data.js pulled `CHANCE_CARDS`/
// `COMMUNITY_CARDS` straight from `../dominion/cards`, bypassing this file entirely, and even
// that value only ever lands in `_pendingMap` transiently between `setActiveMod` and the
// `setActiveMap(loadWorld(...))` call that immediately overwrites it (see
// src/mod-map-select.js:resolveModMap / src/Game.js:setActiveModObject). Terra Titans has no
// map.json boards (`maps: []`), only its globe world, so that overwrite happens on every real
// game. The actual fix lives on `TERRA_TITANS.cards` in
// mods/dominion/atlas/worlds/terra-titans.js, which imports these two arrays and appends one
// dynamically-resolved `moveTo` hub-teleport card to each (see that file's header comment for
// why the moveTo targets are computed instead of hardcoded).
//
// Below: 14 HAND-WRITTEN cards per deck (28 base + 2 moveTo appended in the world file = 30
// total), themed for 16 historical world leaders contending for a modern Earth — conquest,
// tribute, trade routes, monuments, plagues, golden ages. Chance skews toward
// movement/conquest/high-variance swings; Community skews toward civic/domestic/tribute events
// (mirrors Dominion's own chance/community split). Money values are Dominion's card values
// scaled ~1.5x (rounded to the nearest $5-15) to match terra-titans' mapMechanics.priceMultiplier
// 1.5 (mods/dominion/atlas/worlds/terra-titans.js) — property here costs 1.5x Dominion's same
// $60-400 raw price band, so flat cash cards are scaled to stay proportionate to the board's
// cost of living. NOTE: goSalary/baseStartingMoney themselves are NOT scaled (terra-titans'
// rules.js reuses Dominion's core economy verbatim; only mapMechanics.priceMultiplier differs,
// which affects BUY price, not income) — payPercent/forceBuy stay percentage-based and need no
// scaling at all. Balance-checked via `npm run sim -- --mod terra-titans` (see the ticket
// report for the before/after win-rate table).
export const CHANCE_CARDS = [
  { text: 'Your caravans return laden with silk and spice. Collect $90.', action: 'gain', value: 90 },
  { text: "A rival's supply train is plundered on the road. Collect $120.", action: 'gain', value: 120 },
  { text: "You unearth a pharaoh's tomb, untouched for millennia. Collect $300.", action: 'gain', value: 300 },
  { text: 'A border skirmish drains your coffers. Pay $45.', action: 'pay', value: 45 },
  { text: 'Famine strikes your provinces — the treasury pays for relief. Pay $90.', action: 'pay', value: 90 },
  { text: 'Your dynasty falls into decline. Pay 10% of your total assets.', action: 'payPercent', value: 10 },
  { text: 'A palace coup seizes you in the night. Go to Jail.', action: 'goToJail', value: 0 },
  { text: 'Trade routes flourish across every holding you own. Collect $75 per territory.', action: 'gainPerProperty', value: 75 },
  { text: "Hostile Conquest! Seize a rival's cheapest territory for 150% tribute.", action: 'forceBuy', value: 150 },
  { text: 'Master engineers arrive at your court. Freely upgrade one holding.', action: 'freeUpgrade', value: 0 },
  { text: 'A new trade pact benefits every ruler at the table. All players collect $150.', action: 'gainAll', value: 150 },
  { text: 'Foreign envoys bring modest tribute. Collect $60.', action: 'gain', value: 60 },
  { text: 'A rebellion in the provinces must be put down. Pay $60.', action: 'pay', value: 60 },
  { text: 'A golden age of prosperity sweeps your empire. Collect $180.', action: 'gain', value: 180 },
];

export const COMMUNITY_CARDS = [
  { text: 'A monument dedication uncovers a hidden treasury. Collect $300.', action: 'gain', value: 300 },
  { text: 'Plague quarantine confines you to your own palace. Go to Jail.', action: 'goToJail', value: 0 },
  { text: 'Census tribute trickles in from every province. Collect $30.', action: 'gain', value: 30 },
  { text: "A grand monument draws pilgrims and coin. Collect $150.", action: 'gain', value: 150 },
  { text: 'Plague ravages your dominion. Pay 15% of your total assets.', action: 'payPercent', value: 15 },
  { text: 'Public works are completed ahead of schedule. Freely upgrade one holding.', action: 'freeUpgrade', value: 0 },
  { text: 'Your greatest monument crumbles to ruin. Your most-developed holding loses one level.', action: 'downgrade', value: 0 },
  { text: 'A diplomatic marriage brings a dowry of gold. Collect $300.', action: 'gain', value: 300 },
  { text: 'A shared harvest festival benefits every ruler. All players collect $75.', action: 'gainAll', value: 75 },
  { text: 'Grain reserves run short — the court dips into the treasury. Pay $45.', action: 'pay', value: 45 },
  { text: 'A minor province pays its yearly tribute. Collect $45.', action: 'gain', value: 45 },
  { text: 'Flood damage along the river must be repaired at once. Pay $90.', action: 'pay', value: 90 },
  { text: 'Scholars restore a great library, drawing visitors and coin. Collect $120.', action: 'gain', value: 120 },
  { text: 'A costly festival is thrown in your honor. Pay $60.', action: 'pay', value: 60 },
];
