# Meinopoly Roadmap

_Last updated: 2026-07-12. This records direction agreed with the project owner; the two
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

> **SP4 — Smart-builder: DONE 2026-07-02 (main `5ce299a`).** `npm run create-mod -- <facts.json> --smart
> [--seed s]` relaxes SP1's input from "near-final" to FACTS: per-city geo/data/archetypes, character
> concepts, property groupings. `expandFacts` (pure, seeded, deterministic — `src/createmod/smart/`) derives
> atlas connectors+hubs (nearest-neighbor tour + hub greedy measured against the loader's own expandWorld +
> reversed-BFS), sum-34 rosters (concept or rough-stats mode), and a validateMap-legal classic ring board,
> then feeds SP1's pipeline. `--dry-run` prints the derived JSON as an inspect/tweak escape hatch. Ships two
> smart-built mods (`silk-road` atlas + `gilded-rails` classic). 587 unit tests + a mod-select E2E. The
> facts schema is the contract SP2's LLM extraction will target.

> **SP2 — Book→facts extractor: DONE 2026-07-05 (main `f6c3314`).** `npm run extract-facts -- <book.txt>`
> turns a whole book (chunked map-reduce, success-only chunk cache, `--lang auto|en|zh`) into an SP4 facts.json
> via OpenAI strict structured outputs: per-chunk candidate extraction → code-side union-find merge/rank/cut →
> focused synthesis (world/board, roster with id-integrity gate, per-character lore with degrade-on-failure) →
> offline validation → ONE section-scoped repair round (roster reconciliation re-keys surviving lore). Real
> places get real geo; fictional worlds get LLM layouts; `--map-image westeros.jpg` aligns places to a
> user-supplied map via vision and ships it as the board background (`worldbg` asset chain through emit →
> atlasAssets). `create-mod -- book.txt --from-book` chains extraction into the --smart build with an early
> dup-check before any API spend. Key hygiene throughout (.env only, never logged/cached). Pure core in
> `src/createmod/extract/` + `scripts/extract-facts.js`; 679 unit tests. Manual live-API acceptance checklist
> in `.superpowers/sdd/progress.md`, pending user run (needs real OPENAI_API_KEY).

> **SP3 — Portrait generation: DONE 2026-07-06 (main `b901b77`).** `npm run gen-portraits -- <mod-id>`
> gives a created mod real pixel-art portraits: ONE gpt-image-1 grid image per ≤16-char batch
> (square-first packing, near-equal batches) → slice → center-crop → 52px nearest downscale →
> deterministic 24-color median-cut quantize (spec-pinned tie-breaks) → 341×341 upscale →
> `mods/<id>/portraits/<char-id>.png` + characters.js re-render (PORTRAIT_MAP auto-wired). Atomic
> buffer-all-then-write (failures never destroy existing portraits), stale-PNG pruning with pre-call
> preview, cost plan printed before any spend, `--dry-run`/`--force`/`--style`/`--image-model`,
> roster-id injection/duplicate/identifier validation (a hostile data.json can no longer break the
> app build), key redaction on all error paths to disk. `create-mod ... --portraits` chains it on
> every create path. Pure core `src/createmod/portraits/` + `scripts/gen-portraits.js` (pngjs, no
> Python/native deps); 766 unit tests. **Major Task 1 is now COMPLETE end-to-end: book → facts →
> mod → portraits.** Manual live acceptance (sanguo 8 portraits) pending user key.


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
Decomposed 2026-07-06 into: SP1 foundation (events+seats) → SP2 duel/对战 → SP3 MCP → SP4 dialogue
(with per-character turn memory + personality memory).

