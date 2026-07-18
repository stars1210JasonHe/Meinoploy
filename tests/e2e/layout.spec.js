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
  // Locale pin (localization task 5): this file's assertions are text-locked to
  // pre-i18n EN literals (e.g. 'Mediterranean Ave', '$60', 'CHOOSE YOUR ROUTE' —
  // see gameplay.spec.js's identical comment for the full rationale). Set before
  // the app boots, alongside the existing fast-roll flag.
  //
  // Fast-roll flag (gameplay.spec.js convention): skips App.js's own ~0.9s
  // PRE-DISPATCH tumble (a different element, `.centerslot__dice`) so multi-turn
  // loops stay fast. It does NOT gate anim.js's post-move `#dice-overlay` job —
  // that's driven off G.events (`dice_rolled`) and only skipped by a separate
  // flag (`window.__MEINO_NO_ANIM`, unset here) — so step (e) below still gets a
  // real dice-overlay tumble to assert against.
  await page.addInitScript(() => {
    window.localStorage.setItem('meinopoly_locale', 'en');
    window.__MP_FAST_ROLL = true;
  });
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
    // Owner acceptance fix wave, Fix 3 (wide-screen gutter mode): the file's
    // pinned 1400x900 default now crosses the new >=300px-per-side gutter
    // threshold (the rest-state board already left a ~342px gutter at that
    // width even before Fix 3 — see the "Wide-screen gutter mode" describe
    // block below), which would move the chip strip into a LEFT-gutter
    // COLUMN and auto-open the drawer — both of which this test's assertions
    // (a0's "drawer never opened yet" premise, the single-row/hover-reveal
    // chip mechanics later in this file) assume are OFF. This test is about
    // chrome MECHANISM (popover/drawer/animation), not gutter layout — pin it
    // narrow so it keeps exercising exactly what it always has; the new
    // gutter-specific behavior gets its own dedicated tests below.
    await page.setViewportSize({ width: 1180, height: 900 });
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
    // width. History: a 594px/0.42 figure (Critical chip-column bug,
    // #player-info stacking vertically) was superseded by the
    // `#player-info { display:contents }` fix (642px/0.459, floor 0.44).
    // Task 4 (fullscreen-stage wave) recalibrates again: the full-bleed layout
    // (task-2-report.md) plus the chrome-bands fix (task-2-report.md "Fix:
    // chrome bands" — App.js `_syncChromeBands()` measures the REAL rendered
    // height of `.game__chips`/`.game__actionbar` every render and writes
    // `--chrome-top`/`--chrome-bottom` custom props that `.app--game .board`
    // subtracts from `100dvh`) grows the board to **715x715 at 1400x900** in
    // the pre-roll rest state this assertion runs in (chrome-top 76px,
    // chrome-bottom 109px) — 715/1400 = 0.511. Floor set to 0.49: just under
    // the measured 0.511 (~2pt headroom for cross-run font/scrollbar jitter)
    // and still a real regression trip-wire — it would catch a collapse back
    // toward the pre-Task-4 642px/0.459 baseline, unlike the old 0.44 floor
    // which sat below both.
    const boardW = await page.locator('#board').evaluate(el => el.clientWidth);
    const vw = await page.evaluate(() => window.innerWidth);
    expect(boardW / vw).toBeGreaterThan(0.49);

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
    // Owner acceptance fix wave, Fix 3: same narrow pin as the test above and
    // for the same reason — this test specifically proves the chip strip is a
    // single ROW, which is the <300px-gutter (today's) layout; Fix 3's gutter
    // mode intentionally turns the strip into a COLUMN above the threshold, so
    // pin below it to keep testing what this test is actually about.
    await page.setViewportSize({ width: 1180, height: 900 });
    await selectCharacters(page, 6);

    const chips = page.locator('.game__chips .pcard--chip');
    await expect(chips).toHaveCount(6);
    const tops = await chips.evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().top)));
    const uniqueTops = [...new Set(tops)];
    expect(uniqueTops.length).toBe(1); // single row, not a stacked column

    const boardW = await page.locator('#board').evaluate(el => el.clientWidth);
    const vw = await page.evaluate(() => window.innerWidth);
    // Same 0.49 floor as the 2-player test (a) — proves the board doesn't
    // collapse as player count grows, which is exactly what the Critical did.
    // `--chrome-top` is constant across player counts (task-2-report.md: chips
    // only vary by count via the display:contents single-row fix, not height),
    // so the 715px/0.511 rest-state measurement applies here too.
    expect(boardW / vw).toBeGreaterThan(0.49);
  });
});

