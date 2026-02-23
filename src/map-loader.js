// Map Loader — validates and loads map.json files
// Generates layout positions for square/circle/rectangle/hexagon layouts
// Usage: const map = loadMap(mapJson)

var VALID_SPACE_TYPES = ['go', 'property', 'railroad', 'utility', 'tax', 'chance', 'community', 'jail', 'parking', 'goToJail'];
var VALID_CARD_ACTIONS = ['moveTo', 'gain', 'pay', 'goToJail', 'payPercent', 'gainAll', 'gainPerProperty', 'freeUpgrade', 'downgrade', 'forceBuy'];
var VALID_LAYOUT_TYPES = ['square', 'circle', 'rectangle', 'hexagon', 'custom'];
var VALID_VICTORY_TYPES = ['wealth', 'monopoly', 'survival', 'influence'];

var DEFAULT_ICONS = {
  go: '\u27A1\uFE0F',
  chance: '\u2753',
  community: '\uD83D\uDCE6',
  tax: '\uD83D\uDCB0',
  railroad: '\uD83D\uDE82',
  utility: '\u26A1',
  jail: '\uD83D\uDC6E',
  parking: '\uD83C\uDD7F\uFE0F',
  goToJail: '\uD83D\uDEA8',
};

// ── Position Generators ─────────────────────────────────

function generateSquarePositions(spaceCount) {
  var positions = {};
  var perSide = Math.floor(spaceCount / 4);
  var cornerSpacing = 100 / perSide;

  // Bottom row: space 0 at bottom-right, going left
  for (var i = 0; i <= perSide; i++) {
    positions[i] = { x: 100 - (i * cornerSpacing), y: 100 };
  }
  // Left column: going up
  for (var i = 1; i < perSide; i++) {
    positions[perSide + i] = { x: 0, y: 100 - (i * cornerSpacing) };
  }
  // Top row: left to right
  for (var i = 0; i <= perSide; i++) {
    positions[perSide * 2 + i] = { x: i * cornerSpacing, y: 0 };
  }
  // Right column: going down
  for (var i = 1; i < perSide; i++) {
    positions[perSide * 3 + i] = { x: 100, y: i * cornerSpacing };
  }

  // Handle remaining spaces if not evenly divisible
  var placed = Object.keys(positions).length;
  if (placed < spaceCount) {
    // Distribute remaining along the bottom before space 0
    for (var i = placed; i < spaceCount; i++) {
      var frac = (i - placed + 1) / (spaceCount - placed + 1);
      positions[i] = { x: 100 - frac * 100, y: 100 };
    }
  }

  return positions;
}

function generateCirclePositions(spaceCount, params) {
  var positions = {};
  var radius = (params && params.radius) || 45;
  var cx = 50;
  var cy = 50;

  for (var i = 0; i < spaceCount; i++) {
    // Start at bottom (270 deg / -90 deg), go clockwise
    var angle = (-Math.PI / 2) + (2 * Math.PI * i / spaceCount);
    positions[i] = {
      x: Math.round((cx + radius * Math.cos(angle)) * 100) / 100,
      y: Math.round((cy + radius * Math.sin(angle)) * 100) / 100,
    };
  }
  return positions;
}

function generateRectanglePositions(spaceCount, params) {
  var positions = {};
  var ratio = (params && params.ratio) || 1.5;

  // Distribute spaces around a rectangle with given width:height ratio
  // Total perimeter = 2*(w + h), normalize so it fits in 0-100
  var w = ratio / (1 + ratio) * 100;
  var h = 100 - w;
  var marginX = (100 - w) / 2;
  var marginY = (100 - h) / 2;

  var perim = 2 * (w + h);
  var spacing = perim / spaceCount;

  for (var i = 0; i < spaceCount; i++) {
    var dist = i * spacing;
    var x, y;

    if (dist <= w) {
      // Bottom edge, right to left
      x = marginX + w - dist;
      y = marginY + h;
    } else if (dist <= w + h) {
      // Left edge, bottom to top
      x = marginX;
      y = marginY + h - (dist - w);
    } else if (dist <= 2 * w + h) {
      // Top edge, left to right
      x = marginX + (dist - w - h);
      y = marginY;
    } else {
      // Right edge, top to bottom
      x = marginX + w;
      y = marginY + (dist - 2 * w - h);
    }

    positions[i] = {
      x: Math.round(x * 100) / 100,
      y: Math.round(y * 100) / 100,
    };
  }
  return positions;
}

