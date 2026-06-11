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

// Role (atlas) -> engine space type, so existing handleLanding semantics can attach later.
var ROLE_TO_TYPE = {
  property: 'property',
  transit: 'railroad',
  tax: 'tax',
  chance: 'chance',
  community: 'community',
};

// Display suffixes for non-property slots.
var ROLE_SUFFIX = {
  transit: 'Transit',
  tax: 'Tax',
  chance: 'Chance',
  community: 'Community',
};

var ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

function roman(n) {
  return ROMAN[n - 1] || String(n);
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

// Expand an authored World into a branching board graph.
// Pure; throws ONLY on unresolvable refs (missing archetype / connector target) —
// validateWorld() pre-checks those for error-list reporting.
// Returns { spaces, edges, placeGroups, hubs, placeOf, entries, exits, placeValues, boardSize }.
export function expandWorld(world, archetypes, defaults) {
  var cfg = mergeAtlasConfig(defaults || ATLAS_DEFAULTS, world.atlasConfig);
  var placeValues = computePlaceValues(world.places, cfg.normalization);

  var norm = cfg.normalization;
  var spaces = [];
  var placeOf = {};
  var entries = {};
  var exits = {};
  var placeGroups = {};

  // Step 3: per place, concat archetype slots (in archetype order) into a chain of spaces.
  world.places.forEach(function (place) {
    var slots = [];
    place.archetypes.forEach(function (aId) {
      var archetype = archetypes[aId];
      if (!archetype) {
        throw new Error('expandWorld: place "' + place.id + '" references unknown archetype "' + aId + '"');
      }
      slots = slots.concat(archetype.spaceSlots);
    });

    var placeValue = placeValues[place.id];
    var propertyCount = slots.filter(function (s) { return s.role === 'property'; }).length;
    var propertyIds = [];
    var propertyIndex = 0;

    slots.forEach(function (slot, slotIndex) {
      var id = spaces.length;
      var space = {
        id: id,
        role: slot.role,
        type: ROLE_TO_TYPE[slot.role],
        placeId: place.id,
        slotIndex: slotIndex,
        pos: place.pos,
      };
      if (slot.role === 'property') {
        // Slot ladder: slot k of m property slots gets +/-20% spread around placeValue.
        var k = propertyIndex;
        var factor = 0.8 + 0.4 * k / Math.max(propertyCount - 1, 1);
        var price = propertyCount === 1
          ? placeValue
          : Math.round(placeValue * factor / norm.priceStep) * norm.priceStep;
        space.price = price;
        space.rent = Math.max(1, Math.round(price * norm.rentRatio));
        space.name = place.realName + ' ' + roman(propertyIndex + 1);
        propertyIds.push(id);
        propertyIndex++;
      } else if (slot.role === 'transit') {
        // Buyable transit, classic railroad semantics.
        space.price = placeValue;
        space.name = place.realName + ' ' + ROLE_SUFFIX[slot.role];
      } else if (slot.role === 'tax') {
        space.taxAmount = Math.round(placeValue / 4 / norm.priceStep) * norm.priceStep;
        space.name = place.realName + ' ' + ROLE_SUFFIX[slot.role];
      } else {
        space.name = place.realName + ' ' + ROLE_SUFFIX[slot.role];
      }
      spaces.push(space);
      placeOf[id] = place.id;
    });

    entries[place.id] = spaces.length - slots.length;
    exits[place.id] = spaces.length - 1;

    // Step 5: buildable set = property-role spaces, ONLY if >= 2 (decision 7).
    if (propertyIds.length >= 2) {
      placeGroups[place.id] = propertyIds;
    }
  });

  // Step 4: edges — internal chains, then connectors exit(A) -> entry(B).
  var edges = [];
  spaces.forEach(function (s) { edges[s.id] = []; });
  world.places.forEach(function (place) {
    var entry = entries[place.id];
    var exit = exits[place.id];
    for (var i = entry; i < exit; i++) {
      edges[i].push(i + 1);
    }
    var connectors = place.connectors || {};
    for (var dir in connectors) {
      var targetId = connectors[dir];
      if (entries[targetId] === undefined) {
        throw new Error('expandWorld: place "' + place.id + '" connector "' + dir + '" targets unknown place "' + targetId + '"');
      }
      edges[exit].push(entries[targetId]);
    }
  });

  // Step 6: hub stamping (decision 2) — hub places get isHub on their ENTRY space.
  var hubs = [];
  (world.hubs || []).forEach(function (placeId) {
    var entryId = entries[placeId];
    if (entryId === undefined) {
      throw new Error('expandWorld: world.hubs references unknown place "' + placeId + '"');
    }
    spaces[entryId].isHub = true;
    hubs.push(entryId);
  });

  return {
    spaces: spaces,
    edges: edges,
    placeGroups: placeGroups,
    hubs: hubs,
    placeOf: placeOf,
    entries: entries,
    exits: exits,
    placeValues: placeValues,
    boardSize: spaces.length,
  };
}
