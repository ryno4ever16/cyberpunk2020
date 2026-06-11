/**
 * Rig-portable e2e helpers.
 *
 * The main e2e suite (tests/e2e/) drives the live :30000 world via helpers/foundry.js +
 * helpers/accounts.js. Every spec already CREATES its own content (tagged __pwtest / __PW__)
 * and cleans it up, so the only thing tying those specs to :30000 is the login.
 *
 * This module swaps that one piece: `loginRig(page)` authenticates into the v13/v14 RIG as the
 * Gamemaster (password from FVTT_RIG_PASSWORD, target via FVTT_URL — see playwright.v14.config.js),
 * and we re-export the rig-agnostic helpers verbatim so a ported spec needs a single import line.
 *
 * Run:  v14 -> npx playwright test --config playwright.v14.config.js v14/e2e/<spec>
 *       v13 -> FVTT_URL=http://localhost:30003 npx playwright test --config playwright.v14.config.js v14/e2e/<spec>
 */
import { joinAsGM } from "../rig-helpers.js";

export {
  evalGame,
  evalGameOrThrow,
  cleanupTestData,
  setupSceneWithToken,
  waitForCanvasScene,
  whoami,
  TEST_FLAG,
  TEST_PREFIX,
} from "../../helpers/foundry.js";

/**
 * Rig analogue of the main suite's login(page, account): join the rig world as the first
 * Gamemaster and wait for game.ready. Ignores any account arg (the rig has one GM).
 * @param {import('@playwright/test').Page} page
 */
export async function loginRig(page, _account, opts = {}) {
  await joinAsGM(page);
  if (opts.canvas) {
    await page.waitForFunction(() => typeof window.canvas !== "undefined", undefined, { timeout: 20_000 });
  }
  return page;
}
