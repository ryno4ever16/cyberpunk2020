import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Shimmering singletons: re-triggering a singleton window's open control while it's already open runs
 * a brief border-shimmer (`.cp-shimmer`) on the existing window, then self-clears. Verified for a
 * tear-off tab window and the shop window. Self-cleans (tagged actor).
 */

test.describe.configure({ mode: "serial" });

let ctx, page, actorId;

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, ignoreHTTPSErrors: true });
  page = await ctx.newPage();
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});
  await evalGameOrThrow(page, () => game.settings.set("cyberpunk2020", "shoppingEnabled", true));
  // The init-time hook already ran in this long-lived world; install it manually for the test (saving
  // the original so afterAll can restore it — don't leave the shared world's prototype patched).
  await evalGameOrThrow(page, async () => {
    window.__cpOrigRender = Application.prototype.render;
    const m = await import("/systems/cyberpunk2020/module/shimmer.js");
    m.registerShimmerOnReopen();
  });
  actorId = await evalGameOrThrow(page, async () => {
    const actor = await Actor.create({ name: "__PW__Shimmer", type: "character", flags: { cyberpunk2020: { __pwtest: true } } });
    return actor.id;
  });
});

test.afterAll(async () => {
  await evalGameOrThrow(page, () => { if (window.__cpOrigRender) Application.prototype.render = window.__cpOrigRender; }).catch(() => {});
  if (page) await cleanupTestData(page).catch(() => {});
  if (ctx) await ctx.close();
});

test("re-opening an already-open tab window shimmers it, then self-clears", async () => {
  const res = await evalGameOrThrow(page, async (a) => {
    const mod = await import("/systems/cyberpunk2020/module/actor/actor-tab-popout.js");
    const actor = game.actors.get(a);
    for (const app of Object.values(actor.apps)) if (app.constructor.name === "CyberpunkActorTabSheet") await app.close();
    const win = mod.CyberpunkActorTabSheet.open(actor, "combat");      // first open
    await new Promise((r) => setTimeout(r, 350));
    const beforeReopen = !!win.element[0].querySelector(":scope > .cp-shimmer-ring"); // should be false
    mod.CyberpunkActorTabSheet.open(actor, "combat");                   // re-open while open → shimmer
    return { id: win.id, beforeReopen, shimmering: !!win.element[0].querySelector(":scope > .cp-shimmer-ring") };
  }, actorId);

  expect(res.beforeReopen, "no shimmer on first open").toBe(false);
  expect(res.shimmering, "re-open adds the shimmer class").toBe(true);

  await page.waitForTimeout(1400);
  const cleared = await page.locator(`#${res.id}`).evaluate((el) => !el.querySelector(":scope > .cp-shimmer-ring"));
  expect(cleared, "shimmer self-clears (~1.2s)").toBe(true);
});

test("re-opening the already-open shop window shimmers it", async () => {
  const res = await evalGameOrThrow(page, async (a) => {
    const cat = await import("/systems/cyberpunk2020/module/shop/catalog.js");
    const actor = game.actors.get(a);
    // close any open shop first
    for (const w of Object.values(ui.windows)) if (w.constructor.name === "CatalogBrowser") await w.close();
    cat.openShopWindow(actor, { view: "home" });                       // first open
    await new Promise((r) => setTimeout(r, 450));
    const win = Object.values(ui.windows).find((w) => w.constructor.name === "CatalogBrowser");
    const beforeReopen = !!win.element[0].querySelector(":scope > .cp-shimmer-ring");
    cat.openShopWindow(actor, { view: "home" });                       // re-open while open → shimmer
    return { id: win.element[0].id, beforeReopen, shimmering: !!win.element[0].querySelector(":scope > .cp-shimmer-ring") };
  }, actorId);

  expect(res.beforeReopen, "no shimmer on first open").toBe(false);
  expect(res.shimmering, "re-open adds the shimmer class to the shop window").toBe(true);

  await page.waitForTimeout(1400);
  const cleared = await page.locator(`#${res.id}`).evaluate((el) => !el.querySelector(":scope > .cp-shimmer-ring"));
  expect(cleared, "shop shimmer self-clears").toBe(true);

  await evalGameOrThrow(page, async () => {
    for (const w of Object.values(ui.windows)) if (w.constructor.name === "CatalogBrowser") await w.close();
  });
});

test("the generic hook shimmers any sheet re-opened while already open (item sheet)", async () => {
  const res = await evalGameOrThrow(page, async (a) => {
    const actor = game.actors.get(a);
    const [item] = await actor.createEmbeddedDocuments("Item", [{ name: "__PW__ShimItem", type: "weapon" }]);
    const sheet = actor.items.get(item.id).sheet;
    sheet.render(true);                                   // first open
    await new Promise((r) => setTimeout(r, 400));
    const before = !!sheet.element?.[0]?.querySelector(":scope > .cp-shimmer-ring");
    sheet.render(true);                                   // re-open while open → generic hook shimmers
    await new Promise((r) => setTimeout(r, 60));
    const after = !!sheet.element?.[0]?.querySelector(":scope > .cp-shimmer-ring");
    await sheet.close();
    return { before, after };
  }, actorId);
  expect(res.before, "no shimmer on first open").toBe(false);
  expect(res.after, "render(true) on an already-open sheet shimmers it").toBe(true);
});
