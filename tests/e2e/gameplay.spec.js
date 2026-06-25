const { test, expect } = require('@playwright/test');

// ─────────────────────────────────────────────────────────────
// Navigation helpers for the pixel UI + victory-select flow
// ─────────────────────────────────────────────────────────────

// SELECT MOD step (LOCAL only, after Local Game). It renders mod cards (.map-card with
// data-mod-idx) only when >1 mod is registered; with one mod it auto-advances and this
// returns immediately. Picks the mod card whose title matches `modName`.
async function selectMod(page, modName) {
  // Mod cards carry data-mod-idx; map cards carry data-map-idx. Wait briefly for the mod
  // step; if it auto-advanced (single mod) we won't find one and just return.
  const modCard = page.locator('.map-card[data-mod-idx]', { hasText: modName }).first();
  if (await modCard.isVisible({ timeout: 4000 }).catch(() => false)) {
    await modCard.click();
  }
}

// Steps 1-4: hero → mod select → map select → player count → victory select → land on
// the character-select screen for player 1.
async function gotoCharSelect(page) {
  await page.goto('/');

  // 1. Hero start screen
  await page.waitForSelector('#btn-mode-local', { timeout: 10000 });
  await page.click('#btn-mode-local');

  // 1b. Mod select — with >1 mod registered the SELECT MOD step renders. Pick Dominion
  // so the rest of this flow (and every existing Dominion test) is unchanged.
  await selectMod(page, 'Dominion');

  // 2. Map select — classic is the first card
  await page.waitForSelector('.map-card[data-map-idx="0"]', { timeout: 10000 });
  await page.click('.map-card[data-map-idx="0"]');

  // 3. Player count — 2 players
  await page.waitForSelector('.count-btn[data-count="2"]', { timeout: 10000 });
  await page.click('.count-btn[data-count="2"]');

  // 4. Victory select — defaults to "Last Standing"; just start
  await page.waitForSelector('#btn-vic-start', { timeout: 10000 });
  await page.click('#btn-vic-start');

  // Now on the character-select screen
  await page.waitForSelector('.charcard', { timeout: 10000 });
}

// Pick the first available (untaken) character and confirm it. Two-step:
// click the card to preview (.charcard--sel), then commit via #btn-select-confirm.
async function pickAndConfirm(page) {
  const card = page.locator('.charcard:not(.charcard--taken)').first();
  await card.click();
  // Confirm button enables once a card is previewed
  const confirm = page.locator('#btn-select-confirm');
  await expect(confirm).toBeEnabled();
  await confirm.click();
}

// Full path: navigate in, then select two characters → game board.
async function selectCharacters(page) {
  await gotoCharSelect(page);

  // Player 1
  await pickAndConfirm(page);
  // Player 2 — wait for the screen to advance (PLAYER 2 header) before picking
  await page.waitForFunction(() => {
    const el = document.querySelector('.select__p');
    return el && /PLAYER 2/.test(el.textContent);
  }, { timeout: 10000 });
  await pickAndConfirm(page);

  // Game board appears
  await page.waitForSelector('#btn-roll', { timeout: 10000 });
}

// Complete one turn: roll, resolve card modal, handle buy/pass + auction, end.
async function completeTurn(page, { buy = false } = {}) {
  const rollBtn = page.locator('#btn-roll');
  if (await rollBtn.isVisible().catch(() => false)) {
    await rollBtn.click();
    // Roll plays a ~0.9s dice animation before the move dispatches — wait it out fully
    // (a fixed wait is reliable; btn-roll detaches on any re-render, so it can't be the signal).
    await page.waitForTimeout(1100);
  }

  // Resolve a drawn event card (modal — accept it)
  const evAccept = page.locator('#ev-accept');
  if (await evAccept.isVisible().catch(() => false)) {
    await evAccept.click();
    await page.waitForTimeout(300);
  }

  // Buy / pass on a buyable property (center slot)
  const buyBtn = page.locator('#btn-buy');
  if (await buyBtn.isVisible().catch(() => false)) {
    if (buy) {
      await buyBtn.click();
      await page.waitForTimeout(300);
    } else {
      await page.click('#btn-pass');
      await page.waitForTimeout(300);

      // Passing may trigger an auction modal — pass it out for all bidders
      const passAuctionBtn = page.locator('#btn-pass-auction');
      for (let i = 0; i < 6; i++) {
        if (await passAuctionBtn.isVisible().catch(() => false)) {
          await passAuctionBtn.click();
          await page.waitForTimeout(200);
        } else {
          break;
        }
      }
    }
  }

  // End turn
  const endBtn = page.locator('#btn-end');
  if (await endBtn.isVisible().catch(() => false) && await endBtn.isEnabled().catch(() => false)) {
    await endBtn.click();
    await page.waitForTimeout(300);
  }
}

