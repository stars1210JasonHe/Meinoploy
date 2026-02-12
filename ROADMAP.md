# Meinopoly Roadmap

## Phase 1 — Core Demo ✅

- [x] Project setup with boardgame.io + Parcel
- [x] Define all 40 board spaces (properties, railroads, utilities, taxes, etc.)
- [x] Implement core game logic (dice, movement, buying, rent, jail, bankruptcy)
- [x] Build visual Monopoly board with CSS grid
- [x] Player info panels, dice display, action buttons, message log
- [x] Character design document with 10 characters and stats
- [x] Character lore files (all 10)
- [x] Pixel-art character portraits split into individual heads
- [x] Integrate character head portraits into the game UI as player avatars
- [x] Test and verify full game loop works end-to-end
- [x] Add .gitignore and push to GitHub

## Phase 2 — Character Integration ✅

- [x] Character selection screen before game start
- [x] Display character portraits on the board and player panels
- [x] Implement character-specific passive abilities (all 10 characters)
- [x] Character stat display (Capital, Luck, Negotiation, Charisma, Tech, Stamina)
- [x] Create portrait for Ophelia Nightveil (10th character)
- [x] Character lore viewer modal (click "View Lore" on character cards)

## Phase 3 — Enhanced Gameplay ✅ (core mechanics complete)

- [x] Building system (House, Hotel, Skyscraper, Landmark) with color-set monopoly requirement
- [x] Mortgage / unmortgage mechanic
- [x] Expand Chance/Community Chest card pools (6 new action types)
- [x] Season system (4 seasons cycling every 10 turns, affecting prices/rent/tax)
- [x] Triple doubles → go to jail
- [x] Property management UI panel (upgrade, mortgage, unmortgage)
- [x] Config-driven rules system (`mods/dominion/rules.js`) — all game rules modifiable
- [x] Property trading between players (propose, accept, reject, cancel)
- [x] Auction system for unpurchased properties (round-robin bidding)
- [ ] Sound effects and animations (dice roll, movement, purchase)
- [ ] Turn timer

## Phase 4 — Multiplayer & Polish

- [ ] 2-4 player support with proper UI scaling
- [ ] boardgame.io multiplayer lobby (online play)
- [ ] Spectator mode
- [ ] Game save/load
- [ ] Mobile-responsive layout
- [ ] Localization (English + Chinese)

## Phase 5 — Advanced Features

- [ ] Character-specific event cards (3-5 per character)
- [ ] Alliance / voting system (political mechanics)
- [ ] World disaster events
- [ ] Growth / decay mechanics for characters
- [ ] Character-map synergy rules

## Phase 6 — Deployment

- [ ] Production build optimization
- [ ] Deploy to hosting (Vercel / Netlify / GitHub Pages)
- [ ] CI/CD pipeline
- [ ] Playtesting feedback loop

---

## Architecture

- **Engine code**: `src/` (Game.js, App.js, constants.js — shim re-exports from mod)
- **Mod data**: `mods/dominion/` (characters, board, cards, lore, rules, portraits)
- **Rules config**: `mods/dominion/rules.js` — all game rules in one config object
- **Tests**: `src/__tests__/` (142 tests covering all game mechanics)
- **Design docs**: `data/` (Chinese design documents, Python tools)
