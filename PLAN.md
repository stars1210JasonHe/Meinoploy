# Meinopoly — Game Logic Document

---

## 1. Game Overview

Meinopoly is a **moddable** property trading board game engine. The core mechanics — dice, properties, rent, upgrades, bankruptcy — stay the same across all mods. What changes per mod is the **theme**: character designs, space names, event card flavor, board layout, and visual style.

The current mod is **"Dominion: Multi-dimensional World Property Council"** — a sci-fi council of 10 characters competing for property control. But the same engine could run a fantasy mod, a cyberpunk mod, a historical mod, etc. All share the same game structure.

### 1.1 Design Principles

- **Moddable**: Maps, characters, events, and space types are data-driven. Changing the theme means swapping data files, not rewriting game logic.
- **Configurable**: Player count (2-10), starting money, board size, character count — all adjustable per game session.
- **Online multiplayer**: Players in different locations can play together (not just same-screen). boardgame.io supports server-based multiplayer with lobbies.
- **Extensible**: The turn structure, landing events, and property management are designed with hooks for future features (conversations, character-specific events, AI bots).

---

## 2. Game Flow

### 2.1 Phases

The game has three phases:

```
LOBBY  -->  CHARACTER SELECT  -->  PLAY
```

1. **Lobby** *(future)* — Players join the room. Host configures: player count, map, starting money, game mode. Can add AI bot players.
2. **Character Select** — Each player picks a character in turn order. No duplicates. Once all players have chosen, the game begins.
3. **Play** — Players take turns. The game continues until a win condition is met.

> **Future: Conversation Phase** — Between certain turns or events, players will be able to chat, negotiate deals, form alliances, or trash-talk. This will be a separate phase layered on top of the play phase. Not implemented now, but the architecture will support it.

### 2.2 Turn Structure

Each turn follows this sequence. The structure is designed to be **extensible** — new events, character-specific actions, and special interactions can plug into any step.

```
START OF TURN
  |
  v
[Trapped?] --yes--> Resolve trap (pay fine / roll to escape / wait)
  |                    |
  no                   Currently: "Jail" (roll doubles or pay $50)
  |                    Future mods: "Alien Abduction", "Quarantine",
  |                    "Dimensional Rift" — same mechanic, different skin
  v
ROLL DICE (2d6)
  |
  +--> Triple doubles? --> Trapped! Turn ends.
  |
  v
MOVE token (position + dice total, wraps around board)
  |
  +--> Passed START? --> Collect salary (+ character bonuses)
  |
  v
RESOLVE LANDING (depends on space type)
  |
  +--> Unowned property? --> Buy or Pass (or Auction, future)
  +--> Owned by opponent? --> Pay rent
  +--> Tax/Fee space? --> Pay amount
  +--> Event space? --> Draw and resolve event card
  +--> Trap space? --> Get trapped
  +--> Safe space? --> No action
  |
  |    Future: character-specific landing effects,
  |    random encounters, NPC interactions
  |
  v
PROPERTY MANAGEMENT (after rolling)
  +--> Upgrade properties
  +--> Mortgage / Unmortgage
  |
  |    Future: trade with other players,
  |    use character abilities, IPO shares
  |
  v
END TURN --> Next player (skip bankrupt/eliminated players)
```

### 2.3 Win Conditions

**Current**: Last player standing. A player is eliminated when their money drops to $0 or below.

**Future options** (configurable per game):
- **Timed game**: After N turns, richest player wins (total assets)
- **Dominion victory**: Own properties in 5+ different color groups
- **Character-specific victories**: e.g., Ophelia wins if she reaches $3000 while her wealth is hidden
- **Cooperative modes**: Teams compete against each other

---

## 3. The Board

### 3.1 Map System

The board is **data-driven**. The current map has 40 spaces arranged in a loop, but different mods can have different maps:

| Config | Current Value | Moddable? |
|--------|--------------|-----------|
| Total spaces | 40 | Yes — could be 30, 50, etc. |
| Space names | Classic Monopoly names | Yes — themed per mod |
| Space types | 10 types (see below) | Yes — new types can be added |
| Color groups | 8 groups | Yes — more or fewer |
| Prices & rents | Classic Monopoly values | Yes — balanced per map |

