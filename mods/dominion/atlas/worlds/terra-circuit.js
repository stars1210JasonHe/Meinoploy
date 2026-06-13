// Terra Circuit — the first hand-authored atlas world (spec §9.5).
// Authored AS IF generated: only archetype assignments + real place data +
// connectors + hubs + winPaths are hand-set; loadWorld derives every economy
// value (prices/rents), positions, and traits via the normalization pipeline.
// 7 real cities in a branching directed loop with two capital hubs (tokyo,
// newyork) and one fork (singapore -> mumbai | dubai).
export var TERRA_CIRCUIT = {
  id: 'terra-circuit',
  name: 'Terra Circuit',
  story: 'A grand tour of Earth’s great cities — branch at Singapore, bank at the capital hubs.',
  movementMode: 'atlas',
  schemaVersion: '3.0-draft',
  places: [
    { id: 'tokyo', archetypes: ['tech-hub'], realName: 'Tokyo',
      pos: { x: 85, y: 30 }, data: { population: 37000000, gdp: 2050, fame: 95 },
      connectors: { s: 'shanghai' }, isHub: true },
    { id: 'shanghai', archetypes: ['port'], realName: 'Shanghai',
      pos: { x: 82, y: 52 }, data: { population: 27000000, gdp: 1100, fame: 82 },
      connectors: { s: 'singapore' } },
    { id: 'singapore', archetypes: ['transit-hub'], realName: 'Singapore',
      pos: { x: 74, y: 72 }, data: { population: 5700000, gdp: 470, fame: 80 },
      connectors: { w: 'mumbai', n: 'dubai' } },
    { id: 'mumbai', archetypes: ['residential'], realName: 'Mumbai',
      pos: { x: 52, y: 74 }, data: { population: 21000000, gdp: 370, fame: 72 },
      connectors: { n: 'newyork' } },
    { id: 'dubai', archetypes: ['market'], realName: 'Dubai',
      pos: { x: 50, y: 52 }, data: { population: 3500000, gdp: 145, fame: 76 },
      connectors: { w: 'newyork' } },
    { id: 'newyork', archetypes: ['financial-district'], realName: 'New York',
      pos: { x: 20, y: 42 }, data: { population: 18800000, gdp: 1770, fame: 98 },
      connectors: { n: 'london' }, isHub: true },
    { id: 'london', archetypes: ['downtown'], realName: 'London',
      pos: { x: 34, y: 22 }, data: { population: 9500000, gdp: 980, fame: 96 },
      connectors: { e: 'tokyo' } },
  ],
  hubs: ['tokyo', 'newyork'],
  winPaths: ['dominion', 'wealth', 'survival'],
  victory: { params: { groupsToWin: 3 } },
  size: { maxPlaces: 16, maxSpaces: 96 },
  // Slots within a place fan out wider than the 0.4% default so tiles don't stack.
  atlasConfig: { positions: { slotOffsetStep: 3 } },
  theme: { logoText: 'TERRA', logoSubtitle: 'CIRCUIT' },
};
