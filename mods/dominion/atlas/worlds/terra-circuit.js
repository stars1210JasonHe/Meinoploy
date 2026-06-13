// Terra Circuit — the first hand-authored atlas world (spec §9.5).
// Authored AS IF generated: only archetype assignments + real place data +
// connectors + hubs + winPaths are hand-set; loadWorld derives every economy
// value (prices/rents), positions, and traits via the normalization pipeline.
// 7 real cities in a branching directed loop with two capital hubs (tokyo,
// newyork) and one fork (singapore -> mumbai | dubai).
// pos values form a stylized geographic world-map spread across the FULL board:
// the center is now free (the absolute renderer relocates the dice/buy/pass HUD
// to the side panel for atlas maps), so cities may sit centrally. The edge
// overlay draws the real topology regardless of where tiles sit.
export var TERRA_CIRCUIT = {
  id: 'terra-circuit',
  name: 'Terra Circuit',
  story: 'A grand tour of Earth’s great cities — branch at Singapore, bank at the capital hubs.',
  movementMode: 'atlas',
  schemaVersion: '3.0-draft',
  places: [
    { id: 'tokyo', archetypes: ['tech-hub'], realName: 'Tokyo',
      pos: { x: 88, y: 28 }, data: { population: 37000000, gdp: 2050, fame: 95 },
      connectors: { s: 'shanghai' }, isHub: true },
    { id: 'shanghai', archetypes: ['port'], realName: 'Shanghai',
      pos: { x: 80, y: 46 }, data: { population: 27000000, gdp: 1100, fame: 82 },
      connectors: { s: 'singapore' } },
    { id: 'singapore', archetypes: ['transit-hub'], realName: 'Singapore',
      pos: { x: 80, y: 70 }, data: { population: 5700000, gdp: 470, fame: 80 },
      connectors: { w: 'mumbai', n: 'dubai' } },
    { id: 'mumbai', archetypes: ['residential'], realName: 'Mumbai',
      pos: { x: 60, y: 66 }, data: { population: 21000000, gdp: 370, fame: 72 },
      connectors: { n: 'newyork' } },
    { id: 'dubai', archetypes: ['market'], realName: 'Dubai',
      pos: { x: 46, y: 52 }, data: { population: 3500000, gdp: 145, fame: 76 },
      connectors: { w: 'newyork' } },
    { id: 'newyork', archetypes: ['financial-district'], realName: 'New York',
      pos: { x: 10, y: 46 }, data: { population: 18800000, gdp: 1770, fame: 98 },
      connectors: { n: 'london' }, isHub: true },
    { id: 'london', archetypes: ['downtown'], realName: 'London',
      pos: { x: 24, y: 24 }, data: { population: 9500000, gdp: 980, fame: 96 },
      connectors: { e: 'tokyo' } },
  ],
  hubs: ['tokyo', 'newyork'],
  winPaths: ['dominion', 'wealth', 'survival'],
  victory: { params: { groupsToWin: 3 } },
  size: { maxPlaces: 16, maxSpaces: 96 },
  // Slots within a place fan out so the 7.5%-wide tiles don't bury each other
  // (gap 6 vs tile 7.5 = light ~20% touch, readable; all slots stay on-board for
  // the ring positions). Tighter per-slot layout is the camera/render-polish task.
  atlasConfig: { positions: { slotOffsetStep: 6 } },
  theme: { logoText: 'TERRA', logoSubtitle: 'CIRCUIT' },
};
