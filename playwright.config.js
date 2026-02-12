const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:1234',
    headless: true,
  },
  webServer: {
    command: 'npx parcel index.html --port 1234',
    port: 1234,
    timeout: 30000,
    reuseExistingServer: true,
  },
});
