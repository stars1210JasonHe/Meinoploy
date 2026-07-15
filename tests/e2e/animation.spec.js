const { test, expect } = require('@playwright/test');

// Animations ON (no __MEINO_NO_ANIM, no __MP_FAST_ROLL): this is the one E2E spec
// that exercises the real presentation path added by the experience wave —
// #dice-overlay tumble + .token hop (src/anim.js's createAnimator, wired up in
// src/App.js's _makeAnimStage/_ensureAnimator). Every other spec in this suite sets
// window.__MP_FAST_ROLL = true (see gameplay.spec.js's beforeEach) to skip the
// cosmetic roll entirely for speed; this file deliberately does NOT, so it is the
// only place the animation pipeline actually runs end-to-end in a browser.
//
// Timings (src/anim.js): DICE_TUMBLE_MS=700 + DICE_HOLD_MS=400 = ~1.1s dice-overlay
// window, then HOP_MS=160ms per tile walked. App.js's own pre-dispatch cosmetic
// tumble (_animateRollThenMove, ~0.9s) runs BEFORE the move is even sent, so the
// overlay can take up to ~1s to appear after the click. All waits below are
// generous polls against these real, known durations — tolerance, not flake-hiding,
// since animations are presentation-only and never gate game state.

// ─── Setup helpers, copied verbatim from tests/e2e/gameplay.spec.js ───
// (gameplay.spec.js does not export these, and that file's beforeEach sets
// __MP_FAST_ROLL — incompatible with this spec — so the flow is duplicated here
// rather than imported. Keep in sync manually if the entry-UI flow changes.)

async function selectMod(page, modName) {
  const modCard = page.locator('.map-card[data-mod-idx]', { hasText: modName }).first();
  if (await modCard.isVisible({ timeout: 4000 }).catch(() => false)) {
    await modCard.click();
  }
}

async function gotoCharSelect(page) {
  await page.goto('/');

  // 1. Hero start screen
  await page.waitForSelector('#btn-mode-local', { timeout: 10000 });
  await page.click('#btn-mode-local');

  // 1b. Mod select — pick Dominion (classic map lives under this mod)
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

async function pickAndConfirm(page) {
  const card = page.locator('.charcard:not(.charcard--taken)').first();
  await card.click();
  const confirm = page.locator('#btn-select-confirm');
  await expect(confirm).toBeEnabled();
  await confirm.click();
}

// Locale pin (localization task 5): this file's assertions don't read any locale
// string directly, but it shares gameplay.spec.js's navigation flow verbatim (see
// the header comment) — pin 'en' for consistency with every other spec and so a
// future text-locked assertion added here doesn't silently depend on the DEFAULT
// locale. Deliberately does NOT set __MP_FAST_ROLL (this file's whole point is the
// real, un-skipped animation pipeline — see the header comment).
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.localStorage.setItem('meinopoly_locale', 'en'); });
});

async function selectCharacters(page) {
  await gotoCharSelect(page);

  // Player 1
  await pickAndConfirm(page);
  // Player 2 — wait for the screen to advance before picking
  await page.waitForFunction(() => {
    const el = document.querySelector('.select__p');
    return el && /PLAYER 2/.test(el.textContent);
  }, { timeout: 10000 });
  await pickAndConfirm(page);

  // Game board appears
  await page.waitForSelector('#btn-roll', { timeout: 10000 });
}

test('dice overlay tumbles and token hops on roll, game stays interactive throughout', async ({ page }) => {
  test.setTimeout(45000);

  await selectCharacters(page);

  // Player 1 (id "0") starts on GO; both players' tokens live in the persistent
  // #token-layer overlay (see App.js renderTokens doc comment).
  const token = page.locator('.token[data-player="0"]');
  await expect(token).toBeVisible();
  const before = await token.evaluate(el => ({ left: el.style.left, top: el.style.top }));

  await page.click('#btn-roll');

  // Dice overlay shows during the tumble window. It can take up to ~1s to appear
  // (App.js's pre-dispatch cosmetic tumble runs first, then the real move
  // round-trips before anim.js's dice_rolled-driven diceStart() fires) — poll
  // generously rather than asserting immediately.
  await expect(page.locator('#dice-overlay')).toBeVisible({ timeout: 8000 });

  // Fix 2 regression guard (enqueue-claim ownership, src/anim.js + App.js's
  // _makeAnimStage.hopQueued): while the dice overlay is visible — the whole
  // ~1.1s tumble+hold window — the token must sit at its ORIGIN, not its
  // destination. Before the fix, the hop job only claimed (and held) the token
  // once IT started playing, i.e. AFTER the dice job finished; renderTokens has
  // no ownership guard until that claim exists, so it painted the token at the
  // final G-state destination for the entire dice window, then it visibly
  // snapped back to path[0] to begin the walk. Capture now, assert against the
  // settled position below. NOTE: asserting `duringOverlay === before` instead
  // would be wrong — `before` carries renderTokens' peer-stacking offset (both
  // players start clustered on GO, ±1.5%), while animation placements
  // (hopQueued/hopTo's place()) use raw space centers, so the two legitimately
  // differ by that offset even though both are "at GO".
  const duringOverlay = await token.evaluate(el => ({ left: el.style.left, top: el.style.top }));

  // Overlay hides after tumble+hold (700+400ms per anim.js); poll generously.
  await expect(page.locator('#dice-overlay')).toBeHidden({ timeout: 8000 });
  // Token ended somewhere new (a roll off GO always moves) — the hop itself runs
  // AFTER the overlay hides (anim.js finishes the dice job, then starts the hop
  // job), so this assertion legitimately follows the overlay-hidden assertion.
  await expect.poll(async () => {
    const after = await token.evaluate(el => ({ left: el.style.left, top: el.style.top }));
    return after.left !== before.left || after.top !== before.top;
  }, { timeout: 8000 }).toBe(true);

  // Wait for the walk to fully settle: hopTo rewrites style.left/top every
  // HOP_MS=160ms while walking, so two samples 250ms apart only match once the
  // walk is over (max walk off GO = 12 tiles ≈ 1.9s; poll bound is generous).
  await expect.poll(async () => {
    const a = await token.evaluate(el => ({ left: el.style.left, top: el.style.top }));
    await page.waitForTimeout(250);
    const b = await token.evaluate(el => ({ left: el.style.left, top: el.style.top }));
    return a.left === b.left && a.top === b.top;
  }, { timeout: 8000 }).toBe(true);
  // The reviewer-prescribed enqueue-claim assertion: the position held during
  // the dice window must NOT be the final settled destination. If the claim
  // regresses to hop-start time, renderTokens paints the destination during
  // the overlay window, duringOverlay === settled, and this fails.
  const settled = await token.evaluate(el => ({ left: el.style.left, top: el.style.top }));
  expect(settled).not.toEqual(duringOverlay);

  // Invariant: the game stayed fully interactive throughout the whole tumble+hop
  // sequence — no animation-driven lock on the controls. Exactly one of these is
  // the legitimate next action after a first roll from GO (no properties owned
  // yet, so no auction/trade is reachable): #btn-roll reappears enabled on a
  // doubles re-roll, #ev-accept on a drawn card, #btn-buy/#btn-pass on a
  // purchasable tile, or #btn-end once nothing else is pending.
  await expect(page.locator(
    '#btn-roll, #btn-end:not([disabled]), #ev-accept, #btn-buy, #btn-pass'
  ).first()).toBeEnabled({ timeout: 8000 });
});
