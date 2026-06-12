import { validateRoute, autoRoute, enumerateRoutes } from '../atlas-movement';
import { loadWorld } from '../world-loader';
import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';
import { MINI_WORLD } from '../../mods/dominion/atlas/fixtures/mini-world';

const EDGES = loadWorld(MINI_WORLD, ARCHETYPES).edges;
// 0→1→2→3→4→5, 5→[6,9], 6→7→8→0, 9→10→11→0

describe('validateRoute', () => {
  test('accepts a straight chain walk', () => {
    expect(validateRoute(EDGES, 0, [1, 2, 3], 3)).toBe(true);
  });
  test('accepts both branches at the fork', () => {
    expect(validateRoute(EDGES, 4, [5, 6], 2)).toBe(true);
    expect(validateRoute(EDGES, 4, [5, 9], 2)).toBe(true);
  });
  test('accepts a route that cycles through the same node twice', () => {
    // 11→0→1→2→3→4→5→6→7→8→0→1→2 = 12 hops, node 0 visited twice
    expect(validateRoute(EDGES, 11, [0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2], 12)).toBe(true);
  });
  test('rejects a non-edge hop', () => {
    expect(validateRoute(EDGES, 0, [2], 1)).toBe(false);   // 0→2 not an edge
    expect(validateRoute(EDGES, 4, [5, 7], 2)).toBe(false); // 5→7 not an edge
  });
  test('rejects wrong length: short with outgoing edges remaining', () => {
    expect(validateRoute(EDGES, 0, [1, 2], 3)).toBe(false); // node 2 has edges
  });
  test('rejects a route longer than steps', () => {
    expect(validateRoute(EDGES, 0, [1, 2, 3, 4], 3)).toBe(false);
  });
  test('rejects non-arrays', () => {
    expect(validateRoute(EDGES, 0, undefined, 3)).toBe(false);
    expect(validateRoute(EDGES, 0, 'nope', 3)).toBe(false);
  });
  test('no-stall: short route accepted iff it dead-ends', () => {
    const dead = [[1], []]; // node 1 has no outgoing edges
    expect(validateRoute(dead, 0, [1], 3)).toBe(true);   // stalls at 1
    expect(validateRoute(dead, 1, [], 3)).toBe(true);    // can't move at all
    expect(validateRoute(EDGES, 0, [], 3)).toBe(false);  // node 0 CAN move
  });
});

describe('autoRoute', () => {
  test('walks the first edge at every node', () => {
    // from 4: 5 then edges[5][0] = 6 (berlin listed before geneva)
    expect(autoRoute(EDGES, 4, 3)).toEqual([5, 6, 7]);
  });
  test('stops early at a dead end', () => {
    const dead = [[1], []];
    expect(autoRoute(dead, 0, 5)).toEqual([1]);
    expect(autoRoute(dead, 1, 5)).toEqual([]);
  });
  test('auto-routes always validate', () => {
    for (let start = 0; start < 12; start++) {
      for (let steps = 1; steps <= 12; steps++) {
        const r = autoRoute(EDGES, start, steps);
        expect(validateRoute(EDGES, start, r, steps)).toBe(true);
      }
    }
  });
});

describe('enumerateRoutes', () => {
  test('one route on a pure chain segment', () => {
    expect(enumerateRoutes(EDGES, 0, 3)).toEqual([[1, 2, 3]]);
  });
  test('two routes through the fork, depth-first in edge order', () => {
    expect(enumerateRoutes(EDGES, 4, 2)).toEqual([[5, 6], [5, 9]]);
  });
  test('every enumerated route validates', () => {
    enumerateRoutes(EDGES, 0, 8).forEach(r => {
      expect(validateRoute(EDGES, 0, r, 8)).toBe(true);
    });
  });
  test('cap bounds the result count', () => {
    // fully connected 3-node graph explodes: 3 outgoing edges each, 5 steps
    const dense = [[0, 1, 2], [0, 1, 2], [0, 1, 2]];
    expect(enumerateRoutes(dense, 0, 5, 10).length).toBe(10);
  });
  test('dead-end stall routes are included (shorter than steps)', () => {
    const dead = [[1], []];
    expect(enumerateRoutes(dead, 0, 4)).toEqual([[1]]);
  });
});
