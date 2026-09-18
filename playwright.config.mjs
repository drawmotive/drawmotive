import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 90_000 },
  use: { baseURL: 'http://127.0.0.1:4186', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: { command: 'node test/serve.mjs', url: 'http://127.0.0.1:4186/examples/browser/', reuseExistingServer: false, timeout: 30_000 },
});
