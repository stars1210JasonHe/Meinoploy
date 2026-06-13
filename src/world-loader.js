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
  positions: {
    // Per-slot x offset (percent) so co-located tokens don't fully overlap.
    // NOTE: plan prose suggested 2, but 0.4 keeps the spread tight: max offset
    // from the place pos is (n-1)/2 * slotOffsetStep (n = slot count, so 1.0
    // at n=6); rendering spreads slots properly later.
    slotOffsetStep: 0.4,
  },
  theme: {
    // Sensible pixel (GBC-flavored) defaults; world.theme overrides per key.
    boardBackground: '#0f380f',
    boardBorder: '#0f380f',
    cellBackground: '#9bbc0f',
    cellBorder: '#306230',
    cornerBackground: '#8bac0f',
    textColor: '#0f380f',
    centerBackground: '#306230',
    logoText: 'MEINOPOLY',
    logoSubtitle: '',
    logoColor: '#f0c040',
    logoSubColor: '#8bac0f',
    centerObject: null,
  },
};

// Win paths the engine can actually score. SECURITY: this is the validation
// gate for world.winPaths — deliberately NOT part of ATLAS_DEFAULTS, so a
// world cannot self-whitelist a path via atlasConfig overrides.
var ENGINE_SCORED_PATHS = ['wealth', 'dominion', 'survival'];

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

// Aggregate archetype statLean vectors into map traits (decision 4).
// Sum every archetype INSTANCE's statLean across places (an archetype used by 3
// places counts 3x), divide by place count, merge explicit overrides AFTER
// (override replaces the aggregated value), clamp every stat to +/-clamp,
// drop exact-zero stats.
export function aggregateTraits(places, archetypes, clamp, overrides) {
  var sums = {};
  places.forEach(function (place) {
    (place.archetypes || []).forEach(function (aId) {
      var archetype = archetypes[aId];
      if (!archetype || !archetype.statLean) return;
      for (var stat in archetype.statLean) {
        sums[stat] = (sums[stat] || 0) + archetype.statLean[stat];
      }
    });
  });

  var traits = {};
  var stat;
  if (places.length > 0) {
    for (stat in sums) {
      traits[stat] = sums[stat] / places.length;
    }
  }
  if (overrides) {
    for (stat in overrides) {
      traits[stat] = overrides[stat];
    }
  }
  for (stat in traits) {
    var v = Math.max(-clamp, Math.min(clamp, traits[stat]));
    if (v === 0) {
      delete traits[stat];
    } else {
      traits[stat] = v;
    }
  }
  return traits;
}

// Card action whitelist — same list as src/map-loader.js (duplicated: that module
// does not export it, and this task must not modify it).
var VALID_CARD_ACTIONS = ['moveTo', 'gain', 'pay', 'goToJail', 'payPercent', 'gainAll', 'gainPerProperty', 'freeUpgrade', 'downgrade', 'forceBuy'];

