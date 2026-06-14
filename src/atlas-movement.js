// Atlas route helpers — pure graph functions over the world-loader's edges
// array (edges[id] = array of successor ids). No Game.js / boardgame.io
// dependencies: shared by the engine (route validation) and, later, the
// route-choice UI (enumeration).

// True if `route` is a legal whole-route from `start` (spec D11): every hop
// follows an edge, and the route is exactly `steps` long — or shorter ONLY
// because its final node has no outgoing edges (runtime no-stall fallback).
export function validateRoute(edges, start, route, steps) {
  if (!Array.isArray(route) || route.length > steps) return false;
  let at = start;
  for (let i = 0; i < route.length; i++) {
    const out = edges[at];
    if (!out || out.indexOf(route[i]) < 0) return false;
    at = route[i];
  }
  if (route.length < steps) {
    const out = edges[at];
    if (out && out.length > 0) return false; // stopped early with moves left
  }
  return true;
}

// Deterministic fallback route: take the first edge at every node; stop early
// at dead ends. Used when the player submits no route (pre-route-UI clients).
export function autoRoute(edges, start, steps) {
  const route = [];
  let at = start;
  for (let i = 0; i < steps; i++) {
    const out = edges[at];
    if (!out || out.length === 0) break;
    at = out[0];
    route.push(at);
  }
  return route;
}

// All distinct legal routes of `steps` hops from `start` (shorter only at
// dead ends), depth-first in edge order, capped at `cap` results so a dense
// graph cannot explode the UI.
export function enumerateRoutes(edges, start, steps, cap = 64) {
  const results = [];
  function walk(at, route) {
    if (results.length >= cap) return;
    if (route.length === steps) {
      results.push(route.slice());
      return;
    }
    const out = edges[at];
    if (!out || out.length === 0) {
      results.push(route.slice()); // no-stall: record the stalled route
      return;
    }
    for (let i = 0; i < out.length; i++) {
      route.push(out[i]);
      walk(out[i], route);
      route.pop();
      if (results.length >= cap) return;
    }
  }
  walk(start, []);
  return results;
}

function lastNode(route) {
  return route.length ? route[route.length - 1] : undefined;
}

// Player route CHOICES from `start` over `steps`, grouped by the FIRST point of
// divergence (the branch the player actually picks) rather than by destination —
// so two routes that reconverge on the same end tile are STILL offered as
// separate choices (otherwise a diamond like place A -> {B,C} -> D would hide one
// branch). Returns [{ node, route }] where `node` is the divergence-point tile to
// highlight. length <= 1 means there is no real fork; the caller auto-commits the
// lone route (or [] when the player cannot move).
export function routeChoices(edges, start, steps, cap = 64) {
  const routes = enumerateRoutes(edges, start, steps, cap);
  if (routes.length <= 1) {
    return routes.length ? [{ node: lastNode(routes[0]), route: routes[0] }] : [];
  }
  // First index at which the enumerated routes disagree.
  const maxLen = Math.max.apply(null, routes.map(r => r.length));
  let div = -1;
  for (let i = 0; i < maxLen && div < 0; i++) {
    const a = routes[0][i];
    for (let k = 1; k < routes.length; k++) {
      if (routes[k][i] !== a) { div = i; break; }
    }
  }
  if (div < 0) return [{ node: lastNode(routes[0]), route: routes[0] }]; // identical routes
  const out = [], seen = {};
  routes.forEach(r => {
    const node = r[div];
    if (node !== undefined && seen[node] === undefined) {
      seen[node] = true;
      out.push({ node: node, route: r });
    }
  });
  return out;
}
