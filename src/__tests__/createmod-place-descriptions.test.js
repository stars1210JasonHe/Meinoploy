// Create-Mod content quality wave (2026-07-16), Part A steps 2-4 — thread place descriptions
// facts -> expandFacts -> emit -> validate -> the popover-read field.
// Spec: docs/superpowers/specs/2026-07-16-createmod-content-wave.md
//
// Popover field-name finding (verified by reading src/App.js, not guessed):
//   - ATLAS: App.js:289 sets `this.mapData.atlasPlaces = mapJson.places` in setMap(); App.js's
//     _tileDetailData (App.js:2043-2076) looks up `place = atlasPlaces.find(p => p.id ===
//     space.placeId)` and reads `place.description` verbatim into the popover's `d.description`
//     (rendered by game-chrome.js's tileDetailHtml at game-chrome.js:139). So for atlas worlds,
//     the field the popover reads is exactly `world.places[i].description` in the emitted
//     data.json — proven end-to-end below.
//   - CLASSIC: `_tileDetailData`'s `place` lookup is GATED on `space.placeId`, which classic
//     spaces never have (that's an atlas-only concept from world-loader's expandWorld) — so
//     `place` is always null for classic tiles and `d.description` is always null too, REGARDLESS
//     of whether `map.spaces[i].description` is present in the data. map-loader.js's loadMap DOES
//     preserve `space.description` verbatim onto the live space object (Object.assign spread at
//     map-loader.js's spacesWithIcons map), so the data is there and forward-compatible — it is
//     simply not wired to the popover today. This is a real, disclosed gap (not fixed here per
//     the "no App.js changes" constraint) — see the honest-concerns section of the wave report.
import { expandFacts, makeRng } from '../createmod/smart/index';
import { deriveClassicBoard } from '../createmod/smart/board';
import { validateModInput } from '../createmod/validate';
import { validateWorld } from '../world-loader';
import { validateMap } from '../map-loader';
import { emitMod } from '../createmod/emit';
import { ARCHETYPES } from '../../mods/dominion/atlas/archetypes';
import { CHANCE_CARDS, COMMUNITY_CARDS } from '../../mods/dominion/cards';
import { MINI_WORLD } from '../../mods/dominion/atlas/fixtures/mini-world';
import classicMap from '../../mods/dominion/maps/classic/map.json';

const OPTS_SP1 = { ARCHETYPES, reusedCards: { chance: CHANCE_CARDS, community: COMMUNITY_CARDS } };

// ── expandFacts passthrough (SP4) ────────────────────────────────────
describe('expandFacts — atlas place description passthrough (pure spread, no code change needed)', () => {
  test('facts.world.places[].description rides verbatim into the expanded world.places[]', () => {
    const facts = {
      id: 'test-smart', name: 'Test Smart', tagline: 't', mapType: 'atlas', seed: 's1',
      world: {
        renderMode: 'globe', victory: { maxTurns: 150, params: { groupsToWin: 2 } },
        places: [
          { id: 'aa', realName: 'Aa', archetypes: ['market'], geo: { lat: 40, lng: -74 }, data: { population: 2000000, gdp: 200, fame: 72 }, description: 'A river port.' },
          { id: 'bb', realName: 'Bb', archetypes: ['market'], geo: { lat: 51, lng: 0 }, data: { population: 2000000, gdp: 200, fame: 71 } },
          { id: 'cc', realName: 'Cc', archetypes: ['market'], geo: { lat: 35, lng: 139 }, data: { population: 2000000, gdp: 200, fame: 70 } },
        ],
      },
      roster: [{ id: 'a', name: 'A', passive: 'enforcer' }, { id: 'b', name: 'B', passive: 'pioneer' }],
    };
    const input = expandFacts(facts, { ARCHETYPES });
    expect(input.world.places[0].description).toBe('A river port.');
    expect(input.world.places[1]).not.toHaveProperty('description');
  });
});