> **MT2-SP1 — Typed engine events + seat authorization: DONE 2026-07-07 (main `d992f7b`).** Every
> gameplay occurrence is now ONE typed event on `G.events` (40-type frozen registry, seq-monotonic,
> capped log) via `src/events.js`'s `logEvent`; all 71 `G.messages` sites migrated with BYTE-IDENTICAL
> text (golden-capture harness: 9 scenarios/167 frozen snapshots; guardrail test bans raw pushes;
> 26/26 E2E first-run). `detectAndTriggerAI` is event-driven (lazy seq cursor, no load/join bursts) —
> string-sniffing retired, AI eventData now carries real values. Seat authorization: `enforceSeats`
> (Lobby sends setupData), uniform `requireActor` on all 22 moves (privilege-escalation hole closed —
> a trade target can no longer rewind/bankrupt the proposer), `setActivePlayers` envelopes with every
> exit restored — ONLINE TRADES AND AUCTIONS WORK ACROSS SEATS for the first time. Hardened along the
> way: accept-time trade re-validation (stale-snapshot auto-cancel), auction solvency re-checks,
> bankrupt-bidder cleanup, and a PRODUCTION boardgame.io v0.45 crash (rejected moves → STRIP_TRANSIENTS
> → master unhandled rejection) fixed via `client:false` on all moves (empirically reproduced pre-fix).
> 932 unit tests + 26 E2E. The event registry is the contract SP2/SP3/SP4 consume. Post-merge tickets:
> endTurn×awaitingRoute pre-existing hole; SP3 must document the 200-event front-trim for slow consumers.

- **Character dialogue** — formalize AI character conversation (today: `src/character-ai.js`, OpenAI,
  per-event + chat) into a proper, game-state-aware, in-character, multi-turn dialogue system,
  WITH per-character turn memory + personality memory (owner requirement 2026-07-06).
- **MCP** — expose game state + mechanisms over MCP so external agents/tools (and the dialogue layer)
  can observe/drive the game. (`sim/match.js` is the headless-driving precedent; events = subscribe feed.)
> **MT2-SP2 — Rent-duel mechanism (对战/单挑): DONE 2026-07-10 (main `d20c8cb`).** Landing on a rent-due
> opponent property (duel-enabled mods) offers PAY RENT or DUEL!: the owner FIGHTS (each side 2d6 +
> stamina + luck÷2, tie→defender; challenger win = rent waived, loss = double rent, bankruptcy-capable)
> or DECLINES (normal rent). Cooldown default 3 turns; `RULES.duel` fully configurable (stats, dice,
> multiplier, tie rule). Frozen-rent contract; 10-move mid-duel guard list; save/load-safe (stale-duel
> clear + round-trip tests); seat envelopes (third cross-seat guard pair) proven over the Local master;
> AI DUEL reactions; sim duelPolicy bots + duel-cashflow tournament tables (fairness gates PASS under
> both strength and always policies — weak challenger wins 17.5% and bleeds 2× rent, as designed);
> turnbox UI with owner hand-off cue + dice-face result strip; enabled on terra-titans (Genghis vs
> Cleopatra is now a real fight at ~1-3%, not a foregone conclusion). Drive-by production fixes: globe
> route auto-commit stuck-UI (pre-existing since 06-24, also heals ancient-empires/silk-road) and sim
> strength-policy game-truncation. 1018 unit tests + 28 E2E. Events duel_offered/initiated/declined/
> resolved (registry 42) are the SP3-MCP/SP4-dialogue contract surface.
> **MT2-SP3 — MCP layer: DONE 2026-07-11 (main `a68847d`).** A 9-tool stdio MCP server
> (`npm run mcp`; register with `claude mcp add meinopoly -- node <abs>/scripts/mcp-server.js` —
> NEVER via npm run, its banner corrupts the wire) lets AI agents join a running game server
> (`MOD=<id> npm run server`) as REAL player seats: list/create/join match (probe-before-connect
> ghost guardrail, 409 cred-reuse restart recovery, await-first-sync), get_state/digest (seat-scoped
> projections, no raw-G leak), list_legal_moves (hand-mirrored eligibility table, drift-oracle-tested
> both directions over 4 seeded full games), make_move (4-layer pipeline: zod schemas → gameover →
> decisionSeq correlation fail-closed → bounded event-signature attribution incl. challenger-actor'd
> duel_resolved + stale-trade branch; single-flight), get_events (exclusive cursor, sentinel −1,
> gap:true on real front-trim), wait_for_my_turn (canAct predicate, independent concurrent waits).
> Engine: G.activeModId/activeMapId stamping + MOD=/MAP= server boot + App.js online first-sync
> alignment. Scoped-esm bootstrap (SDK/zod native CJS + src/ via esm shim) with --selftest. Whole-stack
> smoke test spawns BOTH real processes and speaks raw JSON-RPC (schema serialization pinned).
> 1093 unit tests; final whole-branch review + re-review = ready-to-merge. PENDING: manual acceptance
> (browser + MCP seat to gameover incl. a duel response) — blocked on "no second player to add",
> unblocks when bots land or via a second Claude session. Post-merge tickets: atlas drift coverage,
> App.js version-skew re-align guard, CLAUDE.md docs pass (npm run mcp + registration flow), small
> seam polish (onSync client-identity check, waitForMyTurn catch specificity, smoke gameProc stderr).
- **Other mechanisms (TBD — to discuss):** e.g. AI bot players, alliances/voting, world events.

