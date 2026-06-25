// Active rules — the engine's single live RULES object.
//
// CRUX of the mod engine: `RULES` is imported by-value and read as `RULES.*` at ~206
// engine sites. Tests (Game.test.js / atlas-engine.test.js) import RULES from the
// Dominion barrel/rules module and MUTATE it in place (e.g. `RULES.core.maxTurns = 5`).
// For those mutations to reach the engine with ZERO test edits, the engine's live RULES
// must SHARE OBJECT IDENTITY with Dominion's actual rules object at load time.
//
// So we re-export Dominion's rules object directly. setActiveMod() (in src/Game.js) NEVER
// rebinds this binding — it mutates the SAME object in place (clear own keys, then deep
// Object.assign the resolved mod rules in). That keeps this identity stable forever, which
// is what both the engine and the tests depend on.
import { RULES as dominionRules } from './dominion/rules';

export const RULES = dominionRules; // SHARED IDENTITY at load — do not rebind, mutate in place.
