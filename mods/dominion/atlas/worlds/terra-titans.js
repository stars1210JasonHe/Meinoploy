// Terra Titans — the 49-city atlas world for the PIXEL-GLOBE renderer.
// Stage 3.1–3.3 of the mod-engine plan. A full eastward lap of the planet with
// regional forks: nine continental clusters, each anchored by (or draining to) a
// HUB, wired into one branching directed loop. Same loader/validator as every
// other atlas world (src/world-loader.js) — only the *board view* differs
// (renderMode:'globe'); the economy/graph/sim are derived identically.
//
// Provenance: cities + lat/lng + archetype + hub flags come from
//   docs/superpowers/plans/2026-06-25-terra-titans-design.json  (cityList, 10 hubs).
// Structure mirrors terra-globe.js (the 12-city template) verbatim.
//
// ┌─ HOW TO ADD / EDIT A CITY ─────────────────────────────────────────────────┐
// │ Add ONE place(...) entry. You supply real-world facts; loadWorld derives    │
// │ prices/rents/traits and the globe projects geo onto the sphere.             │
// │                                                                            │
// │   place(id, displayName, archetypes, lat, lng, connectors, data)            │
// │                                                                            │
// │   id          short unique kebab key            e.g. 'new-york'             │
// │   displayName shown on the tile/label           e.g. 'New York'            │
// │   archetypes  one id from archetypes.js (or an array for a multi-district   │
// │               city). KEEP <= 2 so no single city blows valueShareCap 0.35.  │
// │   lat, lng    REAL coordinates, decimal degrees (N & E positive). Single    │
// │               source of truth; flat fallback pos:{x,y} is auto-derived.     │
// │   connectors  { dir: targetCityId, ... } outgoing routes. TWO+ entries make │
// │               a fork the player chooses at runtime (the whole point — forks │
// │               at hubs/region boundaries give the route-picker real choices).│
// │   data        { population, gdp($B), fame(0-100) } real-ish numbers → drive │
// │               the $60–400 price band via log/min-max normalization.         │
// │                                                                            │
// │ INVARIANTS the loader THROWS on (validateWorld):                            │
// │  (a) no dead ends   — every place needs >= 1 outgoing connector.            │
// │  (b) reachable      — some other place must connect TO each place.          │
// │  (c) hub-reach <=14 — every space must reach a hub within 14 reversed-BFS    │
// │      steps (~4 forward connector hops). Peripheral / high-latitude cities   │
// │      (Stockholm, Moscow, Auckland) get a SHORTCUT toward a near hub.        │
// │  (d) value share    — no city > 35% of summed property prices.              │
// │ Validate instantly:  npm run sim -- --map terra-titans --games 20           │
// └────────────────────────────────────────────────────────────────────────────┘

// Template helper — turns real-world facts into a loader-ready place object.
// geo is the source of truth; pos:{x,y} (equirectangular projection) is derived
// so the existing flat loader/sim/validator keep working with zero changes.
function place(id, displayName, archetypes, lat, lng, connectors, data) {
  return {
    id: id,
    realName: displayName,
    archetypes: Array.isArray(archetypes) ? archetypes : [archetypes],
    geo: { lat: lat, lng: lng },                                  // ← globe reads this
    pos: { x: (lng + 180) / 360 * 100, y: (90 - lat) / 180 * 100 }, // ← derived, flat fallback
    connectors: connectors,
    data: data,
  };
}

