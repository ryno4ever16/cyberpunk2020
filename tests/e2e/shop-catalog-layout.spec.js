import { test, expect } from "@playwright/test";
import { login, evalGameOrThrow } from "../helpers/foundry.js";
import { ACCOUNTS } from "../helpers/accounts.js";

/**
 * Regression for the catalog LAYOUT. Foundry core's `.flexrow{align-items:center}` +
 * `.flexcol>*{flex:none}` + default full-width `button` used to balloon the columns to ~64,000px and
 * stack the jump letters 778px tall, collapsing the item list to 0. These assert the list scrolls
 * inside the window and the jump bar stays a thin strip.
 */
test("catalog layout: list scrolls inside the window, jump bar is a thin strip", async ({ page }) => {
  await login(page, ACCOUNTS.gm);

  const R = await evalGameOrThrow(page, async () => {
    const out = {};
    await game.settings.set("cyberpunk2020", "shoppingEnabled", true);
    const mod = await import("/systems/cyberpunk2020/module/shop/catalog.js");
    const browser = new mod.CatalogBrowser(null);
    await browser.render(true);
    await new Promise(r => setTimeout(r, 500));
    const root = browser.element?.[0] ?? document.querySelector(".cp-catalog");
    const h = (sel) => { const el = root.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().height) : null; };
    const list = root.querySelector(".cp-catalog-list");
    out.appH = Math.round(root.getBoundingClientRect().height);
    out.listClientH = list?.clientHeight ?? 0;
    out.listScrollH = list?.scrollHeight ?? 0;
    out.filtersH = h(".cp-catalog-filters");
    out.centerH = h(".cp-catalog-center");
    out.jumpH = h(".cp-catalog-jump");
    out.rows = root.querySelectorAll(".cp-catalog-row").length;
    out.chips = root.querySelectorAll(".cp-cat-chip").length;
    await browser.close();
    return out;
  });

  console.log("Catalog layout:", JSON.stringify(R));
  expect(R.rows, "rows render").toBeGreaterThan(100);
  expect(R.chips, "category chips render").toBeGreaterThan(10);
  // Columns are window-bounded, not content-ballooned.
  expect(R.filtersH, "filters bounded to window").toBeLessThan(R.appH + 5);
  expect(R.centerH, "center bounded to window").toBeLessThan(R.appH + 5);
  // The list has real height and scrolls.
  expect(R.listClientH, "list has height").toBeGreaterThan(200);
  expect(R.listScrollH, "list content overflows (scrolls)").toBeGreaterThan(R.listClientH);
  // Jump bar is a thin strip, not a stacked column.
  expect(R.jumpH, "jump bar is a thin strip").toBeLessThan(120);
});
