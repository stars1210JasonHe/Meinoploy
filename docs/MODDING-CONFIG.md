# Config-Driven Mod Creation Guide

Create a complete Meinopoly mod using only JSON config files and image assets — no JavaScript required.

---

## Mod Folder Structure

```
mods/
  your-mod-name/
    mod.json              # Mod metadata
    board.json            # 40 board spaces + color groups
    characters.json       # Character definitions (stats, passives, colors)
    cards.json            # Chance & Community Chest decks
    rules.json            # Game rules (or omit to use defaults)
    lore.json             # Character lore/backstories (optional)
    portraits/            # Character portrait PNGs (optional)
      character-id.png    # Named by character ID (kebab-case)
```

---

## Step-by-Step: Create a New Mod

### Step 1: Create `mod.json`

Mod metadata. The `id` must match the folder name.

```json
{
  "id": "your-mod-name",
  "name": "Your Mod Display Name",
  "description": "A short description of your mod.",
  "author": "Your Name",
  "version": "1.0.0",
  "language": "en"
}
```

### Step 2: Create `board.json`

Defines all 40 board spaces and color groups. The board must have exactly 40 spaces with sequential IDs 0-39.

**Required corner spaces:**
| ID | Type |
|----|------|
| 0  | `go` |
| 10 | `jail` |
| 20 | `parking` |
| 30 | `goToJail` |

**Space types:** `go`, `property`, `railroad`, `utility`, `tax`, `chance`, `community`, `jail`, `parking`, `goToJail`

```json
{
  "spaces": [
    { "id": 0,  "name": "GO",                "type": "go",        "color": null, "price": 0,   "rent": 0 },
    { "id": 1,  "name": "Mediterranean Ave", "type": "property",  "color": "#8B4513", "price": 60,  "rent": 4 },
    { "id": 2,  "name": "Community Chest",   "type": "community", "color": null, "price": 0,   "rent": 0 },
    { "id": 3,  "name": "Baltic Ave",        "type": "property",  "color": "#8B4513", "price": 60,  "rent": 4 },
    { "id": 4,  "name": "Income Tax",        "type": "tax",       "color": null, "price": 0,   "rent": 200 },
    { "id": 5,  "name": "Reading Railroad",  "type": "railroad",  "color": null, "price": 200, "rent": 25 },
    { "id": 6,  "name": "Oriental Ave",      "type": "property",  "color": "#87CEEB", "price": 100, "rent": 6 },
    "...40 spaces total..."
  ],

  "colorGroups": {
    "#8B4513": [1, 3],
    "#87CEEB": [6, 8, 9],
    "#FF69B4": [11, 13, 14],
    "#FF8C00": [16, 18, 19],
    "#FF0000": [21, 23, 24],
    "#FFFF00": [26, 27, 29],
    "#008000": [31, 32, 34],
    "#0000FF": [37, 39]
  }
}
```

**Validation rules:**
- Exactly 40 spaces, IDs 0-39
- Corners at positions 0, 10, 20, 30
- Each property must have a `color` that exists in `colorGroups`
- Each `colorGroups` entry must reference valid property IDs
- 4 railroads, 2 utilities, 3 chance, 3 community, 2 tax spaces recommended
- `rent` on tax spaces = the tax amount players pay

### Step 3: Create `characters.json`

Define 2-10 characters with stats and passive abilities.

**Stats** (each 1-10, recommended total ~36 per character):
| Stat | Code | Effect |
|------|------|--------|
| Capital | `capital` | Starting money bonus (+50 per point) |
| Luck | `luck` | Card redraw ability (threshold: 8+) |
| Negotiation | `negotiation` | Property buy discount (1% per point, max 10%) |
| Charisma | `charisma` | Rent payment discount (1% per point, max 10%) |
| Tech | `tech` | Upgrade cost discount (2% per point, max 20%) |
| Stamina | `stamina` | Dice reroll ability (threshold: 7+) |