The map's **theme** influences everything: a space station map might have "Docking Bay" instead of "Railroad", or "Reactor Core" instead of "Electric Company". The mechanics stay the same.

### 3.2 Space Types

| Type | Current Name | What Happens |
|------|-------------|--------------|
| **Start** | GO | Collect salary when passing |
| **Property** | Various Ave/Place | Can be bought, upgraded, collects rent from visitors |
| **Transit** | Railroad | Can be bought. Rent scales with how many transits you own (see 6.2) |
| **Utility** | Electric Co. / Water Works | Can be bought. Rent = dice roll x multiplier (see 6.3) |
| **Event** | Chance | Draw a random event card — could be good or bad |
| **Community** | Community Chest | Draw a community card — tends to give money |
| **Tax** | Income Tax / Luxury Tax | Pay a fixed amount to the bank |
| **Trap** | Jail | If sent here, you're stuck until you escape |
| **Trap Trigger** | Go To Jail | Landing here sends you to the Trap space |
| **Safe** | Free Parking / Just Visiting | Nothing happens. Rest stop. |

> In the Dominion mod, these could be renamed: Transit = "Warp Gate", Utility = "Energy Grid" / "Life Support", Trap = "Detention Cell", Event = "Council Decree", etc.

### 3.3 Color Groups (Current Map)

Properties belong to color groups. Owning all properties in a group (a **"monopoly"**) unlocks rent bonuses and building upgrades.

| Color | Properties | Group Size |
|-------|-----------|------------|
| Brown | Mediterranean Ave ($60), Baltic Ave ($60) | 2 |
| Light Blue | Oriental Ave ($100), Vermont Ave ($100), Connecticut Ave ($120) | 3 |
| Pink | St. Charles Place ($140), States Ave ($140), Virginia Ave ($160) | 3 |
| Orange | St. James Place ($180), Tennessee Ave ($180), New York Ave ($200) | 3 |
| Red | Kentucky Ave ($220), Indiana Ave ($220), Illinois Ave ($240) | 3 |
| Yellow | Atlantic Ave ($260), Ventnor Ave ($260), Marvin Gardens ($280) | 3 |
| Green | Pacific Ave ($300), North Carolina Ave ($300), Pennsylvania Ave ($320) | 3 |
| Dark Blue | Park Place ($350), Boardwalk ($400) | 2 |

---

## 4. Money & Economy

### 4.1 Starting Money

The base starting amount is configurable at game start. Default: **$1500**.

With a character selected, starting money is adjusted by the **Capital** stat:

```
startingMoney = baseMoney + (Capital x $50)
```

| Character | Capital | Starting Money (base $1500) |
|-----------|---------|---------------------------|
| Albert Victor | 9 | $1950 |
| Knox Ironlaw | 7 | $1850 |
| Marcus Grayline | 6 | $1800 |
| Evelyn Zero | 4 | $1700 |

### 4.2 Income Sources

- **Passing START (GO)**: Collect salary ($200 default, character bonuses may apply)
- **Rent**: Other players pay you when they land on your properties
- **Event cards**: Some cards give you money ($20 - $200)
- **Mortgaging**: Sell a property to the bank for 50% of its price (you keep ownership but it stops earning)
- **Character passives**: Some characters earn money from special triggers (e.g., Sophia Ember gets $100 on any bankruptcy)

### 4.3 Expenses

- **Buying properties**: Pay the listed price (character discounts may apply)
- **Paying rent**: When you land on someone else's property
- **Taxes**: Fixed amounts when landing on tax spaces
- **Trap fines**: Pay to escape (e.g., $50 jail fine)
- **Building upgrades**: Pay to improve your properties
- **Unmortgaging**: Pay 55% of property price to reactivate a mortgaged property
- **Event cards**: Some cards cost you money ($15 - $50)

---

## 5. Buying Properties

### 5.1 When You Can Buy

When you land on an **unowned** property, transit, or utility, and you have enough money, you can choose:
- **Buy** — pay the price, gain ownership
- **Pass** — decline (future: triggers an auction where all players can bid)

### 5.2 Effective Buy Price

Your character can make properties cheaper:

```
effectivePrice = listedPrice
                 x (1 - Negotiation x 1%)      // stat discount, max 10% off
                 x (0.90 if financier passive)  // Albert Victor: extra 10% off
                 = floor(result)
```