## Next wave (owner feedback 2026-07-11, experience-first)
> **Experience wave: DONE 2026-07-12 (main `6bc10dc`, 10 commits, 1128 unit + 30 E2E).**
> ① Flat-atlas map declutter (`declutterPositions` in world-loader — deterministic min-distance
> relaxation; the 三国 sanguo map's stacked tiles are now readable; real-data test fixture).
> ② Event-driven presentation layer (spec'd invariant: animations/audio NEVER touch game state):
> `src/anim.js` scheduler (lazy seq cursor w/ first-sight absorb, FIFO by seq, fast-forward on
> input, depth-cap drain, gap-jump, enqueue-claim token ownership) + `src/App.js` stage — center
> dice tumble (real pip glyphs, 700+400ms), token hop 160ms/tile on ALL three renderers (grid,
> flat atlas, globe via dataset.lat/lng), `moved` events carry `data.path` on atlas walks.
> ③ `src/audio.js` WebAudio chiptune SFX (no asset files; total event→sound map over the 42-type
> registry; mute toggle persisted; bgmGain channel reserved — owner adds BGM later).
> Final review + re-review closed (4 Importants found at the seams, all fixed: loadGame cursor
> off-by-one, destination-preview, first-sight replay burst, reset placement leak).
> Owner acceptance 2026-07-12: dice/animation/sound approved; map READABILITY fixed — remaining
> complaints are pre-existing LAYOUT issues → next wave below.

## Next wave 2 (owner feedback 2026-07-12, in-game layout rebuild)
> **Layout rebuild: DONE 2026-07-12 (main `44ad35b`, 11 commits, 1144 unit + 32 E2E).**
> Map-dominant rows layout (top portrait-chip strip w/ TURN/OUT/JAIL badges + click-popover detail
> card; bottom horizontal action bar; right LOG/CHAT/MANAGE drawer w/ unread dot) — the 590px of
> permanent side rails is gone; board 642px@1400×900 / ~822px@1080p (old cap 780), square and
> contained at EVERY aspect ratio (container-query `100cqmin` sizing), invariant of player count
> (2-10, chips overflow-x). Portrait tokens everywhere (board/globe/chips/popover/who-chip) via
> `_clientChar` client-bundle resolution — LOAD-BEARING DISCOVERY: G characters never carry
> portraits (Tier-A data, by design). `src/game-chrome.js` pure builders (entry-ui precedent).
> Two final-review Criticals found + fixed (chip vertical-column collapse at high player counts;
> near-square viewport overflow). Two adjudicated E2E retargets. anim/SFX layer untouched.
> Owner acceptance feedback → wave 3 below.

## Next wave 3 (owner acceptance feedback 2026-07-12): atlas map fill + ownership visibility
> **Wave 3: DONE 2026-07-12 (main `4d669e1`, 4 commits, 1153 unit + 33 E2E; final review passed
> CLEAN — zero findings, first wave to do so).** ① Rank-aware fit (`fitPositions`, blend default 1)
> — sanguo main-cluster spread 57→79 (+40%, live-DOM-measured); affine fit was proven structurally
> outlier-capped and escalated to rank mid-wave on reviewer evidence. Declutter recalibrated 17/11.
> ② Atlas tiles 9.5%/11% (classic ring maps untouched). ③ Ownership: bought tile = owner-color
> border + 14px portrait flag (mortgage dims it; mort badge relocated bottom-right to avoid
> collision), unbought stays neutral; globe city points ownership-colored (single owner / contested
> gray / unowned red) via accessor-reassign on ownership delta. E2E ownership case added (33 total).
> Owner acceptance: features good but STILL not readable enough at layout scale → wave 4.

## Next wave 4 (owner acceptance feedback 2026-07-12): FULLSCREEN map + auto-hide chrome
> **Wave 4: DONE 2026-07-13 (main `bf45b6c`, 12 commits, 1163 unit + 40 E2E).** Full-bleed game
> stage (`app--game`): auto-hide topbar (mousemove rect-poll — mouseenter provably sticks),
> Fullscreen-API button, floating chip strip (slim/hover-expand) + action bar, wide-screen GUTTER
> mode (≥300px/side: chips column left rail, log drawer auto-open right, action bar docked in
> the left rail). Tile info popovers (calculateRent exported; atlas place stats + optional 简介),
> token/gtoken → player card with LORE, Escape modal-first, always-visible route network with
> per-edge hot highlighting + route-pick banner/pulse (owner round-1: "卡住了" was the invisible
> route prompt), calm base lines. RECT canvas for atlas/globe (owner round-2: "还是方块") —
> tiles square via cqmin, sanguo 1266×896 @1890×920 — and board size LOCKED in-game (owner-found
> deform bug: 742→630 after one roll, now bit-identical across states + E2E regression guard).
> Three acceptance rounds; 2 pre-existing latent bugs fixed (sibling-selector drawer, :root var).
> Deferred: globe-city popover parity, drawer-tabs z-overlap, hotzone/chip 2px, >1100px check.

## Next initiative (owner 2026-07-13): VISUAL RESKIN — design-first (重皮不重骨)
> **RESKIN R1+R2+R3: DONE 2026-07-13 (7 waves, all inline-executed, 1198 unit + 43 E2E).**
> Owner chose **B2 像素化夜光战情室 (hi-bit pixel war room)** from 4 mockups (canonical:
> `docs/superpowers/design/mockup-b2-pixel-nightlights.html`); architecture principle: SHELL
> (engine, constant) vs BACKGROUND (per-mod, era-driven, generated).
> - **R1a** tokens/foundation: one B2 :root palette (GB 3-theme + CRT retired), wr-panel/notch/
>   btn/badge component family, `src/wr-bloom.js` ditherBloom sprites (fixed context enum).
> - **R1b** HUD: amber CTA + pulse, navy dice + amber pips, bilingual 交易/结束回合 labels,
>   drawer/topbar/route-banner, wr popover cards.
> - **R2** per-mod board backgrounds (PULLED AHEAD — owner asked why bgs don't render):
>   persistent `.board__bg` layer on all flat renderers (starfield fallback), era-driven
>   `composeBoardBgPrompt` from character lore, `npm run gen-boardbg -- <mod>` CLI
>   (**gpt-image-2** default per owner) + committed art for dominion-classic/gilded-rails/
>   steam-barons/silk-road/ancient-empires (+ sanguo working-tree only — owner WIP). New mod
>   contract: `mapAssets[mapId].boardBg` (classic twin of atlasAssets worldBg).
> - **R1c** atlas node-cards: dither-bloom halos (owner-neon when owned), hexagon chance /
>   diamond tax / amber GO shapes, pixel-dashed routes (E2E opacity gates untouched).
>   + owner-driven brightness pass (veils cut, art ×1.3, routes .32, bloom alphas up).
> - **R1d** classic ring material + legend cartouche (LIVE per-player territory rows).
> - **R3** entry screens: `.pix-panel`/`.pix-btn`/`--bevel`/`--drop` primitives redefined to
>   the B2 material — every entry screen converted wholesale; .modal unified.
> **Remaining: R4 ambience** (light dust, node pulse, hover micro-motion, victory moments) —
> anytime, additive-only. **Follow-up:** create-mod auto-wiring of generated boardBg
> (gen-boardbg prints the wiring line today; integrate into the create-mod chain like
> --portraits).

## Near-term (owner 2026-07-12): Localization 汉化
Owner wants Chinese localization — EXPLICITLY not necessarily in wave 4; schedule as its own
wave (Phase 9 already lists "Localization (English + Chinese)"). UI strings are scattered inline
(templates in App.js/game-chrome/entry-ui) — needs a small string-table design first.

## Near-term (owner 2026-07-12): mod balance simulator (standalone)
> **DONE 2026-07-14.** `npm run sim -- --mod <id>` runs any registered mod on its REAL board
> (registry resolution; fixed the ingest that silently clobbered non-dominion boards with
> dominion's classic map.json): headline MELEE table (full roster in shared 8-seat games,
> rotation windows for 16-char rosters, per-character win% vs the 1/seats baseline with
> CI-gated STRONG/WEAK flags) + the existing 1v1 fit/strategy gates generalized to any roster.
> Dominion runs without --mod stay byte-identical. First real finding (sanguo, 200 games):
> 關羽 wins 67.5% of 8-seat games (5.4× baseline), 李儒 0% — sanguo needs tuning before play.

## Near-term (owner 2026-07-12): per-place 简介 in create-mod
Wave 4 ships a tile-info popover that displays an OPTIONAL `place.description`; no world carries
it yet. Follow-up: the create-mod pipeline (extract-facts → smart-builder → emit) should generate
a short per-place description from the source book so generated mods (sanguo etc.) ship with 简介.
Touches the LLM extraction schema + emit pass-through + validateWorld optional-field tolerance.

## Engine stat mechanics (owner 2026-07-14, from the balance-sim findings)
> **DONE 2026-07-14 (feat/stat-mechanics, 5 commits, 1285 unit + 44 E2E).** The sim proved
> negotiation/tech/luck/stamina contributed ZERO to outcomes (no hooks in recurring money
> flows). New continuous passive modifiers, all RULES-config and per-mod overridable:
> negotiation +1.5%/pt rent COLLECTED (charisma's mirror), tech +2%/pt rent on built
> properties, luck +3%/pt card gains + floor(luck/3) redraws (threshold retired — redraw
> pauses now roster-wide, owner-approved), stamina −3%/pt tax/negative-card losses.
> Validation: dominion 200-game melee zero flags before AND after (the earlier "4 flags"
> was 6-game noise), bottom tightened (Evelyn luck-10 5.6→8.1%). Honest limit, measured:
> melee bottom (sanguo 李儒 3.5%) is early-capital-snowball × winner-take-all — needs stat
> redistribution (meaningful now), not rules knobs; aggressive-value probe reverted.
> Post-merge tickets: gainAll logs nominal amount, MCP digest redraw hint unconditional,
> old-save luckRedraws drift.

## Sequencing (proposed; to confirm)
1. Near-term: entry-UI polish (small, visible).
2. Then pick ONE major task to design first. Task 1 (create-mod engine) compounds content velocity;
   Task 2 (API/MCP + dialogue) deepens the play experience. Each gets its own design pass (likely a
   workflow) before implementation.
