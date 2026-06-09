# Handoff: Meinopoly Pixel UI (Game Boy Color frontend)

## Overview
A full retro **Game Boy Color / 16-bit pixel** visual redesign of the Meinopoly client, covering
every screen of the current hot-seat flow: **Title/Lobby → Character Select → Game Board →
Results**, plus the **Event Card / Lore / Trade / Auction** modals. The goal is to replace the
current dark-dashboard look with a cohesive chunky-pixel handheld aesthetic while keeping all
existing game mechanics intact.

## About the Design Files
The files in this bundle are **design references created in HTML/React (Babel JSX)** — a working
prototype that shows the intended look, layout, copy, and interaction flow. **They are not meant to
be dropped into the repo as-is.**

Your real client (`src/App.js`) is **vanilla JavaScript with DOM rendering** (no framework) on top of
**boardgame.io**, with all CSS inlined in `index.html`. The task for Claude Code is to **recreate
this pixel design inside that existing vanilla-JS/DOM environment** — i.e. port the CSS and the
DOM structure, wiring it to the live boardgame.io `G` state and moves you already have. The React
in the prototype is only a convenience for the mock; do **not** add React to the project.

The single most portable, highest-value artifact here is the **CSS** (design tokens + component
classes). It is plain CSS with CSS custom properties and can be copied into `index.html` almost
verbatim. The HTML structure of each component is documented below so you can reproduce it with
`document.createElement` / template strings in `App.js`.

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, bevels, and interaction states are all
specified. Recreate pixel-for-pixel using the tokens and class specs below. Three palettes are
provided (see Design Tokens → Palettes); ship **Council** as the default and keep the others as
optional themes if useful.

---

## Global Look & Feel

- **No rounded corners anywhere.** Everything is hard-edged pixel chrome.
- **Two fonts**, both Google Fonts:
  - `Press Start 2P` — display / headings / HUD numbers / button labels (used small, 7–14px)
  - `VT323` — body text, descriptions, tile names, log lines (used 14–24px; it renders large)
- **Pixel bevels** instead of soft shadows. Every raised panel/button uses an inset light/dark
  bevel plus a hard offset drop shadow (no blur). See `--bevel` / `--drop` tokens.
- `image-rendering: pixelated` on the whole app and all `<img>` (keeps the 341×341 portraits crisp
  when scaled).
- `-webkit-font-smoothing: none` for crisp text edges.
- Optional **CRT overlays**: full-screen scanline `repeating-linear-gradient` (multiply blend) and a
  radial vignette. Both are toggleable; default on.
- Background: subtle 2px horizontal scanline gradient over a radial dark gradient.

---

## Design Tokens

### Fonts
```css
--disp: 'Press Start 2P', monospace;   /* headings, HUD, buttons */
--body: 'VT323', monospace;            /* body, descriptions, tiles */
```
Load: `https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap`

### Bevels / shadows (palette-independent)
```css
--bevel: inset 2px 2px 0 rgba(255,255,255,.10), inset -2px -2px 0 rgba(0,0,0,.5);
--drop:  5px 5px 0 rgba(0,0,0,.45);
```

### Palettes (set as CSS vars on a root `.app` element)
The whole UI reads these 10 variables. Switching themes = swapping these values only.

**Council (default — navy + gold, premium):**
```css
--bg:#0e1120; --bg2:#1b2034; --bg3:#0a0c17;
--ink:#f2e9cf; --ink-dim:#9298b6; --accent:#e9b23c; --accent2:#6f7cd6;
--line:#39406a; --good:#5ad98a; --bad:#e2574f;
```
**Verdant (Game Boy DMG green):**
```css
--bg:#0c2410; --bg2:#16401c; --bg3:#081a0b;
--ink:#c4e86a; --ink-dim:#6f9a3f; --accent:#a9d637; --accent2:#5fae54;
--line:#2f5e2c; --good:#bdee5a; --bad:#e0b24a;
```
**Arcade (neon CRT):**
```css
--bg:#0a0a16; --bg2:#16162e; --bg3:#06060f;
--ink:#eaeaff; --ink-dim:#8a8ac0; --accent:#ff4d8d; --accent2:#36d6e7;
--line:#34346a; --good:#48e89a; --bad:#ff5470;
```

