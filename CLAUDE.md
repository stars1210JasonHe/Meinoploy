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
- `mods/dominion/` — Current mod: characters, board, cards, portraits, lore
- `data/` — Design docs and Python tooling (Split.py for portraits)
- `test/` — Original boardgame.io TicTacToe tutorial (reference only)

## Architecture

### Engine (src/)
- `src/Game.js` — boardgame.io game definition: setup(), moves, turn management, endIf. Imports mod data from `mods/dominion/`.
- `src/constants.js` — Engine constants: building tiers, seasons, player colors/tokens
- `src/App.js` — Client initialization + DOM-based UI rendering (no framework). Creates an 11x11 CSS grid board, player panels, dice, action buttons, message log
- `index.html` — Entry point with all CSS styles inline

### Mod (mods/dominion/)
- `mods/dominion/index.js` — Re-exports all mod data
- `mods/dominion/characters.js` — 10 characters with stats, passives, Parcel-imported portrait PNGs
- `mods/dominion/board.js` — 40 board spaces + 8 color groups
- `mods/dominion/cards.js` — Chance & Community Chest card decks (includes enhanced cards)
- `mods/dominion/portraits/` — 9 character head portraits (341x341 PNG)
- `mods/dominion/lore/` — 9 character lore markdown files

## Characters

10 characters designed, 9 have lore files and pixel-art portraits. The 10th (Ophelia Nightveil) needs a portrait. Character data is in `data/Characters-v0.1.md` (Chinese). Each character has 6 stats (Capital, Luck, Negotiation, Charisma, Tech, Stamina) totaling the same sum, plus passive abilities.

## Game Mechanics (Current)

- 2-player local hot-seat (boardgame.io singleplayer client)
- Character selection with stat-based gameplay modifiers
- 40 spaces, dice, property buying with negotiation discounts, rent with charisma discounts
- 4-tier building system: House → Hotel → Skyscraper → Landmark
- Mortgage/unmortgage system
- Season system: Summer → Autumn → Winter → Spring (cycles every 10 turns)
- Enhanced event cards: payPercent, gainAll, freeUpgrade, downgrade, forceBuy, gainPerProperty
- Triple doubles → jail
- Chance/Community Chest with card redraw mechanics
- 10 character passives integrated into gameplay

## Commands

```bash
npm start        # Dev server at localhost:1234
npm run build    # Production build
npx jest --no-coverage  # Run 128 unit tests
```

For Python scripts in `data/`:
```bash
cd data && uv run Split.py
```

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

- The 10th character (Ophelia Nightveil) is missing a portrait
- Parcel v1 is deprecated; consider migrating to Parcel v2 or Vite in the future
- `data/` has its own `pyproject.toml` from uv init — this is for the Python split script only
- Future: online multiplayer, AI bots, trading, auctions (see PLAN.md)

## GitHub

- Remote: https://github.com/stars1210JasonHe/Meinoploy.git
