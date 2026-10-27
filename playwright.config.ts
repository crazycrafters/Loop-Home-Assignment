import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

const executable =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
export default defineConfig({
  testDir: './test/browser',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 30_000,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    baseURL: 'http://127.0.0.1:3177',
    viewport: { width: 1440, height: 1000 },
    launchOptions: executable ? { executablePath: executable } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm start',
    url: 'http://127.0.0.1:3177/health',
    reuseExistingServer: false,
    env: {
      HOST: '127.0.0.1',
      PORT: '3177',
      DATABASE_PATH: ':memory:',
      LOG_LEVEL: 'silent',
      NODE_ENV: 'test',
    },
  },
});