### Property group colors (board color bars — used in ALL palettes, full color, do not theme)
```
brown #8a5a2b   cyan #5cc6e8   pink #e85ca8   orange #ef9223
red   #e23b3b   yellow #f2d029 green #36b15a  blue  #3b62e2
```

### Player colors
```
Player 1 #e9b23c (gold)    Player 2 #5cc6e8 (cyan)
```

### Spacing / sizing notes
- Panel border: `3px solid var(--line)`; panel bg `var(--bg2)`; inset panels `var(--bg3)`.
- Button border: `3px solid` (`var(--line)`, or `#000` for primary); primary bg `var(--accent)`,
  text `#161009`. `:active` → `translate(3px,3px)` and shrink the drop shadow (the press-down).
- Board: square, `width: min(72vh, 760px)`, 11×11 CSS grid with
  `grid-template-columns: 1.4fr repeat(9,1fr) 1.4fr` (same for rows) so the 4 corners are larger.
  Center occupies `grid-row: 2 / 11; grid-column: 2 / 11`.

---

## Screens / Views

### 1. Title / Lobby
- **Purpose:** entry screen; confirm match settings and start.
- **Layout:** single centered column, `min-height:100vh`, ~22px gap.
- **Components:**
  - Big `MEINOPOLY` wordmark — `Press Start 2P`, 64px, color `--accent`, `text-shadow:6px 6px 0 #000`
    plus a soft accent glow. Tagline below in `Press Start 2P` 11px `--ink-dim`, letter-spacing 3px.
  - **NEW GAME** panel (width 520px): rows for MODE / BOARD / SEASONS (dashed `--line` separators),
    then two **player seats** showing a token, "PLAYER n", and a green "READY".
  - **START GAME** primary button (lg) + blinking `▸ PRESS START` (1s steps blink).
  - Footer line: version + feature summary, `Press Start 2P` 8px `--ink-dim`.

### 2. Character Select
- **Purpose:** Player 1 then Player 2 each pick 1 of 10 councillors.
- **Layout:** header → 4-column grid of character cards → sticky bottom action bar.
- **Header:** "PLAYER n" (`--accent2`) + "CHOOSE YOUR CHARACTER" (`--accent`, 22px, shadow),
  subtitle in VT323 18px `--ink-dim`.
- **Character card (`.charcard`):**
  - Top row: 72px framed portrait (border = character color) + name (`Press Start 2P` 10px, character
    color) + title (VT323 16px dim) + "START $X,XXX" (Press Start 2P 7px dim).
  - Stats block (inset panel): 6 **segmented stat bars** (CAP/LCK/NEG/CHA/TEC/STA), one row each,
    10 cells, filled cells = character color. Label left (7px), value right.
  - Passive: name (`Press Start 2P` 8px `--accent`) + description (VT323 15px).
  - Foot: "VIEW LORE" button (opens Lore modal) + a SELECTED / TAKEN tag.
  - States: hover lifts 2px + brightens; `--sel` adds accent ring + glow; `--taken` (already chosen by
    P1) is greyed `opacity:.35` and non-clickable.
- **Bottom bar:** BACK (ghost) · chosen summary (portrait + name + title) · primary button reading
  **"NEXT PLAYER ▸"** for P1 and **"BEGIN GAME ▸"** for P2 (disabled until a pick is made).

### 3. Game Board (main play screen)
- **Purpose:** the actual game.
- **Layout:** 3-column CSS grid `286px 1fr 304px`, 16px gap, left/right columns `position:sticky`.
- **Left column — "COUNCIL":** a player card per player (`.pcard`):
  - 48px portrait + name (Press Start 2P 9px) + title (VT323 15px) + a "TURN" chip on the active
    player. Big money readout (`Money` component, `--good` color, 18px). Meta row: token + "N DEEDS"
    + passive name (`--accent2`). Active card gets a colored ring + glow.
  - An **END MATCH** ghost button at the bottom (→ Results).
