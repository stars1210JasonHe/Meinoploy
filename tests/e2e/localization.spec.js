const { test, expect } = require('@playwright/test');

// zh smoke spec (localization task 5, spec §4): the ONE spec in this suite that
// runs at the DEFAULT locale (zh) — no meinopoly_locale pin (every OTHER spec
// pins 'en' precisely so it does NOT have to deal with this). Proves:
//   1. the hero screen boots in Chinese by default (menu.localGame = '本地游戏',
//      src/i18n.js DEFAULT_LOCALE = 'zh');
//   2. a full local 2p game is playable at that locale end to end — nothing
//      app-breaking hides behind an untranslated/blank string;
//   3. the event-driven LOG (src/i18n-log.js, Task 4) renders a real game event
//      (a dice roll) in Chinese;
//   4. the #btn-lang toggle re-renders that SAME log history LIVE in English —
//      no reload, no re-roll — and the turnbox CTA (#btn-end) follows the same
//      locale; then round-trips back to Chinese, proving the swap re-derives
//      from G.events every time (spec §3: "Locale switch re-renders the WHOLE
//      log history"), not a one-shot render.
//
// Self-contained per-file setup helpers, NOT exported — same convention every
// other spec in this suite uses (see gameplay.spec.js's header comment: each
// file keeps its own copies rather than sharing a helper module).

async function selectMod(page, modName) {
  const modCard = page.locator('.map-card[data-mod-idx]', { hasText: modName }).first();
  if (await modCard.isVisible({ timeout: 4000 }).catch(() => false)) {
    await modCard.click();
  }
}

// Fast-roll only — deliberately NO meinopoly_locale pin: this file's entire
// point is to exercise the DEFAULT (zh) boot path that every other spec in this
// suite pins itself away from.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.__MP_FAST_ROLL = true; });
});

