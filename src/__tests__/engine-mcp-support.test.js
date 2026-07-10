// MT2-SP3 engine support: G mod/map identity stamping (spec §0b) + the
// proposeTrade malformed-args guard (spec §2 engine hardening).
import { Client } from 'boardgame.io/client';
import { INVALID_MOVE } from 'boardgame.io/core';
import { Monopoly, setActiveMap, setActiveMod } from '../Game';
import { loadMap } from '../map-loader';
import { loadWorld } from '../world-loader';
import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';
import { MODS } from '../../mods/index';
import classicMapJson from '../../mods/dominion/maps/classic/map.json';

afterAll(() => {
  // Restore process defaults for other test files sharing this module registry.
  setActiveMod('dominion');
  setActiveMap(loadMap(classicMapJson));
});

function freshG(numPlayers = 2) {
  const client = Client({ game: Monopoly, numPlayers, debug: false });
  client.start();
  return client.getState().G;
}

describe('G.activeModId / G.activeMapId stamping', () => {
  test('classic map on dominion stamps both ids', () => {
    setActiveMod('dominion');
    setActiveMap(loadMap(classicMapJson));
    const G = freshG();
    expect(G.activeModId).toBe('dominion');
    expect(G.activeMapId).toBe(classicMapJson.id);
  });

  test('terra-titans atlas world stamps world id', () => {
    setActiveMod('terra-titans');
    const world = (MODS['terra-titans'].worlds || [])[0];
    expect(world).toBeDefined(); // terra-titans ships exactly one atlas world
    setActiveMap(loadWorld(world, ARCHETYPES));
    const G = freshG();
    expect(G.activeModId).toBe('terra-titans');
    expect(G.activeMapId).toBe(world.id);
  });

  test('setActiveMod reseed (mod default board, no map) stamps activeMapId null', () => {
    setActiveMod('dominion'); // reseeds _pendingMap from the mod board — no map id
    const G = freshG();
    expect(G.activeModId).toBe('dominion');
    expect(G.activeMapId).toBeNull();
  });

  test('spec case (i): setupData.victory is IGNORED — victory follows the server default (V2 fallback documented)', () => {
    // V2 was resolved at plan time: setup() computes victory via
    // resolveVictory() (module state), never setupData — this test PINS that
    // fact so create_match's no-victory-arg contract stays honest.
    setActiveMod('dominion');
    setActiveMap(loadMap(classicMapJson));
    const client = Client({
      game: { ...Monopoly, setup: (ctx) => Monopoly.setup(ctx, { enforceSeats: true, victory: { primary: 'monopoly' } }) },
      numPlayers: 2, debug: false,
    });
    client.start();
    const G = client.getState().G;
    expect(G.victory.primary).not.toBe('monopoly'); // the passed victory did NOT take effect
  });
});

describe('proposeTrade malformed-proposal guard', () => {
  // Direct positional-move call (established Game.test.js idiom). Unguarded,
  // `const {...} = proposal` on null THROWS — through bgio's fire-and-forget
  // master path that is an unhandledRejection = server crash (spec round 1).
  function playG() {
    setActiveMod('dominion');
    setActiveMap(loadMap(classicMapJson));
    const ctx = { currentPlayer: '0', numPlayers: 2 };
    const G = Monopoly.setup(ctx);
    G.phase = 'play';
    G.hasRolled = true;
    return G;
  }
  const ctx = { currentPlayer: '0', numPlayers: 2 };

  test.each([null, undefined, 'x', 42, true])('proposal %p -> INVALID_MOVE, no throw', (bad) => {
    const G = playG();
    expect(Monopoly.moves.proposeTrade(G, ctx, bad)).toBe(INVALID_MOVE);
  });

  test('well-formed proposal still works', () => {
    const G = playG();
    const r = Monopoly.moves.proposeTrade(G, ctx, { targetPlayerId: '1' });
    expect(r).not.toBe(INVALID_MOVE);
    expect(G.trade).toMatchObject({ proposerId: '0', targetPlayerId: '1', offeredMoney: 0 });
  });
});
