/**
 * sim --mod resolution + the mod-default board ingest fix (spec 2026-07-14).
 */
import { resolveMod, resolveMap, pickFitExtremes, pickBalancedPair } from '../sim/mod-resolve';
import { ingestMap, runMatch } from '../sim/match';
import { runMeleeTournament } from '../sim/tournament';
import { Monopoly } from '../Game';
import { Client } from 'boardgame.io/client';
import { MODS } from '../../mods';
import { TERRA_CIRCUIT } from '../../mods/dominion/atlas/worlds/terra-circuit';

const gilded = MODS['gilded-rails'];

describe('resolveMod', () => {
  test('resolves registered ids; unknown fails listing the registry', () => {
    expect(resolveMod(MODS, 'gilded-rails').id).toBe('gilded-rails');
    expect(() => resolveMod(MODS, 'nope')).toThrow(/Registered:.*dominion/);
  });
});

describe('resolveMap', () => {
  const LEGACY = { classic: null, 'terra-circuit': TERRA_CIRCUIT };

  test('default: first world, else first MAP (generated classic mods reuse dominion board as mod.board), else mod default', () => {
    const withWorld = { id: 'x', worlds: [{ id: 'w1' }], maps: [] };
    expect(resolveMap(withWorld, null).world.id).toBe('w1');
    const classicMod = { id: 'y', worlds: [], maps: [{ id: 'm1' }] };
    expect(resolveMap(classicMod, null)).toMatchObject({ world: null, mapJson: { id: 'm1' }, modDefault: false });
    const bareMod = { id: 'z', worlds: [], maps: [] };
    expect(resolveMap(bareMod, null)).toMatchObject({ modDefault: true, world: null, mapJson: null });
  });

  test('world id and map id resolve; unknown fails listing known names', () => {
    const mod = { id: 'x', worlds: [{ id: 'w1' }], maps: [{ id: 'm1' }] };
    expect(resolveMap(mod, 'w1').world.id).toBe('w1');
    expect(resolveMap(mod, 'm1').mapJson.id).toBe('m1');
    expect(() => resolveMap(mod, 'zzz')).toThrow(/Known: default, w1, m1/);
  });

  test('legacy dominion aliases keep working (classic → null world)', () => {
    const dom = { id: 'dominion', worlds: [], maps: [] };
    expect(resolveMap(dom, 'classic', LEGACY)).toMatchObject({ world: null, modDefault: false });
    expect(resolveMap(dom, 'terra-circuit', LEGACY).world).toBe(TERRA_CIRCUIT);
  });
});

describe('fit + balanced-pair pickers over arbitrary rosters', () => {
  test('pickFitExtremes uses stat sums without traits', () => {
    const { best, worst } = pickFitExtremes(gilded.characters, null);
    expect(best.id).not.toBe(worst.id);
    expect(best.score).toBeGreaterThanOrEqual(worst.score);
  });
  test('pickBalancedPair returns two distinct median-adjacent ids, deterministic', () => {
    const pair = pickBalancedPair(MODS['dominion'].characters);
    expect(pair).toHaveLength(2);
    expect(pair[0]).not.toBe(pair[1]);
    expect(pickBalancedPair(MODS['dominion'].characters)).toEqual(pair);
  });
});

describe('ingestMap mapJson path — the board-clobber regression', () => {
  test('after a terra world ingest, a gilded-rails map ingest plays on the RAILS board', () => {
    ingestMap({ world: TERRA_CIRCUIT });
    ingestMap({ mapJson: gilded.maps[0] });
    const client = Client({ game: Monopoly, numPlayers: 2, debug: false });
    client.start();
    const G = client.getState().G;
    // Dominion classic space 1 is "Mediterranean Ave"; gilded-rails space 1 is
    // "Homestead Halt" — the old ingest had NO mapJson path and always loaded
    // dominion's classic map.json for non-world games.
    expect(G.board.spaces[1].name).toBe('Homestead Halt');
    client.stop();
  });
});

describe('melee integration — tiny real-reducer run on a non-dominion mod', () => {
  test('4 games on gilded-rails default board complete and attribute wins', () => {
    const roster = gilded.characters.map(c => c.id);
    const r = runMeleeTournament({
      roster, games: 4, seed: 'mod-resolve-test', modId: 'gilded-rails', mapJson: gilded.maps[0], maxTurns: 60,
    });
    expect(r.seats).toBe(3);
    expect(r.rows).toHaveLength(3);
    const totalGamesPlayed = r.rows.reduce((a, row) => a + row.games, 0);
    expect(totalGamesPlayed).toBe(4 * 3); // everyone plays every game (roster <= seats)
    const totalWins = r.rows.reduce((a, row) => a + row.wins, 0);
    expect(totalWins).toBeGreaterThan(0);
    expect(totalWins).toBeLessThanOrEqual(4);
  }, 60000);
});
