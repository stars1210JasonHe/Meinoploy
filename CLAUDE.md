# CLAUDE.md — Project Guide for Claude Code

## Project Overview

**Meinopoly** is a moddable Monopoly-style board game engine built with boardgame.io. The current mod is "Dominion: Multi-dimensional World Property Council" — a sci-fi council of 10 characters competing for property control. The game design documents are written in Chinese; the code is in English.

## Tech Stack

- **Game framework**: boardgame.io v0.45 (plain JS, no React)
- **Bundler**: Parcel v1 (parcel-bundler)
- **Language**: Vanilla JavaScript (ES modules)
- **Python tooling**: Use `uv` for Python environments (NOT pip/python directly — Python is not on PATH on this machine)
- **Node**: v20.19.0, npm 10.8.2
- **Platform**: Windows (Git Bash shell)

## Key Directories

- `src/` — Engine source code (App.js, Game.js, constants.js)
- `src/__tests__/` — 157 Jest unit tests
- `mods/dominion/` — Current mod: characters, board, cards, rules, portraits, lore
- `docs/` — Project documentation (RULES.md, MODDING.md, ROADMAP.md, PLAN.md, Design.md) — gitignored
- `tests/e2e/` — 18 Playwright E2E tests
- `data/` — Design docs (Chinese) and Python tooling (Split.py for portraits)
- `test/` — Original boardgame.io TicTacToe tutorial (reference only)

## Architecture

### Engine (src/)
- `src/Game.js` — boardgame.io game definition: setup(), moves, turn management, endIf. Imports mod data from `mods/dominion/`.
- `src/constants.js` — Re-export shim from mod rules (backward compat for App.js imports)
- `src/App.js` — Client initialization + DOM-based UI rendering (no framework). Creates an 11x11 CSS grid board, player panels, dice, action buttons, message log
- `index.html` — Entry point with all CSS styles inline

### Mod (mods/dominion/)
- `mods/dominion/index.js` — Re-exports all mod data
- `mods/dominion/characters.js` — 10 characters with stats, passives, Parcel-imported portrait PNGs
- `mods/dominion/board.js` — 40 board spaces + 8 color groups
- `mods/dominion/cards.js` — Chance & Community Chest card decks (includes enhanced cards)
- `mods/dominion/rules.js` — All game rules config (core, buildings, rent, seasons, stats, passives, trading, auction)
- `mods/dominion/portraits/` — 10 character head portraits (341x341 PNG)
- `mods/dominion/lore/` — 10 character lore markdown files

## Characters

All 10 characters have lore files and pixel-art portraits (including Ophelia Nightveil). Character data is in `data/Characters-v0.1.md` (Chinese). Each character has 6 stats (Capital, Luck, Negotiation, Charisma, Tech, Stamina) totaling the same sum, plus passive abilities.

## Game Mechanics (Current)

- 2–10 players: local hot-seat or online multiplayer (server.js + Lobby.js)
- Game Boy Color pixel UI (3 palettes + CRT toggle); ported from `data/design_handoff_pixel_ui/`
- Map system: 4 board layouts (square/circle/hex/custom), data-driven via `map.json`
- AI characters: optional OpenAI event reactions + chat (`character-ai.js`)
- Dialogue memory (记忆宿敌, MT2-SP4): seat-keyed attitude ledger (grudge/trust from the
  event stream, `src/dialogue/memory.js`, works keyless), memory-aware prompts + season
  diaries + banter, speech bubbles, attitude glyphs in the player popover, bots read the
  ledger on trade decisions; $3/game HARD LLM cost cap (double fuse in character-ai)
- Victory conditions: Last Standing / Timed-Richest / Dominion, chosen at game start (`G.victory`)
- Character selection with stat-based gameplay modifiers
- 40 spaces, dice, property buying with negotiation discounts, rent with charisma discounts
- 4-tier building system: House → Hotel → Skyscraper → Landmark
- Mortgage/unmortgage system
- Season system: Summer → Autumn → Winter → Spring (cycles every 10 turns)
- Enhanced event cards: payPercent, gainAll, freeUpgrade, downgrade, forceBuy, gainPerProperty
- Triple doubles → jail
- Chance/Community Chest with card redraw mechanics
- 10 character passives integrated into gameplay
- Config-driven rules: all game values in `mods/dominion/rules.js`
- Property trading: propose, accept, reject, cancel between players
- Auction system: round-robin bidding when player passes on buying

## Commands

```bash
npm start        # Dev server at localhost:1234
npm run build    # Production build
npm run server   # Online multiplayer server (port 8088)
npm run sim -- --mod <id>   # Headless balance tournament
npx jest --no-coverage  # Run ~1731 unit tests
npx playwright test     # Run 49 E2E tests (needs npm start running on 1234)
```