- **Center — the board** (`Board` component): 40 tiles positioned on the 11×11 grid (see Board Tiles
  below), with a center area containing: rotated `MEINOPOLY` logo + sub, a **Season** box
  (label / season name / "Cycle n/10"), the **two dice**, the **buy/manage/info prompt**, and a
  status hint ("ROLL TO MOVE" / "END TURN WHEN READY" / "ROLLING…").
- **Right column:**
  - **Turn box:** current player (token + name), big **ROLL DICE** primary button, then a row of
    **TRADE** + **END TURN** (END TURN disabled until the player has rolled).
  - **Event log:** titled panel, newest entry on top, each line has a left border colored by kind
    (good=`--good`, bad=`--bad`, neutral=`--accent2`).

#### Board Tiles (`.tile`)
- Each tile knows its **edge** (bottom/left/top/right/corner) which sets the color-bar position and
  inner padding (color bar sits on the inner edge; inner content padded away from it by 18%).
- Property tiles show: a **group color bar** (18% thickness on the inner edge), a small **glyph** for
  special tiles, the **name** (VT323 11px, wraps, `overflow-wrap:anywhere`), and **price**
  (`Press Start 2P` 6px dim).
- Corner tiles (GO / Just Visiting+Jail / Free Parking / Go To Jail) are larger with bigger glyph +
  accent name.
- **Ownership:** small house pips top-right (one per building level, 1–4), colored by owner.
- **Tokens:** player tokens cluster bottom-right of their current tile.
- **Glyphs are CSS-drawn (no emoji)** via `::before` content: GO `▶`, chance `?`, community `▣`,
  tax `$`, railroad `▬`, utility `↯`, jail `‖`, goToJail `»`, parking `P`, crown `♔`, swap `⇄`.

#### Grid position mapping (id 0–39)
```
id 0  -> r11 c11 (GO, bottom-right)
1..9  -> r11, c = 11 - id      (bottom row, right→left)
id 10 -> r11 c1  (Jail/Just Visiting, bottom-left)
11..19-> c1,  r = 11 - (id-10) (left col, bottom→top)
id 20 -> r1 c1   (Free Parking, top-left)
21..29-> r1,  c = 1 + (id-20)  (top row, left→right)
id 30 -> r1 c11  (Go To Jail, top-right)
31..39-> c11, r = 1 + (id-30)  (right col, top→bottom)
```

### 4. Modals (centered, scrim `rgba(4,5,10,.78)` + slight blur)
- **Event Card** (`.evcard`): deck label, large kind-colored glyph, the card text (VT323 23px), a
  FORTUNE/HAZARD/EVENT tag, OK button. Border + glyph tint by kind (good/bad).
- **Lore** (`.lore`, wide, 2-col `200px 1fr`): left = 150px portrait + name + title + the 6 stat bars
  on `--bg3`; right = PASSIVE (name+desc, `--accent2`) / DOSSIER (flavor paragraph, VT323 19px) /
  STARTING CAPITAL (money) / CLOSE button.
- **Trade** (`.trade`, wide): header "PROPOSE TRADE", two **trade sides** in a `1fr 40px 1fr` grid
  with a `⇄` swap glyph between. Each side: player header, a selectable deed list (selected deed gets
  an accent ring), and a CASH stepper (− / value / +). A BALANCE readout ("IN YOUR FAVOUR" /
  "FAVOURS RIVAL" / "ROUGHLY EVEN"). Footer: CANCEL + PROPOSE.
- **Auction** (`.auction`): header, the lot (color bar + name + listed price), a big CURRENT BID
  value + high-bidder token, a bidder list (states IN / LEADS / PASS, passed rows dimmed), and
  BID +$10 / PASS actions; collapses to "CLOSE LOT" when one bidder remains.

### 5. Results
- **Purpose:** end-of-match standings.
- **Layout:** centered column. Crown glyph → "VICTORY" (Press Start 2P 44px, accent, big shadow) →
  120px winner portrait (ring+glow) → winner name → subtitle. Then a **FINAL STANDINGS** panel: a row
  per player (rank, token, name, "N PROPS", net worth `Money`). PLAY AGAIN primary button (→ Title).

