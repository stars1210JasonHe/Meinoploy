# Meinopoly

A Monopoly-inspired board game demo built with [boardgame.io](https://boardgame.io), featuring original sci-fi characters from the **Dominion: Multi-dimensional World Property Council** universe.

## Overview

Meinopoly combines classic Monopoly mechanics with a rich sci-fi setting where players take on the roles of Dimensional Council agents, each with unique playstyles and abilities. The game is designed around strategic diversity — every character represents a distinct approach to victory.

## Characters (9 playable)

| Character | Title | Playstyle |
|-----------|-------|-----------|
| Albert Victor | Council Financier | Steady capital flow / city dominance |
| Lia Startrace | Star Pioneer | High-risk / tech expansion |
| Marcus Grayline | Political Operator | Alliance / vote control |
| Evelyn Zero | Probability Speculator | Events / luck-based |
| Knox Ironlaw | Order Enforcer | Control / lockdown |
| Sophia Ember | Crisis Arbitrageur | Disaster / volatility profit |
| Cassian Echo | Information Merchant | Intel / counter-play |
| Mira Dawnlight | Idealist Council Member | Long-term growth / late-game power |
| Renn Chainbreaker | Disruptor | Anti-monopoly / disruption |

A 10th character, **Ophelia Nightveil** (Shadow Council Member), is designed but not yet illustrated.

## Tech Stack

- **Game Engine**: [boardgame.io](https://boardgame.io) v0.45
- **Bundler**: Parcel
- **Language**: Plain JavaScript (no framework)
- **Art**: Pixel-art character portraits

## Project Structure

```
Meinopoly/
├── index.html          # Entry point with board CSS
├── package.json        # Dependencies (boardgame.io, parcel)
├── src/
│   ├── App.js          # Client, UI rendering, board layout
│   ├── Game.js         # boardgame.io game logic (moves, turns, rules)
│   └── boardData.js    # 40 board spaces, Chance/Community cards, player data
├── data/
│   ├── Characters-v0.1.md              # Character design document (Chinese)
│   ├── *-Lore.md                       # Individual character lore files
│   ├── ChatGPT Image *.png             # Original 3x3 character grid
│   ├── Split.py                        # Script to split grid into heads
│   └── heads/                          # Individual character portraits (341x341)
│       ├── Albert-Victor.png
│       ├── Lia-Startrace.png
│       └── ... (9 total)
└── test/               # Original boardgame.io tutorial (TicTacToe)
```

## Getting Started

```bash
npm install
npm start
```

Opens at `http://localhost:1234`. The game runs as a local 2-player hot-seat demo.

## Current Features

- Full 40-space Monopoly board with classic layout
- Dice rolling, movement, passing GO
- Property buying and rent collection
- Chance and Community Chest cards
- Jail mechanics (roll doubles or pay fine)
- Bankruptcy detection and game-over
- Visual board with CSS grid layout
- Player info panels, dice display, action log

## License

Private project.
