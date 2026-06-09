# Quick Wins: Map Connections Engine + Ophelia Hidden Victory

## Feature 1: Map Connections (Portal System)

### What it does
When a player lands on a space with portal connections, they choose to teleport or stay. Enables the portals in Outer Rim (5↔17, 11↔26) and Nightveil (25→8).

### Changes

**Game.js:**
- Add `_connections = null` module var, set in `setActiveMap()`
- Add `pendingPortal: null` to setup() state + turn.onBegin reset
- After movement in rollDice: check if landed space has non-adjacent connection targets → set `G.pendingPortal = { targets, from }`, turnPhase = 'portal'
- New move `usePortal(G, ctx, targetId)` — teleport + handleLanding (no GO salary)
- New move `skipPortal(G, ctx)` — stay + handleLanding on current space

**App.js:**
- Portal choice UI in renderActions: "Teleport to [name]" buttons + "Stay here" button

**Tests:**
- Portal offered on connected space, usePortal/skipPortal work, no portal on linear maps

---

## Feature 2: Ophelia Hidden Victory

### What it does
Ophelia wins instantly when total assets reach threshold (default $5000). Others can't see it coming since her money shows as `$???`.

### Changes

**rules.js:**
- Add `shadow.hiddenVictoryThreshold: 5000`

**Game.js:**
- In checkGameOver(): check if shadow-passive player's assets >= threshold → return winner with reason 'hiddenVictory'

**App.js:**
- Game-over display for hiddenVictory reason: special reveal message

**Tests:**
- Ophelia wins at threshold, non-Ophelia doesn't trigger it

---

## Files: Game.js, App.js, rules.js, Game.test.js