**Example** — Mediterranean Ave (listed $60):
- No character: **$60**
- Albert Victor (Negotiation 8 + financier): $60 x 0.92 x 0.90 = **$49**
- Lia Startrace (Negotiation 4): $60 x 0.96 = **$57**

---

## 6. Rent Calculation

When you land on a property owned by another player, you must pay rent. The amount depends on the property type, buildings, and character modifiers.

### 6.1 Regular Properties

Properties have a **base rent** printed on them. This rent increases with buildings and monopoly ownership:

```
if property has buildings (level 1-4):
    rent = baseRent x buildingMultiplier
else if owner has monopoly (all properties in this color):
    rent = baseRent x 2
else:
    rent = baseRent
```

**Building level** is a number from 0 to 4 that you increase by paying to upgrade:
- **Level 0** = empty land, just the deed
- **Level 1** = House built on it (rent x3)
- **Level 2** = Hotel (rent x7)
- **Level 3** = Skyscraper (rent x12)
- **Level 4** = Landmark (rent x20)

You upgrade one level at a time. See Section 7 for building rules.

### 6.2 Transits (Railroads)

Transits are special — they don't have buildings, but their rent scales with **how many transits you own**:

```
1 transit owned = $25 rent (on ANY of your transits)
2 transits      = $50
3 transits      = $100
4 transits      = $200
```

**Why it matters**: If you own 1 railroad and someone lands on it, they pay $25. If you buy a second railroad, now BOTH of your railroads charge $50 each. The more you collect, the scarier they become.

In the Dominion mod, these are "Warp Gates" — control the transit network to tax everyone who travels through.

### 6.3 Utilities

Utilities have dice-based rent — the amount depends on what the visitor rolled to get there:

```
1 utility owned:  rent = diceTotal x 4
2 utilities owned: rent = diceTotal x 10
```

**Why it matters**: If you own Electric Company and someone rolls a 9 to land on it, they pay $36. If you also own Water Works, now both charge diceTotal x 10 — that same roll of 9 would cost $90.

It's unpredictable but powerful when you own both. In the Dominion mod, these could be "Energy Grid" and "Life Support System".

### 6.4 Character Modifiers on Rent

After base rent is calculated, character effects apply in order:

```
Step 1: Charisma discount (visitor)
        rent = rent x (1 - Charisma x 1%)        // max 10% off

Step 2: Knox regulation (owner's ability)
        rent = rent x 1.20                        // only on Knox's regulated property

Step 3: Renn anti-monopoly (visitor's passive)
        rent = rent x 0.75                        // only if owner has monopoly
```

Final rent = floor(result)

### 6.5 Mortgaged Properties

Mortgaged properties collect **$0 rent**. If you mortgage Boardwalk, visitors land for free.

### 6.6 Rent Examples

**Boardwalk ($400, base rent $100), owner has monopoly, no buildings:**
- Normal visitor: $100 x 2 = **$200**
- Visitor with Charisma 6: $200 x 0.94 = **$188**
- Renn visiting (Charisma 6 + anti-monopoly): $200 x 0.94 x 0.75 = **$141**

**Mediterranean Ave, with House (level 1):**
- Normal visitor: $4 x 3 = **$12**
- Visitor with Charisma 10: $12 x 0.90 = **$10**

---

## 7. Building Upgrades

### 7.1 How It Works

When you own **all properties in a color group** (a monopoly), you can pay to build on them. Buildings increase rent dramatically.

You upgrade one level at a time. Think of it as improving the property step by step:

| Level | Name | What You Pay | Rent Becomes |
|-------|------|-------------|-------------|
| 0 | Vacant | — (just own it) | base rent (x2 if monopoly) |
| 1 | House | property price x 0.50 | base rent x 3 |
| 2 | Hotel | property price x 0.75 | base rent x 7 |
| 3 | Skyscraper | property price x 1.00 | base rent x 12 |
| 4 | Landmark | property price x 1.50 | base rent x 20 |

Once you build (level 1+), the building multiplier **replaces** the monopoly 2x bonus. Buildings are always better than the monopoly bonus.

### 7.2 Upgrade Rules

