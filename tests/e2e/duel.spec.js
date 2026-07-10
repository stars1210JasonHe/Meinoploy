const { test, expect } = require('@playwright/test');

// Rent-duel mechanism E2E (MT2-SP2 Task 10). Self-contained (mirrors the
// gameplay.spec.js convention of duplicating small nav helpers per-file rather
// than importing across specs — see create-mod.spec.js for the same pattern).
//
// Terra Titans is the only mod with RULES.duel.enabled=true (mods/terra-titans/rules.js
// extends Dominion's BASE with duel.enabled:true); its only board is the 49-city
// Terra Titans globe world (movementMode:'atlas', maps:[] in bundle.data.js), so
// driving a turn there means the same roll -> resolve-route-fork -> resolve-landing
// cycle as gameplay.spec.js's "Atlas World" tests, not the classic board-center flow.

test.beforeEach(async ({ page }) => {
  // Fast-roll flag: skip the ~0.9s dice tumble animation (gameplay.spec.js convention).
  await page.addInitScript(() => { window.__MP_FAST_ROLL = true; });
});

// ─────────────────────────────────────────────────────────────
// Terra Titans navigation: hero -> mod select ('Terra Titans') -> map select
// (its only card, also titled 'Terra Titans') -> 2 players -> victory defaults
// -> pick two leaders -> board loads.
// ─────────────────────────────────────────────────────────────
async function pickAndConfirm(page) {
  const card = page.locator('.charcard:not(.charcard--taken)').first();
  await card.click();
  const confirm = page.locator('#btn-select-confirm');
  await expect(confirm).toBeEnabled();
  await confirm.click();
}

async function waitForPlayer2(page) {
  await page.waitForFunction(() => {
    const el = document.querySelector('.select__p');
    return el && /PLAYER 2/.test(el.textContent);
  }, { timeout: 10000 });
}

async function selectCharactersTerraTitans(page) {
  await page.goto('/');

  await page.waitForSelector('#btn-mode-local', { timeout: 10000 });
  await page.click('#btn-mode-local');

  await page.waitForSelector('.map-card[data-mod-idx]', { timeout: 10000 });
  await page.locator('.map-card[data-mod-idx]', { hasText: 'Terra Titans' }).click();

  await page.waitForSelector('.map-card[data-map-idx]', { timeout: 10000 });
  await page.locator('.map-card[data-map-idx]', { hasText: 'Terra Titans' }).click();

  await page.waitForSelector('.count-btn[data-count="2"]', { timeout: 10000 });
  await page.click('.count-btn[data-count="2"]');

  // Explicitly pick LAST STANDING (survival), overriding Terra Titans' own default —
  // its winPaths are ['dominion', 'wealth', 'survival'] (mods/dominion/atlas/worlds/
  // terra-titans.js), so SETUP defaults to DOMINION victory (groupsToWin:2). Left at
  // that default, this spec's buying (needed to build up cross-ownership so a duel can
  // ever trigger) raced dominion victory — instrumented and measured: 2 of 7 real runs
  // ended in "controls 2 color groups" (a legitimate win, .results__victory) before
  // either player ever landed on the other's property. Survival only ends on a genuine
  // bankruptcy, which the cash-floor-gated buying below makes very unlikely within the
  // attempt cap — this removes the race rather than papering over it with more attempts.
  await page.locator('.vic-card[data-mode="survival"]').click();

  await page.waitForSelector('#btn-vic-start', { timeout: 10000 });
  await page.click('#btn-vic-start');

  await page.waitForSelector('.charcard', { timeout: 10000 });
  await pickAndConfirm(page);
  await waitForPlayer2(page);
  await pickAndConfirm(page);

  await page.waitForSelector('#btn-roll', { timeout: 10000 });
}