// ─── CHARACTER SELECTION ────────────────────────────────
test.describe('Character Selection', () => {
  test('hero loads on / and char-select shows 10 characters', async ({ page }) => {
    await page.goto('/');
    // Hero start screen
    await expect(page.locator('#btn-mode-local')).toBeVisible();
    await expect(page.locator('.hero-art')).toBeVisible();

    // Navigate to character select
    await gotoCharSelect(page);
    await expect(page.locator('.select__h')).toContainText('CHOOSE YOUR CHARACTER');
    await expect(page.locator('.charcard')).toHaveCount(10);
  });

  test('selecting characters transitions to game board', async ({ page }) => {
    await selectCharacters(page);

    await expect(page.locator('#board')).toBeVisible();
    await expect(page.locator('.pcard')).toHaveCount(2);
    await expect(page.locator('#btn-roll')).toBeVisible();
  });

  test('character cards show name, stats, passive and lore button', async ({ page }) => {
    await gotoCharSelect(page);
    const firstCard = page.locator('.charcard').first();
    await expect(firstCard.locator('.charcard__name')).toBeVisible();
    await expect(firstCard.locator('.charcard__stats')).toBeVisible();
    await expect(firstCard.locator('.charcard__passive')).toBeVisible();
    await expect(firstCard.locator('.charcard__passive-name')).toBeVisible();
    await expect(firstCard.locator('.charcard__lore')).toBeVisible();
  });

  test('lore modal opens and closes', async ({ page }) => {
    await gotoCharSelect(page);

    // Open lore for the first character
    await page.locator('.charcard__lore').first().click();
    await expect(page.locator('#ui-modal')).toHaveClass(/open/);
    await expect(page.locator('.lore')).toBeVisible();
    await expect(page.locator('.lore__name')).toBeVisible();

    // Close
    await page.click('#btn-lore-close');
    await expect(page.locator('#ui-modal')).not.toHaveClass(/open/);
  });

  test('confirming a pick marks exactly one character as taken for player 2', async ({ page }) => {
    await gotoCharSelect(page);

    // Player 1 picks and confirms
    await pickAndConfirm(page);

    // Player 2's screen — exactly one card is now taken
    await page.waitForFunction(() => {
      const el = document.querySelector('.select__p');
      return el && /PLAYER 2/.test(el.textContent);
    }, { timeout: 10000 });
    await expect(page.locator('.charcard--taken')).toHaveCount(1);
  });
});

// ─── GAME BOARD ─────────────────────────────────────────
test.describe('Game Board', () => {
  test.beforeEach(async ({ page }) => {
    await selectCharacters(page);
  });

  test('board has 40 spaces', async ({ page }) => {
    await expect(page.locator('.tile[data-space]')).toHaveCount(40);
  });

  test('both players start on GO (overlay tokens)', async ({ page }) => {
    // Tokens now live in the persistent overlay (#token-layer), not inside tiles.
    // Two player tokens exist at game start (both co-located on GO).
    await expect(page.locator('#token-layer .token')).toHaveCount(2);
  });

  test('season display shows Summer and Turn 1', async ({ page }) => {
    await expect(page.locator('.board__season-val')).toContainText('Summer');
    await expect(page.locator('.board__season-turns')).toContainText('Turn 1');
  });

  test('active player card shows portrait and passive', async ({ page }) => {
    const activeCard = page.locator('.pcard--active');
    await expect(activeCard).toHaveCount(1);
    // In-game pcards use server-safe character data (no portrait PNG), so the
    // portrait renders as the .portrait container with the character's initial
    // (.portrait__empty) rather than an <img>. Assert the portrait element shows.
    await expect(activeCard.locator('.portrait')).toBeVisible();
    await expect(activeCard.locator('.pcard__passive')).toBeVisible();
  });
});

