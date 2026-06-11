import { defineConfig, devices } from "@playwright/test";

/**
 * Separate Playwright config for the FoundryVTT **v14** compatibility rig.
 *
 * Targets the isolated v14 instance on :30002 (world "V14 Compat Test"), NOT the
 * :30000 shared v13.350 world the main suite uses. Keep these specs in ./v14 so
 * the main `playwright test` run never picks them up (different core version).
 *
 * Run from tests/:  npx playwright test --config playwright.v14.config.js
 */
const BASE_URL = process.env.FVTT_URL || "http://localhost:30002";

export default defineConfig({
  testDir: "./v14",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1600, height: 900 },
    ignoreHTTPSErrors: true,
    actionTimeout: 30_000,
    navigationTimeout: 45_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium-v14",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 900 } },
    },
  ],
});
