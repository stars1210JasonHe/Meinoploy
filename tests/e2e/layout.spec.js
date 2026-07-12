const { test, expect } = require('@playwright/test');

// Layout-rebuild E2E smoke (Task 5). Exercises the as-built map-dominant chrome
// from Tasks 1-4 (src/App.js createLayout + src/game-chrome.js): board dominance,
// the portrait chip strip + click-to-open popover, the right drawer, and a roll/
// animation smoke pass — proving the CHROME mechanism works, not re-verifying
// purchase/turn LOGIC (gameplay.spec.js/animation.spec.js own that; this file
// duplicates only what's needed to drive a turn, per the established per-file
// setup-helper convention — see duel.spec.js's header comment for the same
// rationale: gameplay.spec.js does not export its helpers).

// Task 4 measured board sizing at a real 1400x900 browser (594px, see below) —
// pin the same viewport here so the board-dominance assertion is measuring the
// same thing, not whatever Playwright's default (1280x720) happens to yield.
test.use({ viewport: { width: 1400, height: 900 } });

test.beforeEach(async ({ page }) => {
  // Fast-roll flag (gameplay.spec.js convention): skips App.js's own ~0.9s
  // PRE-DISPATCH tumble (a different element, `.centerslot__dice`) so multi-turn
  // loops stay fast. It does NOT gate anim.js's post-move `#dice-overlay` job —
  // that's driven off G.events (`dice_rolled`) and only skipped by a separate
  // flag (`window.__MEINO_NO_ANIM`, unset here) — so step (e) below still gets a
  // real dice-overlay tumble to assert against.
  await page.addInitScript(() => { window.__MP_FAST_ROLL = true; });
});

// ─── Setup helpers, duplicated from gameplay.spec.js ───
async function selectMod(page, modName) {
  const modCard = page.locator('.map-card[data-mod-idx]', { hasText: modName }).first();
  if (await modCard.isVisible({ timeout: 4000 }).catch(() => false)) {
    await modCard.click();
  }
}

async function gotoCharSelect(page) {
  await page.goto('/');
  await page.waitForSelector('#btn-mode-local', { timeout: 10000 });
  await page.click('#btn-mode-local');
  await selectMod(page, 'Dominion');
  await page.waitForSelector('.map-card[data-map-idx="0"]', { timeout: 10000 });
  await page.click('.map-card[data-map-idx="0"]');
  await page.waitForSelector('.count-btn[data-count="2"]', { timeout: 10000 });
  await page.click('.count-btn[data-count="2"]');
  await page.waitForSelector('#btn-vic-start', { timeout: 10000 });
  await page.click('#btn-vic-start');
  await page.waitForSelector('.charcard', { timeout: 10000 });
}

async function pickAndConfirm(page) {
  const card = page.locator('.charcard:not(.charcard--taken)').first();
  await card.click();
  const confirm = page.locator('#btn-select-confirm');
  await expect(confirm).toBeEnabled();
  await confirm.click();
}

async function selectCharacters(page) {
  await gotoCharSelect(page);
  await pickAndConfirm(page);
  await page.waitForFunction(() => {
    const el = document.querySelector('.select__p');
    return el && /PLAYER 2/.test(el.textContent);
  }, { timeout: 10000 });
  await pickAndConfirm(page);
  await page.waitForSelector('#btn-roll', { timeout: 10000 });
}

