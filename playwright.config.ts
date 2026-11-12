import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.E2E_PORT ?? 4321);
const baseURL = `http://localhost:${port}/system-design-visual/`;
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: ci,
  // CI retries once to absorb runner flakes; local runs keep zero retries so hydration races surface.
  retries: ci ? 1 : 0,
  workers: ci ? 4 : undefined,
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm preview --port ${port}`,
    url: baseURL,
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
});
