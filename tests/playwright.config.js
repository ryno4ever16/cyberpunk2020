import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config for the CP2020 live-world E2E suite.
 *
 * These tests drive a SHARED, LIVE Foundry world ("End to End Testing Paradise").
 * That has consequences baked into this config:
 *   - workers: 1 — never run two specs against the same world concurrently; they
 *     would race on combat state, the active scene, and shared documents.
 *   - fullyParallel: false — same reason.
 *   - Generous timeouts — Foundry's join handshake + canvas draw is slow over the network.
 *
 * The server address / accounts live in helpers/accounts.js (overridable via env).
 */
const BASE_URL = process.env.FVTT_URL || "http://localhost:30000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // One retry: these run against a live remote world, so absorb transient network blips.
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { open: "never" }]],
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
      name: "chromium",
      // Viewport AFTER the device spread: Foundry warns below 1366x768.
      use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 900 } },
    },
  ],
});