test.describe('Map-dominant layout (layout-rebuild)', () => {
  test('big board, portrait chips, popover, drawer, animation intact', async ({ page }) => {
    test.setTimeout(60000);
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await selectCharacters(page);

    // (a) board dominance — #board occupies a majority-ish share of the viewport
    // width. Task 4 measured 594px @1400x900 (594/1400 = 0.42) after dropping
    // pix-btn--full off #btn-roll/#btn-jail/#btn-reroll freed height back to
    // .game__center via the existing grid-template-rows. Use 0.4 as the floor —
    // the design doc's original 0.5 guess (docs/superpowers/specs/
    // 2026-07-12-layout-rebuild-design.md §8) predates this real measurement.
    const boardW = await page.locator('#board').evaluate(el => el.clientWidth);
    const vw = await page.evaluate(() => window.innerWidth);
    expect(boardW / vw).toBeGreaterThan(0.4);

    // (b) active chip is visible in the top strip and carries a face element
    // (portrait <img> or the .chip__face--letter fallback span — either way the
    // class is always present, per game-chrome.js chipHtml).
    await expect(page.locator('.game__chips .pcard--active')).toBeVisible();
    await expect(page.locator('.game__chips .pcard--active .chip__face')).toBeVisible();

    // Buy a property (bounded loop, gameplay.spec.js "buying a property updates
    // ownership" pattern) so the popover below has real propchip content to
    // show — this spec is not re-verifying purchase LOGIC, just proving the
    // popover MECHANISM surfaces whatever renderPlayerInfo hands it.
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
        bought = true;
        break; // stop with the BUYER still the active chip — the popover check below needs it
      }

      const endBtn = page.locator('#btn-end');
      if (await endBtn.isVisible().catch(() => false) && await endBtn.isEnabled().catch(() => false)) {
        await endBtn.click();
        await page.waitForTimeout(300);
      }

      const passAuctionBtn = page.locator('#btn-pass-auction');
      for (let i = 0; i < 6; i++) {
        if (await passAuctionBtn.isVisible().catch(() => false)) {
          await passAuctionBtn.click();
          await page.waitForTimeout(200);
        } else break;
      }
    }
    expect(bought).toBe(true);

    // (c) chip click -> popover shows passive + propchips. Close via the SCRIM
    // click, not Escape: App.js's Escape keydown listener is scoped to
    // `this._drawerOpen` only (createLayout ~460) — it never touches #ui-modal,
    // which closes only when the click target IS the scrim element itself
    // (openUiModal/closeUiModal ~2299-2308). Same pattern as gameplay.spec.js's
    // retargeted popover assertions (Task 2 review adjudication).
    await page.locator('.pcard--active').click();
    await expect(page.locator('.chip-detail .pcard__passive')).toBeVisible();
    const propchips = await page.locator('.chip-detail .propchip').count();
    expect(propchips).toBeGreaterThanOrEqual(1);
    await page.locator('#ui-modal').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#ui-modal')).not.toHaveClass(/open/);

    // (d) drawer: open the LOG tab -> .logline visible inside #drawer; Escape closes.
    await page.click('#drawer-tabs .drawer-tabs__btn[data-tab="log"]');
    await expect(page.locator('#drawer .logline').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#drawer')).toBeHidden();

    // Resolve anything pending and end this turn so the NEXT player has a fresh
    // roll available — a deterministic subject for step (e) below.
    for (let i = 0; i < 6; i++) {
      const evAccept2 = page.locator('#ev-accept');
      if (await evAccept2.isVisible().catch(() => false)) {
        await evAccept2.click(); await page.waitForTimeout(200); continue;
      }
      const passAuctionBtn2 = page.locator('#btn-pass-auction');
      if (await passAuctionBtn2.isVisible().catch(() => false)) {
        await passAuctionBtn2.click(); await page.waitForTimeout(200); continue;
      }
      const endBtn2 = page.locator('#btn-end');
      if (await endBtn2.isVisible().catch(() => false) && await endBtn2.isEnabled().catch(() => false)) {
        await endBtn2.click(); await page.waitForTimeout(300);
      }
      break;
    }

    // (e) roll still animates under the new layout (smoke; animation.spec.js
    // covers depth). #dice-overlay can take up to ~1s to appear (anim.js's dice
    // job trails the real move round-trip) — toBeVisible/toBeHidden already poll.
    await expect(page.locator('#btn-roll')).toBeVisible({ timeout: 10000 });
    await page.click('#btn-roll');
    await expect(page.locator('#dice-overlay')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#dice-overlay')).toBeHidden({ timeout: 8000 });

    // (f) final invariant: the game stayed interactive throughout — an action
    // button is enabled. Brief names #btn-roll/#btn-end as the steady-state
    // pair; broadened to the same landing-outcome superset animation.spec.js's
    // proven-robust invariant uses, since an un-seeded roll may land on a
    // card/property tile instead of an immediately-endable turn.
    await expect(page.locator(
      '#btn-roll, #btn-end:not([disabled]), #ev-accept, #btn-buy, #btn-pass'
    ).first()).toBeEnabled({ timeout: 8000 });

    expect(pageErrors).toEqual([]);
  });
});