Node: the project pins **20.19.0** (nvm on this machine may default to 22 — pin
per-process with `$env:Path = "C:\Users\Server1.0\AppData\Local\nvm\v20.19.0;$env:Path"`).
Server + CLI scripts load ESM source via `scripts/node-compat-register.js` (works under
node 20 AND 22; the old `-r esm` shim crashes under 22). CI (GitHub Actions, 3 jobs:
jest/build/E2E on ubuntu, node 20.19) runs on every push to main.

For Python scripts in `data/`:
```bash
cd data && uv run Split.py
```

## MCP Server (AI agent access)

`scripts/mcp-server.js` is a 9-tool stdio MCP server (`list_matches`, `create_match`,
`join_match`, `get_state`, `get_state_digest`, `list_legal_moves`, `make_move`,
`get_events`, `wait_for_my_turn`) that lets an AI agent join a running game server as a
real player seat — session logic lives in `src/mcp/` (`session.js`, `view.js`,
`legal-moves.js`, `move-schemas.js`), the script itself is the stdio transport + tool
registration wrapper.

**1. Start the game server** (the MCP server is a client of this, not a replacement for it):

```bash
npm run server                              # dominion/classic (default), port 8088
MOD=terra-titans npm run server             # a specific mod, its default map/world
MOD=dominion MAP=classic npm run server     # a specific mod + map/world id
```

`npm run server` (and `sim`/`create-mod`/`extract-facts`/`gen-portraits`/`gen-boardbg`) load via
`node -r ./scripts/node-compat-register.js <entry>.js` — a small Module._extensions hook that
transpiles this project's ES-module-syntax files to CommonJS via the existing `babel.config.js`
(see that file's header comment). It replaces the old `-r esm` loader, which crashes
unconditionally under Node 22; the new mechanism works under both Node 20.19 and Node 22.

`MOD=`/`MAP=` are boot-time env vars (`server.js`, read once at startup) — one mod+map
per server process; `MAP=` without `MOD=` is a startup error (a map id only means
something within a mod). The browser client aligns to `G.activeModId`/`G.activeMapId`
on its first sync, and the MCP server aligns the same way in `onSync` (`src/mcp/session.js`).

**2. Register the MCP server with Claude Code** — direct `node`, NEVER `npm run mcp`:

```bash
claude mcp add meinopoly -- node <absolute path>/scripts/mcp-server.js
```

`npm run mcp` (i.e. `node scripts/mcp-server.js` via npm) exists for manual/local testing
(`--selftest` bootstrap check, ad-hoc runs) but must **never** be used as the actual MCP
registration command — npm's own startup banner writes to stdout, which is the JSON-RPC
wire for stdio transport, and corrupts every message that follows. Always register with
a direct `node <abs path>` invocation so nothing but the server's own JSON-RPC ever
touches stdout.

Useful env vars (all optional, see `scripts/mcp-server.js` header):
`MEINOPOLY_SERVER_URL` (default `http://localhost:8088`), `MEINOPOLY_MCP_MOVE_TIMEOUT_MS`
(default 1500), `MEINOPOLY_MCP_SYNC_TIMEOUT_MS` (default 5000), `MEINOPOLY_MCP_SESSION_FILE`
(default `.superpowers/mcp-session.json` — join credentials, gitignored).

## Conventions

- Game state is managed entirely through boardgame.io's G object (immutable pattern with Immer)
- boardgame.io v0.45 uses OLD positional API: `(G, ctx, ...args)` NOT destructured `({ G, ctx })`
- UI renders by subscribing to client state changes — full re-render on each update
- Board positions mapped via getBoardPositions() → row/col grid coordinates
- Character names use kebab-case for filenames (e.g., `Albert-Victor.png`)
- Design docs and lore are in Chinese, code comments and variable names are in English
- Portrait images must be imported as ES modules (not string paths) for Parcel to process them
- Mod-specific data lives in `mods/`, engine constants in `src/constants.js`

## Known Issues / TODOs

- Parcel v1 is deprecated; consider migrating to Parcel v2 or Vite in the future
- `data/` has its own `pyproject.toml` from uv init — this is for the Python split script only
- Marcus (operator) and Ophelia (shadow) passives have config but no engine logic yet
- Online trades/auctions: cross-player moves don't authorize over the wire yet (no `turn.activePlayers`/stages); local hot-seat works fully
- Weighted victory Phase B (influence/stability axes) not started — only wealth/survival/dominion scored today
- Future: AI bot players, alliances/voting, world disasters, deployment/CI (see docs/ROADMAP.md)

## GitHub

- Remote: https://github.com/stars1210JasonHe/Meinoploy.git
