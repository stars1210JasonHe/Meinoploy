const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const category = process.argv[2] || 'development';
const url = process.argv[3] || 'http://localhost:63340';

const screenshotDir = path.join(__dirname, 'screenshots', category);
fs.mkdirSync(screenshotDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const filename = `${timestamp}.png`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

  page.on('console', msg => console.log('CONSOLE:', msg.text()));
  page.on('pageerror', err => console.log('ERROR:', err.message));

  await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(2000);

  const filepath = path.join(screenshotDir, filename);
  await page.screenshot({ path: filepath, fullPage: true });

  console.log(`Screenshot saved: ${filepath}`);
  await browser.close();
})();
