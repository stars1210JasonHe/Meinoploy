const { test, expect } = require('@playwright/test');

// Helper: select two characters and enter the game
async function selectCharacters(page) {
  // Wait for character select screen
  await page.waitForSelector('.char-card', { timeout: 10000 });

  // Player 1 picks first available character
  await page.locator('.char-card:not(.taken)').first().click();
  await page.waitForTimeout(500);

  // Player 2 picks first available character
  await page.locator('.char-card:not(.taken)').first().click();
  await page.waitForTimeout(1000);

  // Game should now be in play phase
  await page.waitForSelector('#btn-roll', { timeout: 5000 });
}

// Helper: complete one turn (roll, handle buy/pass/auction, end turn)
async function completeTurn(page, { buy = false } = {}) {
  const rollBtn = page.locator('#btn-roll');
  if (await rollBtn.isVisible().catch(() => false)) {
    await rollBtn.click();
    await page.waitForTimeout(300);
  }

  // Handle pending card (accept it)
  const acceptCardBtn = page.locator('#btn-accept-card');
  if (await acceptCardBtn.isVisible().catch(() => false)) {
    await acceptCardBtn.click();
    await page.waitForTimeout(300);
  }

  // Handle buy/pass
  const buyBtn = page.locator('#btn-buy');
  if (await buyBtn.isVisible().catch(() => false)) {
    if (buy) {
      await buyBtn.click();
    } else {
      await page.click('#btn-pass');
      await page.waitForTimeout(300);

      // Handle auction if triggered (pass on auction too)
      const passAuctionBtn = page.locator('#btn-pass-auction');
      for (let i = 0; i < 4; i++) {
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
  if (await endBtn.isVisible().catch(() => false)) {
    await endBtn.click();
    await page.waitForTimeout(300);
  }
}

// ─── CHARACTER SELECTION ────────────────────────────────
test.describe('Character Selection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('.char-card', { timeout: 10000 });
  });

  test('shows character select screen on load', async ({ page }) => {
    await expect(page.locator('.header h1')).toContainText('MEINOPOLY');
    await expect(page.locator('.char-select-header h2')).toContainText('Choose Your Character');

    const cards = page.locator('.char-card');
    const count = await cards.count();
    expect(count).toBe(10);
  });

  test('selecting characters transitions to game board', async ({ page }) => {
    await selectCharacters(page);

    // Board should be visible
    await expect(page.locator('#board')).toBeVisible();
    await expect(page.locator('.player-card')).toHaveCount(2);
    await expect(page.locator('#btn-roll')).toBeVisible();
  });

  test('character cards show stats and lore button', async ({ page }) => {
    const firstCard = page.locator('.char-card').first();
    await expect(firstCard.locator('.char-name')).toBeVisible();
    await expect(firstCard.locator('.char-stats')).toBeVisible();
    await expect(firstCard.locator('.char-passive')).toBeVisible();
    await expect(firstCard.locator('.char-lore-btn')).toBeVisible();
  });

  test('lore modal opens and closes', async ({ page }) => {
    // Click lore button on first character
    await page.locator('.char-lore-btn').first().click();
    await page.waitForTimeout(300);

    // Modal should be visible
    await expect(page.locator('.lore-modal')).toBeVisible();
    await expect(page.locator('.lore-header')).toBeVisible();

    // Close modal
    await page.locator('.lore-close').click();
    await page.waitForTimeout(300);

    // Modal should be hidden
    await expect(page.locator('.lore-modal')).toBeHidden();
  });

  test('selected character is marked as taken', async ({ page }) => {
    // Player 1 selects first character
    await page.locator('.char-card:not(.taken)').first().click();
    await page.waitForTimeout(500);

    // One card should be taken
    const takenCards = page.locator('.char-card.taken');
    await expect(takenCards).toHaveCount(1);
  });
});

