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
