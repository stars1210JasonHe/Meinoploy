// World Loader — expands an authored atlas World (places x archetypes + hubs)
// into a branching board graph compatible with G.board, and validates every
// hard invariant from the atlas spec (the Phase-II generation contract).
// Pure data module: no Game.js / App.js / map-loader.js dependencies.
// Usage: var mapData = loadWorld(worldJson, ARCHETYPES)

export var ATLAS_DEFAULTS = {
  normalization: {
    weights: { population: 1.0, gdp: 1.0, fame: 1.0 },
    priceBand: { min: 60, max: 400 },
    rentRatio: 0.08,
    priceStep: 10,            // round prices to nearest 10
  },
  traitClamp: 0.12,
  valueShareCap: 0.35,
  hubReachSteps: 14,
  size: { maxPlaces: 16, maxSpaces: 96 },
  winPaths: ['wealth', 'dominion', 'survival'],
};

// Merge ATLAS_DEFAULTS with a world's atlasConfig overrides.
// Shallow per section: object-valued sections (normalization, size, ...) merge
// key-by-key; scalar keys (hubReachSteps, valueShareCap, ...) replace directly.
export function mergeAtlasConfig(defaults, overrides) {
  var cfg = {};
  var key;
  for (key in defaults) {
    cfg[key] = defaults[key];
  }
  if (overrides) {
    for (key in overrides) {
      var def = defaults[key];
      var over = overrides[key];
      if (def && over && typeof def === 'object' && !Array.isArray(def)
          && typeof over === 'object' && !Array.isArray(over)) {
        cfg[key] = Object.assign({}, def, over);
      } else {
        cfg[key] = over;
      }
    }
  }
  return cfg;
}

// rawScore per place from real data; min-max mapped onto the price band, rounded to priceStep.
export function computePlaceValues(places, cfg) {
  var raw = {};
  places.forEach(function (p) {
    var d = p.data || {};
    raw[p.id] = cfg.weights.population * Math.log10((d.population || 0) + 1)
              + cfg.weights.gdp        * Math.log10((d.gdp || 0) + 1)
              + cfg.weights.fame       * ((d.fame || 0) / 100);
  });
  var scores = Object.values(raw);
  var lo = Math.min.apply(null, scores), hi = Math.max.apply(null, scores);
  var band = cfg.priceBand, step = cfg.priceStep;
  var out = {};
  places.forEach(function (p) {
    var t = hi === lo ? 0.5 : (raw[p.id] - lo) / (hi - lo);
    out[p.id] = Math.round((band.min + t * (band.max - band.min)) / step) * step;
  });
  return out;
}