function generateHexagonPositions(spaceCount, params) {
  var positions = {};
  var cx = 50;
  var cy = 50;
  var radius = (params && params.radius) || 45;

  // 6 vertices of the hexagon
  var vertices = [];
  for (var v = 0; v < 6; v++) {
    var angle = (-Math.PI / 2) + (2 * Math.PI * v / 6);
    vertices.push({
      x: cx + radius * Math.cos(angle),
      y: cy + radius * Math.sin(angle),
    });
  }

  // Distribute spaces evenly along the 6 edges
  var perEdge = spaceCount / 6;
  var idx = 0;

  for (var e = 0; e < 6; e++) {
    var v1 = vertices[e];
    var v2 = vertices[(e + 1) % 6];
    var stepsOnEdge = Math.round(perEdge);
    if (e === 5) stepsOnEdge = spaceCount - idx; // Last edge gets remainder

    for (var s = 0; s < stepsOnEdge; s++) {
      var t = s / stepsOnEdge;
      positions[idx] = {
        x: Math.round((v1.x + t * (v2.x - v1.x)) * 100) / 100,
        y: Math.round((v1.y + t * (v2.y - v1.y)) * 100) / 100,
      };
      idx++;
    }
  }

  return positions;
}

function generatePositions(layoutType, spaceCount, params) {
  switch (layoutType) {
    case 'square': return generateSquarePositions(spaceCount);
    case 'circle': return generateCirclePositions(spaceCount, params);
    case 'rectangle': return generateRectanglePositions(spaceCount, params);
    case 'hexagon': return generateHexagonPositions(spaceCount, params);
    default: return {};
  }
}

// ── Validation ──────────────────────────────────────────

export function validateMap(mapJson) {
  var errors = [];

  // Meta
  if (!mapJson.id || typeof mapJson.id !== 'string') errors.push('id is required (string)');
  if (!mapJson.name || typeof mapJson.name !== 'string') errors.push('name is required (string)');

  // SpaceCount
  var sc = mapJson.spaceCount;
  if (!sc || typeof sc !== 'number' || sc < 10) errors.push('spaceCount must be >= 10');

  // Layout
  var layout = mapJson.layout;
  if (!layout || !layout.type) {
    errors.push('layout.type is required');
  } else if (!VALID_LAYOUT_TYPES.includes(layout.type)) {
    errors.push('layout.type must be one of: ' + VALID_LAYOUT_TYPES.join(', '));
  } else if (layout.type === 'custom') {
    if (!layout.positions) {
      errors.push('layout.positions is required for custom layout');
    } else {
      for (var i = 0; i < sc; i++) {
        if (!layout.positions[String(i)]) {
          errors.push('layout.positions missing space ' + i);
        }
      }
    }
  }

  // Spaces
  var spaces = mapJson.spaces;
  if (!Array.isArray(spaces)) {
    errors.push('spaces must be an array');
  } else {
    if (spaces.length !== sc) {
      errors.push('spaces.length (' + spaces.length + ') must equal spaceCount (' + sc + ')');
    }
    spaces.forEach(function(s, i) {
      if (s.id !== i) errors.push('Space ' + i + ': id must be ' + i + ', got ' + s.id);
      if (!VALID_SPACE_TYPES.includes(s.type)) errors.push('Space ' + i + ': invalid type "' + s.type + '"');
      if (s.type === 'property') {
        if (!s.color) errors.push('Space ' + i + ' (' + s.name + '): property must have color');
        if (!s.price || s.price <= 0) errors.push('Space ' + i + ' (' + s.name + '): property must have price > 0');
        if (!s.rent || s.rent <= 0) errors.push('Space ' + i + ' (' + s.name + '): property must have rent > 0');
      }
      if (s.type === 'tax' && (!s.taxAmount || s.taxAmount <= 0)) {
        errors.push('Space ' + i + ' (' + s.name + '): tax must have taxAmount > 0');
      }
      if ((s.type === 'railroad' || s.type === 'utility') && (!s.price || s.price <= 0)) {
        errors.push('Space ' + i + ' (' + s.name + '): ' + s.type + ' must have price > 0');
      }
    });
  }

  // Special spaces
  var special = mapJson.specialSpaces;
  if (!special) {
    errors.push('specialSpaces is required');
  } else {
    if (special.go === undefined || special.go === null) errors.push('specialSpaces.go is required');
    if (special.jail === undefined || special.jail === null) errors.push('specialSpaces.jail is required');

    if (spaces && spaces.length > 0) {
      if (special.go !== undefined && spaces[special.go] && spaces[special.go].type !== 'go') {
        errors.push('specialSpaces.go (' + special.go + ') must reference a space with type "go"');
      }
      if (special.jail !== undefined && spaces[special.jail] && spaces[special.jail].type !== 'jail') {
        errors.push('specialSpaces.jail (' + special.jail + ') must reference a space with type "jail"');
      }
      if (special.parking !== undefined && special.parking !== null && spaces[special.parking] && spaces[special.parking].type !== 'parking') {
        errors.push('specialSpaces.parking (' + special.parking + ') must reference a space with type "parking"');
      }
      if (special.goToJail !== undefined && special.goToJail !== null && spaces[special.goToJail] && spaces[special.goToJail].type !== 'goToJail') {
        errors.push('specialSpaces.goToJail (' + special.goToJail + ') must reference a space with type "goToJail"');
      }
    }
  }

  // Color groups
  var groups = mapJson.colorGroups;
  if (!groups || typeof groups !== 'object' || Object.keys(groups).length < 1) {
    errors.push('colorGroups must have at least 1 group');
  } else {
    for (var color in groups) {
      var group = groups[color];
      if (!group.name) errors.push('colorGroup ' + color + ': name is required');
      if (!group.spaces || !Array.isArray(group.spaces) || group.spaces.length < 2) {
        errors.push('colorGroup ' + color + ' (' + (group.name || '?') + '): must have >= 2 spaces');
      } else if (spaces) {
        group.spaces.forEach(function(sid) {
          var space = spaces[sid];
          if (!space) {
            errors.push('colorGroup ' + color + ': space ' + sid + ' does not exist');
          } else if (space.color !== color) {
            errors.push('colorGroup ' + color + ': space ' + sid + ' has color "' + space.color + '"');
          }
        });
      }
    }
  }

  // Cards
  var cards = mapJson.cards;
  if (!cards) {
    errors.push('cards is required');
  } else {
    ['chance', 'community'].forEach(function(deck) {
      var list = cards[deck];
      if (!Array.isArray(list) || list.length === 0) {
        errors.push('cards.' + deck + ' must be a non-empty array');
      } else {
        list.forEach(function(card, i) {
          if (!card.text) errors.push(deck + '[' + i + ']: missing text');
          if (!VALID_CARD_ACTIONS.includes(card.action)) {
            errors.push(deck + '[' + i + ']: invalid action "' + card.action + '"');
          }
          if (card.action === 'moveTo' && (card.value < 0 || card.value >= sc)) {
            errors.push(deck + '[' + i + ']: moveTo value ' + card.value + ' out of range (0-' + (sc - 1) + ')');
          }
        });
      }
    });
  }

  // Theme
  var theme = mapJson.theme;
  if (!theme) {
    errors.push('theme is required');
  } else {
    if (!theme.boardBackground) errors.push('theme.boardBackground is required');
    if (!theme.cellBackground) errors.push('theme.cellBackground is required');
  }

  return errors;
}