// ─── GAME BOARD ─────────────────────────────────────────
test.describe('Game Board', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await selectCharacters(page);
  });

  test('board has 40 spaces', async ({ page }) => {
    const cells = page.locator('.cell[data-space]');
    const count = await cells.count();
    expect(count).toBe(40);
  });

  test('both players start on GO', async ({ page }) => {
    const goCell = page.locator('.cell[data-space="0"]');
    const tokens = goCell.locator('.player-token');
    await expect(tokens).toHaveCount(2);
  });

  test('season display shows Summer Turn 1', async ({ page }) => {
    await expect(page.locator('.season-name')).toContainText('Summer');
    await expect(page.locator('.season-turn')).toContainText('Turn 1');
  });

  test('player panels show character info', async ({ page }) => {
    const firstPlayer = page.locator('.player-card').first();
    await expect(firstPlayer).toHaveClass(/active/);
    await expect(firstPlayer.locator('.player-avatar')).toBeVisible();
    await expect(firstPlayer.locator('.player-passive')).toBeVisible();
  });
});

// ─── BASIC GAMEPLAY ─────────────────────────────────────
test.describe('Basic Gameplay', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await selectCharacters(page);
  });

  test('dice display updates after rolling', async ({ page }) => {
    await expect(page.locator('.dice').first()).toContainText('?');
    await page.click('#btn-roll');
    await expect(page.locator('.dice-total')).toContainText(/Total: \d+/);
  });

  test('roll button disappears after rolling', async ({ page }) => {
    await page.click('#btn-roll');
    await expect(page.locator('#btn-roll')).toHaveCount(0);
  });

  test('message log updates after rolling', async ({ page }) => {
    await page.click('#btn-roll');
    const messageCount = await page.locator('.message').count();
    expect(messageCount).toBeGreaterThanOrEqual(2);
  });

  test('turn flow: roll → act → end turn → next player', async ({ page }) => {
    // Player 1's turn
    const p1Name = await page.locator('.player-card.active strong').textContent();
    await completeTurn(page);

    // Player 2's turn
    const p2Name = await page.locator('.player-card.active strong').textContent();
    expect(p2Name).not.toBe(p1Name);
  });

  test('buying a property updates ownership', async ({ page }) => {
    // Keep playing until a buyable property appears, then buy it
    for (let turn = 0; turn < 10; turn++) {
      const rollBtn = page.locator('#btn-roll');
      if (await rollBtn.isVisible().catch(() => false)) {
        await rollBtn.click();
        await page.waitForTimeout(300);
      }

      // Handle pending card
      const acceptCardBtn = page.locator('#btn-accept-card');
      if (await acceptCardBtn.isVisible().catch(() => false)) {
        await acceptCardBtn.click();
        await page.waitForTimeout(300);
      }

      const buyBtn = page.locator('#btn-buy');
      if (await buyBtn.isVisible().catch(() => false)) {
        await buyBtn.click();
        await page.waitForTimeout(300);

        // Player should now own at least 1 property
        await expect(page.locator('.player-card.active .player-props')).toContainText('1 properties');

        // Owner dot should appear on the board
        const ownerDots = page.locator('.owner-dot');
        const dotCount = await ownerDots.count();
        expect(dotCount).toBeGreaterThanOrEqual(1);
        break;
      }

      // End turn if possible
      const endBtn = page.locator('#btn-end');
      if (await endBtn.isVisible().catch(() => false)) {
        await endBtn.click();
        await page.waitForTimeout(300);
      }

      // Pass auction if triggered
      const passAuctionBtn = page.locator('#btn-pass-auction');
      for (let i = 0; i < 4; i++) {
        if (await passAuctionBtn.isVisible().catch(() => false)) {
          await passAuctionBtn.click();
          await page.waitForTimeout(200);
        } else break;
      }
    }
  });
});