**Passive IDs** (each triggers built-in game logic):
| Passive ID | Name | Engine Effect |
|------------|------|---------------|
| `financier` | Financial Expertise | Buy price -10%, negative events -20% |
| `pioneer` | Tech Pioneer | Upgrade cost -20% |
| `operator` | Political Influence | Alliance income +10%, voting +1 |
| `speculator` | Lucky Draw | +1 extra card redraw |
| `enforcer` | Regulation | Can regulate a property (+20% rent for opponents) |
| `arbitrageur` | Crisis Profit | +$100 when any player goes bankrupt |
| `merchant` | Intel Network | Unlimited card redraws |
| `idealist` | Growth Vision | +$50 bonus when passing GO |
| `breaker` | Anti-Monopoly | -25% rent on monopoly properties |
| `shadow` | Shadow Veil | Hide money from other players |

```json
{
  "characters": [
    {
      "id": "knight-arthur",
      "name": "Knight Arthur",
      "title": "Royal Commander",
      "color": "#c9a44a",
      "stats": {
        "capital": 8,
        "luck": 4,
        "negotiation": 7,
        "charisma": 6,
        "tech": 5,
        "stamina": 6
      },
      "passive": {
        "id": "financier",
        "name": "Royal Treasury",
        "description": "Property purchase price -10%. Financial negative event losses -20%."
      }
    },
    {
      "id": "elena-swift",
      "name": "Elena Swift",
      "title": "Sky Pirate",
      "color": "#5ba3cf",
      "stats": {
        "capital": 4,
        "luck": 9,
        "negotiation": 5,
        "charisma": 5,
        "tech": 7,
        "stamina": 6
      },
      "passive": {
        "id": "speculator",
        "name": "Lucky Wind",
        "description": "Can re-draw event cards once per game."
      }
    }
  ]
}
```

**Validation rules:**
- 2-10 characters
- Each character needs a unique `id` (kebab-case)
- `passive.id` must be one of the 10 built-in passive IDs listed above
- `passive.name` and `passive.description` are display text (can be customized)
- All 6 stats required, values 1-10
- `color` is used for UI theming

### Step 4: Create `cards.json`

Define Chance and Community Chest card decks.

**Card actions:**
| Action | Value Meaning | Example |
|--------|--------------|---------|
| `moveTo` | Board position (0-39) | `{ "action": "moveTo", "value": 0 }` → Go to GO |
| `gain` | Dollar amount | `{ "action": "gain", "value": 200 }` → Collect $200 |
| `pay` | Dollar amount | `{ "action": "pay", "value": 50 }` → Pay $50 |
| `goToJail` | (ignored, use 0) | `{ "action": "goToJail", "value": 0 }` |
| `payPercent` | Percentage of total assets | `{ "action": "payPercent", "value": 10 }` → Pay 10% |
| `gainAll` | Dollar amount from each player | `{ "action": "gainAll", "value": 50 }` → Collect $50 from everyone |
| `gainPerProperty` | Dollars per owned property | `{ "action": "gainPerProperty", "value": 25 }` |
| `freeUpgrade` | (ignored, use 0) | Free building upgrade on cheapest eligible property |
| `downgrade` | (ignored, use 0) | Remove one building level from highest |
| `forceBuy` | (ignored, use 0) | Force-buy cheapest opponent property |