1. **Must own the full color group** — you can't build on Brown unless you own both Brown properties
2. **Even building** — all properties in the group must stay within 1 level of each other. You can't skip ahead on one property. If one is at level 0, you must build on it before upgrading the others to level 2.
3. **No mortgaged properties** in the color group — unmortgage first
4. **Only regular properties** — transits and utilities cannot be upgraded
5. **After rolling** — you can only build during your turn, after you've rolled
6. **Maximum level 4** — Landmark is the highest

### 7.3 Upgrade Cost with Character Modifiers

Characters with high **Tech** stats build cheaper. Lia Startrace has an additional passive discount:

```
upgradeCost = property price x tier cost multiplier
              x (1 - Tech x 2%)              // max 20% off
              x (0.80 if Lia Startrace)      // extra 20% off
              = floor(result)
```

**Example** — Lia Startrace (Tech 9) builds a House on Boardwalk ($400):
```
$400 x 0.50 = $200 base cost
$200 x 0.82 = $164 (Tech 9 = 18% off)
$164 x 0.80 = $131 (pioneer passive = 20% off)
```

### 7.4 Cost Table (no character discounts)

| Property Price | House | Hotel | Skyscraper | Landmark | Total to Max |
|---------------|-------|-------|------------|----------|-------------|
| $60 | $30 | $45 | $60 | $90 | $225 |
| $100 | $50 | $75 | $100 | $150 | $375 |
| $200 | $100 | $150 | $200 | $300 | $750 |
| $300 | $150 | $225 | $300 | $450 | $1,125 |
| $400 | $200 | $300 | $400 | $600 | $1,500 |

### 7.5 Rent Table (no character discounts)

| Property | Base | Monopoly | House | Hotel | Skyscraper | Landmark |
|----------|------|----------|-------|-------|------------|----------|
| Mediterranean ($60) | $4 | $8 | $12 | $28 | $48 | $80 |
| Oriental ($100) | $12 | $24 | $36 | $84 | $144 | $240 |
| St. Charles ($140) | $20 | $40 | $60 | $140 | $240 | $400 |
| St. James ($180) | $28 | $56 | $84 | $196 | $336 | $560 |
| Kentucky ($220) | $36 | $72 | $108 | $252 | $432 | $720 |
| Atlantic ($260) | $44 | $88 | $132 | $308 | $528 | $880 |
| Pacific ($300) | $52 | $104 | $156 | $364 | $624 | $1,040 |
| Park Place ($350) | $70 | $140 | $210 | $490 | $840 | $1,400 |
| Boardwalk ($400) | $100 | $200 | $300 | $700 | $1,200 | $2,000 |

---

## 8. Mortgage System

### 8.1 Mortgage a Property

When you need cash, you can mortgage a property to the bank:
- Receive **50%** of property price immediately
- The property stays yours but collects **$0 rent** while mortgaged
- Shown as grayed out on the board with an "M" badge

**Restrictions:**
- Cannot mortgage a property that has buildings on it
- Cannot mortgage if any property in the same color group has buildings

### 8.2 Unmortgage

Pay **55%** of property price to reactivate. The 5% extra is the bank's interest.

### 8.3 Bankruptcy & Mortgage

- Bankrupt to **another player**: all your properties (including mortgaged ones and buildings) transfer to them
- Bankrupt to **the bank** (tax/card): all properties return to bank, buildings and mortgage status are cleared

---

## 9. Trap System (Jail)

"Trap" is the generic name for a mechanic where a player is stuck and must escape. In the current mod, it's **Jail**. Future mods could reskin this as "Alien Abduction", "Quarantine Zone", "Dimensional Rift", "Frozen in Time", etc. The mechanic is the same.

### 9.1 Getting Trapped

You get sent to the trap space when:
- You land on the **Trap Trigger** space (currently "Go To Jail")
- You draw a **trap card** (e.g., "Go to Jail. Do not pass GO.")
- You roll **triple doubles** (3 consecutive doubles — suspicious behavior!)

### 9.2 Escaping the Trap

Three ways:
1. **Pay the fine** ($50, before rolling, any turn) — instant escape
2. **Roll doubles** — if your dice match, you escape and move that distance
3. **Wait 3 turns** — on the 3rd failed escape attempt, you're forced to pay $50 and released

### 9.3 Trap Fine Bankruptcy

If forced to pay and you can't afford it, you go bankrupt to the bank.

---

## 10. Event Cards

Event cards add randomness and excitement. When you land on a Chance or Community Chest space, you draw one card and resolve it.