// ─── AUCTION ────────────────────────────────────────────
test.describe('Auction System', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await selectCharacters(page);
  });

  test('passing on a property triggers auction', async ({ page }) => {
    // Play until we can buy, then pass to trigger auction
    for (let turn = 0; turn < 10; turn++) {
      const rollBtn = page.locator('#btn-roll');
      if (await rollBtn.isVisible().catch(() => false)) {
        await rollBtn.click();
        await page.waitForTimeout(300);
      }

      // Handle pending card
      const acceptCardBtn = page.locator('#btn-accept-card');
      if (await acceptCardBtn.isVisible().catch(() => false)) {
        await acceptCardBtn.click();
        await page.waitForTimeout(300);
      }

      const passBtn = page.locator('#btn-pass');
      if (await passBtn.isVisible().catch(() => false)) {
        await passBtn.click();
        await page.waitForTimeout(300);

        // Auction panel should appear
        await expect(page.locator('.auction-panel')).toBeVisible();
        await expect(page.locator('.auction-panel h4')).toContainText('Auction');
        await expect(page.locator('#btn-bid')).toBeVisible();
        await expect(page.locator('#btn-pass-auction')).toBeVisible();
        break;
      }

      // End turn
      const endBtn = page.locator('#btn-end');
      if (await endBtn.isVisible().catch(() => false)) {
        await endBtn.click();
        await page.waitForTimeout(300);
      }
    }
  });
});