// Validate an authored World against every hard invariant from the spec.
// Returns a list of error strings (empty = valid) — same contract as validateMap.
// Later checks are skipped if earlier structural ones failed.
export function validateWorld(world, archetypes) {
  var errors = [];
  var cfg = mergeAtlasConfig(ATLAS_DEFAULTS, world.atlasConfig);

  // 1. Meta
  if (!world.id || typeof world.id !== 'string') errors.push('id is required (string)');
  if (!world.name || typeof world.name !== 'string') errors.push('name is required (string)');
  if (world.movementMode !== 'atlas') errors.push('movementMode must be "atlas"');
  var places = world.places;
  if (!Array.isArray(places) || places.length === 0) {
    errors.push('places must be a non-empty array');
    return errors;
  }
  var placeIds = new Set();
  places.forEach(function (p) {
    if (placeIds.has(p.id)) errors.push('duplicate place id "' + p.id + '"');
    placeIds.add(p.id);
  });

  // 2. Refs: archetypes, connector targets, hubs
  places.forEach(function (p) {
    (p.archetypes || []).forEach(function (aId) {
      if (!archetypes[aId]) errors.push('place "' + p.id + '": unknown archetype "' + aId + '"');
    });
    var connectors = p.connectors || {};
    for (var dir in connectors) {
      if (!placeIds.has(connectors[dir])) {
        errors.push('place "' + p.id + '": connector "' + dir + '" targets unknown place "' + connectors[dir] + '"');
      }
    }
  });
  var hubs = world.hubs || [];
  hubs.forEach(function (placeId) {
    if (!placeIds.has(placeId)) errors.push('hubs: unknown place "' + placeId + '"');
  });
  if (errors.length > 0) return errors; // structural failure — skip derived checks

  // 3. Caps (slot total computable from archetypes without full expansion)
  var size = Object.assign({}, cfg.size, world.size || {});
  if (places.length > size.maxPlaces) {
    errors.push('maxPlaces exceeded: ' + places.length + ' places > ' + size.maxPlaces);
  }
  var slotTotal = 0;
  places.forEach(function (p) {
    (p.archetypes || []).forEach(function (aId) {
      slotTotal += archetypes[aId].spaceSlots.length;
    });
  });
  if (slotTotal > size.maxSpaces) {
    errors.push('maxSpaces exceeded: ' + slotTotal + ' spaces > ' + size.maxSpaces);
  }

  // 4. Hubs
  if (hubs.length < 1) errors.push('world must declare at least 1 hub');
  if (errors.length > 0) return errors;

  // 5. Graph (refs already validated, so expandWorld cannot throw)
  var ex;
  try {
    ex = expandWorld(world, archetypes, ATLAS_DEFAULTS);
  } catch (e) {
    errors.push('expansion failed: ' + e.message);
    return errors;
  }
  ex.spaces.forEach(function (s) {
    if (ex.edges[s.id].length === 0) {
      errors.push('space ' + s.id + ' (' + s.name + ') has no outgoing edge');
    }
  });
  // BFS distance-to-hub over REVERSED edges from all hub spaces; every space
  // must reach some hub within cfg.hubReachSteps directed steps.
  var reverse = {};
  ex.spaces.forEach(function (s) { reverse[s.id] = []; });
  ex.spaces.forEach(function (s) {
    ex.edges[s.id].forEach(function (to) { reverse[to].push(s.id); });
  });
  var dist = {};
  var queue = [];
  ex.hubs.forEach(function (h) { dist[h] = 0; queue.push(h); });
  while (queue.length > 0) {
    var cur = queue.shift();
    reverse[cur].forEach(function (from) {
      if (dist[from] === undefined) {
        dist[from] = dist[cur] + 1;
        queue.push(from);
      }
    });
  }
  ex.spaces.forEach(function (s) {
    if (dist[s.id] === undefined || dist[s.id] > cfg.hubReachSteps) {
      errors.push('space ' + s.id + ' (' + s.name + ') cannot reach a hub within ' + cfg.hubReachSteps + ' steps');
    }
  });

  // 6. Economy: buildable places, value-share cap, groupsToWin
  var groupCount = Object.keys(ex.placeGroups).length;
  if (groupCount === 0) {
    errors.push('world has zero buildable places (every place needs >= 2 property spaces to be buildable)');
  }
  // Value share = (sum of the place's property-slot PRICES) / (sum of ALL
  // property-slot prices on the board) — a place with more/bigger property
  // slots holds more board value, not just a higher placeValue.
  var placePropertyValue = {};
  var totalValue = 0;
  ex.spaces.forEach(function (s) {
    if (s.role !== 'property') return;
    placePropertyValue[s.placeId] = (placePropertyValue[s.placeId] || 0) + s.price;
    totalValue += s.price;
  });
  if (totalValue > 0) {
    places.forEach(function (p) {
      var share = (placePropertyValue[p.id] || 0) / totalValue;
      if (share > cfg.valueShareCap) {
        errors.push('place "' + p.id + '" holds ' + Math.round(share * 100) + '% of board value (summed property prices), exceeding valueShareCap ' + cfg.valueShareCap);
      }
    });
  }
  var victoryParams = (world.victory && world.victory.params) || {};
  if (victoryParams.groupsToWin !== undefined && victoryParams.groupsToWin > groupCount) {
    errors.push('groupsToWin (' + victoryParams.groupsToWin + ') exceeds buildable set count (' + groupCount + ')');
  }

  // 7. Win paths: non-empty subset of engine-scored paths
  var winPaths = world.winPaths;
  if (!Array.isArray(winPaths) || winPaths.length === 0) {
    errors.push('winPaths must be a non-empty array');
  } else {
    winPaths.forEach(function (path) {
      if (ENGINE_SCORED_PATHS.indexOf(path) < 0) {
        errors.push('winPaths: "' + path + '" is not an engine-scored path (allowed: ' + ENGINE_SCORED_PATHS.join(', ') + ')');
      }
    });
  }

  // 8. Cards (optional in this task): action whitelist + moveTo node-targeting
  if (world.cards) {
    ['chance', 'community'].forEach(function (deck) {
      var list = world.cards[deck];
      if (!Array.isArray(list)) {
        errors.push('cards.' + deck + ' must be an array');
        return;
      }
      list.forEach(function (card, i) {
        if (!card.text) errors.push(deck + '[' + i + ']: missing text');
        if (VALID_CARD_ACTIONS.indexOf(card.action) < 0) {
          errors.push(deck + '[' + i + ']: invalid action "' + card.action + '"');
        }
        if (card.action === 'moveTo' && (card.value < 0 || card.value >= ex.boardSize || !ex.spaces[card.value])) {
          errors.push(deck + '[' + i + ']: moveTo target ' + card.value + ' is not an existing space id (0-' + (ex.boardSize - 1) + ')');
        }
      });
    });
  }

  return errors;
}

