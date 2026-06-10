import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow } from "../helpers/foundry.js";

/**
 * Setup / What's-New notice (release prep). The old one-time `automationMigrationShown` flag is replaced
 * by `automationNoticeHide`: the GM sees the notice on every load until they tick "Don't show this again".
 * It is now a 2-page dialog; the primary button reads "Next" until the last page, then "Got it".
 *
 * Leaves the test world with the notice HIDDEN so it can't pop over other specs' UI.
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await evalGameOrThrow(p, () => game.settings.set("cyberpunk2020", "automationNoticeHide", true)); } catch {}
  await ctx.close();
});

test("setting migrated: automationNoticeHide registered, old flag gone", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  const reg = await evalGameOrThrow(page, () => ({
    hasNew: game.settings.settings.has("cyberpunk2020.automationNoticeHide"),
    hasOld: game.settings.settings.has("cyberpunk2020.automationMigrationShown"),
    headDoublingDefaultOn: game.settings.settings.get("cyberpunk2020.headHitDoubling")?.default === true
  }));
  expect(reg.hasNew, "new hide setting is registered").toBe(true);
  expect(reg.hasOld, "old one-time flag is removed").toBe(false);
  expect(reg.headDoublingDefaultOn, "head doubling stays ON by default (user decision)").toBe(true);
});

test("notice shows on load, paginates 2 pages (Next→Got it), and the checkbox hides it", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  // Force it visible on the next load, then reload so the ready hook re-fires with it un-hidden.
  await evalGameOrThrow(page, () => game.settings.set("cyberpunk2020", "automationNoticeHide", false));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => globalThis.game?.ready === true, undefined, { timeout: 60_000 });

  const next = page.locator(".cp-feat-next").first();
  await next.waitFor({ state: "visible", timeout: 30_000 });

  // Page 1 of 2.
  await expect(page.locator(".cp-feat-page")).toHaveCount(2);
  await expect(page.locator(".cp-feat-count").first()).toHaveText("1 / 2");
  await expect(next).toHaveText(/Next/);
  const page2hiddenInitially = await page.locator('.cp-feat-page[data-page="1"]').first().evaluate(el => el.style.display === "none");
  expect(page2hiddenInitially, "page 2 hidden initially").toBe(true);

  // Advance to the last page: button becomes "Got it".
  await next.click();
  await expect(page.locator(".cp-feat-count").first()).toHaveText("2 / 2");
  await expect(next).toHaveText(/Got it/);
  const page2shown = await page.locator('.cp-feat-page[data-page="1"]').first().evaluate(el => el.style.display !== "none");
  expect(page2shown, "page 2 shown after Next").toBe(true);

  // Back returns to page 1.
  await page.locator(".cp-feat-back").first().click();
  await expect(page.locator(".cp-feat-count").first()).toHaveText("1 / 2");

  // The "Don't show this again" checkbox persists to the setting immediately.
  await page.locator(".cp-feat-hide-cb").first().check();
  const hidNow = await evalGameOrThrow(page, () => game.settings.get("cyberpunk2020", "automationNoticeHide"));
  expect(hidNow, "checkbox sets the hide setting").toBe(true);

  // Finish: Next → last page → Got it closes the dialog.
  await next.click();
  await expect(next).toHaveText(/Got it/);
  await next.click();
  await expect(page.locator(".cp-feat-next")).toHaveCount(0);
});