```json
{
  "chance": [
    { "text": "Advance to GO! Collect $200.",       "action": "moveTo", "value": 0 },
    { "text": "Bank pays you dividend of $50.",      "action": "gain",   "value": 50 },
    { "text": "Go to Jail. Do not pass GO.",         "action": "goToJail", "value": 0 },
    { "text": "Pay poor tax of $15.",                "action": "pay",    "value": 15 },
    { "text": "Building loan matures. Collect $150.","action": "gain",   "value": 150 },
    { "text": "Pay 10% asset tax.",                  "action": "payPercent", "value": 10 },
    { "text": "It's your birthday! Collect $25 from each player.", "action": "gainAll", "value": 25 },
    { "text": "Free property upgrade!",              "action": "freeUpgrade", "value": 0 },
    { "text": "Building condemned. Lose one level.", "action": "downgrade", "value": 0 },
    { "text": "Hostile takeover! Buy cheapest opponent property.", "action": "forceBuy", "value": 0 }
  ],

  "community": [
    { "text": "Advance to GO! Collect $200.",        "action": "moveTo", "value": 0 },
    { "text": "Bank error in your favor. Collect $200.", "action": "gain", "value": 200 },
    { "text": "Go to Jail. Do not pass GO.",         "action": "goToJail", "value": 0 },
    { "text": "Doctor's fee. Pay $50.",              "action": "pay",    "value": 50 },
    { "text": "Life insurance matures. Collect $100.", "action": "gain", "value": 100 },
    { "text": "Tax refund. Collect $20.",            "action": "gain",   "value": 20 },
    { "text": "Pay hospital fees of $100.",          "action": "pay",    "value": 100 },
    { "text": "Collect $50 per property you own.",   "action": "gainPerProperty", "value": 50 },
    { "text": "Free renovation!",                    "action": "freeUpgrade", "value": 0 },
    { "text": "Earthquake! Lose one building level.","action": "downgrade", "value": 0 }
  ]
}
```

**Validation rules:**
- At least 5 cards per deck recommended (10 is standard)
- Each card must have `text`, `action`, and `value`
- `action` must be one of the valid actions listed above
- Negative actions (`pay`, `payPercent`, `goToJail`, `downgrade`) can be redrawn by high-luck characters

### Step 5: Create `rules.json` (Optional)

Override any default game rules. Only include the values you want to change — everything else uses defaults.

```json
{
  "core": {
    "baseStartingMoney": 1500,
    "goSalary": 200,
    "maxTurns": 0,
    "freeParkingPot": true
  },

  "buildings": {
    "names": ["Empty", "Cottage", "Manor", "Castle", "Fortress"],
    "icons": ["", "\ud83c\udfe0", "\ud83c\udfe8", "\ud83c\udff0", "\ud83c\udfdb\ufe0f"],
    "sellbackRate": 0.5
  },

  "seasons": {
    "enabled": true,
    "changeInterval": 10,
    "list": [
      { "id": "spring",  "name": "Spring",  "icon": "\ud83c\udf38", "priceMod": 1.0,  "rentMod": 1.0,  "taxMod": 1.0 },
      { "id": "summer",  "name": "Summer",  "icon": "\u2600\ufe0f", "priceMod": 1.10, "rentMod": 0.90, "taxMod": 1.0 },
      { "id": "autumn",  "name": "Autumn",  "icon": "\ud83c\udf42", "priceMod": 0.90, "rentMod": 1.0,  "taxMod": 1.0 },
      { "id": "winter",  "name": "Winter",  "icon": "\u2744\ufe0f", "priceMod": 1.0,  "rentMod": 1.20, "taxMod": 2.0 }
    ]
  },

  "display": {
    "playerColors": ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6",
                     "#1abc9c", "#e67e22", "#2c3e50", "#d35400", "#8e44ad"],
    "playerTokens": ["\ud83d\udd34", "\ud83d\udd35", "\ud83d\udfe2", "\ud83d\udfe1", "\ud83d\udfe3",
                     "\u26aa", "\ud83d\udfe0", "\u26ab", "\ud83d\udfe4", "\ud83d\udfe6"]
  }
}
```

See `mods/dominion/rules.js` for the complete list of all configurable values.

### Step 6: Add Portraits (Optional)

Place PNG images in `portraits/` folder, named by character ID:

```
portraits/
  knight-arthur.png
  elena-swift.png
```

- Recommended size: 341x341 pixels
- Format: PNG with transparency
- Filename must match the character's `id` field (kebab-case)
- Characters without a portrait will show a placeholder letter

### Step 7: Create `lore.json` (Optional)

Character backstories and flavor text. Each key is a character ID.