// ── Load Map ────────────────────────────────────────────

export function loadMap(mapJson) {
  var errors = validateMap(mapJson);
  if (errors.length > 0) {
    throw new Error('Map validation failed:\n  - ' + errors.join('\n  - '));
  }

  // Generate positions if not provided
  var layout = mapJson.layout;
  var positions = layout.positions;
  if (!positions) {
    positions = generatePositions(layout.type, mapJson.spaceCount, layout.params || {});
  } else {
    // Normalize string keys to match space IDs
    var normalized = {};
    for (var key in positions) {
      normalized[parseInt(key)] = positions[key];
    }
    positions = normalized;
  }

  // Build color groups in engine format: { "#hex": [id, id, ...] }
  var colorGroupsFlat = {};
  for (var color in mapJson.colorGroups) {
    colorGroupsFlat[color] = mapJson.colorGroups[color].spaces;
  }

  // Resolve icons for each space
  var themeIcons = mapJson.theme.icons || DEFAULT_ICONS;
  var spacesWithIcons = mapJson.spaces.map(function(s) {
    var icon = s.icon || themeIcons[s.type] || '';
    // For utilities, try to pick between sub-types based on name
    if (s.type === 'utility' && !s.icon) {
      if (s.name.toLowerCase().indexOf('electric') >= 0 || s.name.toLowerCase().indexOf('power') >= 0 || s.name.toLowerCase().indexOf('reactor') >= 0) {
        icon = '\uD83D\uDCA1'; // lightbulb
      } else if (s.name.toLowerCase().indexOf('water') >= 0) {
        icon = '\uD83D\uDEB0'; // water
      }
    }
    return Object.assign({}, s, { icon: icon });
  });

  // Determine which spaces are "corners" (special spaces)
  var specialIds = [];
  var special = mapJson.specialSpaces;
  if (special.go !== undefined && special.go !== null) specialIds.push(special.go);
  if (special.jail !== undefined && special.jail !== null) specialIds.push(special.jail);
  if (special.parking !== undefined && special.parking !== null) specialIds.push(special.parking);
  if (special.goToJail !== undefined && special.goToJail !== null) specialIds.push(special.goToJail);

  // Victory config with defaults
  var victory = mapJson.victory || {};
  var victoryConfig = {
    primary: victory.primary || 'wealth',
    maxTurns: victory.maxTurns || 0,
    params: victory.params || {},
  };

  // Map mechanics with defaults
  var mechanics = mapJson.mapMechanics || {};
  var mapMechanics = {
    incomeMultiplier: mechanics.incomeMultiplier !== undefined ? mechanics.incomeMultiplier : 1.0,
    rentMultiplier: mechanics.rentMultiplier !== undefined ? mechanics.rentMultiplier : 1.0,
    taxMultiplier: mechanics.taxMultiplier !== undefined ? mechanics.taxMultiplier : 1.0,
    priceMultiplier: mechanics.priceMultiplier !== undefined ? mechanics.priceMultiplier : 1.0,
    upgradeCostMultiplier: mechanics.upgradeCostMultiplier !== undefined ? mechanics.upgradeCostMultiplier : 1.0,
    branchChoice: mechanics.branchChoice || 'player',
  };

  // Risk profile with defaults
  var risk = mapJson.riskProfile || {};
  var riskProfile = {
    volatility: risk.volatility !== undefined ? risk.volatility : 0.5,
    eventFrequency: risk.eventFrequency !== undefined ? risk.eventFrequency : 1.0,
  };

  // Theme with defaults
  var theme = mapJson.theme;
  var resolvedTheme = {
    boardBackground: theme.boardBackground || '#2d5016',
    boardBorder: theme.boardBorder || '#000000',
    cellBackground: theme.cellBackground || '#c8e6c0',
    cellBorder: theme.cellBorder || '#3a7d2a',
    cornerBackground: theme.cornerBackground || theme.cellBackground || '#b0d8a0',
    textColor: theme.textColor || '#222222',
    centerBackground: theme.centerBackground || theme.boardBackground || '#2d5016',
    logoText: theme.logoText || 'MEINOPOLY',
    logoSubtitle: theme.logoSubtitle || '',
    logoColor: theme.logoColor || '#f0c040',
    logoSubColor: theme.logoSubColor || '#aed581',
    centerObject: theme.centerObject || null,
    icons: themeIcons,
  };

  return {
    // Meta
    id: mapJson.id,
    name: mapJson.name,
    description: mapJson.description || '',
    schemaVersion: mapJson.schemaVersion || '1.0',

    // World classification
    world: mapJson.world || null,

    // Layout
    layoutType: layout.type,
    positions: positions,
    spaceCount: mapJson.spaceCount,

    // Board data (engine-compatible)
    spaces: spacesWithIcons,
    specialSpaces: mapJson.specialSpaces,
    cornerIds: specialIds,
    colorGroups: mapJson.colorGroups,
    colorGroupsFlat: colorGroupsFlat,

    // Cards
    chanceCards: mapJson.cards.chance,
    communityCards: mapJson.cards.community,
    cardPools: (mapJson.cards && mapJson.cards.pools) || {},

    // Connections (null = linear loop)
    connections: mapJson.connections || null,

    // Mechanics
    mapMechanics: mapMechanics,
    riskProfile: riskProfile,
    victory: victoryConfig,

    // Theme
    theme: resolvedTheme,

    // Future (pass through for later implementation)
    phases: mapJson.phases || [],
    affinity: mapJson.affinity || {},
    assets: mapJson.assets || null,
    rulesOverrides: mapJson.rulesOverrides || {},
  };
}

// ── Helpers ─────────────────────────────────────────────

// Determine grid dimensions for square/rectangle layouts (for CSS Grid rendering)
export function getGridDimensions(spaceCount, layoutType) {
  if (layoutType !== 'square' && layoutType !== 'rectangle') return null;
  var perSide = Math.floor(spaceCount / 4);
  var gridSize = perSide + 1; // e.g., 40 spaces → 10 per side → 11x11 grid
  return { rows: gridSize, cols: gridSize };
}

// Convert percentage positions to CSS Grid row/col for square layouts
export function positionsToGrid(positions, spaceCount) {
  var perSide = Math.floor(spaceCount / 4);
  var gridSize = perSide + 1;
  var grid = {};

  for (var id in positions) {
    var p = positions[id];
    var col = Math.round(p.x / 100 * perSide);
    var row = Math.round(p.y / 100 * perSide);
    grid[id] = { row: row, col: col };
  }
  return grid;
}
