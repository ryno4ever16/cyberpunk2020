import { defineConfig } from "vitest/config";

/**
 * Unit-test runner for PURE logic (no Foundry/browser). Complements the Playwright
 * E2E suite in tests/ (which drives live Foundry worlds). Unit specs live in tests/unit/.
 */
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.js"],
    environment: "node",
  },
});