// 49-city round-the-world tour. The mainline flows eastward NY → SA → Europe →
// MENA → Africa → S.Asia → SE Asia/Oceania → E.Asia → back to NY, and each region
// forks into a short spur that drains into the next hub (keeps every city within
// ~4 connector hops of one of the 10 hubs). Hubs (10): new-york, sao-paulo,
// london, paris, dubai, lagos, mumbai, singapore, shanghai, tokyo.
var PLACES = [
  // ── NORTH AMERICA (hub: new-york) ──────────────────────────────────────────
  //     id              name            archetype             lat      lng      connectors                                    {population, gdp($B), fame}
  place('new-york',     'New York',     'financial-district',  40.71,  -74.01, { e: 'london', w: 'chicago', s: 'bogota' },   { population: 18800000, gdp: 1770, fame: 98 }),
  place('chicago',      'Chicago',      'industrial',          41.88,  -87.63, { w: 'los-angeles', n: 'toronto' },           { population: 8900000,  gdp: 690,  fame: 80 }),
  place('los-angeles',  'Los Angeles',  'tech-hub',            34.05, -118.24, { n: 'vancouver', s: 'mexico-city' },         { population: 12500000, gdp: 1050, fame: 90 }),
  place('vancouver',    'Vancouver',    'port',                49.28, -123.12, { e: 'toronto' },                             { population: 2600000,  gdp: 140,  fame: 64 }),
  place('toronto',      'Toronto',      'downtown',            43.65,  -79.38, { e: 'new-york' },                            { population: 6300000,  gdp: 380,  fame: 72 }),
  place('mexico-city',  'Mexico City',  'market',              19.43,  -99.13, { e: 'bogota', s: 'havana' },                 { population: 21800000, gdp: 480,  fame: 78 }),
  place('havana',       'Havana',       'frontier',            23.11,  -82.37, { s: 'bogota' },                              { population: 2100000,  gdp: 30,   fame: 58 }),
  place('bogota',       'Bogota',       'frontier',             4.71,  -74.07, { s: 'lima' },                                { population: 10700000, gdp: 130,  fame: 62 }),

  // ── SOUTH AMERICA (hub: sao-paulo) ─────────────────────────────────────────
  place('lima',         'Lima',         'residential',        -12.05,  -77.04, { e: 'sao-paulo' },                           { population: 10700000, gdp: 110,  fame: 60 }),
  place('sao-paulo',    'Sao Paulo',    'market',             -23.55,  -46.63, { e: 'london', s: 'rio-de-janeiro' },         { population: 22000000, gdp: 480,  fame: 78 }),
  place('rio-de-janeiro','Rio de Janeiro','landmark',         -22.91,  -43.17, { s: 'buenos-aires' },                        { population: 13500000, gdp: 200,  fame: 82 }),
  place('buenos-aires', 'Buenos Aires', 'downtown',           -34.60,  -58.38, { w: 'santiago' },                            { population: 15400000, gdp: 320,  fame: 74 }),
  place('santiago',     'Santiago',     'industrial',         -33.45,  -70.67, { n: 'sao-paulo' },                           { population: 6800000,  gdp: 170,  fame: 64 }),

  // ── EUROPE (hubs: london, paris) ───────────────────────────────────────────
  place('london',       'London',       'financial-district',  51.51,   -0.13, { e: 'paris', s: 'madrid' },                  { population: 9500000,  gdp: 980,  fame: 96 }),
  place('paris',        'Paris',        'landmark',            48.86,    2.35, { e: 'berlin', s: 'rome' },                   { population: 11100000, gdp: 850,  fame: 95 }),
  place('madrid',       'Madrid',       'downtown',            40.42,   -3.70, { e: 'paris' },                               { population: 6700000,  gdp: 330,  fame: 76 }),
  place('berlin',       'Berlin',       'industrial',          52.52,   13.40, { e: 'stockholm', s: 'rome' },                { population: 3700000,  gdp: 280,  fame: 80 }),
  place('rome',         'Rome',         'landmark',            41.90,   12.50, { w: 'paris', e: 'athens' },                  { population: 4300000,  gdp: 220,  fame: 88 }),
  place('athens',       'Athens',       'landmark',            37.98,   23.73, { n: 'sofia', e: 'istanbul' },                { population: 3200000,  gdp: 110,  fame: 78 }),
  place('sofia',        'Sofia',        'residential',         42.70,   23.32, { e: 'istanbul' },                            { population: 1300000,  gdp: 40,   fame: 52 }),
  place('moscow',       'Moscow',       'capital-hub',         55.76,   37.62, { s: 'istanbul' },                            { population: 12500000, gdp: 560,  fame: 84 }),
  place('stockholm',    'Stockholm',    'tech-hub',            59.33,   18.07, { w: 'paris', e: 'moscow' },                  { population: 1700000,  gdp: 180,  fame: 66 }),
  place('istanbul',     'Istanbul',     'transit-hub',         41.01,   28.98, { e: 'cairo', s: 'baghdad' },                 { population: 15500000, gdp: 340,  fame: 80 }),

  // ── MENA (hub: dubai) ──────────────────────────────────────────────────────
  place('cairo',        'Cairo',        'market',              30.04,   31.24, { e: 'baghdad', s: 'lagos' },                 { population: 21000000, gdp: 140,  fame: 74 }),
  place('baghdad',      'Baghdad',      'market',              33.31,   44.36, { e: 'dubai', n: 'tehran', s: 'riyadh' },     { population: 7500000,  gdp: 70,   fame: 64 }),
  place('dubai',        'Dubai',        'market',              25.20,   55.27, { e: 'karachi', s: 'nairobi' },               { population: 3500000,  gdp: 145,  fame: 86 }),
  place('tehran',       'Tehran',       'frontier',            35.69,   51.39, { e: 'dubai' },                               { population: 9200000,  gdp: 110,  fame: 64 }),
  place('riyadh',       'Riyadh',       'frontier',            24.71,   46.68, { e: 'dubai' },                               { population: 7700000,  gdp: 200,  fame: 66 }),

  // ── AFRICA (hub: lagos) ────────────────────────────────────────────────────
  place('lagos',        'Lagos',        'frontier',             6.52,    3.38, { e: 'kinshasa', s: 'johannesburg' },         { population: 15400000, gdp: 130,  fame: 70 }),
  place('kinshasa',     'Kinshasa',     'wilderness',          -4.32,   15.31, { e: 'nairobi', s: 'johannesburg' },          { population: 14300000, gdp: 40,   fame: 50 }),
  place('nairobi',      'Nairobi',      'frontier',            -1.29,   36.82, { n: 'addis-ababa', s: 'johannesburg' },      { population: 4700000,  gdp: 60,   fame: 60 }),
  place('addis-ababa',  'Addis Ababa',  'wilderness',           9.03,   38.74, { e: 'nairobi' },                             { population: 5200000,  gdp: 30,   fame: 52 }),
  place('johannesburg', 'Johannesburg', 'industrial',         -26.20,   28.05, { n: 'dubai' },                               { population: 5600000,  gdp: 160,  fame: 66 }),

  // ── SOUTH ASIA (hub: mumbai) ───────────────────────────────────────────────
  place('mumbai',       'Mumbai',       'residential',         19.08,   72.88, { e: 'delhi', s: 'bangalore' },               { population: 21000000, gdp: 370,  fame: 76 }),
  place('karachi',      'Karachi',      'port',                24.86,   67.01, { e: 'mumbai' },                              { population: 16800000, gdp: 200,  fame: 62 }),
  place('delhi',        'Delhi',        'market',              28.61,   77.21, { e: 'dhaka', s: 'bangalore' },               { population: 32900000, gdp: 290,  fame: 78 }),
  place('bangalore',    'Bangalore',    'tech-hub',            12.97,   77.59, { n: 'mumbai' },                              { population: 13200000, gdp: 110,  fame: 70 }),
  place('dhaka',        'Dhaka',        'residential',         23.81,   90.41, { e: 'bangkok' },                             { population: 22400000, gdp: 130,  fame: 60 }),
  place('bangkok',      'Bangkok',      'market',              13.76,  100.50, { e: 'singapore' },                           { population: 10700000, gdp: 220,  fame: 78 }),

  // ── SE ASIA / OCEANIA (hub: singapore) ─────────────────────────────────────
  place('singapore',    'Singapore',    'transit-hub',          1.35,  103.82, { e: 'jakarta', n: 'manila' },                { population: 5700000,  gdp: 470,  fame: 84 }),
  place('jakarta',      'Jakarta',      'frontier',            -6.21,  106.85, { e: 'manila' },                              { population: 11200000, gdp: 190,  fame: 64 }),
  place('manila',       'Manila',       'port',                14.60,  120.98, { n: 'shanghai', s: 'sydney' },               { population: 14400000, gdp: 230,  fame: 66 }),
  place('sydney',       'Sydney',       'capital-hub',         -33.87,  151.21, { e: 'auckland', n: 'manila' },               { population: 5300000,  gdp: 410,  fame: 84 }),
  place('auckland',     'Auckland',     'wilderness',          -36.85,  174.76, { w: 'sydney' },                             { population: 1700000,  gdp: 90,   fame: 60 }),

  // ── EAST ASIA (hubs: shanghai, tokyo) ──────────────────────────────────────
  place('shanghai',     'Shanghai',     'port',                31.23,  121.47, { e: 'tokyo', n: 'beijing', s: 'hong-kong' }, { population: 27000000, gdp: 1100, fame: 82 }),
  place('beijing',      'Beijing',      'capital-hub',         39.90,  116.41, { s: 'shanghai', e: 'seoul' },                { population: 21500000, gdp: 720,  fame: 84 }),
  place('hong-kong',    'Hong Kong',    'financial-district',  22.32,  114.17, { n: 'shanghai' },                            { population: 7500000,  gdp: 380,  fame: 86 }),
  place('seoul',        'Seoul',        'tech-hub',            37.57,  126.98, { e: 'tokyo' },                               { population: 9700000,  gdp: 780,  fame: 82 }),
  place('tokyo',        'Tokyo',        'tech-hub',            35.68,  139.65, { e: 'new-york' },                            { population: 37000000, gdp: 2050, fame: 95 }),
];

