# Atlas Map System — index & roadmap

The **Atlas** system is Meinopoly's composable map engine: real places × district
**archetypes** → a branching board graph, loaded/validated at runtime. It runs alongside
the legacy loop maps (`movementMode: 'loop'`); atlas worlds set `movementMode: 'atlas'`.
The long-term goal is **AI map generation** (a prompt → a full playable world via the same
loader the hand-authored maps use).

> Design spec (gitignored): `docs/superpowers/specs/2026-06-09-composable-atlas-map-design.md`
> Per-task plans (gitignored): `docs/superpowers/plans/2026-*-atlas-*.md`

---

## Where everything lives

### Map content (this folder, `mods/dominion/atlas/`)
- `worlds/terra-circuit.js` — the hand-authored world (7 real cities, branching loop,
  Singapore fork, two hubs). Data-only + **server/sim/test-safe** (no image imports).
- `archetypes.js` — the 12 district archetypes (price/rent/slot profiles + trait leans).
- `fixtures/mini-world.js` — tiny world used by unit tests.
- `assets/` — real-city background images: `world.jpg` + `cities/<placeId>.jpg`,
  `fetch-assets.mjs` (reproducible Wikimedia fetch), `CREDITS.md` (provenance/licensing).
- `terra-assets.js` — **CLIENT-ONLY** ES-module image imports (world bg + city photos).
  NEVER import from Game.js/world-loader/sim/tests — they run under plain Node and can't
  load images (same split as `characters.js` vs `characters-data.js`).

### Engine / loader / client (`src/`)
- `world-loader.js` — `loadWorld`, `expandWorld`, `validateWorld`, `computePlaceValues`
  (log/min-max normalization → $60–400 band), `aggregateTraits` (clamp ±0.12).
- `atlas-movement.js` — pure graph helpers: `validateRoute`, `autoRoute`,
  `enumerateRoutes`, `routeChoices` (groups branches by first-divergence node).
- `Game.js` — engine integration: `setActiveMap`, `G.board.{movementMode,edges,hubs,traits,winPaths}`,
  `groupKeyOf` (placeId||color), `rollOnly`/`commitRoute` (route picker), hub salary via
  `applyEconMods('income',…)`, in-place jail (`sendToJail`), `computeAffinityBonus` (map traits).
- `App.js` — client: `setMap` dispatches `loadWorld`; `ATLAS_ASSETS` registry → `mapData.atlasAssets`;
  `_renderAbsoluteBoard` (world bg + edge arrows + labels); `_tileHtml` (city photo + scrim);
  `_resolveAtlasRoute` (route-picker UI); victory selector honors map `maxTurns`.

### Balance sim (`src/sim/`) — `npm run sim -- --map terra-circuit --games 200 --seed 1`
- `match.js` (one game via boardgame.io Client), `bot.js` (greedy-developer + route strategies),
  `tournament.js` (seat rotation, CI, 60/40 gate, `runStrategyTournament`), `standings.js`, `cli.js`.

### Config / tests
- `mods/dominion/rules.js` → `RULES.affinity.cashPerFit` (map-trait grant magnitude).
- `terra-circuit.js` → `victory.maxTurns` (timed terminator).
- Tests: `src/__tests__/{atlas-movement,atlas-engine,terra-circuit,sim-bot,sim-tournament}.test.js`
  + the affinity describe in `Game.test.js`. Run `npx jest --no-coverage` (446) + `npx playwright test`.

---

## Status — Phase I

| Done | What |
|---|---|
| ✅ | World loader + `validateWorld` + 12 archetypes + MINI_WORLD |
| ✅ | Engine movement: whole-route walk, hub salary, node-targeted moveTo |
| ✅ | Place-set monopolies + dominion victory on atlas |
| ✅ | First visible + playable map (Terra Circuit) |
| ✅ | Map polish: geographic-ish layout, labels, edge arrows |
| ✅ | Route picker: choose your branch at forks (spec D11) |
| ✅ | Balance sim: camper/tourer + best/worst-fit, 60/40 gate |
| ✅ | Map traits: one-time stat-scaled affinity grant + Terra 120-turn terminator |
| ✅ | Real-city backgrounds: world-map board + per-city photos |

---

## Next / backlog (priority order)

1. **Geographic city alignment** *(immediate, cheap)* — pin each Terra city at its real
   lat/long on the world map (`pos.x = (lon+180)/360*100`, `pos.y = (90-lat)/180*100`) so
   the world-map board reads as an actual world tour. Just the 7 `pos` values; screenshot-verify.
2. **Expand Terra to ~40 spaces** — author ~13–14 cities for a full-size board; re-run the
   balance sim to re-tune `maxTurns` + `cashPerFit` (both were tuned for the 21-tile board).
3. **Win-path selector + victory footguns** — per-match victory UI filtered to `winPaths`;
   reconcile UI id `'monopoly'`→`'dominion'`; close: (a) dominion world with <3 buildable
   groups = unwinnable → clamp `groupsToWin`; (b) wealth world with no `maxTurns` = never ends.
   This is the safe prerequisite for AI generation.
4. **Camera / zoom + culling renderer** — shared-transform container, zoom-to-fit, auto-follow,
   <16ms gate. Only worth it once boards are bigger than ~21 tiles.
5. **Character-select fit display** — show a character's affinity/fit on the select screen
   before picking (today the bonus only appears in the join message + in-game money).
6. **Phase II: AI map generation** — prompt → archetype assignments + real place data +
   connectors → `loadWorld`. The strategic payoff; also yields big boards on demand.

---

## Known latent findings (not bugs — revisit when relevant)

- **Short games are not character-balanced**: best-fit ~69% win at a 40-turn cap (the long
  game masks it). Matters if a map is short/fast.
- **`maxTurns` is a flat TOTAL-turn cap**: more players → fewer rounds each (120 turns = 60
  rounds for 2p, 30 for 4p). Per-player scaling is a win-path-selector concern.
- **Affinity cash grant is diluted on long maps**: it only expresses once a map has a bounded
  length (sim-proven). Tuned for Terra's 120-turn cap.