// ─── BASIC GAMEPLAY ─────────────────────────────────────
test.describe('Basic Gameplay', () => {
  test.beforeEach(async ({ page }) => {
    await selectCharacters(page);
  });

  test('dice show a total after rolling', async ({ page }) => {
    // Before roll: two pip dice and a hint, no total
    await expect(page.locator('.die')).toHaveCount(2);
    await page.click('#btn-roll');
    await expect(page.locator('.centerslot__total')).toContainText('TOTAL');
  });

  test('roll button disappears after rolling', async ({ page }) => {
    await page.click('#btn-roll');
    await expect(page.locator('#btn-roll')).toHaveCount(0);
  });

  test('event log updates after rolling', async ({ page }) => {
    await page.click('#btn-roll');
    await page.waitForTimeout(1100); // roll plays a ~0.9s dice animation before dispatching
    const lineCount = await page.locator('.logline').count();
    expect(lineCount).toBeGreaterThanOrEqual(2);
  });

  test('turn flow: active player changes after a full turn', async ({ page }) => {
    const p1Name = await page.locator('.pcard--active .pcard__name').textContent();
    await completeTurn(page);
    // Resolve any modal that might block the next player's view
    const p2Name = await page.locator('.pcard--active .pcard__name').textContent();
    expect(p2Name).not.toBe(p1Name);
  });

  test('buying a property updates ownership', async ({ page }) => {
    let bought = false;
    for (let turn = 0; turn < 12 && !bought; turn++) {
      const rollBtn = page.locator('#btn-roll');
      if (await rollBtn.isVisible().catch(() => false)) {
        await rollBtn.click();
        await page.waitForTimeout(300);
      }

      const evAccept = page.locator('#ev-accept');
      if (await evAccept.isVisible().catch(() => false)) {
        await evAccept.click();
        await page.waitForTimeout(300);
      }

      const buyBtn = page.locator('#btn-buy');
      if (await buyBtn.isVisible().catch(() => false)) {
        await buyBtn.click();
        await page.waitForTimeout(400);

        // Active player now owns at least one deed
        await expect(page.locator('.pcard--active .pcard__meta')).toContainText('1 DEEDS');
        const chips = await page.locator('.pcard--active .propchip').count();
        expect(chips).toBeGreaterThanOrEqual(1);

        // Board shows ownership (house pips inside an owner badge)
        const houses = await page.locator('.tile__house').count();
        expect(houses).toBeGreaterThanOrEqual(1);
        bought = true;
        break;
      }

      const endBtn = page.locator('#btn-end');
      if (await endBtn.isVisible().catch(() => false) && await endBtn.isEnabled().catch(() => false)) {
        await endBtn.click();
        await page.waitForTimeout(300);
      }

      // Clear stray auctions
      const passAuctionBtn = page.locator('#btn-pass-auction');
      for (let i = 0; i < 6; i++) {
        if (await passAuctionBtn.isVisible().catch(() => false)) {
          await passAuctionBtn.click();
          await page.waitForTimeout(200);
        } else break;
      }
    }
    expect(bought).toBe(true);
  });
});

// ─── AUCTION ────────────────────────────────────────────
test.describe('Auction System', () => {
  test.beforeEach(async ({ page }) => {
    await selectCharacters(page);
  });

  test('passing on a property triggers an auction modal', async ({ page }) => {
    let auctioned = false;
    for (let turn = 0; turn < 12 && !auctioned; turn++) {
      const rollBtn = page.locator('#btn-roll');
      if (await rollBtn.isVisible().catch(() => false)) {
        await rollBtn.click();
        await page.waitForTimeout(300);
      }

      const evAccept = page.locator('#ev-accept');
      if (await evAccept.isVisible().catch(() => false)) {
        await evAccept.click();
        await page.waitForTimeout(300);
      }

      const passBtn = page.locator('#btn-pass');
      if (await passBtn.isVisible().catch(() => false)) {
        await passBtn.click();
        await page.waitForTimeout(400);

        // Auction modal should appear
        await expect(page.locator('.auction')).toBeVisible();
        await expect(page.locator('.auction__head')).toContainText('AUCTION');
        await expect(page.locator('#btn-bid')).toBeVisible();
        await expect(page.locator('#btn-pass-auction')).toBeVisible();
        auctioned = true;
        break;
      }

      const endBtn = page.locator('#btn-end');
      if (await endBtn.isVisible().catch(() => false) && await endBtn.isEnabled().catch(() => false)) {
        await endBtn.click();
        await page.waitForTimeout(300);
      }
    }
    expect(auctioned).toBe(true);
  });
});

