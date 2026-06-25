// Stage 1 acceptance: setActiveMod must mutate the live RULES IN PLACE (never rebind),
// so the engine's ~206 RULES.* reads and the tests' in-place RULES mutations keep working
// with zero churn. With only Dominion registered this is a pure pass-through.
import { setActiveMod } from '../Game';
import { RULES } from '../../mods/active-rules';
import { MODS, PRISTINE } from '../../mods/index';

describe('setActiveMod', () => {
  test('keeps RULES object identity (never rebinds the binding)', () => {
    const ref = RULES;
    setActiveMod('dominion');
    // Same reference — engine reads and test mutations both still reach this object.
    expect(RULES).toBe(ref);
  });

  test('RULES still has Dominion values after setActiveMod("dominion")', () => {
    setActiveMod('dominion');
    expect(RULES.core.baseStartingMoney).toBe(1500);
    expect(RULES.core.boardSize).toBe(40);
    expect(RULES.seasons.list).toHaveLength(4);
    expect(Array.isArray(RULES.display.playerColors)).toBe(true);
  });

  test('own keys are cleared and re-merged (no stale keys, all expected keys present)', () => {
    // Poison the live RULES with a stray own key — setActiveMod must clear it.
    RULES.__strayKey = 'should-be-deleted';
    setActiveMod('dominion');
    expect('__strayKey' in RULES).toBe(false);
    // Core config sections are all present after the re-merge.
    ['core', 'buildings', 'rent', 'seasons', 'stats', 'passives', 'trading', 'auction', 'display']
      .forEach((k) => expect(RULES[k]).toBeDefined());
  });

  test('reseeds from the PRISTINE clone, not the live object (clone is independent)', () => {
    // The pristine clone must not share identity with the live rules — proves a future
    // mod switch reseeds from an untouched snapshot, never from a mutated live object.
    expect(PRISTINE.dominion).not.toBe(RULES);
    expect(PRISTINE.dominion.core.baseStartingMoney).toBe(1500);
  });

  test('throws on an unknown mod id', () => {
    expect(() => setActiveMod('does-not-exist')).toThrow(/Unknown mod/);
  });

  test('Dominion is registered in MODS as a tier-A bundle (no image fields)', () => {
    expect(MODS.dominion).toBeDefined();
    expect(MODS.dominion.id).toBe('dominion');
    expect(MODS.dominion.rules).toBe(RULES); // bundle.data rules === the live shared object
    expect(MODS.dominion.portraits).toBeUndefined(); // tier A has NO portraits
    expect(MODS.dominion.keyArt).toBeUndefined();     // tier A has NO keyArt
  });
});