// ─── Task 4: full-bleed geometry, auto-hide topbar, slim chips, popovers ───
//
// Globe always-on route network (spec §2.6): NOT probed here. The flat-atlas
// equivalent already has a pre-roll `.board__edges` assertion (gameplay.spec.js
// "atlas map: Terra Circuit renders and is playable") — not duplicated. A
// globe-side JS probe would need `this._globe.arcsData()` (globe.gl's live
// arcs accessor), but App.js never exposes the MonopolyBoard instance (or
// `this._globe`) on `window` — `new MonopolyBoard(appElement)` at the bottom
// of App.js discards its return value — so there is no one-line
// `page.evaluate` reach to it. Skipped per the brief's own fallback; verified
// only manually (task-3-report.md: "arcs clearly visible pre-roll" screenshot).
test.describe('Fullscreen stage (Task 4)', () => {
  test('full-bleed geometry: zero board/chrome overlap, topbar auto-hide + reveal, chips slim, #btn-fs', async ({ page }) => {
    test.setTimeout(30000);
    // Owner acceptance fix wave, Fix 3: pin narrow, same reasoning as the two
    // tests above. This test's zero-overlap assertion assumes the ROW layout
    // (chips ABOVE the board, action bar BELOW it) and its slim-chip
    // assertion assumes the HOVER-reveal mechanic — both are the <300px-
    // gutter behavior; gutter mode replaces both intentionally above the
    // threshold and gets its own zero-overlap + always-visible-info
    // assertions in the "Wide-screen gutter mode" describe block below.
    await page.setViewportSize({ width: 1180, height: 900 });
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await selectCharacters(page);

    // ZERO-OVERLAP invariant — stronger than a pixel pin since the chrome
    // bands are dynamic (_syncChromeBands() re-measures every render): the
    // board must never sit underneath either floating bar. board top >= chips
    // bottom, board bottom <= actionbar top (1px slop for sub-pixel rounding).
    const chipsRect = await page.locator('.game__chips').evaluate(el => el.getBoundingClientRect());
    const boardRect = await page.locator('#board').evaluate(el => el.getBoundingClientRect());
    const actionbarRect = await page.locator('.game__actionbar').evaluate(el => el.getBoundingClientRect());
    expect(boardRect.top).toBeGreaterThanOrEqual(chipsRect.bottom - 1);
    expect(boardRect.bottom).toBeLessThanOrEqual(actionbarRect.top + 1);

    // Topbar hidden at rest — rect fully off-viewport (translateY(-100%)).
    // App.js createLayout wires a document-level `mousemove` listener that
    // toggles .topbar--show (a live poll of cursor-vs-hotzone/topbar rects,
    // NOT a mouseenter/mouseleave pair — see index.html's #topbar-hotzone
    // comment for why that naive version gets stuck open). index.html gives
    // the transform a 150ms transition, which starts the instant `.app--game`
    // is added (character-select's last click races the game screen showing
    // up) — measured live: reading the rect immediately after `#btn-roll`
    // appears caught the topbar MID-transition (y+height ~30px, not ~0).
    // Wait out the transition + a small buffer before asserting "at rest".
    const topbar = page.locator('.topbar');
    await page.waitForTimeout(250);
    let tbRect = await topbar.boundingBox();
    expect(tbRect.y + tbRect.height).toBeLessThanOrEqual(1);
    await expect(topbar).not.toHaveClass(/topbar--show/);

    // Revealed by a real mousemove into the 10px top hot-zone (#topbar-hotzone).
    // The class toggles synchronously on the mousemove listener, but the
    // geometry follows the same 150ms CSS transition as above — wait it out
    // before reading the rect (measured live: reading immediately after the
    // class-toggle assertion still returned y=-45.8, the fully-hidden value).
    await page.mouse.move(700, 5);
    await expect(topbar).toHaveClass(/topbar--show/);
    await page.waitForTimeout(250);
    tbRect = await topbar.boundingBox();
    expect(tbRect.y).toBeGreaterThanOrEqual(-1);
    expect(tbRect.y).toBeLessThanOrEqual(2);

    // Moving away hides it again (a live poll has no event-history to get stuck on).
    await page.mouse.move(700, 500);
    await expect(topbar).not.toHaveClass(/topbar--show/);

    // Chips slim at rest: .pcard__name hidden; chip :hover reveals it (pure
    // CSS — index.html `.app--game .pcard--chip:hover .pcard__name`).
    const activeName = page.locator('.game__chips .pcard--active .pcard__name');
    await expect(activeName).toBeHidden();
    await page.locator('.game__chips .pcard--active').hover();
    await expect(activeName).toBeVisible();

    // #btn-fs present in the floating action bar. True Fullscreen API can't
    // be asserted headless (spec §4) — assert only that the click doesn't
    // throw; the fullscreen promise itself may reject under a headless/
    // no-window-manager sandbox (an environment property, not something this
    // wave's code controls).
    const fsBtn = page.locator('#btn-fs');
    await expect(fsBtn).toBeVisible();
    let threw = false;
    try { await fsBtn.click(); } catch (e) { threw = true; }
    expect(threw).toBe(false);

    expect(pageErrors).toEqual([]);
  });

  test('tile popover: unowned shows name + price, Escape closes; bought tile shows owner', async ({ page }) => {
    test.setTimeout(60000);
    await selectCharacters(page);

    // Unowned tile — classic space 1, "Mediterranean Ave" $60 (mods/dominion/
    // board.js), clicked pre-roll so it is guaranteed unowned. No token sits
    // here yet either (both players start at GO/space 0).
    await page.locator('.tile[data-space="1"]').click();
    await expect(page.locator('.tile-detail')).toBeVisible();
    await expect(page.locator('.tile-detail__name')).toHaveText('Mediterranean Ave');
    await expect(page.locator('.tile-detail__price')).toHaveText('$60');
    await expect(page.locator('.tile-detail__owner--unowned')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#ui-modal')).not.toHaveClass(/open/);

    // Buy a property (bounded loop, same pattern as the (c) chip-popover test
    // above) — stops with the buyer still active, so the popover checks below
    // have a real owned tile to inspect.
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
        break;
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

    // Click the now-owned tile (`.tile--owned`, App.js _tileHtml). Clicked
    // near a corner, not dead-center: the buyer's OWN token (App.js
    // renderTokens) sits exactly at the tile's computed center and is
    // z-layered above the tile grid (#token-layer, z:5) — the board's
    // delegated click handler gives `.token[data-player]` absolute priority
    // (task-3-report.md Concern #3 / the flat-route-priority fix documents
    // the same token-over-tile precedence for route targets), so a dead-
    // center click here would open the PLAYER popover instead of the tile
    // one. A corner click reaches the tile itself.
    await page.locator('.tile--owned').first().click({ position: { x: 5, y: 5 } });
    await expect(page.locator('.tile-detail')).toBeVisible();
    await expect(page.locator('.tile-detail__owner-name')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#ui-modal')).not.toHaveClass(/open/);

    // Token popover (spec §2.5b) — the buyer has now moved off GO, so their
    // token no longer overlaps the other (still-at-GO) player's token.
    // data-chip on the active chip and data-player on its token share the
    // same player index (game-chrome.js chipHtml / App.js renderTokens).
    // { force: true }: the CURRENT-TURN token carries `.token--turn`, which
    // index.html gives an infinite `token-bob 0.9s ease-in-out infinite`
    // animation (a deliberate always-on visual cue, index.html ~616-641) —
    // measured live: a plain .click() hung for the full 60s timeout on
    // Playwright's "element is not stable" actionability check, which by
    // design never succeeds against a perpetually-animating element. force
    // skips only the stability wait; nothing else covers this token here (no
    // route-pick, no other player's token on this tile), so the click still
    // lands on the real element.
    const activeIdx = await page.locator('.game__chips .pcard--active').getAttribute('data-chip');
    await page.locator(`.token[data-player="${activeIdx}"]`).click({ force: true });
    await expect(page.locator('.chip-detail')).toBeVisible();
    await expect(page.locator('.chip-detail .pcard__name')).toBeVisible();
    await expect(page.locator('.chip-detail__lore')).toBeVisible(); // every mod ships lore
    await page.keyboard.press('Escape');
    await expect(page.locator('#ui-modal')).not.toHaveClass(/open/);
  });
});

// ─── Owner acceptance fix wave: wide-screen gutter mode (Fix 3) ───
//
// >=300px-per-side gutter threshold (App.js _syncGutterMode). 1535x900 is
// comfortably above it (the rest-state board is height-driven — ~776-900px
// per the chrome-band math below — leaving a wide gutter at this width);
// scoped to its own describe block via test.use so it doesn't affect the
// narrower-pinned tests above (which deliberately test the <300px fallback).
test.describe('Wide-screen gutter mode (Fix 3)', () => {
  test.use({ viewport: { width: 1535, height: 900 } });

  test('chips column fills the left gutter, drawer is a persistent right-gutter panel, board grows, zero overlap', async ({ page }) => {
    test.setTimeout(30000);
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await selectCharacters(page);

    // Gutter mode ON at this width (App.js _syncGutterMode toggles this class
    // on #game-area once the measured per-side gutter clears 300px).
    await expect(page.locator('#game-area')).toHaveClass(/game--gutters/);

    const chipsRect = await page.locator('.game__chips').evaluate(el => el.getBoundingClientRect());
    const boardRect = await page.locator('#board').evaluate(el => el.getBoundingClientRect());
    const drawerRect = await page.locator('#drawer').evaluate(el => el.getBoundingClientRect());
    // Redesign B: the action bar leaves the bottom-center floating position
    // and docks into the SAME left rail as the chip column, below it —
    // extend the zero-overlap invariant to cover it too (this is the
    // regression surface for a rail mis-position: an action bar that
    // overlapped the board here would previously have been invisible to
    // this test, since it only ever checked chips/drawer).
    const actionbarRect = await page.locator('.game__actionbar').evaluate(el => el.getBoundingClientRect());

    // Zero-overlap invariant, gutter-mode flavor (must hold in BOTH modes,
    // per the brief): the chip column sits fully left of the board, the
    // drawer panel fully right of it — neither ever renders under the board.
    expect(chipsRect.right).toBeLessThanOrEqual(boardRect.left + 1);
    expect(drawerRect.left).toBeGreaterThanOrEqual(boardRect.right - 1);
    expect(actionbarRect.right).toBeLessThanOrEqual(boardRect.left + 1);
    // ...and sits BELOW the chip column within that same rail, not overlapping it.
    expect(actionbarRect.top).toBeGreaterThanOrEqual(chipsRect.bottom - 1);

    // Full chip info visible WITHOUT hover — the narrow-mode hover-reveal
    // mechanic (tested at 1180x900 above) is overridden in gutter mode.
    const activeName = page.locator('.game__chips .pcard--active .pcard__name');
    await expect(activeName).toBeVisible();

    // Drawer auto-opens (LOG tab) on gutter-mode entry — a persistent panel,
    // not an overlay the user has to open themselves.
    await expect(page.locator('#drawer')).not.toBeHidden();
    await expect(page.locator('.drawer-tabs__btn[data-tab="log"]')).toHaveClass(/drawer-tabs__btn--active/);

    // The user can still close it, and it does NOT get forced back open on
    // the next render — App.js _syncGutterMode only auto-opens on the
    // mode-ENTRY transition (on && !wasOn), not every render. Closed via
    // Escape, not a second tab click: `#drawer-tabs` (positioned `right:0`
    // inside the viewport-spanning `.game__center`) sits at the same right
    // edge the open drawer panel occupies in EVERY mode — narrow or gutter —
    // so a click aimed at the tab rail while the drawer is genuinely open
    // there hits the drawer panel first (Playwright: "#drawer intercepts
    // pointer events"), a PRE-EXISTING overlap this fix wave did not touch
    // (every other drawer-close in this file already goes through Escape,
    // never a second tab click on an open drawer — see test (d) above).
    await page.keyboard.press('Escape');
    await expect(page.locator('#drawer')).toBeHidden();
    await page.locator('.pcard--active').click(); // trigger another state render
    await expect(page.locator('.chip-detail')).toBeVisible();
    await page.locator('#ui-modal').click({ position: { x: 5, y: 5 } });
    await expect(page.locator('#drawer')).toBeHidden();

    // Board grows once the chip strip stops eating a horizontal TOP band
    // (--chrome-top shrinks to a fixed offset instead of the chip strip's
    // real height — see _syncChromeBands). Logged for the task report.
    const vw = await page.evaluate(() => window.innerWidth);
    console.log(`[gutter-mode] board px @${vw}x900: ${boardRect.width}`);
    expect(boardRect.width / vw).toBeGreaterThan(0.5);

    expect(pageErrors).toEqual([]);
  });
});

// ─── Owner acceptance fix wave: route-pick visibility + line tidiness (Fix 1 + Fix 2) ───
//
// Drives the Terra Circuit atlas world to a genuine multi-choice fork (reusing
// gameplay.spec.js's atlas-world setup/turn-resolution flow, duplicated per
// this file's own setup-helper convention — see the header comment) and
// asserts the NEW primary cue (#route-banner) is visible, the base edge
// network is dimmed, and at least one edge is marked hot — then that
// everything clears immediately on commit. Runs at the file's default
// viewport (1400x900); the banner/edge mechanism is renderer/mode-agnostic
// (index.html: .game__center-scoped, gated purely by .game--routepick) so it
// doesn't matter whether gutter mode happens to be on or off at that width.
test.describe('Route-pick visibility + line tidiness (Fix 1 + Fix 2)', () => {
  async function selectCharactersAtlas(page) {
    await page.goto('/');
    await page.waitForSelector('#btn-mode-local', { timeout: 10000 });
    await page.click('#btn-mode-local');
    await selectMod(page, 'Dominion');
    await page.waitForSelector('.map-card[data-map-idx]', { timeout: 10000 });
    await page.locator('.map-card[data-map-idx]', { hasText: 'Terra Circuit' }).click();
    await page.waitForSelector('.count-btn[data-count="2"]', { timeout: 10000 });
    await page.click('.count-btn[data-count="2"]');
    await page.waitForSelector('#btn-vic-start', { timeout: 10000 });
    await page.click('#btn-vic-start');
    await page.waitForSelector('.charcard', { timeout: 10000 });
    await pickAndConfirm(page);
    await page.waitForFunction(() => {
      const el = document.querySelector('.select__p');
      return el && /PLAYER 2/.test(el.textContent);
    }, { timeout: 10000 });
    await pickAndConfirm(page);
    await page.waitForSelector('#btn-roll', { timeout: 10000 });
  }

  test('route banner + pulse are the primary cue at a fork; base network dims, fork edges pop', async ({ page }) => {
    test.setTimeout(60000);
    await selectCharactersAtlas(page);

    let forkSeen = false;
    for (let turn = 0; turn < 40 && !forkSeen; turn++) {
      const rollBtn = page.locator('#btn-roll');
      if (await rollBtn.isVisible().catch(() => false)) {
        await rollBtn.click();
        await page.waitForTimeout(1100); // wait out the ~0.9s dice animation + dispatch

        const target = page.locator('.tile--route-target').first();
        if (await target.isVisible().catch(() => false)) {
          forkSeen = true;

          // Fix 1: the banner is the primary "you're stuck here" cue — must
          // be genuinely visible (not merely present-but-dimmed like the
          // floating chip/action-bar chrome under routepick).
          await expect(page.locator('#game-area')).toHaveClass(/game--routepick/);
          await expect(page.locator('#route-banner')).toBeVisible();
          await expect(page.locator('#route-banner')).toHaveText(/CHOOSE YOUR ROUTE/);

          // Fix 2: base network dimmed, pending-fork edges lit (per-edge-hot
          // mechanism — data-from/data-to identity set at SVG build time,
          // edge--hot toggled by _resolveAtlasRoute).
          const hotEdges = await page.locator('.board__edges line.edge--hot').count();
          expect(hotEdges).toBeGreaterThan(0);
          const baseOpacity = await page.locator('.board__edges line:not(.edge--hot)').first()
            .evaluate(el => getComputedStyle(el).opacity).catch(() => null);
          if (baseOpacity !== null) expect(parseFloat(baseOpacity)).toBeLessThan(0.1);

          await target.click();
          await page.waitForTimeout(350);

          // Clears immediately on commit.
          await expect(page.locator('#game-area')).not.toHaveClass(/game--routepick/);
          await expect(page.locator('#route-banner')).toBeHidden();
          break;
        }
      }

      // No fork this roll — clear whatever resulted and move to the next
      // turn (same resolution steps as gameplay.spec.js's completeTurnAtlas).
      const evAccept = page.locator('#ev-accept');
      if (await evAccept.isVisible().catch(() => false)) { await evAccept.click(); await page.waitForTimeout(300); }
      const buyBtn = page.locator('#btn-buy');
      if (await buyBtn.isVisible().catch(() => false)) {
        await page.locator('#btn-pass').click();
        await page.waitForTimeout(300);
        const passAuctionBtn = page.locator('#btn-pass-auction');
        for (let i = 0; i < 6; i++) {
          if (await passAuctionBtn.isVisible().catch(() => false)) { await passAuctionBtn.click(); await page.waitForTimeout(200); }
          else break;
        }
      }
      const endBtn = page.locator('#btn-end');
      if (await endBtn.isVisible().catch(() => false) && await endBtn.isEnabled().catch(() => false)) {
        await endBtn.click();
        await page.waitForTimeout(300);
      }
    }

    expect(forkSeen).toBe(true);
  });
});

// ─── Redesign wave: rectangular atlas/globe canvas + locked board size ───
//
// Redesign A: atlas (flat, `renderMode` unset/'flat') and globe (`renderMode:
// 'globe'`) boards render on a RECTANGULAR canvas (`.board--rect`, index.html)
// that fills the available width AND height independently, instead of the
// classic square (`aspect-ratio:1/1`) board every other test in this file
// exercises — classic boards (grid/circle/hex/custom) are UNTOUCHED by this
// redesign and keep the existing square/board-dominance assertions above.
// Pinned to the same 1535x900 wide viewport as the gutter-mode describe block
// above: at that aspect ratio a height-driven SQUARE board tops out at
// 900px wide (900/1535 = 58.6%), so a rect board genuinely reclaiming the
// horizontal void is the regression this width is chosen to expose — the
// owner's "方块" ("why is it still basically square in the middle") complaint
// would NOT show at a narrower/near-square viewport.
test.describe('Rectangular atlas/globe canvas (Redesign A)', () => {
  test.use({ viewport: { width: 1535, height: 900 } });

  // Duplicated from the "Route-pick visibility" describe block's
  // selectCharactersAtlas above (this file's own established per-describe-block
  // setup-helper convention — see the file header comment), generalized to take
  // the map/world display name so it covers both the flat atlas world (Terra
  // Circuit) and the globe world (Terra Globe), which are both registered under
  // the same "Dominion" mod (mods/dominion/bundle.data.js `worlds:`).
  async function selectCharactersWorld(page, mapName) {
    await page.goto('/');
    await page.waitForSelector('#btn-mode-local', { timeout: 10000 });
    await page.click('#btn-mode-local');
    await selectMod(page, 'Dominion');
    await page.waitForSelector('.map-card[data-map-idx]', { timeout: 10000 });
    await page.locator('.map-card[data-map-idx]', { hasText: mapName }).click();
    await page.waitForSelector('.count-btn[data-count="2"]', { timeout: 10000 });
    await page.click('.count-btn[data-count="2"]');
    await page.waitForSelector('#btn-vic-start', { timeout: 10000 });
    await page.click('#btn-vic-start');
    await page.waitForSelector('.charcard', { timeout: 10000 });
    await pickAndConfirm(page);
    await page.waitForFunction(() => {
      const el = document.querySelector('.select__p');
      return el && /PLAYER 2/.test(el.textContent);
    }, { timeout: 10000 });
    await pickAndConfirm(page);
    await page.waitForSelector('#btn-roll', { timeout: 10000 });
  }

  // Measures the AVAILABLE rect .board--rect's own CSS formula (index.html)
  // targets — NOT the raw viewport. At 1535x900, gutter mode legitimately
  // activates for rect boards too (the same >=300px-per-side affordability
  // probe classic boards use — see App.js _syncGutterMode's isRect branch),
  // which reserves two fixed-width rails for the chip/action-bar column and
  // the drawer; "fills the rect" (the brief's own phrasing) means fills what
  // is actually left over after those rails, not 95% of the full viewport —
  // a board that also swallowed the rails would overlap the chip column/
  // drawer, which the OTHER zero-overlap tests in this file already forbid.
  // Reads the real CSS custom properties App.js writes (not a re-derived
  // hardcoded constant) so this can't silently drift from the mechanism.
  async function availableRect(page) {
    const vw = await page.evaluate(() => window.innerWidth);
    const vh = await page.evaluate(() => window.innerHeight);
    const gutters = await page.locator('#game-area').evaluate(el => el.classList.contains('game--gutters'));
    const gutterW = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter-w')) || 0);
    const chromeTop = await page.locator('#game-area').evaluate(el => parseFloat(getComputedStyle(el).getPropertyValue('--chrome-top')) || 0);
    const chromeBottom = await page.locator('#game-area').evaluate(el => parseFloat(getComputedStyle(el).getPropertyValue('--chrome-bottom')) || 0);
    const width = gutters ? (vw - gutterW * 2 - 24) : (vw - 24);
    const height = vh - chromeTop - chromeBottom;
    return { width, height, gutters, vw, vh };
  }

  test('flat atlas (Terra Circuit): board fills the available rect on both axes, tiles stay square', async ({ page }) => {
    test.setTimeout(30000);
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await selectCharactersWorld(page, 'Terra Circuit');

    await expect(page.locator('#board')).toHaveClass(/board--rect/);
    const boardRect = await page.locator('#board').evaluate(el => el.getBoundingClientRect());
    const avail = await availableRect(page);
    console.log(`[rect-canvas atlas] board px @${avail.vw}x${avail.vh} (gutters=${avail.gutters}): `
      + `${boardRect.width}x${boardRect.height}, avail ${avail.width}x${avail.height}`);
    expect(boardRect.width / avail.width).toBeGreaterThan(0.95);
    expect(boardRect.height / avail.height).toBeGreaterThan(0.95);

    // Tiles stay SQUARE (cqmin-sized off the board's own short axis — see
    // _renderAbsoluteBoard/index.html .board--rect) even though the board
    // itself is not — sample one rendered tile box.
    const tileBox = await page.locator('.tile[data-space]').first().evaluate(el => el.getBoundingClientRect());
    expect(Math.abs(tileBox.width - tileBox.height)).toBeLessThan(2);

    expect(pageErrors).toEqual([]);
  });

  test('globe (Terra Globe): board container fills the available rect on both axes', async ({ page }) => {
    test.setTimeout(30000);
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await selectCharactersWorld(page, 'Terra Globe');

    await expect(page.locator('#board')).toHaveClass(/board--rect/);
    await expect(page.locator('#board')).toHaveClass(/board--globe/);
    const boardRect = await page.locator('#board').evaluate(el => el.getBoundingClientRect());
    const avail = await availableRect(page);
    console.log(`[rect-canvas globe] board px @${avail.vw}x${avail.vh} (gutters=${avail.gutters}): `
      + `${boardRect.width}x${boardRect.height}, avail ${avail.width}x${avail.height}`);
    // Same measurement as the flat-atlas test above — the globe's WebGL
    // canvas is resized off the SAME #board container
    // (_ensureGlobeResizeObserver), so the container filling the available
    // rect is the load-bearing assertion; the sphere itself just ends up
    // centered with more visible sky, per the brief.
    expect(boardRect.width / avail.width).toBeGreaterThan(0.95);
    expect(boardRect.height / avail.height).toBeGreaterThan(0.95);

    expect(pageErrors).toEqual([]);
  });
});

// ─── Redesign wave: locked board size (Redesign B) ───
//
// Owner-confirmed bug: the board's bounding box deformed (742px -> 630px)
// after a single roll, because the old _syncChromeBands measured the action
// bar's REAL rendered height every update() tick, and that height genuinely
// varies with turn state (rest vs. jail vs. a pending card, etc — see
// src/App.js's CHROME_NARROW_TOP/BOTTOM doc comment for the full measured
// root cause). This is the regression test for exactly that bug: the board's
// bounding box must be BIT-IDENTICAL across a roll, a buy/pass resolution,
// and an end-turn — not just "close" or "still mostly square". Pinned to
// 1180x900 (narrow/floating-chrome mode, the same viewport the pre-existing
// "big board" tests above use) — this is where the bars float OVER the board
// and originally caused the deformation; wide-screen gutter mode was verified
// manually in the browser instead of duplicated here (per the task brief's
// own browser-verification step), since the rail's action bar has its own
// fixed max-height there (index.html `.game--gutters .game__actionbar`) and
// the same STATIC-constant mechanism applies either way.
test.describe('Locked board size (Redesign B)', () => {
  test('board bounding box is identical across roll, buy/pass, and end-turn', async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1180, height: 900 });
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await selectCharacters(page);

    const boardBox = () => page.locator('#board').evaluate(el => {
      const r = el.getBoundingClientRect();
      return { width: Math.round(r.width), height: Math.round(r.height) };
    });

    const before = await boardBox();
    console.log(`[lock] board px before roll: ${before.width}x${before.height}`);

    // Roll — the exact step that revealed the original deformation (a
    // taller/shorter turnbox state, e.g. a buy prompt appearing, changing the
    // action bar's real content height, which used to feed straight into the
    // board's height formula).
    await page.click('#btn-roll');
    await page.waitForTimeout(1100);
    const afterRoll = await boardBox();
    console.log(`[lock] board px after roll: ${afterRoll.width}x${afterRoll.height}`);
    expect(afterRoll).toEqual(before);

    // If a buy prompt appeared, resolve it (buy or pass) — same invariant.
    const buyBtn = page.locator('#btn-buy');
    const passBtn = page.locator('#btn-pass');
    if (await buyBtn.isVisible().catch(() => false)) {
      await buyBtn.click();
    } else if (await passBtn.isVisible().catch(() => false)) {
      await passBtn.click();
    }
    await page.waitForTimeout(400);
    const passAuctionBtn = page.locator('#btn-pass-auction');
    for (let i = 0; i < 6; i++) {
      if (await passAuctionBtn.isVisible().catch(() => false)) { await passAuctionBtn.click(); await page.waitForTimeout(200); }
      else break;
    }
    const afterBuy = await boardBox();
    console.log(`[lock] board px after buy/pass: ${afterBuy.width}x${afterBuy.height}`);
    expect(afterBuy).toEqual(before);

    // End turn (bounded resolve loop first, in case a card/auction is pending).
    for (let i = 0; i < 6; i++) {
      const evAccept = page.locator('#ev-accept');
      if (await evAccept.isVisible().catch(() => false)) { await evAccept.click(); await page.waitForTimeout(200); continue; }
      break;
    }
    const endBtn = page.locator('#btn-end');
    if (await endBtn.isVisible().catch(() => false) && await endBtn.isEnabled().catch(() => false)) {
      await endBtn.click();
      await page.waitForTimeout(300);
    }
    const afterEnd = await boardBox();
    console.log(`[lock] board px after end-turn: ${afterEnd.width}x${afterEnd.height}`);
    expect(afterEnd).toEqual(before);

    expect(pageErrors).toEqual([]);
  });
});