### 10.1 Card Types

| Action | What Happens | Example |
|--------|-------------|---------|
| **gain** | You receive money | "Bank pays you dividend of $50" |
| **pay** | You lose money (can cause bankruptcy) | "Doctor's fee. Pay $50" |
| **moveTo** | Move to a specific space (collect salary if passing START) | "Advance to Illinois Ave" |
| **goToJail** | Sent directly to the trap space | "Go to Jail. Do not pass GO." |

> Future: more card types — "steal from player", "swap positions", "free upgrade", "shield from rent next turn", "choose any space to teleport to", etc.

### 10.2 Current Cards

**Chance (10 cards):**
- Advance to GO! Collect $200.
- Advance to Illinois Ave.
- Advance to St. Charles Place.
- Bank pays you dividend of $50.
- Go to Jail. Do not pass GO.
- Make general repairs: Pay $25.
- Speeding fine: Pay $15.
- You won a crossword competition! Collect $100.
- Your building loan matures. Collect $150.
- You have been elected chairman. Pay $50.

**Community Chest (10 cards):**
- Advance to GO! Collect $200.
- Bank error in your favor. Collect $200.
- Doctor's fee. Pay $50.
- From sale of stock you get $50.
- Go to Jail. Do not pass GO.
- Holiday fund matures. Collect $100.
- Income tax refund. Collect $20.
- Life insurance matures. Collect $100.
- School fees. Pay $50.
- You inherit $100.

> These cards are data-driven and will be replaced with themed cards per mod. The Dominion mod could have: "Black Swan Event: property values drop 30%", "Wormhole: teleport anywhere", "Council Decree: all players pay tax", etc.

### 10.3 Card Redraw Mechanic

Some characters can **reject a card and draw again**:

- **Cassian Echo** (merchant passive): Can always accept or redraw, unlimited times — the ultimate card manipulator
- **High Luck characters** (Luck >= 8): Get 1 redraw per game, but only on cards that cost money
- **Evelyn Zero** (speculator passive): Gets an extra redraw on top of her Luck-based one

When a redrawable card is drawn, the turn pauses. The player sees the card and chooses **Accept** or **Redraw**.

---

## 11. Characters

### 11.1 Character System

Characters are **mod content** — the Dominion mod has 10, but another mod could have 5 or 20. What stays the same across all mods is the **stat system** and how stats affect gameplay.

Every character has **6 stats** (range 1-10) and **1 passive ability**.

### 11.2 Stats

| Stat | What It Does |
|------|-------------|
| **Capital** | More starting money: base + Capital x $50 |
| **Luck** | >= 8: get 1 free card redraw per game (only on money-losing cards) |
| **Negotiation** | Buy properties cheaper: -1% per point (max -10%) |
| **Charisma** | Pay less rent: -1% per point (max -10%) |
| **Tech** | Build cheaper: -2% per point (max -20%) |
| **Stamina** | >= 7: get 1 free dice reroll per game |

### 11.3 Dominion Mod Characters

---

#### Albert Victor — Council Financier
| CAP | LCK | NEG | CHA | TEC | STA | Start |
|-----|-----|-----|-----|-----|-----|-------|
| 9 | 4 | 8 | 6 | 5 | 4 | $1950 |

**Passive — Financial Expertise**: Property purchase price -10%. Tax and card losses -20%.

**Playstyle**: Richest starter, cheapest buyer. Dominates the early buying phase. No rerolls or redraws — pure economic power.

---

#### Lia Startrace — Interstellar Pioneer
| CAP | LCK | NEG | CHA | TEC | STA | Start |
|-----|-----|-----|-----|-----|-----|-------|
| 5 | 8 | 4 | 5 | 9 | 6 | $1750 |

**Passive — Tech Pioneer**: Upgrade cost -20%.

**Playstyle**: The builder. Tech 9 (-18%) + passive (-20%) = upgrades cost ~34% less. Luck 8 grants 1 card redraw. Get a monopoly and build fast.

---

#### Marcus Grayline — Political Operator
| CAP | LCK | NEG | CHA | TEC | STA | Start |
|-----|-----|-----|-----|-----|-----|-------|
| 6 | 4 | 7 | 9 | 4 | 5 | $1800 |

**Passive — Political Influence**: Alliance income +10%. *(Active when alliances are implemented)*