// ── Load World ──────────────────────────────────────────
// Validate -> expand -> aggregate traits -> assemble a mapData-compatible
// object (superset of loadMap()'s contract) with atlas extensions.
export function loadWorld(world, archetypes) {
  var errors = validateWorld(world, archetypes);
  if (errors.length > 0) {
    throw new Error('World validation failed:\n  - ' + errors.join('\n  - '));
  }

  var cfg = mergeAtlasConfig(ATLAS_DEFAULTS, world.atlasConfig);
  var ex = expandWorld(world, archetypes, ATLAS_DEFAULTS);
  var traits = aggregateTraits(world.places, archetypes, cfg.traitClamp, world.traits);

  // Per-space positions: the place's pos with a small deterministic slot offset
  // (x + (slotIndex - (n-1)/2) * step, clamped 0-100) so tokens don't fully overlap.
  var slotCounts = {};
  ex.spaces.forEach(function (s) {
    slotCounts[s.placeId] = (slotCounts[s.placeId] || 0) + 1;
  });
  var step = cfg.positions.slotOffsetStep;
  var positions = {};
  ex.spaces.forEach(function (s) {
    var n = slotCounts[s.placeId];
    var x = s.pos.x + (s.slotIndex - (n - 1) / 2) * step;
    positions[s.id] = {
      x: Math.max(0, Math.min(100, x)),
      y: Math.max(0, Math.min(100, s.pos.y)),
    };
  });

  // placeId -> real display name, for atlas city labels (additive renderer input).
  var placeNames = {};
  world.places.forEach(function (p) { placeNames[p.id] = p.realName; });

  var victory = world.victory || {};
  var cards = world.cards || {};
  var mechanics = world.mapMechanics || {};
  var risk = world.riskProfile || {};

  return {
    // ── mapData-compatible (subset App.js/Game.js already consume) ──
    id: world.id,
    name: world.name,
    description: world.story || '',
    schemaVersion: world.schemaVersion || '3.0-draft',
    layoutType: 'custom',
    spaceCount: ex.boardSize,
    spaces: ex.spaces,
    positions: positions,
    colorGroupsFlat: ex.placeGroups, // alias — legacy readers see groups
    chanceCards: cards.chance || [],
    communityCards: cards.community || [],
    mapMechanics: {
      incomeMultiplier: 1.0,
      rentMultiplier: 1.0,
      taxMultiplier: 1.0,
      priceMultiplier: 1.0,
      upgradeCostMultiplier: 1.0,
      branchChoice: mechanics.branchChoice || 'player',
    },
    riskProfile: {
      volatility: risk.volatility !== undefined ? risk.volatility : 0.5,
      eventFrequency: risk.eventFrequency !== undefined ? risk.eventFrequency : 1.0,
    },
    victory: {
      primary: world.winPaths[0],
      maxTurns: victory.maxTurns || 0,
      params: victory.params || {},
    },
    theme: Object.assign({}, cfg.theme, world.theme || {}),
    // jail is a temporary placeholder — the atlas engine task wires jail-node semantics.
    specialSpaces: { go: ex.hubs[0], jail: null },

    // ── atlas extensions ──
    movementMode: 'atlas',
    edges: ex.edges,
    placeGroups: ex.placeGroups,
    hubs: ex.hubs,
    traits: traits,
    winPaths: world.winPaths,
    placeOf: ex.placeOf,
    entries: ex.entries,
    exits: ex.exits,
    placeNames: placeNames,
    worldId: world.id,
  };
}