// ── deriveClassicBoard: both places[] shapes, description on property spaces ──
describe('deriveClassicBoard — place descriptions (backward-compat string + new object shape)', () => {
  function withMeta(map) { return { ...map, id: 't', name: 'T' }; }

  test('plain string places (existing hand-authored shape) -> no description, still validates', () => {
    const facts = { groups: [
      { name: 'G0', color: 'red', places: ['Alpha', 'Beta'] },
      { name: 'G1', color: 'blue', places: ['Gamma', 'Delta'] },
    ] };
    const map = deriveClassicBoard(facts, { rng: makeRng('b') });
    expect(validateMap(withMeta(map))).toEqual([]);
    map.spaces.filter(s => s.type === 'property').forEach(s => expect(s).not.toHaveProperty('description'));
  });

  test('{name, description} places -> description lands on the matching property space', () => {
    const facts = { groups: [
      { name: 'G0', color: 'red', places: [{ name: 'Alpha', description: 'The old mill.' }, 'Beta'] },
      { name: 'G1', color: 'blue', places: ['Gamma', 'Delta'] },
    ] };
    const map = deriveClassicBoard(facts, { rng: makeRng('b') });
    expect(validateMap(withMeta(map))).toEqual([]);
    const alpha = map.spaces.find(s => s.name === 'Alpha');
    expect(alpha.description).toBe('The old mill.');
    const beta = map.spaces.find(s => s.name === 'Beta');
    expect(beta).not.toHaveProperty('description');
  });

  test('mixed string + object items in the same group (hand-author opts in per-place)', () => {
    const facts = { groups: [
      { name: 'G0', color: 'red', places: ['Alpha', { name: 'Beta', description: 'Foggy docks.' }] },
      { name: 'G1', color: 'blue', places: ['Gamma', 'Delta'] },
    ] };
    const map = deriveClassicBoard(facts, { rng: makeRng('b') });
    expect(validateMap(withMeta(map))).toEqual([]);
    expect(map.spaces.find(s => s.name === 'Beta').description).toBe('Foggy docks.');
    expect(map.spaces.find(s => s.name === 'Alpha')).not.toHaveProperty('description');
  });

  test('object item with no/invalid description -> space carries no description key', () => {
    const facts = { groups: [
      { name: 'G0', color: 'red', places: [{ name: 'Alpha', description: '' }, { name: 'Beta' }] },
      { name: 'G1', color: 'blue', places: ['Gamma', 'Delta'] },
    ] };
    const map = deriveClassicBoard(facts, { rng: makeRng('b') });
    expect(map.spaces.find(s => s.name === 'Alpha')).not.toHaveProperty('description');
    expect(map.spaces.find(s => s.name === 'Beta')).not.toHaveProperty('description');
  });
});

// ── validateWorld / validateMap tolerance (string <= 200, else reject) ──
describe('validateWorld — description tolerance', () => {
  const clone = w => JSON.parse(JSON.stringify(w));
  test('absent -> no error (optional)', () => {
    expect(validateWorld(MINI_WORLD, ARCHETYPES)).toEqual([]);
  });
  test('valid string within 200 -> no error', () => {
    const w = clone(MINI_WORLD); w.places[0].description = 'A hub city.';
    expect(validateWorld(w, ARCHETYPES)).toEqual([]);
  });
  test('exactly 200 chars -> accepted', () => {
    const w = clone(MINI_WORLD); w.places[0].description = 'x'.repeat(200);
    expect(validateWorld(w, ARCHETYPES)).toEqual([]);
  });
  test('201 chars -> rejected with a clear message', () => {
    const w = clone(MINI_WORLD); w.places[0].description = 'x'.repeat(201);
    const errs = validateWorld(w, ARCHETYPES);
    expect(errs.join(' ')).toMatch(/description.*<= 200/);
  });
  test('non-string -> rejected', () => {
    const w = clone(MINI_WORLD); w.places[0].description = 42;
    expect(validateWorld(w, ARCHETYPES).join(' ')).toMatch(/description/);
  });
});

describe('validateMap — description tolerance', () => {
  test('absent -> no error (optional)', () => {
    expect(validateMap(classicMap)).toEqual([]);
  });
  test('valid string within 200 -> no error', () => {
    const spaces = classicMap.spaces.map(s => ({ ...s }));
    spaces[1] = { ...spaces[1], description: 'A brownstone row.' };
    expect(validateMap({ ...classicMap, spaces })).toEqual([]);
  });
  test('201 chars -> rejected with a clear message', () => {
    const spaces = classicMap.spaces.map(s => ({ ...s }));
    spaces[1] = { ...spaces[1], description: 'x'.repeat(201) };
    const errs = validateMap({ ...classicMap, spaces });
    expect(errs.join(' ')).toMatch(/description.*<= 200/);
  });
  test('non-string -> rejected', () => {
    const spaces = classicMap.spaces.map(s => ({ ...s }));
    spaces[1] = { ...spaces[1], description: ['not', 'a', 'string'] };
    expect(validateMap({ ...classicMap, spaces }).join(' ')).toMatch(/description/);
  });
});

