# Meinopoly

A moddable Monopoly-style board game engine built with [boardgame.io](https://boardgame.io). The current mod is **Dominion: Multi-dimensional World Property Council** — a sci-fi council of 10 unique characters competing for property control.

![Game Board](screenshots/debug/game-board.png)

## Features

- **10 Unique Characters** — each with pixel-art portraits, 6 stats (Capital, Luck, Negotiation, Charisma, Tech, Stamina), passive abilities, and full lore (in Chinese)
- **40-Space Board** — properties, railroads, utilities, taxes, Chance & Community Chest
- **4-Tier Building System** — House, Hotel, Skyscraper, Landmark with even-building rule
- **Season System** — Summer, Autumn, Winter, Spring cycle every 10 turns, affecting prices, rent, and taxes
- **Property Trading** — propose, accept, reject, or cancel trades between players
- **Auction System** — round-robin bidding when a player passes on buying a property
- **Mortgage/Unmortgage** — standard mortgage mechanics with season-adjusted values
- **Enhanced Event Cards** — 6 extra card types: payPercent, gainAll, freeUpgrade, downgrade, forceBuy, gainPerProperty
- **Config-Driven Rules** — all game rules live in a single config file (`mods/dominion/rules.js`), making the engine fully moddable
- **Character Lore Viewer** — click "View Lore" to read each character's full backstory in a modal
- **157 Unit Tests** covering all game mechanics

## Characters

| Character | Title | Passive |
|-----------|-------|---------|
| Albert Victor | Council Financier | Property price -10%, negative event losses -20% |
| Lia Startrace | Interstellar Pioneer | Upgrade cost -20% |
| Marcus Grayline | Political Operator | Alliance income share +10%, voting influence +1 |
| Evelyn Zero | Probability Speculator | Extra card redraws |
| Knox Ironlaw | Order Enforcer | Regulate a property for +20% rent |
| Sophia Ember | Crisis Arbitrageur | Gain $100 when any player goes bankrupt |
| Cassian Echo | Information Merchant | Unlimited card redraws |
| Mira Dawnlight | Idealist Council Member | +$50 bonus when passing GO |
| Renn Chainbreaker | Rule Breaker | -25% rent on monopoly properties |
| Ophelia Nightveil | Shadow Council Member | Hide true money from other players |

## Tech Stack

- **Game engine**: [boardgame.io](https://boardgame.io) v0.45
- **Bundler**: Parcel v1
- **Language**: Vanilla JavaScript (ES modules, no framework)
- **Tests**: Jest (unit) + Playwright (E2E)
- **Node**: v20.19.0

## Quick Start

```bash
# Install dependencies
npm install

# Start dev server (opens at localhost:1234)
npm start

# Run unit tests
npx jest --no-coverage

# Production build
npm run build
```

The game runs as a local 2-player hot-seat demo.

## Project Structure

```
src/
  Game.js          # boardgame.io game definition (moves, setup, turn logic)
  App.js           # DOM-based UI (board, panels, modals)
  constants.js     # Re-exports from mod rules (shim for backward compat)
  __tests__/       # 157 Jest unit tests

mods/dominion/
  index.js         # Re-exports all mod data
  rules.js         # All game rules config (core, buildings, rent, seasons, trading, auction...)
  characters.js    # 10 characters with stats, passives, portraits
  board.js         # 40 board spaces + 8 color groups
  cards.js         # Chance & Community Chest decks
  lore.js          # Character lore data (Chinese)
  portraits/       # 10 pixel-art character head PNGs
  lore/            # 10 character lore markdown files

data/              # Design docs (Chinese) and Python tooling
index.html         # Entry point with inline CSS
```

## Modding

The engine is designed to be moddable. All game data lives in `mods/dominion/` — to create a new mod:

1. Create a new folder under `mods/` (e.g. `mods/my-mod/`)
2. Implement the same exports as `mods/dominion/index.js`:
   - `BOARD_SPACES`, `COLOR_GROUPS` — board layout
   - `CHARACTERS`, `getCharacterById`, `getStartingMoney` — character data
   - `CHANCE_CARDS`, `COMMUNITY_CARDS` — event card decks
   - `RULES` — full rules config object
3. Update the import path in `src/Game.js` and `src/App.js`

The `RULES` object controls all game parameters — starting money, jail fine, building costs, stat effects, passive ability values, trading/auction settings, and more.

## Roadmap

See [ROADMAP.md](docs/ROADMAP.md) for the full development plan. See also [RULES.md](docs/RULES.md) and [MODDING.md](docs/MODDING.md).

- **Phase 1** — Core Demo ✅
- **Phase 2** — Character Integration ✅
- **Phase 3** — Enhanced Gameplay ✅ (trading, auctions, config-driven rules)
- **Phase 4** — Multiplayer & Polish (planned)
- **Phase 5** — Advanced Features (planned)
- **Phase 6** — Deployment (planned)

## License

Private project.