**Playstyle**: Highest Charisma (-9% rent). Good Negotiation (-7% buy price). A diplomat who pays less everywhere.

---

#### Evelyn Zero — Probability Speculator
| CAP | LCK | NEG | CHA | TEC | STA | Start |
|-----|-----|-----|-----|-----|-----|-------|
| 4 | 10 | 3 | 6 | 5 | 6 | $1700 |

**Passive — Lucky Draw**: +1 extra card redraw.

**Playstyle**: Luck 10 = 1 base redraw + 1 passive = **2 redraws total**. Best card manipulation. Weakest buyer and poorest starter. Plays the odds.

---

#### Knox Ironlaw — Order Enforcer
| CAP | LCK | NEG | CHA | TEC | STA | Start |
|-----|-----|-----|-----|-----|-----|-------|
| 7 | 3 | 6 | 4 | 6 | 6 | $1850 |

**Passive — Regulation**: Mark 1 owned property as "regulated" — opponents pay +20% rent there.

**Playstyle**: The landlord. Put regulation on your most expensive upgraded property for maximum pain. Only character who can amplify rent on a specific space.

---

#### Sophia Ember — Crisis Arbitrageur
| CAP | LCK | NEG | CHA | TEC | STA | Start |
|-----|-----|-----|-----|-----|-----|-------|
| 5 | 6 | 5 | 5 | 4 | 8 | $1750 |

**Passive — Crisis Profit**: Gain $100 when any player goes bankrupt.

**Playstyle**: Gets stronger as the game progresses. Stamina 8 = 1 reroll. In a 10-player game, could earn $900 from 9 bankruptcies. The vulture.

---

#### Cassian Echo — Information Merchant
| CAP | LCK | NEG | CHA | TEC | STA | Start |
|-----|-----|-----|-----|-----|-----|-------|
| 6 | 5 | 6 | 6 | 6 | 5 | $1800 |

**Passive — Intel Network**: Unlimited card redraws on any card.

**Playstyle**: Most balanced stats (all 5-6). Never stuck with a bad card — keep redrawing until satisfied. No big discounts, but absolute control over card outcomes.

---

#### Mira Dawnlight — Idealist Council Member
| CAP | LCK | NEG | CHA | TEC | STA | Start |
|-----|-----|-----|-----|-----|-----|-------|
| 4 | 6 | 5 | 8 | 5 | 6 | $1700 |

**Passive — Growth Vision**: Collect $250 instead of $200 when passing START.

**Playstyle**: Slow and steady. Extra $50 per lap compounds over time. High Charisma (-8% rent). Best in long games with many laps around the board.

---

#### Renn Chainbreaker — Rule Breaker
| CAP | LCK | NEG | CHA | TEC | STA | Start |
|-----|-----|-----|-----|-----|-----|-------|
| 5 | 5 | 4 | 6 | 7 | 7 | $1750 |

**Passive — Anti-Monopoly**: Pay 25% less rent on monopoly properties.

**Playstyle**: The counter-pick. Punishes players who build monopolies. Stamina 7 = 1 reroll. Tech 7 = -14% build cost. Defensive and resilient.

---

#### Ophelia Nightveil — Shadow Council Member
| CAP | LCK | NEG | CHA | TEC | STA | Start |
|-----|-----|-----|-----|-----|-----|-------|
| 6 | 7 | 5 | 7 | 3 | 6 | $1800 |

**Passive — Shadow Veil**: Other players cannot see her money (shows "$???" on their screen).

**Playstyle**: Mind games. Opponents can't tell if she's rich or broke, if she can afford that property or bluffing. Good Charisma (-7% rent). Weakest Tech. The poker player.

---

## 12. Dice & Movement

### 12.1 Dice Roll

Roll two 6-sided dice (2d6). Total range: 2-12. Move that many spaces forward around the board.

### 12.2 Doubles

When both dice show the same number: **doubles**. Three consecutive doubles in one turn = sent to the trap space (suspicious behavior).

### 12.3 Reroll (Stamina Ability)

Characters with **Stamina >= 7** get 1 free reroll per game. After rolling and seeing the result (but before resolving any buy/card actions), you can undo the roll — your token returns to where it was before, and you roll fresh.

Cannot reroll if you've already started buying or resolving a card.

