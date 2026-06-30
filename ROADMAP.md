# Meinopoly Roadmap

_Last updated: 2026-06-26. This records direction agreed with the project owner; the two
major tasks below are to **discuss + design before building** — each is a large initiative._

## Where we are
- **Mod engine** (runtime-selectable mods) + **Terra Titans** mod shipped to `main`:
  16 historical/Three-Kingdoms leaders (incl. Cao Cao, Liu Bei) on a 49-city pixel globe,
  with pixel-art portraits.
- **Globe** polish done: zoom in/out, walkable-route lighting, 49-city label declutter.
- **Balance** (sim-tuned 2026-06-26): terra-titans `groupsToWin 2` + `maxTurns 150`.
- Scope so far: **local hot-seat**. Online cross-player moves (turn.activePlayers) still pending.

## Near-term polish
1. ~~**Game-entry UI polish**~~ **DONE 2026-06-29 (main `6259b00`).** Centered menu screens (fixed the
   inline-`block`-over-`flex` root cause), body-font nav arrows, dynamic hero footer + mod taglines, live SVG
   map previews (`src/entry-ui.js miniMapSvg`), merged GAME SETUP screen (players+victory), local-only progress
   breadcrumb with soft-exit jump-back. New `src/entry-ui.js` (17 unit tests) + 4 E2E; 481 Jest + 24 E2E green.
2. ~~Balance follow-up (tourer dominance)~~ **RESOLVED 2026-06-26.** Root cause measured: tourer
   grabbed ~6.5x more cheap land (net-worth only 1.04x, but a consistent edge → ~63% wins). Fixed by
   wiring per-world economy (`loadWorld` was hardcoding mapMechanics to 1.0) + terra-titans
   `priceMultiplier: 1.5` — tourer win% 63%→~50%, both fairness gates PASS, dominion still ~57% natural.

## Major Task 1 — Create-Mod Engine (authoring → LLM-driven)
**Goal:** build whole mods without hand-coding; ultimately drive it with an LLM.

> **SP1 — Create-Mod compiler: DONE 2026-06-30 (main `1fabb9f`).** `npm run create-mod -- <input.json>`
> turns a near-final JSON spec (atlas world OR classic map + roster) into a validated, registered, runnable
> mod under `mods/<id>/`, reusing Dominion's economy. Pure core in `src/createmod/` + `scripts/create-mod.js`
> CLI; idempotent registry patch (kebab→camelId) with `--remove`/`--dry-run`/`--force`/`--balance`. Ships two
> example mods (`ancient-empires` atlas + `steam-barons` classic), both build + selectable in-game. 536 unit
> tests + a create-mod E2E. This is the no-LLM vertical slice; SP2–SP4 below layer on its input contract.


- **Map module** — a builder for atlas worlds (places, geo lat/lng, connectors, archetypes, hubs)
  that auto-satisfies the loader contract (no dead ends, every tile reaches a hub ≤N steps,
  value-share cap, groupsToWin ≤ buildable groups). Today worlds are hand-authored JS.
- **Character module** — a builder for rosters: 6 stats (sum ~34), a passive from the 8 IMPLEMENTED
  ids (financier/pioneer/speculator/enforcer/idealist/breaker/arbitrageur/merchant), color, lore.
- **LLM-driven generation (the dream):** feed a SOURCE (e.g. a book) → LLM extracts characters +
  attributes + relationships, themes + builds a map, and emits a COMPLETE mod (data + lore +
  portrait prompts). Pipeline: ingest → extract → map-to-engine-schema → validate (loader/stat
  rules) → bundle. (We already proved the pieces: workflow rosters, codex image-gen for portraits,
  validateWorld for boards — this productizes them.)

## Major Task 2 — API / MCP layer (game mechanisms)
**Goal:** establish the character-dialogue mechanism + other mechanisms via a real API / MCP surface.
- **Character dialogue** — formalize AI character conversation (today: `src/character-ai.js`, OpenAI,
  per-event + chat) into a proper, game-state-aware, in-character, multi-turn dialogue system.
- **MCP** — expose game state + mechanisms over MCP so external agents/tools (and the dialogue layer)
  can observe/drive the game.
- **Other mechanisms (TBD — to discuss):** e.g. AI bot players, alliances/voting, world events.

## Sequencing (proposed; to confirm)
1. Near-term: entry-UI polish (small, visible).
2. Then pick ONE major task to design first. Task 1 (create-mod engine) compounds content velocity;
   Task 2 (API/MCP + dialogue) deepens the play experience. Each gets its own design pass (likely a
   workflow) before implementation.