// ─── FULL GAME PROCESS ──────────────────────────────────
test.describe('Full Game Process', () => {

  test('complete game: 20 turns with buying, auctions, end turn', async ({ page }) => {
    test.setTimeout(120000); // many turns × small waits — needs headroom
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await selectCharacters(page);
    await expect(page.locator('#board')).toBeVisible();
    await expect(page.locator('.board__season-val')).toContainText('Summer');

    let propertiesBought = 0;
    let turnsPlayed = 0;

    for (let turn = 0; turn < 20; turn++) {
      // Stop if the game ended
      if (await page.locator('.results__victory').isVisible().catch(() => false)) break;

      const rollBtn = page.locator('#btn-roll');
      if (await rollBtn.isVisible().catch(() => false)) {
        await rollBtn.click();
        await page.waitForTimeout(1100); // wait out the ~0.9s dice animation + dispatch
        const total = page.locator('.centerslot__total');
        if (await total.isVisible().catch(() => false)) {
          await expect(total).toContainText('TOTAL');
        }
      }

      // Resolve event card modal
      const evAccept = page.locator('#ev-accept');
      if (await evAccept.isVisible().catch(() => false)) {
        await evAccept.click();
        await page.waitForTimeout(300);
      }

      // Buy on most turns, pass-and-auction occasionally
      const buyBtn = page.locator('#btn-buy');
      if (await buyBtn.isVisible().catch(() => false)) {
        if (turn % 3 !== 2) {
          await buyBtn.click();
          propertiesBought++;
          await page.waitForTimeout(300);
        } else {
          await page.click('#btn-pass');
          await page.waitForTimeout(400);

          const auction = page.locator('.auction');
          if (await auction.isVisible().catch(() => false)) {
            // First bidder bids, then everyone else passes out
            const bidBtn = page.locator('#btn-bid');
            if (await bidBtn.isVisible().catch(() => false)) {
              await page.fill('#bid-amount', '10');
              await bidBtn.click();
              await page.waitForTimeout(200);
            }
            const passAuctionBtn = page.locator('#btn-pass-auction');
            for (let i = 0; i < 6; i++) {
              if (await passAuctionBtn.isVisible().catch(() => false)) {
                await passAuctionBtn.click();
                await page.waitForTimeout(200);
              } else break;
            }
          }
        }
      }

      // End turn
      const endBtn = page.locator('#btn-end');
      if (await endBtn.isVisible().catch(() => false) && await endBtn.isEnabled().catch(() => false)) {
        await endBtn.click();
        await page.waitForTimeout(200);
        turnsPlayed++;
      }
    }

    // No JS errors
    expect(pageErrors).toEqual([]);

    // Still 2 player cards (unless someone went bankrupt — but pcards persist as OUT)
    await expect(page.locator('.pcard')).toHaveCount(2);

    expect(turnsPlayed).toBeGreaterThan(0);
    expect(propertiesBought).toBeGreaterThan(0);

    const lineCount = await page.locator('.logline').count();
    expect(lineCount).toBeGreaterThan(0);

    await expect(page.locator('.tile[data-space]')).toHaveCount(40);
  });

  test('property management: upgrade and mortgage', async ({ page }) => {
    test.setTimeout(120000); // ~40 turns × small waits — needs headroom
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await selectCharacters(page);

    for (let turn = 0; turn < 40; turn++) {
      if (await page.locator('.results__victory').isVisible().catch(() => false)) break;

      const rollBtn = page.locator('#btn-roll');
      if (await rollBtn.isVisible().catch(() => false)) {
        await rollBtn.click();
        await page.waitForTimeout(200);
      }

      const evAccept = page.locator('#ev-accept');
      if (await evAccept.isVisible().catch(() => false)) {
        await evAccept.click();
        await page.waitForTimeout(200);
      }

      // Always buy to accumulate deeds
      const buyBtn = page.locator('#btn-buy');
      if (await buyBtn.isVisible().catch(() => false)) {
        await buyBtn.click();
        await page.waitForTimeout(200);
      }

      // Upgrade when an upgrade button is available (full color group owned)
      const upgradeBtn = page.locator('.btn-upgrade').first();
      if (await upgradeBtn.isVisible().catch(() => false)) {
        await upgradeBtn.click();
        await page.waitForTimeout(200);
      }

      // Mortgage when we have a healthy property count
      const mortgageBtn = page.locator('.btn-mortgage').first();
      if (await mortgageBtn.isVisible().catch(() => false)) {
        const chips = await page.locator('.pcard--active .propchip').count();
        if (chips > 3) {
          await mortgageBtn.click();
          await page.waitForTimeout(200);
        }
      }

      const endBtn = page.locator('#btn-end');
      if (await endBtn.isVisible().catch(() => false) && await endBtn.isEnabled().catch(() => false)) {
        await endBtn.click();
        await page.waitForTimeout(200);
      }

      // Clear stray auctions
      const passAuctionBtn = page.locator('#btn-pass-auction');
      for (let i = 0; i < 6; i++) {
        if (await passAuctionBtn.isVisible().catch(() => false)) {
          await passAuctionBtn.click();
          await page.waitForTimeout(150);
        } else break;
      }
    }

    expect(pageErrors).toEqual([]);
    await expect(page.locator('.pcard')).toHaveCount(2);
  });

  test('season changes after enough turns', async ({ page }) => {
    test.setTimeout(180000); // 22 turns × completeTurn waits (incl. the ~0.9s dice animation) — needs headroom
    await selectCharacters(page);

    // Play 22 turns (season cycles every 10)
    for (let turn = 0; turn < 22; turn++) {
      if (await page.locator('.results__victory').isVisible().catch(() => false)) break;
      await completeTurn(page, { buy: turn % 2 === 0 });
    }

    // The "Turn N" number in the season strip should exceed 10
    const turnText = await page.locator('.board__season-turns').textContent();
    const m = turnText.match(/Turn\s+(\d+)/);
    const turnNum = m ? parseInt(m[1]) : 0;
    expect(turnNum).toBeGreaterThan(10);
  });
});

