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

// `count` defaults to 2 (the original single-test flow); the gate-recalibration
// discriminating test below (final fix wave) drives this at count=6 to prove
// the chip strip stays a single row at a count high enough to force
// overflow-x, not just at 2 players where a vertical-stack bug would have
// been subtle (96px tall strip) instead of board-collapsing (480px at 10).
async function gotoCharSelect(page, count = 2) {
  await page.goto('/');
  await page.waitForSelector('#btn-mode-local', { timeout: 10000 });
  await page.click('#btn-mode-local');
  await selectMod(page, 'Dominion');
  await page.waitForSelector('.map-card[data-map-idx="0"]', { timeout: 10000 });
  await page.click('.map-card[data-map-idx="0"]');
  await page.waitForSelector(`.count-btn[data-count="${count}"]`, { timeout: 10000 });
  await page.click(`.count-btn[data-count="${count}"]`);
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

async function selectCharacters(page, count = 2) {
  await gotoCharSelect(page, count);
  for (let i = 0; i < count; i++) {
    await pickAndConfirm(page);
    if (i < count - 1) {
      const next = i + 2;
      await page.waitForFunction((n) => {
        const el = document.querySelector('.select__p');
        return el && new RegExp(`PLAYER ${n}`).test(el.textContent);
      }, next, { timeout: 10000 });
    }
  }
  await page.waitForSelector('#btn-roll', { timeout: 10000 });
}

test.describe('Map-dominant layout (layout-rebuild)', () => {
  test('big board, portrait chips, popover, drawer, animation intact', async ({ page }) => {
    test.setTimeout(60000);
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await selectCharacters(page);

    // (a0) LOG tab unread dot (q2): character select's "All characters
    // selected! Game begins!" logline (src/events.js formatEventMessage,
    // character_selected/allSelected) already exists in G.messages at this
    // point and the drawer has never been opened — deterministic proof the
    // dot lights from real unseen state, not a hardcoded flag.
    await expect(page.locator('.drawer-tabs__btn[data-tab="log"]')).toHaveClass(/drawer-tabs__btn--unread/);

    // (a) board dominance — #board occupies a majority-ish share of the viewport
    // width. The 594px/0.42 figure this comment used to cite was WRONG — it
    // encoded the Critical chip-column bug (final fix wave): #player-info was a
    // plain block inside the flex .game__chips, so .pcard--chip elements stacked
    // VERTICALLY, and even at 2 players that tall strip ate enough height that
    // the "measured" board undershot what the layout actually delivers once
    // chips render as a real horizontal strip (`#player-info { display:contents }`
    // fix). Re-measured post-fix, real 1400x900 Chromium, 2 players: #board
    // clientWidth = 642px (642/1400 = 0.459). Floor set to 0.44, just under the
    // measured ratio.
    const boardW = await page.locator('#board').evaluate(el => el.clientWidth);
    const vw = await page.evaluate(() => window.innerWidth);
    expect(boardW / vw).toBeGreaterThan(0.44);

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
    // (d2) opening the LOG tab clears the unread dot (q2) — _openDrawer('log')
    // snapshots this._logSeenCount to the current G.messages.length.
    await expect(page.locator('.drawer-tabs__btn[data-tab="log"]')).not.toHaveClass(/drawer-tabs__btn--unread/);
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

  // Gate recalibration (final fix wave): this is the assertion that would have
  // caught the Critical. At 2 players the chip-column bug was subtle (a 96px
  // vertical strip barely dented the board); it only became board-collapsing
  // at high player counts (480px tall at 10). Drive 6 players — enough to
  // force horizontal overflow in the chip strip at 1400px — and assert every
  // .pcard--chip shares one offsetTop (a real single-row horizontal strip, not
  // a column) AND the board-dominance floor still holds at that count.
  test('6-player chip strip stays a single row and board dominance holds', async ({ page }) => {
    test.setTimeout(60000);
    await selectCharacters(page, 6);

    const chips = page.locator('.game__chips .pcard--chip');
    await expect(chips).toHaveCount(6);
    const tops = await chips.evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().top)));
    const uniqueTops = [...new Set(tops)];
    expect(uniqueTops.length).toBe(1); // single row, not a stacked column

    const boardW = await page.locator('#board').evaluate(el => el.clientWidth);
    const vw = await page.evaluate(() => window.innerWidth);
    // Same 0.44 floor as the 2-player test (a) — proves the board doesn't
    // collapse as player count grows, which is exactly what the Critical did.
    expect(boardW / vw).toBeGreaterThan(0.44);
  });
});