### 12.4 Passing START (GO)

When your position wraps past space 0, collect salary:
- Standard: **$200**
- Mira Dawnlight: **$250** (passive bonus)

Does NOT trigger when sent directly to a space (trap cards, "Go To Jail", etc.).

---

## 13. Bankruptcy & Elimination

### 13.1 When It Happens

A player is bankrupt when their money drops to **$0 or below** from any payment.

### 13.2 What Happens

**Bankrupt to another player (from rent):**
- All your properties, buildings, and mortgage status transfer to them
- You are eliminated from the game

**Bankrupt to the bank (from tax, cards, or trap fines):**
- All your properties return to the bank (become unowned)
- Buildings and mortgage status are cleared
- You are eliminated

### 13.3 Sophia Ember Trigger

When anyone goes bankrupt, Sophia Ember (if alive) gains **$100** from the chaos.

---

## 14. AI Bot Players

*(Future feature)*

The game supports up to **10 players** — any mix of human and AI bot players. Bots make decisions using simple heuristics:

### 14.1 Bot Decision Logic

| Decision | Bot Strategy |
|----------|-------------|
| **Buy property?** | Buy if affordable and total properties < 8. Prioritize completing color groups. |
| **Upgrade?** | Always upgrade when affordable and monopoly owned. Prioritize highest-rent properties. |
| **Mortgage?** | Mortgage lowest-value properties first when money < $100. |
| **Unmortgage?** | Unmortgage when money > property price x 2. |
| **Pay jail fine?** | Pay if money > $500, otherwise try to roll doubles. |
| **Use reroll?** | Reroll if landed on expensive opponent property. |
| **Accept/redraw card?** | Redraw `pay` cards, accept `gain` cards. |

### 14.2 Bot Difficulty Levels

| Level | Behavior |
|-------|----------|
| **Easy** | Random decisions, buys everything it can afford |
| **Medium** | Follows the heuristic table above |
| **Hard** | Considers opponent positions, prioritizes strategic monopolies, avoids overspending |

---

## 15. All Player Actions

| Move | When Available | Effect |
|------|---------------|--------|
| `selectCharacter(id)` | Character select phase | Pick a character |
| `rollDice` | Your turn, haven't rolled yet | Roll 2d6, move, resolve landing |
| `buyProperty` | Landed on unowned property | Pay price, gain ownership |
| `passProperty` | Landed on unowned property | Decline to buy |
| `payJailFine` | In trap, before rolling | Pay $50, escape |
| `useReroll` | After rolling, before acting | Undo roll, reroll from original position |
| `acceptCard` | Card drawn, deciding | Apply the card effect |
| `redrawCard` | Card drawn, has redraws | Discard card, draw a new one |
| `regulateProperty(id)` | Knox only, owns property | Mark property for +20% rent |
| `upgradeProperty(id)` | After rolling, owns monopoly | Build next tier |
| `mortgageProperty(id)` | Owns property, no buildings | Get 50% cash, property stops earning |
| `unmortgageProperty(id)` | Owns mortgaged property | Pay 55% to reactivate |
| `endTurn` | Done with all actions | Pass to next player |

---

## 16. Future Roadmap

Features planned but not yet implemented:

| Feature | Description | Priority |
|---------|-------------|----------|
| **Online multiplayer** | Server-based play, players in different locations | High |
| **AI bot players** | Computer opponents, 3 difficulty levels, up to 10 total players | High |
| **2-10 player support** | Configurable player count at game start | High |
| **Trading** | Offer properties/money to other players | Medium |
| **Auctions** | When a player passes on buying, all players bid | Medium |
| **Conversation/Chat** | In-game messaging between players | Medium |
| **Stock/IPO system** | List properties as shares, other players can invest | Medium |
| **Alliance system** | Form alliances — no rent between allies, shared income | Medium |
| **Season system** | Every 10 turns, season changes affecting prices and rent | Medium |
| **Enhanced events** | Themed event cards per mod (alien encounters, market crashes, etc.) | Medium |
| **Character-specific events** | Unique landing effects and abilities per character | Low |
| **More win conditions** | Timed game, dominion victory, hidden objectives | Low |
| **Mod system** | Load different themes (maps, characters, cards) from data files | Low |
| **Sound & animations** | Dice roll animation, purchase sounds, rent alerts | Low |