// ─── ATLAS WORLD (Terra Circuit) ────────────────────────
// Navigate into a game on the Terra Circuit atlas world (movementMode:'atlas'),
// selecting the map card by its title rather than the classic index-0 card.
async function selectCharactersAtlas(page) {
  await page.goto('/');

  // 1. Hero start screen
  await page.waitForSelector('#btn-mode-local', { timeout: 10000 });
  await page.click('#btn-mode-local');

  // 1b. Mod select — Terra Circuit is a Dominion world, so pick the Dominion mod.
  await selectMod(page, 'Dominion');

  // 2. Map select — pick the Terra Circuit card by title (not the classic card)
  await page.waitForSelector('.map-card[data-map-idx]', { timeout: 10000 });
  await page.locator('.map-card[data-map-idx]', { hasText: 'Terra Circuit' }).click();

  // 3. Player count — 2 players
  await page.waitForSelector('.count-btn[data-count="2"]', { timeout: 10000 });
  await page.click('.count-btn[data-count="2"]');

  // 4. Victory select — defaults to the world's primary path (dominion); start
  await page.waitForSelector('#btn-vic-start', { timeout: 10000 });
  await page.click('#btn-vic-start');

  // 5. Character select — pick two
  await page.waitForSelector('.charcard', { timeout: 10000 });
  await pickAndConfirm(page);
  await page.waitForFunction(() => {
    const el = document.querySelector('.select__p');
    return el && /PLAYER 2/.test(el.textContent);
  }, { timeout: 10000 });
  await pickAndConfirm(page);

  // Game board appears
  await page.waitForSelector('#btn-roll', { timeout: 10000 });
}

// One atlas turn. Clicks are NORMAL (no { force: true }): the center buy/pass
// prompt sits ABOVE tiles (board__center--abs z-index) and the world's tiles
// ring the perimeter clear of the center, so a covered/unclickable button would
// fail the test — that is the point (it proves the map is genuinely playable,
// not just non-crashing). The game walks the graph via auto-route (no route arg).
async function completeTurnAtlas(page) {
  const rollBtn = page.locator('#btn-roll');
  if (await rollBtn.isVisible().catch(() => false)) {
    await rollBtn.click();
    await page.waitForTimeout(1100); // wait out the ~0.9s dice animation + dispatch
    // If a fork offered choices, pick the first highlighted city; else it auto-committed.
    const target = page.locator('.tile--route-target').first();
    if (await target.isVisible().catch(() => false)) {
      await target.click();
      await page.waitForTimeout(350);
    }
  }

  const evAccept = page.locator('#ev-accept');
  if (await evAccept.isVisible().catch(() => false)) {
    await evAccept.click();
    await page.waitForTimeout(300);
  }

  // Pass on any buyable property (hard click — proves the center prompt is
  // reachable), then pass any resulting auction out.
  const buyBtn = page.locator('#btn-buy');
  if (await buyBtn.isVisible().catch(() => false)) {
    await page.locator('#btn-pass').click();
    await page.waitForTimeout(300);
    const passAuctionBtn = page.locator('#btn-pass-auction');
    for (let i = 0; i < 6; i++) {
      if (await passAuctionBtn.isVisible().catch(() => false)) {
        await passAuctionBtn.click();
        await page.waitForTimeout(200);
      } else break;
    }
  }

  const endBtn = page.locator('#btn-end');
  if (await endBtn.isVisible().catch(() => false) && await endBtn.isEnabled().catch(() => false)) {
    await endBtn.click();
    await page.waitForTimeout(300);
  }
}

