// Terra Globe — the first atlas world authored for the PIXEL-GLOBE renderer.
// 12 real cities spread across BOTH hemispheres and all longitudes, so the
// globe always has content whichever way it is rotated. Same loader/validator
// as every other atlas world (world-loader.js) — only the *board view* differs
// (renderMode:'globe'); the economy/graph/sim are derived identically.
//
// ┌─ HOW TO ADD A CITY ───────────────────────────────────────────────────────┐
// │ Add ONE place(...) entry to the array below. You only supply real-world    │
// │ facts; loadWorld derives prices/rents/traits, and the globe projects geo   │
// │ onto the sphere automatically.                                             │
// │                                                                            │
// │   place(id, displayName, archetype, lat, lng, connectors, data)            │
// │                                                                            │
// │   id          short unique key, lowercase            e.g. 'paris'          │
// │   displayName shown on the tile/label                e.g. 'Paris'          │
// │   archetype   one id from archetypes.js (or an array for a multi-district  │
// │               city) — sets the property/transit/tax/etc. slot mix          │
// │   lat, lng    REAL coordinates, decimal degrees (N & E positive). This is  │
// │               the single source of truth; the globe reads it directly and  │
// │               the flat fallback pos:{x,y} is auto-derived from it.          │
// │   connectors  { dir: targetCityId, ... } outgoing routes. Any dir labels;  │
// │               TWO+ entries make a fork the player chooses at runtime.       │
// │   data        { population, gdp, fame } real-ish numbers → drive the       │
// │               $60–400 price band via log/min-max normalization.            │
// │                                                                            │
// │ Then: (a) make sure the new city is reachable (some other city's           │
// │ connectors point at it) and it has an outgoing connector — no dead ends;   │
// │ (b) keep hubs spaced so every tile reaches a hub within ~14 steps;         │
// │ (c) up to size.maxPlaces cities (raise it below if you need more).         │
// │ Validate instantly:  npm run sim -- --map terra-globe --games 20           │
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

// 12-city round-the-world tour. Main ring (eastward) + a southern-hemisphere
// branch (São Paulo / Lagos / Johannesburg) that forks at New York & London and
// rejoins at Dubai. Hubs: New York, Dubai, Tokyo (spaced ~4 cities apart so every
// tile reaches a hub within the 14-step validateWorld limit).
var PLACES = [
  //     id            name            archetype             lat      lng      connectors                        {population, gdp($B), fame}
  place('newyork',    'New York',     'financial-district',  40.71,  -74.01, { e: 'london',  s: 'saopaulo' }, { population: 18800000, gdp: 1770, fame: 98 }),
  place('saopaulo',   'São Paulo',    'market',             -23.55,  -46.63, { e: 'lagos' },                  { population: 22000000, gdp: 480,  fame: 78 }),
  place('london',     'London',       'downtown',            51.51,   -0.13, { e: 'cairo',   s: 'lagos' },    { population: 9500000,  gdp: 980,  fame: 96 }),
  place('lagos',      'Lagos',        'frontier',             6.52,    3.38, { e: 'johannesburg' },           { population: 15000000, gdp: 130,  fame: 68 }),
  place('johannesburg','Johannesburg','industrial',         -26.20,   28.05, { n: 'dubai' },                 { population: 5600000,  gdp: 160,  fame: 66 }),
  place('cairo',      'Cairo',        'landmark',            30.04,   31.24, { e: 'dubai' },                  { population: 21000000, gdp: 140,  fame: 74 }),
  place('dubai',      'Dubai',        'market',              25.20,   55.27, { e: 'mumbai' },                 { population: 3500000,  gdp: 145,  fame: 76 }),
  place('mumbai',     'Mumbai',       'residential',         19.08,   72.88, { e: 'singapore' },              { population: 21000000, gdp: 370,  fame: 72 }),
  place('singapore',  'Singapore',    'transit-hub',          1.35,  103.82, { n: 'shanghai' },               { population: 5700000,  gdp: 470,  fame: 80 }),
  place('shanghai',   'Shanghai',     'port',                31.23,  121.47, { n: 'tokyo' },                  { population: 27000000, gdp: 1100, fame: 82 }),
  place('tokyo',      'Tokyo',        'tech-hub',            35.68,  139.65, { s: 'sydney' },                 { population: 37000000, gdp: 2050, fame: 95 }),
  place('sydney',     'Sydney',       'capital-hub',        -33.87,  151.21, { e: 'newyork' },                { population: 5300000,  gdp: 410,  fame: 84 }),
];

export var TERRA_GLOBE = {
  id: 'terra-globe',
  name: 'Terra Globe',
  story: 'A full lap of the planet — twelve cities across every continent, played on a spinning pixel Earth.',
  movementMode: 'atlas',
  renderMode: 'globe',          // ← Stage-2 board renderer switch (ignored by loader/sim today)
  schemaVersion: '3.0-draft',
  places: PLACES,
  hubs: ['newyork', 'dubai', 'tokyo'],
  winPaths: ['dominion', 'wealth', 'survival'],
  // BALANCE (sim Stage 1, 200 games): terminates ~179 turns; CHARACTER balance PASSES
  // (best-fit 54% vs worst-fit 46%, fair) at the existing RULES.affinity.cashPerFit=5000
  // so no global re-tune. KNOWN ISSUE: STRATEGY gate FAILS — camper 63% vs tourer 37%
  // (real, confound-removed). Root cause is structural: the southern branch (saopaulo→
  // lagos→johannesburg, all low-value cities) is a long detour that punishes touring.
  // Refine the connector graph / branch values to rebalance (data-only, no engine change).
  victory: { maxTurns: 200, params: { groupsToWin: 4 } },
  size: { maxPlaces: 16, maxSpaces: 96 },
  // globe.pixelRatio: WebGL drawing-buffer scale — lower = chunkier pixels (the
  // nearest-neighbor upscale gives the pixel-art look). ~0.3 reads clearly as pixels
  // on a ~500-780px board; 0.5+ is subtle. User-tunable per world.
  atlasConfig: { positions: { slotOffsetStep: 4 }, globe: { pixelRatio: 0.3 } },
  theme: { logoText: 'TERRA', logoSubtitle: 'GLOBE' },
};