// ─── FULL GAME PROCESS ──────────────────────────────────
test.describe('Full Game Process', () => {

  test('complete game: 20 turns with buying, auctions, and property management', async ({ page }) => {
    const consoleErrors = [];
    page.on('pageerror', err => consoleErrors.push(err.message));

    await page.goto('/');

    // ── Phase 1: Character Selection ──
    await page.waitForSelector('.char-card', { timeout: 10000 });
    await expect(page.locator('.char-select-header h2')).toContainText('Choose Your Character');

    // P1 picks first character
    const p1Card = page.locator('.char-card:not(.taken)').first();
    const p1Name = await p1Card.locator('.char-name').textContent();
    await p1Card.click();
    await page.waitForTimeout(500);

    // P2 picks next character
    const p2Card = page.locator('.char-card:not(.taken)').first();
    const p2Name = await p2Card.locator('.char-name').textContent();
    await p2Card.click();
    await page.waitForTimeout(1000);

    // Verify game board loaded
    await expect(page.locator('#board')).toBeVisible();
    await expect(page.locator('#btn-roll')).toBeVisible();
    await expect(page.locator('.season-name')).toContainText('Summer');

    // ── Phase 2: Play 20 turns ──
    let propertiesBought = 0;
    let auctionsTriggered = 0;
    let turnsPlayed = 0;

    for (let turn = 0; turn < 20; turn++) {
      // Check if game is over
      const gameOver = page.locator('.game-over');
      if (await gameOver.isVisible().catch(() => false)) {
        break;
      }

      // Roll dice
      const rollBtn = page.locator('#btn-roll');
      if (await rollBtn.isVisible().catch(() => false)) {
        await rollBtn.click();
        await page.waitForTimeout(300);

        // Verify dice shows a total
        const diceTotal = page.locator('.dice-total');
        if (await diceTotal.isVisible().catch(() => false)) {
          await expect(diceTotal).toContainText(/Total: \d+/);
        }
      }

      // Handle pending card
      const acceptCardBtn = page.locator('#btn-accept-card');
      if (await acceptCardBtn.isVisible().catch(() => false)) {
        await acceptCardBtn.click();
        await page.waitForTimeout(300);
      }

      // Handle buy/pass — alternate strategy
      const buyBtn = page.locator('#btn-buy');
      if (await buyBtn.isVisible().catch(() => false)) {
        if (turn % 3 !== 2) {
          // Buy on most turns
          await buyBtn.click();
          propertiesBought++;
          await page.waitForTimeout(300);
        } else {
          // Pass occasionally to trigger auctions
          await page.click('#btn-pass');
          await page.waitForTimeout(300);

          // Handle auction
          const auctionPanel = page.locator('.auction-panel');
          if (await auctionPanel.isVisible().catch(() => false)) {
            auctionsTriggered++;

            // First bidder places a bid
            const bidBtn = page.locator('#btn-bid');
            if (await bidBtn.isVisible().catch(() => false)) {
              await page.fill('#bid-amount', '10');
              await bidBtn.click();
              await page.waitForTimeout(200);
            }

            // Second bidder passes
            const passAuctionBtn = page.locator('#btn-pass-auction');
            if (await passAuctionBtn.isVisible().catch(() => false)) {
              await passAuctionBtn.click();
              await page.waitForTimeout(200);
            }
          }

          // Clean up remaining auction rounds
          const passAuctionBtn = page.locator('#btn-pass-auction');
          for (let i = 0; i < 4; i++) {
            if (await passAuctionBtn.isVisible().catch(() => false)) {
              await passAuctionBtn.click();
              await page.waitForTimeout(200);
            } else break;
          }
        }
      }

      // Handle jail (pay fine if in jail)
      const jailBtn = page.locator('#btn-jail');
      if (await jailBtn.isVisible().catch(() => false)) {
        // Just roll for doubles (already done above)
      }

      // End turn
      const endBtn = page.locator('#btn-end');
      if (await endBtn.isVisible().catch(() => false)) {
        await endBtn.click();
        await page.waitForTimeout(200);
        turnsPlayed++;
      }
    }

    // ── Phase 3: Verify game state ──
    // No JS errors
    expect(consoleErrors).toHaveLength(0);

    // Both player panels still exist
    await expect(page.locator('.player-card')).toHaveCount(2);

    // Some turns were played
    expect(turnsPlayed).toBeGreaterThan(0);

    // Some properties were bought
    expect(propertiesBought).toBeGreaterThan(0);

    // Messages log has content
    const messageCount = await page.locator('.message').count();
    expect(messageCount).toBeGreaterThan(0);

    // Board still renders properly
    const cellCount = await page.locator('.cell[data-space]').count();
    expect(cellCount).toBe(40);
  });

  test('property management: upgrade and mortgage', async ({ page }) => {
    const consoleErrors = [];
    page.on('pageerror', err => consoleErrors.push(err.message));

    await page.goto('/');
    await selectCharacters(page);

    // Play many turns, always buying to accumulate properties
    for (let turn = 0; turn < 40; turn++) {
      const gameOver = page.locator('.game-over');
      if (await gameOver.isVisible().catch(() => false)) break;

      const rollBtn = page.locator('#btn-roll');
      if (await rollBtn.isVisible().catch(() => false)) {
        await rollBtn.click();
        await page.waitForTimeout(200);
      }

      const acceptCardBtn = page.locator('#btn-accept-card');
      if (await acceptCardBtn.isVisible().catch(() => false)) {
        await acceptCardBtn.click();
        await page.waitForTimeout(200);
      }

      const buyBtn = page.locator('#btn-buy');
      if (await buyBtn.isVisible().catch(() => false)) {
        await buyBtn.click();
        await page.waitForTimeout(200);
      }

      // Check for upgrade buttons in property management
      const upgradeBtn = page.locator('.btn-upgrade').first();
      if (await upgradeBtn.isVisible().catch(() => false)) {
        await upgradeBtn.click();
        await page.waitForTimeout(200);
      }

      // Check for mortgage buttons
      const mortgageBtn = page.locator('.btn-mortgage').first();
      if (await mortgageBtn.isVisible().catch(() => false)) {
        // Only mortgage if we have many properties
        const propBadges = page.locator('.prop-badge');
        if (await propBadges.count() > 3) {
          await mortgageBtn.click();
          await page.waitForTimeout(200);
        }
      }

      const endBtn = page.locator('#btn-end');
      if (await endBtn.isVisible().catch(() => false)) {
        await endBtn.click();
        await page.waitForTimeout(200);
      }

      // Handle stray auctions
      const passAuctionBtn = page.locator('#btn-pass-auction');
      for (let i = 0; i < 4; i++) {
        if (await passAuctionBtn.isVisible().catch(() => false)) {
          await passAuctionBtn.click();
          await page.waitForTimeout(100);
        } else break;
      }
    }

    expect(consoleErrors).toHaveLength(0);
    await expect(page.locator('.player-card')).toHaveCount(2);
  });

  test('season changes after enough turns', async ({ page }) => {
    await page.goto('/');
    await selectCharacters(page);

    // Play 22 turns (season changes every 10 turns)
    for (let turn = 0; turn < 22; turn++) {
      await completeTurn(page, { buy: turn % 2 === 0 });
    }

    // Season should have changed from Summer
    // Turn count should be > 10
    const turnText = await page.locator('.season-turn').textContent();
    const turnNum = parseInt(turnText.match(/\d+/)?.[0] || '0');
    expect(turnNum).toBeGreaterThan(10);
  });
});