export var TERRA_TITANS = {
  id: 'terra-titans',
  name: 'Terra Titans',
  story: 'Forty-nine cities, every continent, one eastward lap of the planet — played on a spinning pixel Earth where history\'s greatest empire-builders contest the modern world.',
  movementMode: 'atlas',
  renderMode: 'globe',          // ← Stage-2 board renderer switch (ignored by loader/sim today)
  schemaVersion: '3.0-draft',
  places: PLACES,
  hubs: ['new-york', 'sao-paulo', 'london', 'paris', 'dubai', 'lagos', 'mumbai', 'singapore', 'shanghai', 'tokyo'],
  winPaths: ['dominion', 'wealth', 'survival'],
  // maxTurns 300 is a PLACEHOLDER — the board tripled (12→49 cities, 147 spaces) vs
  // terra-globe, so game length must be re-tuned with a >=200-game sim (Stage 3.7).
  // groupsToWin 6 is well below the ~49 buildable groups on this board.
  victory: { maxTurns: 300, params: { groupsToWin: 6 } },
  // 49 cities × 3 slots = 147 spaces — blows the inherited 16/96 default, so raise.
  size: { maxPlaces: 56, maxSpaces: 176 },
  // globe.pixelRatio: WebGL drawing-buffer scale — lower = chunkier pixels.
  atlasConfig: { positions: { slotOffsetStep: 4 }, globe: { pixelRatio: 0.3 } },
  theme: { logoText: 'TERRA', logoSubtitle: 'TITANS' },
};