// ─── Rail actionbar content-sizing (dice-clip fix) ───
//
// Owner-reported, controller-probed: in gutter mode the vertical rail
// turnbox content genuinely reaches ~276px tall (probe @1890x920: turnbox
// rect t:662 b:938 vs the OLD actionbar rect t:742 b:912, viewport 920) while
// the rail actionbar clipped at a static max-height:170px worst-case reserve
// — the dice block's bottom ran past its own container, rendering half-
// hidden bottom-left. Fix (index.html `.game--gutters .game__actionbar` /
// `.game--gutters .game__chips`, App.js `_syncChromeBands`): the actionbar
// sizes to its REAL content and grows UPWARD from its bottom:8px rail anchor
// instead of clipping — it lives entirely in the rail so this never touches
// the board (the Redesign B deform-bug lock in the describe block above is
// untouched: gutter-mode --chrome-top/--chrome-bottom stay the flat
// CHROME_GUTTER_MARGIN constant regardless of the actionbar's real height).
// The chip column above it yields the same real height back via the
// measured `--rail-bar-h` custom prop instead of the old static 186px
// reserve. Originally driven on 三国志 (sanguo-excerpt) per the fix brief,
// but that mod is owner-WIP and NOT committed — on CI's clean checkout the
// mod card never renders and all three specs time out (first-CI-run find,
// 2026-07-18). Switched to Dominion's "Terra Circuit" world (the committed
// atlas flat-RECT board gameplay.spec's atlas tests already drive): it
// crosses the same >=300px-per-side gutter threshold (App.js
// `_syncGutterMode`'s rect-board probe) at these three viewports — the
// containment invariant under test is mod-agnostic.
test.describe('Rail actionbar content-sizing (dice-clip fix)', () => {
  async function selectCharactersAtlasRect(page, viewport) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await page.waitForSelector('#btn-mode-local', { timeout: 10000 });
    await page.click('#btn-mode-local');
    await selectMod(page, 'Dominion');
    await page.waitForSelector('.map-card[data-map-idx]', { timeout: 10000 });
    await page.locator('.map-card[data-map-idx]', { hasText: 'Terra Circuit' }).click();
    await page.waitForSelector('.count-btn[data-count="2"]', { timeout: 10000 });
    await page.click('.count-btn[data-count="2"]');
    await page.waitForSelector('#btn-vic-start', { timeout: 10000 });
    await page.click('#btn-vic-start');
    await page.waitForSelector('.charcard', { timeout: 10000 });
    await pickAndConfirm(page);
    await page.waitForFunction(() => {
      const el = document.querySelector('.select__p');
      return el && /PLAYER 2/.test(el.textContent);
    }, { timeout: 10000 });
    await pickAndConfirm(page);
    await page.waitForSelector('#btn-roll', { timeout: 10000 });
  }

  // Full containment probe — reused at rest AND after forcing a taller
  // (buy-prompt) turnbox state, the exact regression surface the owner hit.
  async function assertContainment(page, label) {
    const turnboxRect = await page.locator('#turnbox').evaluate(el => el.getBoundingClientRect());
    const actionbarRect = await page.locator('.game__actionbar').evaluate(el => el.getBoundingClientRect());
    const chipsRect = await page.locator('.game__chips').evaluate(el => el.getBoundingClientRect());
    const viewport = await page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    console.log(`[rail-clip ${label}] turnbox t:${Math.round(turnboxRect.top)} b:${Math.round(turnboxRect.bottom)} `
      + `| actionbar t:${Math.round(actionbarRect.top)} b:${Math.round(actionbarRect.bottom)} `
      + `| chips b:${Math.round(chipsRect.bottom)} | viewport ${viewport.w}x${viewport.h}`);

    // Turnbox fully inside the actionbar rail — the dice block never runs
    // past its own container again.
    expect(turnboxRect.top).toBeGreaterThanOrEqual(actionbarRect.top - 1);
    expect(turnboxRect.bottom).toBeLessThanOrEqual(actionbarRect.bottom + 1);
    expect(turnboxRect.left).toBeGreaterThanOrEqual(actionbarRect.left - 1);
    expect(turnboxRect.right).toBeLessThanOrEqual(actionbarRect.right + 1);

    // ...and fully inside the viewport — a container that itself ran
    // off-screen would pass the check above and still be a visible bug.
    expect(turnboxRect.top).toBeGreaterThanOrEqual(-1);
    expect(turnboxRect.left).toBeGreaterThanOrEqual(-1);
    expect(turnboxRect.bottom).toBeLessThanOrEqual(viewport.h + 1);
    expect(turnboxRect.right).toBeLessThanOrEqual(viewport.w + 1);

    // Zero-overlap invariant still holds between the two rail sections — the
    // dynamic --rail-bar-h handoff must not let them collide.
    expect(actionbarRect.top).toBeGreaterThanOrEqual(chipsRect.bottom - 1);
  }

  for (const viewport of [{ width: 1890, height: 920 }, { width: 1535, height: 900 }, { width: 1890, height: 1000 }]) {
    test(`turnbox stays contained @${viewport.width}x${viewport.height}`, async ({ page }) => {
      test.setTimeout(60000);
      const pageErrors = [];
      page.on('pageerror', err => pageErrors.push(err.message));

      await selectCharactersAtlasRect(page, viewport);
      await expect(page.locator('#game-area')).toHaveClass(/game--gutters/);

      const boardBox = () => page.locator('#board').evaluate(el => {
        const r = el.getBoundingClientRect();
        return { width: Math.round(r.width), height: Math.round(r.height) };
      });

      // Rest-state containment — this alone reproduces the owner's report
      // (the pre-roll turnbox column already includes the dice-or-atlas
      // slot + roll/jail buttons + end-turn, tall enough on its own).
      await assertContainment(page, `${viewport.width}x${viewport.height} rest`);
      const before = await boardBox();

      // Roll — and if a buy prompt lands (a taller turnbox state still),
      // re-assert containment there too. Board rect must not move either
      // way: the Redesign B lock is orthogonal to this fix (gutter-mode
      // --chrome-top/--chrome-bottom stay the flat CHROME_GUTTER_MARGIN
      // constant regardless of the actionbar's real height).
      let sawTallerState = false;
      for (let turn = 0; turn < 15 && !sawTallerState; turn++) {
        const rollBtn = page.locator('#btn-roll');
        if (await rollBtn.isVisible().catch(() => false)) {
          await rollBtn.click();
          await page.waitForTimeout(1100);
          const buyBtn = page.locator('#btn-buy');
          if (await buyBtn.isVisible().catch(() => false)) {
            sawTallerState = true;
            await assertContainment(page, `${viewport.width}x${viewport.height} buy-prompt`);
            await page.locator('#btn-pass').click();
            await page.waitForTimeout(300);
            const passAuctionBtn = page.locator('#btn-pass-auction');
            for (let i = 0; i < 6; i++) {
              if (await passAuctionBtn.isVisible().catch(() => false)) { await passAuctionBtn.click(); await page.waitForTimeout(200); }
              else break;
            }
          }
        }
        const evAccept = page.locator('#ev-accept');
        if (await evAccept.isVisible().catch(() => false)) { await evAccept.click(); await page.waitForTimeout(300); }
        const endBtn = page.locator('#btn-end');
        if (await endBtn.isVisible().catch(() => false) && await endBtn.isEnabled().catch(() => false)) {
          await endBtn.click();
          await page.waitForTimeout(300);
        }
      }

      const afterRoll = await boardBox();
      console.log(`[rail-clip lock ${viewport.width}x${viewport.height}] board before: ${before.width}x${before.height} `
        + `after: ${afterRoll.width}x${afterRoll.height} (sawTallerState=${sawTallerState})`);
      expect(afterRoll).toEqual(before);

      expect(pageErrors).toEqual([]);
    });
  }
});