```json
{
  "knight-arthur": {
    "nameZh": "Character name (localized)",
    "titleZh": "Character title (localized)",
    "identity": "Role or identity description",
    "alignment": "Alignment keywords",
    "background": "Backstory text.\n\nUse \\n\\n for paragraphs.\nUse **bold** for emphasis.",
    "noticed": "How they were noticed (optional, can be null).",
    "joining": "How they joined the game.",
    "styleIntro": "Introduction to their play style.",
    "style": [
      "First belief or principle",
      "Second belief or principle",
      "Third belief or principle"
    ],
    "styleOutro": "Conclusion about their style.",
    "relationships": [
      { "target": "Elena Swift", "description": "Allies in battle, rivals in treasure." },
      { "target": "Dark Lord", "description": "Sworn enemies since the first war." }
    ],
    "themeSummary": "A one-line theme quote.\nCan be multiline."
  }
}
```

**Notes:**
- Field names use `Zh` suffix (from original Chinese design) but can contain any language
- `background`, `joining`, `styleOutro` support markdown formatting
- `relationships[].target` is a display name (not an ID)
- `noticed` field is optional (set to `null` to skip that section)

---

## Complete Example: Medieval Mod

Here's a minimal complete mod with 2 characters and simplified board:

### `mods/medieval/mod.json`
```json
{
  "id": "medieval",
  "name": "Medieval Kingdoms",
  "description": "A medieval-themed property trading game.",
  "author": "Your Name",
  "version": "1.0.0",
  "language": "en"
}
```

### `mods/medieval/characters.json`
```json
{
  "characters": [
    {
      "id": "knight-arthur",
      "name": "Knight Arthur",
      "title": "Royal Commander",
      "color": "#c9a44a",
      "stats": { "capital": 8, "luck": 4, "negotiation": 7, "charisma": 6, "tech": 5, "stamina": 6 },
      "passive": { "id": "financier", "name": "Royal Treasury", "description": "Buy price -10%, loss reduction -20%." }
    },
    {
      "id": "elena-swift",
      "name": "Elena Swift",
      "title": "Sky Pirate",
      "color": "#5ba3cf",
      "stats": { "capital": 4, "luck": 9, "negotiation": 5, "charisma": 5, "tech": 7, "stamina": 6 },
      "passive": { "id": "speculator", "name": "Lucky Wind", "description": "Can re-draw event cards once per game." }
    }
  ]
}
```

### `mods/medieval/rules.json`
```json
{
  "buildings": {
    "names": ["Empty", "Cottage", "Manor", "Castle", "Fortress"],
    "icons": ["", "\ud83c\udfe0", "\ud83c\udfe8", "\ud83c\udff0", "\ud83c\udfdb\ufe0f"]
  },
  "core": {
    "freeParkingPot": true
  }
}
```

*(board.json and cards.json would follow the same format shown above)*

---

## Validation Checklist

Before loading your mod, verify:

- [ ] `mod.json` exists with valid `id` matching folder name
- [ ] `board.json` has exactly 40 spaces with IDs 0-39
- [ ] Corner spaces: id 0=go, 10=jail, 20=parking, 30=goToJail
- [ ] All property colors exist in `colorGroups`
- [ ] All `colorGroups` IDs reference property-type spaces
- [ ] `characters.json` has 2-10 characters with unique IDs
- [ ] Each character has all 6 stats (1-10 each)
- [ ] Each `passive.id` is one of the 10 built-in passives
- [ ] `cards.json` has valid actions on all cards
- [ ] `moveTo` values are valid board positions (0-39)
- [ ] Portrait filenames match character IDs (if provided)
- [ ] `rules.json` only overrides valid config keys

---

## How It Works (Engine Side)

The mod loader reads your JSON files and converts them into the same data structures the engine expects:

```
board.json      →  BOARD_SPACES[] + COLOR_GROUPS{}
characters.json →  CHARACTERS_DATA[] + portrait mapping
cards.json      →  CHANCE_CARDS[] + COMMUNITY_CARDS[]
rules.json      →  RULES{} (merged with defaults)
lore.json       →  CHARACTER_LORE{}
```

The engine code (`src/Game.js`) doesn't change — it always consumes the same data shapes regardless of whether they come from JavaScript modules or JSON configs.
