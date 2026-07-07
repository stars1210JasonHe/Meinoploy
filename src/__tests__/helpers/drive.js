// Golden-message capture harness (Task 2 of the engine-events migration).
//
// Drives the REAL boardgame.io reducer (Game.js's `Monopoly` def, completely
// unmigrated) through deterministic scripted scenarios so Tasks 3-6 have an
// executable, byte-identical baseline for `G.messages` text. See
// .superpowers/sdd/task-2-brief.md for the full scenario list and rationale.
//
// Idioms reused from src/sim/match.js (read that file first):
//   - v0.45 seeds the GAME DEF, not the Client option: spread `Monopoly` into a
//     fresh object with `seed` set (never mutate the imported engine — this
//     harness, like the sim, is a pure consumer).
//   - setActiveMap(...) BEFORE constructing the Client, so Monopoly.setup()
//     snapshots the right board into G.board. We always pin the classic map
//     explicitly (never rely on Game.js's default _pendingMap) so this harness
//     is immune to another test file in the same Jest module registry having
//     left a different map active.
//   - Single local Client (no playerID) + synchronous client.moves.X(...) then
//     client.getState() — valid for a single local client (proven by the sim).

import { Client } from 'boardgame.io/client';
import { Monopoly, setActiveMap } from '../../Game';
import { loadMap } from '../../map-loader';
import classicMapJson from '../../../mods/dominion/maps/classic/map.json';

// Build a fresh, seeded client on the classic board and start it (phase:
// 'characterSelect', ready for selectCharacter calls).
export function makeClient(numPlayers, seed) {
  setActiveMap(loadMap(classicMapJson));
  const seededGame = Object.assign({}, Monopoly, { seed: String(seed) });
  const client = Client({ game: seededGame, numPlayers, debug: false });
  client.start();
  return client;
}

// Drive character selection for every seat, in turn order, one characterId per
// seat. Characters must be distinct (the engine rejects a duplicate pick).
export function selectAllCharacters(client, charIds) {
  charIds.forEach(id => client.moves.selectCharacter(id));
}

// Dispatch a fixed script and capture a deep-copied `G.messages` snapshot after
// EVERY step. A step is either:
//   - an array [moveName, ...args] dispatched as client.moves[moveName](...args)
//   - a function (client) => void for state-dependent-but-still-deterministic
//     cleanup (e.g. "if a buy prompt is pending, resolve it") — deterministic
//     because the seed fixes what state actually occurs at that point.
// A move that boardgame.io rejects (INVALID_MOVE) is a harmless no-op — the
// snapshot for that step will just repeat the prior one.
export function playScript(client, script) {
  const snapshots = [];
  for (const step of script) {
    if (typeof step === 'function') {
      step(client);
    } else {
      const [name, ...args] = step;
      const fn = client.moves[name];
      if (typeof fn !== 'function') {
        throw new Error(`playScript: unknown move "${name}"`);
      }
      fn(...args);
    }
    snapshots.push(JSON.parse(JSON.stringify(client.getState().G.messages)));
  }
  return snapshots;
}

// Conditional step builders — deterministic given the baked seed, used inline
// in scenario scripts to shrug off whatever a dice roll happens to land on
// (a buy prompt, a pending card) without hand-computing every dice outcome.
export function ifCanBuy(moveName) {
  return (client) => {
    if (client.getState().G.canBuy) client.moves[moveName]();
  };
}

export function ifPendingCard(moveName) {
  return (client) => {
    if (client.getState().G.pendingCard) client.moves[moveName]();
  };
}

// Try seeds 1..maxSeed; `attempt(seed)` builds its own fresh client (via
// makeClient) and returns true/false for whether the seed satisfies whatever
// precondition the scenario needs (e.g. "lands on a buyable property"). Returns
// the first passing seed, or null if none of [1, maxSeed] pass.
export function seedHunt(maxSeed, attempt) {
  for (let seed = 1; seed <= maxSeed; seed++) {
    let ok = false;
    try {
      ok = attempt(seed);
    } catch (e) {
      ok = false;
    }
    if (ok) return seed;
  }
  return null;
}
