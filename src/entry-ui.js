// Pure, dependency-light helpers for the pre-game entry UI. Jest-safe: this module
// must NOT import images, the globe lib, or boardgame.io. App.js imports from here.
// map-loader is the ONLY allowed import (it is itself Jest-safe — no image/globe imports).

const { generatePositions } = require('./map-loader');

function pluralize(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 'S');
}

// Ordered entry steps. 'mod' is dropped when only one mod is registered (auto-skip).
var STEP_ORDER = [
  { key: 'mode', label: 'MODE' },
  { key: 'mod', label: 'MOD' },
  { key: 'map', label: 'MAP' },
  { key: 'setup', label: 'SETUP' },
  { key: 'character', label: 'CHARACTER' },
];

function breadcrumbSteps(opts) {
  var current = opts.current;
  var picks = opts.picks || {};
  var modCount = opts.modCount || 1;
  var visible = STEP_ORDER.filter(function (s) { return s.key !== 'mod' || modCount > 1; });
  var curIdx = visible.findIndex(function (s) { return s.key === current; });
  return visible.map(function (s, i) {
    var state = i < curIdx ? 'done' : (i === curIdx ? 'current' : 'future');
    return {
      key: s.key,
      label: s.label,
      value: state === 'future' ? '' : (picks[s.key] || ''),
      state: state,
      interactive: state === 'done',
    };
  });
}

// Orthographic-front projection of (lat,lng) onto a unit disc, view-centered at
// (LAT0,LNG0). Returns null for far-side points (cull). Output is 0-100 with a small
// inset so dots don't touch the globe rim.
var LAT0 = 15 * Math.PI / 180, LNG0 = 0;
function orthographic(lat, lng) {
  var p = lat * Math.PI / 180, l = lng * Math.PI / 180 - LNG0;
  var cosc = Math.sin(LAT0) * Math.sin(p) + Math.cos(LAT0) * Math.cos(p) * Math.cos(l);
  if (cosc < 0) return null; // back of the globe
  var x = Math.cos(p) * Math.sin(l);
  var y = Math.cos(LAT0) * Math.sin(p) - Math.sin(LAT0) * Math.cos(p) * Math.cos(l);
  return { x: 50 + x * 44, y: 50 - y * 44 };
}

function mapPreviewPoints(mapJson) {
  try {
    if (!mapJson) return [];
    if (mapJson.movementMode === 'atlas') {
      var places = mapJson.places || [];
      var out = [];
      for (var i = 0; i < places.length; i++) {
        var pl = places[i], pt = null;
        if (pl.geo) pt = orthographic(pl.geo.lat, pl.geo.lng);
        else if (pl.pos) pt = { x: pl.pos.x, y: pl.pos.y };
        if (pt) out.push({ x: pt.x, y: pt.y, color: 'var(--accent)' });
      }
      return out;
    }
    var layout = mapJson.layout || {};
    var positions = layout.positions ||
      generatePositions(layout.type, mapJson.spaceCount, layout.params || {});
    var spaces = mapJson.spaces || [];
    var byId = {};
    for (var s = 0; s < spaces.length; s++) byId[spaces[s].id] = spaces[s];
    var themeColor = (mapJson.theme && mapJson.theme.logoColor) || 'var(--accent)';
    var pts = [];
    for (var id in positions) {
      var sp = byId[id];
      pts.push({
        x: positions[id].x, y: positions[id].y,
        color: (sp && sp.color) || themeColor,
      });
    }
    return pts;
  } catch (e) {
    return [];
  }
}

module.exports = { pluralize, breadcrumbSteps, mapPreviewPoints };