// ─── TERRA TITANS MOD (globe world, 16 historical leaders) ──
// Exercises the now-live mod-select step: pick Terra Titans → its globe world →
// confirm all 16 leader cards render → start → the (globe) board loads.
test.describe('Terra Titans mod', () => {
  test('select mod → globe world → 16 leaders → board loads', async ({ page }) => {
    test.setTimeout(60000);
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto('/');

    // 1. Hero → Local Game
    await page.waitForSelector('#btn-mode-local', { timeout: 10000 });
    await page.click('#btn-mode-local');

    // 2. SELECT MOD — pick Terra Titans (now that 2 mods are registered, this renders)
    await page.waitForSelector('.map-card[data-mod-idx]', { timeout: 10000 });
    const ttCard = page.locator('.map-card[data-mod-idx]', { hasText: 'Terra Titans' }).first();
    await expect(ttCard).toBeVisible();
    await ttCard.click();

    // 3. Map select — Terra Titans' only board is its globe world. Pick it by title.
    await page.waitForSelector('.map-card[data-map-idx]', { timeout: 10000 });
    await page.locator('.map-card[data-map-idx]', { hasText: 'Terra Titans' }).click();

    // 4. Player count — 2 players
    await page.waitForSelector('.count-btn[data-count="2"]', { timeout: 10000 });
    await page.click('.count-btn[data-count="2"]');

    // 5. Victory select — defaults to the world's primary path (dominion); start
    await page.waitForSelector('#btn-vic-start', { timeout: 10000 });
    await page.click('#btn-vic-start');

    // 6. Character select — all 16 historical leaders render as cards
    await page.waitForSelector('.charcard', { timeout: 10000 });
    await expect(page.locator('.charcard')).toHaveCount(16);
    // Portraits are placeholders: colored-initial fallback (no <img>), via .portrait__empty.
    await expect(page.locator('.charcard .portrait__empty').first()).toBeVisible();

    // Pick two leaders → game board
    await pickAndConfirm(page);
    await page.waitForFunction(() => {
      const el = document.querySelector('.select__p');
      return el && /PLAYER 2/.test(el.textContent);
    }, { timeout: 10000 });
    await pickAndConfirm(page);

    // 7. Board loads — roll button present + the globe renderer class is applied.
    await page.waitForSelector('#btn-roll', { timeout: 10000 });
    await expect(page.locator('.board--globe')).toHaveCount(1);

    // No render/setup crash across the mod-select → globe-board flow.
    expect(pageErrors).toEqual([]);
  });
});

test.describe('Atlas World', () => {
  test('atlas map: Terra Circuit renders and is playable', async ({ page }) => {
    test.setTimeout(60000);
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await selectCharactersAtlas(page);

    // Board renders on the absolute renderer: tiles + the edge overlay both
    // present, and the cornerIds guard means no crash drawing tiles.
    await expect(page.locator('.board__grid--absolute .tile').first()).toBeVisible();
    await expect(page.locator('.board__edges')).toHaveCount(1);
    await expect(page.locator('.board__edges line').first()).toBeAttached();

    // Play a few turns via auto-route (roll → resolve buy/pass + auction → end).
    // Track the active player so we can assert turns actually advanced.
    const whoSeen = new Set();
    for (let turn = 0; turn < 5; turn++) {
      if (await page.locator('.results__victory').isVisible().catch(() => false)) break;
      const who = await page.locator('.turnbox__who').textContent().catch(() => '');
      if (who) whoSeen.add(who.trim());
      await completeTurnAtlas(page);
    }

    // Turns genuinely advanced — the active player changed at least once, which
    // is only possible if the (hard-clicked) buy/pass + end buttons were reachable.
    expect(whoSeen.size).toBeGreaterThan(1);
    // Every roll resolved (auto-commit or a picked fork) — nothing left dangling.
    await expect(page.locator('.tile--route-target')).toHaveCount(0);
    // No render/move crash across setup + auto-route turns.
    expect(pageErrors).toEqual([]);
  });
});
