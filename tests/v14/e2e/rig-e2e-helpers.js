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

/**
 * Multi-account support. The :30000 world ships extra users (a player + an assistant GM);
 * the rig starts with only the Gamemaster, so multi-account specs first call ensureRigUsers()
 * (run as GM) to create the matching users, then log a second context in via loginRigAs().
 * All rig users share FVTT_RIG_PASSWORD (rig throwaway). Names match helpers/accounts.js so the
 * ported bodies' `game.users.find(u => u.name === "...")` lookups work unchanged.
 */
export const RIG_USERS = [
  { name: "Test User 1", role: 1 },          // PLAYER
  { name: "Assistant Gamemaster", role: 3 }, // ASSISTANT (GM-for-permissions)
];

/** As GM: create any missing rig test users (idempotent). Foundry hashes the password on create. */
export async function ensureRigUsers(gmPage, users = RIG_USERS) {
  const { evalGameOrThrow } = await import("../../helpers/foundry.js");
  const password = process.env.FVTT_RIG_PASSWORD ?? "";
  return evalGameOrThrow(gmPage, async (arg) => {
    const created = [];
    for (const u of arg.users) {
      if (!game.users.find((x) => x.name === u.name)) {
        await User.create({ name: u.name, role: u.role, password: arg.password });
        created.push(u.name);
      }
    }
    return { created, totalUsers: game.users.size };
  }, { password, users });
}

/** Join the rig as a SPECIFIC user (by display name), e.g. "Test User 1" / "Assistant Gamemaster". */
export async function loginRigAs(page, name, password = process.env.FVTT_RIG_PASSWORD ?? "") {
  await page.goto("/join", { waitUntil: "domcontentloaded" });
  const sel = page.locator('select[name="userid"]');
  await sel.waitFor({ state: "visible", timeout: 30_000 });
  await sel.selectOption({ label: name });
  await page.locator('input[name="password"]').fill(password);
  await Promise.all([
    page.waitForNavigation({ url: /\/game/, timeout: 45_000 }).catch(() => {}),
    page.locator('button[name="join"]').click(),
  ]);
  await page.waitForFunction(() => window.game?.ready === true, undefined, { timeout: 60_000 });
  return page;
}