// ── Round-trip: facts.json WITH descriptions -> emitted data.json, exact popover field ──
describe('round-trip: facts.json descriptions land in data.json under the field App.js reads', () => {
  test('atlas: world.places[].description survives facts -> expandFacts -> validate -> emit -> data.json', () => {
    const facts = {
      id: 'desc-atlas-mod', name: 'Desc Atlas Mod', tagline: 't', version: '1.0.0', mapType: 'atlas', seed: 'seed1',
      world: {
        renderMode: 'globe', victory: { maxTurns: 150, params: { groupsToWin: 2 } },
        // 4 EQUAL-value places (identical population/gdp/fame, like the orchestrator test's
        // fixture) so no place concentrates board value past the default valueShareCap —
        // unrelated to the description field under test here.
        places: [
          { id: 'aa', realName: 'Aa', archetypes: ['market'], geo: { lat: 40, lng: -74 }, data: { population: 1000000, gdp: 50, fame: 60 }, description: 'A river port on the delta.' },
          { id: 'bb', realName: 'Bb', archetypes: ['market'], geo: { lat: 51, lng: 0 }, data: { population: 1000000, gdp: 50, fame: 60 } },
          { id: 'cc', realName: 'Cc', archetypes: ['market'], geo: { lat: 35, lng: 139 }, data: { population: 1000000, gdp: 50, fame: 60 } },
          { id: 'dd', realName: 'Dd', archetypes: ['market'], geo: { lat: -33, lng: 151 }, data: { population: 1000000, gdp: 50, fame: 60 } },
        ],
      },
      roster: [
        { id: 'a', name: 'A', passive: 'enforcer' },
        { id: 'b', name: 'B', passive: 'pioneer' },
      ],
    };
    const input = expandFacts(facts, { ARCHETYPES });
    const { ok, errors, normalized } = validateModInput(input, OPTS_SP1);
    expect(errors).toEqual([]);
    expect(ok).toBe(true);
    const { files } = emitMod(normalized);
    const dataFile = files.find(f => f.path.endsWith('.data.json'));
    const data = JSON.parse(dataFile.contents);
    // This IS mapJson.places in App.js's setMap (App.js:289) -> place.description in
    // _tileDetailData (App.js:2076) -> tileDetailHtml's d.description (game-chrome.js:139).
    const aa = data.world.places.find(p => p.id === 'aa');
    expect(aa.description).toBe('A river port on the delta.');
    const bb = data.world.places.find(p => p.id === 'bb');
    expect(bb).not.toHaveProperty('description');
  });

  test('classic: map.spaces[].description survives the same pipeline (data-complete; NOT yet read by the popover — see file header)', () => {
    const facts = {
      id: 'desc-classic-mod', name: 'Desc Classic Mod', tagline: 't', version: '1.0.0', mapType: 'classic', seed: 'seed2',
      board: { groups: [
        { name: 'G0', color: 'red', places: [{ name: 'Foundry Row', description: 'Smoke over the rail yards.' }, 'Coal Yard'] },
        { name: 'G1', color: 'blue', places: ['Rail Exchange', 'Gasworks'] },
      ] },
      roster: [
        { id: 'a', name: 'A', passive: 'enforcer' },
        { id: 'b', name: 'B', passive: 'pioneer' },
      ],
    };
    const input = expandFacts(facts, { ARCHETYPES });
    const { ok, errors, normalized } = validateModInput(input, OPTS_SP1);
    expect(errors).toEqual([]);
    expect(ok).toBe(true);
    const { files } = emitMod(normalized);
    const dataFile = files.find(f => f.path.endsWith('.data.json'));
    const data = JSON.parse(dataFile.contents);
    const foundry = data.map.spaces.find(s => s.name === 'Foundry Row');
    expect(foundry.description).toBe('Smoke over the rail yards.');
    const coal = data.map.spaces.find(s => s.name === 'Coal Yard');
    expect(coal).not.toHaveProperty('description');
  });
});
