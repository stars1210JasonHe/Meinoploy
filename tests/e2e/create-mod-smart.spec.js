const { test, expect } = require('@playwright/test');

// The two smart-built mods must appear on mod-select — proves the facts -> --smart ->
// build pipeline end-to-end (mirrors tests/e2e/create-mod.spec.js for the SP1 mods).
test.describe('Smart-built mods', () => {
  test('silk-road (atlas) + gilded-rails (classic) are selectable', async ({ page }) => {
    await page.goto('/');

    // Wait for hero screen and click LOCAL GAME
    await page.waitForSelector('#btn-mode-local', { timeout: 15000 });
    await page.click('#btn-mode-local');

    // Mod-select renders because MODS.length > 1
    await page.waitForSelector('.map-card[data-mod-idx]', { timeout: 15000 });

    // Assert both smart-built mod names are visible as mod cards
    await expect(page.locator('.map-card[data-mod-idx]', { hasText: 'Silk Road' }).first()).toBeVisible();
    await expect(page.locator('.map-card[data-mod-idx]', { hasText: 'Gilded Rails' }).first()).toBeVisible();
  });
});
