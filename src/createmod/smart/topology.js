// Smart-builder atlas topology: nearest-neighbor tour -> directed cycle connectors ->
// seeded forks -> hub selection measured against the loader's OWN expansion + the SAME
// reversed-BFS validateWorld runs (a place-level heuristic undercounts and is unsafe).
import { expandWorld, ATLAS_DEFAULTS } from '../../world-loader';

function toRad(d) { return d * Math.PI / 180; }

function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.min(1, s)));
}

function bearingKey(a, b) {
  const y = Math.sin(toRad(b.lng - a.lng)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lng - a.lng));
  const deg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  return ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'][Math.round(deg / 45) % 8];
}

function uniqueKey(connectors, key) {
  if (!(key in connectors)) return key;
  let i = 2;
  while ((key + i) in connectors) i++;
  return key + i;
}

// Reversed-BFS distances from hub ENTRY spaces — mirrors validateWorld (world-loader.js:349-372).
function hubDistances(ex) {
  const reverse = {};
  ex.spaces.forEach(s => { reverse[s.id] = []; });
  ex.spaces.forEach(s => { ex.edges[s.id].forEach(to => reverse[to].push(s.id)); });
  const dist = {};
  const queue = [];
  ex.hubs.forEach(h => { dist[h] = 0; queue.push(h); });
  while (queue.length > 0) {
    const cur = queue.shift();
    reverse[cur].forEach(from => {
      if (dist[from] === undefined) { dist[from] = dist[cur] + 1; queue.push(from); }
    });
  }
  return dist; // per-space; undefined = unreachable
}

export function deriveTopology(places, opts) {
  const { ARCHETYPES, rng } = opts;
  const hubReachSteps = opts.hubReachSteps !== undefined ? opts.hubReachSteps : ATLAS_DEFAULTS.hubReachSteps;
  if (!Array.isArray(places) || places.length < 3) {
    throw new Error(`atlas smart-build needs >=3 places (got ${places ? places.length : 0})`);
  }
  const n = places.length;

  // 1. Nearest-neighbor tour. Anchor = max fame (tie-break lowest id). NN step tie-break lowest id.
  const anchor = [...places].sort((a, b) =>
    (b.data.fame - a.data.fame) || (a.id < b.id ? -1 : 1))[0];
  const tour = [anchor];
  const unvisited = new Map(places.filter(p => p.id !== anchor.id).map(p => [p.id, p]));
  while (unvisited.size > 0) {
    const cur = tour[tour.length - 1];
    let best = null;
    let bestD = Infinity;
    for (const p of unvisited.values()) {
      const d = haversine(cur.geo, p.geo);
      if (d < bestD || (d === bestD && best && p.id < best.id)) { best = p; bestD = d; }
    }
    tour.push(best);
    unvisited.delete(best.id);
  }

  // 2. Cycle connectors: Pi -> P(i+1), closing back to the anchor.
  const connectorsByPlace = {};
  tour.forEach((p, i) => {
    const next = tour[(i + 1) % n];
    const c = {};
    c[bearingKey(p.geo, next.geo)] = next.id;
    connectorsByPlace[p.id] = c;
  });

  // 3. Forks (BEFORE hub measurement, so their shortcuts count): floor(n/8) rng-sampled
  // sources each gain one extra connector to the nearest place >= 3 tour-steps away.
  const forkCount = Math.floor(n / 8);
  const pool = tour.map((_, i) => i);
  for (let f = 0; f < forkCount; f++) {
    const idx = pool.splice(Math.floor(rng() * pool.length), 1)[0];
    const src = tour[idx];
    let best = null;
    let bestD = Infinity;
    tour.forEach((cand, j) => {
      const gap = Math.min((j - idx + n) % n, (idx - j + n) % n);
      if (gap < 3) return;
      const d = haversine(src.geo, cand.geo);
      if (d < bestD || (d === bestD && best && cand.id < best.id)) { best = cand; bestD = d; }
    });
    if (!best || best.id === src.id) continue;
    const conns = connectorsByPlace[src.id];
    if (Object.values(conns).includes(best.id)) continue;
    conns[uniqueKey(conns, bearingKey(src.geo, best.geo))] = best.id;
  }

  // 4. Hub selection — greedy fixpoint measured with the REAL expander + reversed-BFS.
  // Each pass adds the argmax-entry-distance NON-HUB place (never "the argmax space's
  // owner": in a cycle that is always an existing hub's slot-1, which never terminates).
  const hubs = [anchor.id];
  const candidate = () => ({
    places: places.map(p => ({ ...p, connectors: connectorsByPlace[p.id] })),
    hubs: [...hubs],
  });
  for (let pass = 0; pass < n; pass++) {
    const ex = expandWorld(candidate(), ARCHETYPES);
    const dist = hubDistances(ex);
    let worst = -1;
    ex.spaces.forEach(s => {
      const d = dist[s.id] === undefined ? Infinity : dist[s.id];
      if (d > worst) worst = d;
    });
    if (worst <= hubReachSteps) break;
    let bestPlace = null;
    let bestDist = -1;
    places.forEach(p => {
      if (hubs.includes(p.id)) return;
      const dRaw = dist[ex.entries[p.id]];
      const d = dRaw === undefined ? Infinity : dRaw;
      if (d > bestDist || (d === bestDist && bestPlace !== null && p.id < bestPlace)) {
        bestPlace = p.id;
        bestDist = d;
      }
    });
    if (bestPlace === null) break; // all places are hubs; validateWorld reports any residue
    hubs.push(bestPlace);
  }

  return { connectorsByPlace, hubs };
}