// Read the active player's cash from the sidebar (e.g. "$1,500" -> 1500).
async function activePlayerMoney(page) {
  const text = await page.locator('.pcard--active .pcard__money').textContent().catch(() => '');
  const digits = (text || '').replace(/[^0-9]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

// Don't buy below this much cash on hand. Buying every landed-on city
// unconditionally (the classic-board helpers' style) risks draining a player's
// wallet right as the FIRST duel's stakes (up to loseMultiplier x rent, itself
// possibly monopoly-doubled) land — which could bankrupt-and-gameover them
// mid-assertion and swap the board out for the results screen, wiping the very
// DOM nodes (.logline / .turnbox__slot) this spec reads. Terra Titans city
// prices top out around $400 (see atlas/worlds/terra-titans.js data-driven
// pricing); gating buys above this floor keeps a comfortable buffer under any
// realistic single duel stake.
const CASH_FLOOR = 700;

// One Terra Titans turn. Route-fork choice is always "the first highlighted
// city" — engineered determinism (not a true RNG seed, which the client has no
// hook for): with BOTH players using the identical fork policy, their paths
// converge onto the same mainline loop instead of diverging every fork, which
// combined with the cash-floor-gated buying below reliably produces a
// rent-due cross-landing (a duel offer) well within the attempt cap. Returns
// true the instant a duel OFFER is showing (#btn-duel visible) so the caller
// can take over the offer/response/fight flow.
async function terraTitansTurn(page) {
  const rollBtn = page.locator('#btn-roll');
  if (await rollBtn.isVisible().catch(() => false)) {
    await rollBtn.click();
    await page.waitForTimeout(1100); // wait out the ~0.9s dice animation + dispatch
    // Terra Titans renders via the GLOBE renderer (renderMode:'globe'), whose route-fork
    // targets are `.gcity--route` city-label overlays (App.js _setupGlobeOverlay's
    // delegated click -> commitRoute), NOT the flat renderer's `.tile--route-target`
    // (gameplay.spec.js's Terra Circuit atlas test uses the flat renderer). This world's
    // hub-heavy graph makes a GENUINE multi-choice fork the common case (~99% of rolls in
    // an engine-level repro over 3000 turns) — a single-choice "fork" auto-commits with no
    // DOM target at all, but that's the rare case, not the norm.
    //
    // This loop originally flaked stuck-on-a-fork (hint showing, no `.gcity--route` ever
    // appearing) — root-caused via instrumentation (not guessed) to a real production bug:
    // App.js's single-choice auto-commit dispatched commitRoute SYNCHRONOUSLY from inside
    // the render path, re-entering update() and leaving the DOM stuck on stale pre-fork
    // state even though the engine's G.awaitingRoute had already correctly cleared (fixed
    // in _globeComputeRouteTargets by deferring that dispatch past the current render —
    // see the fix's own comment there). The `.gcity--route` position is still driven by a
    // requestAnimationFrame loop against the WebGL globe camera, so a small poll window
    // remains prudent (RAF can lag a beat under parallel-worker contention), but the
    // multi-second stuck failures are gone post-fix.
    const awaitingRoute = await page.locator('.centerslot__hint', { hasText: 'CHOOSE YOUR ROUTE' })
      .first().isVisible().catch(() => false);
    if (awaitingRoute) {
      const target = page.locator('.gcity--route').first();
      await target.waitFor({ state: 'visible', timeout: 8000 });
      await target.click();
      await page.waitForTimeout(350);
    }
  }

  const evAccept = page.locator('#ev-accept');
  if (await evAccept.isVisible().catch(() => false)) {
    await evAccept.click();
    await page.waitForTimeout(300);
  }

  if (await page.locator('#btn-duel').isVisible().catch(() => false)) {
    return true;
  }

  const buyBtn = page.locator('#btn-buy');
  if (await buyBtn.isVisible().catch(() => false)) {
    const cash = await activePlayerMoney(page);
    if (cash > CASH_FLOOR) {
      await buyBtn.click();
      await page.waitForTimeout(300);
    } else {
      await page.click('#btn-pass');
      await page.waitForTimeout(400);
      const passAuctionBtn = page.locator('#btn-pass-auction');
      for (let i = 0; i < 6; i++) {
        if (await passAuctionBtn.isVisible().catch(() => false)) {
          await passAuctionBtn.click();
          await page.waitForTimeout(200);
        } else break;
      }
    }
  }

  const endBtn = page.locator('#btn-end');
  if (await endBtn.isVisible().catch(() => false) && await endBtn.isEnabled().catch(() => false)) {
    await endBtn.click();
    await page.waitForTimeout(300);
  }
  return false;
}

test.describe('Duel mechanism (Terra Titans, duel.enabled=true)', () => {
  test('rent-due landing on an opponent city offers a duel; DUEL! -> FIGHT resolves and logs', async ({ page }) => {
    test.setTimeout(240000); // up to 40 atlas turns (route-fork + landing waits), plus headroom for
                              // parallel-worker WebGL/GPU contention (measured up to ~2.6m under a
                              // deliberate 5x-parallel stress run of this very spec)
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await selectCharactersTerraTitans(page);

    let offerSeen = false;
    for (let i = 0; i < 40 && !offerSeen; i++) {
      if (await page.locator('.results__victory').isVisible().catch(() => false)) break;
      offerSeen = await terraTitansTurn(page);
    }
    expect(offerSeen).toBe(true);

    // Offer phase: both PAY RENT and DUEL! are on offer; this spec prefers the
    // DUEL! -> FIGHT path per the task brief. This is the challenger's first-ever
    // duel this game, so RULES.duel.cooldownTurns (lastDuelTurn starts null for
    // every player) can never block it.
    await expect(page.locator('#btn-payrent')).toBeVisible();
    const duelBtn = page.locator('#btn-duel');
    await expect(duelBtn).toBeVisible();
    await expect(duelBtn).toBeEnabled();
    await duelBtn.click();
    await page.waitForTimeout(300);

    // Response hand-off: the owner is named and challenged for the property —
    // this must be readable BEFORE FIGHT is clicked (App.js _duelPromptHtml
    // 'response' phase, rendered via the atlas isDuelResponse turnbox detour).
    await expect(page.locator('.cp__name').first()).toContainText('you are challenged for');
    await expect(page.locator('#btn-fight')).toBeVisible();
    await expect(page.locator('#btn-decline')).toBeVisible();

    await page.locator('#btn-fight').click();
    await page.waitForTimeout(300);

    // Resolution is RANDOM (2d6 + stats per side) — assert the resolution
    // itself is visible, not who won: the "Duel! ... — X wins!" log line
    // (events.js formatEventMessage) and the static two-roll result strip
    // (App.js _duelResultStripHtml) both surface unconditionally either way.
    await expect(page.locator('.logline', { hasText: 'Duel!' }).first()).toBeVisible();
    await expect(page.locator('.turnbox__slot', { hasText: 'WINS' }).first()).toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────
// Dominion (duel.enabled=false, mods/dominion/rules.js) — the DUEL! button must
// never appear, on any landing, ever. Rent always auto-pays (Game.js
// handleLanding's `if (RULES.duel.enabled && ...)` gate is hard off).
// ─────────────────────────────────────────────────────────────
async function selectCharactersDominion(page) {
  await page.goto('/');

  await page.waitForSelector('#btn-mode-local', { timeout: 10000 });
  await page.click('#btn-mode-local');

  const modCard = page.locator('.map-card[data-mod-idx]', { hasText: 'Dominion' }).first();
  if (await modCard.isVisible({ timeout: 4000 }).catch(() => false)) {
    await modCard.click();
  }

  await page.waitForSelector('.map-card[data-map-idx="0"]', { timeout: 10000 });
  await page.click('.map-card[data-map-idx="0"]');

  await page.waitForSelector('.count-btn[data-count="2"]', { timeout: 10000 });
  await page.click('.count-btn[data-count="2"]');

  await page.waitForSelector('#btn-vic-start', { timeout: 10000 });
  await page.click('#btn-vic-start');

  await page.waitForSelector('.charcard', { timeout: 10000 });
  await pickAndConfirm(page);
  await waitForPlayer2(page);
  await pickAndConfirm(page);

  await page.waitForSelector('#btn-roll', { timeout: 10000 });
}

async function completeDominionTurn(page) {
  const rollBtn = page.locator('#btn-roll');
  if (await rollBtn.isVisible().catch(() => false)) {
    await rollBtn.click();
    await page.waitForTimeout(1100);
  }

  const evAccept = page.locator('#ev-accept');
  if (await evAccept.isVisible().catch(() => false)) {
    await evAccept.click();
    await page.waitForTimeout(300);
  }

  const buyBtn = page.locator('#btn-buy');
  if (await buyBtn.isVisible().catch(() => false)) {
    await page.click('#btn-pass');
    await page.waitForTimeout(400);
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

test.describe('Duel mechanism (Dominion, duel.enabled=false)', () => {
  test('Dominion never shows the DUEL! button, across several turns', async ({ page }) => {
    test.setTimeout(60000);
    await selectCharactersDominion(page);

    for (let i = 0; i < 8; i++) {
      await expect(page.locator('#btn-duel')).toHaveCount(0);
      await completeDominionTurn(page);
    }
    await expect(page.locator('#btn-duel')).toHaveCount(0);
  });
});