test.describe('Localization (zh default + LANG toggle) smoke', () => {
  test('zh boot -> 2p game -> zh log -> LANG toggle re-renders EN live -> toggle back to zh', async ({ page }) => {
    test.setTimeout(60000);
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto('/');

    // 1. Hero boots in Chinese by default — menu.localGame's zh value
    // (src/i18n.js STRINGS.zh['menu.localGame'] = '本地游戏').
    await page.waitForSelector('#btn-mode-local', { timeout: 10000 });
    await expect(page.locator('#btn-mode-local')).toContainText('本地游戏');
    await page.click('#btn-mode-local');

    // 2. Mod select (auto-advances if only one mod is registered). Mod NAMES
    // are DATA, never localized (spec §2) — 'Dominion' matches regardless of
    // the active locale.
    await selectMod(page, 'Dominion');

    // 3. Map select — classic is the first card (data-map-idx, locale-independent).
    await page.waitForSelector('.map-card[data-map-idx="0"]', { timeout: 10000 });
    await page.click('.map-card[data-map-idx="0"]');

    // 4. Player count — 2 players (data-count attribute, locale-independent).
    await page.waitForSelector('.count-btn[data-count="2"]', { timeout: 10000 });
    await page.click('.count-btn[data-count="2"]');

    // 5. Victory select — defaults to Last Standing; just start (#btn-vic-start
    // is an id; its LABEL is localized but that's not what we're clicking on).
    await page.waitForSelector('#btn-vic-start', { timeout: 10000 });
    await page.click('#btn-vic-start');

    // 6. Character select. Player-2 handoff is detected via '.charcard--taken'
    // count reaching 1 (a locale-INDEPENDENT structural signal — same one
    // gameplay.spec.js's own "confirming a pick marks exactly one character as
    // taken for player 2" test asserts), NOT the 'PLAYER 2' text every OTHER
    // spec in this suite waits on: that text is charselect.player, rendered
    // '玩家 {n}' at this zh-default locale — an EN regex would hang here.
    await page.waitForSelector('.charcard', { timeout: 10000 });
    const pickAndConfirm = async () => {
      const card = page.locator('.charcard:not(.charcard--taken)').first();
      await card.click();
      const confirm = page.locator('#btn-select-confirm');
      await expect(confirm).toBeEnabled();
      await confirm.click();
    };
    await pickAndConfirm();
    await expect(page.locator('.charcard--taken')).toHaveCount(1);
    await pickAndConfirm();

    // Game board appears.
    await page.waitForSelector('#btn-roll', { timeout: 10000 });

    // 7. Roll once (fast-roll flag skips the ~0.9s tumble). Resolve a drawn
    // event card if one shows, so nothing blocks opening the drawer next.
    await page.click('#btn-roll');
    await page.waitForTimeout(500);
    const evAccept = page.locator('#ev-accept');
    if (await evAccept.isVisible().catch(() => false)) {
      await evAccept.click();
      await page.waitForTimeout(300);
    }

    // 8. Open the LOG drawer tab — the log only renders its lines while the
    // drawer is OPEN on the log tab (Task 4 perf gate; src/App.js
    // renderMessages early-returns and marks itself stale otherwise).
    //
    // Wide-viewport gutter mode (App.js _syncGutterMode) auto-opens the drawer
    // on the log tab already at this point (layout.spec.js's "Wide-screen
    // gutter mode" describe block covers this directly) — clicking the tab
    // rail a SECOND time while the panel is already open there fails
    // ("#drawer intercepts pointer events", same edge-position overlap
    // layout.spec.js's own comment documents), so only click if it isn't
    // already open on the log tab.
    const logTabBtn = page.locator('#drawer-tabs .drawer-tabs__btn[data-tab="log"]');
    const logAlreadyOpen = await page.locator('#drawer').evaluate(el => !el.hidden).catch(() => false)
      && await logTabBtn.evaluate(el => el.classList.contains('drawer-tabs__btn--active')).catch(() => false);
    if (!logAlreadyOpen) {
      await logTabBtn.click();
    }

    // 9. At least one logline renders in Chinese. dice_rolled's zh formatter
    // (src/i18n-log.js ZH_FORMATTERS.dice_rolled) reads "{name} 掷出 {d1} + {d2}
    // = {total}" — every roll produces exactly this line.
    const zhLine = page.locator('#drawer .logline', { hasText: /掷出/ });
    await expect(zhLine.first()).toBeVisible();

    // 10. LANG toggle. #btn-lang lives in the topbar, which auto-hides in-game
    // (.app--game .topbar) — reveal it via the top-edge hotzone hover first
    // (same mechanism bots.spec.js's SAVE-button step and layout.spec.js's
    // topbar tests use).
    await page.hover('#topbar-hotzone');
    await expect(page.locator('.topbar')).toHaveClass(/topbar--show/);
    await page.click('#btn-lang');

    // 11. The SAME log history re-renders live in English — no reload, no
    // re-roll. formatEventMessage's dice_rolled EN template ("{name} rolled
    // {d1} + {d2} = {total}") is the engine's own formatter, byte-identical to
    // pre-i18n G.messages content (spec §3's parity guarantee).
    const enLine = page.locator('#drawer .logline', { hasText: /rolled/ });
    await expect(enLine.first()).toBeVisible();

    // 12. Turnbox CTA (#btn-end) is unconditionally rendered every render
    // (src/App.js renderTurnbox, local hot-seat -> isMyTurn always true, no bot
    // seat, no duel in the Dominion mod) with text t('turnbox.endTurn') —
    // plain 'END TURN' in English. This assertion runs strictly AFTER the LANG
    // click, so it reads the genuine post-toggle EN render.
    await expect(page.locator('#btn-end')).toContainText('END TURN');

    // 13. Toggle back to Chinese — round-trips the SAME history back to zh,
    // proving the swap is driven by re-deriving every line from G.events on
    // every call (src/i18n-log.js renderLogLines), never a one-shot/cached
    // render.
    await page.hover('#topbar-hotzone');
    await page.click('#btn-lang');
    const zhLineAgain = page.locator('#drawer .logline', { hasText: /掷出/ });
    await expect(zhLineAgain.first()).toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});
