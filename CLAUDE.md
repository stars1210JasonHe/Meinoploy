# CLAUDE.md — Project Guide for Claude Code

## Project Overview

**Meinopoly** is a Monopoly-style board game built with boardgame.io. It features original sci-fi characters from the "Dominion: Multi-dimensional World Property Council" universe. The game design documents are written in Chinese; the code is in English.

## Tech Stack

- **Game framework**: boardgame.io v0.45 (plain JS, no React)
- **Bundler**: Parcel v1 (parcel-bundler)
- **Language**: Vanilla JavaScript (ES modules)
- **Python tooling**: Use `uv` for Python environments (NOT pip/python directly — Python is not on PATH on this machine)
- **Node**: v20.19.0, npm 10.8.2
- **Platform**: Windows (Git Bash shell)

## Key Directories

- `src/` — Game source code (App.js, Game.js, boardData.js)
- `data/` — Character design docs, lore files, pixel-art portraits
- `data/heads/` — Individual character head portraits (341x341 PNG, split from 3x3 grid)
- `test/` — Original boardgame.io TicTacToe tutorial (reference only)

## Architecture

- `src/Game.js` — boardgame.io game definition: setup(), moves (rollDice, buyProperty, passProperty, payJailFine, endTurn), turn management, endIf
- `src/boardData.js` — All 40 board spaces, Chance/Community Chest cards, player colors
- `src/App.js` — Client initialization + DOM-based UI rendering (no framework). Creates an 11x11 CSS grid board, player panels, dice, action buttons, message log
- `index.html` — Entry point with all CSS styles inline

## Characters

10 characters designed, 9 have lore files and pixel-art portraits. The 10th (Ophelia Nightveil) needs a portrait. Character data is in `data/Characters-v0.1.md` (Chinese). Each character has 6 stats (Capital, Luck, Negotiation, Charisma, Tech, Stamina) totaling the same sum, plus passive abilities.

## Game Mechanics (Current)

- 2-player local hot-seat (boardgame.io singleplayer client)
- Standard Monopoly: 40 spaces, dice, property buying, rent, Chance/Community Chest, jail, bankruptcy
- No houses/hotels, no trading, no auctions yet (see ROADMAP.md)

## Commands

```bash
npm start        # Dev server at localhost:1234
npm run build    # Production build
```

For Python scripts in `data/`:
```bash
cd data && uv run Split.py
```

## Conventions

- Game state is managed entirely through boardgame.io's G object (immutable pattern with Immer)
- UI renders by subscribing to client state changes — full re-render on each update
- Board positions mapped via getBoardPositions() → row/col grid coordinates
- Character names use kebab-case for filenames (e.g., `Albert-Victor.png`)
- Design docs and lore are in Chinese, code comments and variable names are in English

## Known Issues / TODOs

- Character portraits not yet integrated into the game UI
- Game has not been fully tested end-to-end yet
- The 10th character (Ophelia Nightveil) is missing a portrait
- Parcel v1 is deprecated; consider migrating to Parcel v2 or Vite in the future
- `data/` has its own `pyproject.toml` from uv init — this is for the Python split script only

## GitHub

- Remote: https://github.com/stars1210JasonHe/Meinoploy.git