---

## Interactions & Behavior
- **Navigation:** Title `START GAME` → Select (step=1) → pick → `NEXT PLAYER` (step=2, P1's pick now
  marked TAKEN) → pick → `BEGIN GAME` → Game. `END MATCH` → Results. `PLAY AGAIN` → Title.
- **Roll:** disabled while rolling, while a prompt is open, or after the player already rolled this
  turn. On click: dice "tumble" (~9 random ticks at 70ms) then settle; token **steps tile-by-tile**
  (~110ms/step) to `(pos+sum) % 40`. Passing GO grants +$200 (+$50 extra for Mira Dawnlight).
- **Landing resolution** (mirror your existing rules — these are the prototype's simplified hooks):
  - Unowned property/railroad/utility → center **BUY / AUCTION / PASS** prompt.
  - Owned by other → pay rent (rent × level multiplier), logged.
  - Owned by self → **manage** prompt with **UPGRADE** (up to Lv 4).
  - Chance / Community Chest → draw random card → Event modal.
  - Tax → deduct; Go To Jail → move to tile 10; corners → log only.
- **Buy:** deduct price (−10% for Albert Victor), mark tile owned at level 1.
- **Upgrade:** cost = price × 0.5 (−20% for Lia Startrace), increment level.
- **End Turn:** advance season counter (10 turns → next season in Summer→Autumn→Winter→Spring),
  switch current player, clear prompt/roll flags.
- **Hover/active:** buttons brighten on hover and press-down (translate + shrink drop). Cards lift on
  hover. `:active` is important to the tactile pixel feel — keep it.
- **Ophelia Nightveil** passive: her money shows as `$?,???` to the opponent (the `hidden` flag).

## State Management
This maps onto your existing boardgame.io `G` / `ctx`. The prototype's local state corresponds to:
- `screen` ('title' | 'select' | 'game' | 'results') — client UI state, not part of `G`.
- `players[]`: `{ n, color, id, name, title, passiveName, money, pos, props[], hidden }`.
- `owned`: map `tileId -> { color, n (ownerPlayer), level }`.
- `cur` (current player index), `season`, `seasonTurn`, `turnCount`, `log[]`.
- transient UI: `dice`, `rolling`, `prompt` (buy/manage/info), `event`, `auction`, `rolledThisTurn`,
  `loreChar`, `showTrade`.
In the real app, the durable parts (players, owned, season, positions, money) already live in `G`;
keep the transient UI bits (dice animation, which modal is open, prompt) in the DOM/client layer.

## Assets
- **Character portraits**: the existing `mods/dominion/portraits/*.png` (341×341 pixel art). The
  prototype copied them to `portraits/`. Use the repo originals; render with
  `image-rendering: pixelated`. Ophelia Nightveil still needs a real portrait (known TODO).
- **No other image assets** — all icons/glyphs are CSS-drawn text glyphs, dice are CSS grids of pips,
  tokens are styled `<span>`s. Nothing to export.

## Files (in this bundle)
- `Meinopoly Pixel Prototype.html` — the shell: **all the CSS lives here** (copy into `index.html`),
  plus font links and script load order.
- `meino-data.js` — board spaces, group colors, characters, cards, seasons, the 3 palettes, and the
  `boardGridPos` / `boardEdge` helpers. Mirrors your `mods/dominion` data — reuse your real exports
  instead of this copy.
- `meino-ui.jsx` — primitive components (Panel, PixelButton, StatRow, Portrait, Die, Token, Money,
  Glyph). Read these for the exact DOM each primitive needs.
- `meino-board.jsx` — board grid + tile rendering.
- `meino-screens.jsx` — Title/Lobby, Character Select, Results.
- `meino-modals.jsx` — Event card, Lore, Trade, Auction (includes the English dossier blurbs).
- `meino-app.jsx` — navigation flow + the simplified game-logic hooks described above.

> Porting tip: start by pasting the `<style>` block into `index.html`, then rebuild each screen's DOM
> in `App.js` to match the class names. Because the prototype is class-driven (not React-specific),
> the markup→DOM translation is mostly mechanical.
