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

function _dot(p) {
  return '<circle cx="' + p.x.toFixed(1) + '" cy="' + p.y.toFixed(1) +
    '" r="2.4" fill="' + p.color + '"/>';
}

function miniMapSvg(mapJson) {
  var open = '<svg viewBox="0 0 100 100" class="minimap" preserveAspectRatio="xMidYMid meet" aria-hidden="true">';
  var pts = mapPreviewPoints(mapJson);
  var isAtlas = mapJson && mapJson.movementMode === 'atlas';
  if (!pts.length) {
    var label = (mapJson && mapJson.layout && mapJson.layout.type ? mapJson.layout.type : 'MAP').toUpperCase();
    return open +
      '<rect x="6" y="6" width="88" height="88" rx="6" fill="none" stroke="var(--accent)" stroke-opacity="0.5" stroke-width="2"/>' +
      '<text x="50" y="54" text-anchor="middle" font-size="12" fill="var(--accent)" opacity="0.7">' + label + '</text></svg>';
  }
  var backdrop = isAtlas
    ? '<circle cx="50" cy="50" r="46" fill="none" stroke="var(--accent)" stroke-width="2" stroke-opacity="0.7"/>'
    : '<rect x="4" y="4" width="92" height="92" rx="6" fill="none" stroke="var(--accent)" stroke-width="2" stroke-opacity="0.5"/>';
  var dots = '';
  for (var i = 0; i < pts.length; i++) dots += _dot(pts[i]);
  return open + backdrop + dots + '</svg>';
}

module.exports = { pluralize, breadcrumbSteps, mapPreviewPoints, miniMapSvg };
