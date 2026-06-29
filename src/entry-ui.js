// Pure, dependency-light helpers for the pre-game entry UI. Jest-safe: this module
// must NOT import images, the globe lib, or boardgame.io. App.js imports from here.

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

module.exports = { pluralize, breadcrumbSteps };
