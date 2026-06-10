import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Ammo folded into the shop catalog (release prep): the catalog view generates one row per caliber
 * (box pricing + a load dropdown) instead of the old on-sheet "Buy Ammo" button. Verifies the rows
 * exist in getData + the DOM, and that buying through the catalog charges box price and stocks ammo.
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("catalog generates ammo rows (caliber + load + box size)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    await game.settings.set("cyberpunk2020", "shoppingEnabled", true);
    const buyer = await Actor.create({ name: "__PW__ammocat", type: "character", flags: { cyberpunk2020: { __pwtest: true } }, system: { eurobucks: 1000 } });
    const mod = await import("/systems/cyberpunk2020/module/shop/catalog.js");
    const app = new mod.CatalogBrowser(buyer, { view: "catalog" });
    const data = await app.getData();
    const nine = data.rows.find(r => r.ammo && r.caliber === "9mm");

    app.render(true);
    const dl = Date.now() + 9000;
    let el = null;
    while (Date.now() < dl) { el = document.querySelector(".cp-catalog-window"); if (el?.querySelector(".cp-ammo-row[data-ammo-caliber]")) break; await new Promise(r => setTimeout(r, 200)); }
    const domRow = el?.querySelector('.cp-ammo-row[data-ammo-caliber="9mm"]');

    const out = {
      hasAmmoCat: data.cats.some(c => c.key === "Ammo"),
      hasLoads: Array.isArray(data.ammoLoads) && data.ammoLoads.some(l => l.id === "ap"),
      nineExists: !!nine,
      nineName: nine?.name ?? null,
      nineHasBoxSize: (nine?.boxSize ?? 0) > 0,
      nineNoSourceKey: nine?.key === "",      // not a compendium doc → not drag-to-buy / shop-curatable
      domRowExists: !!domRow,
      domHasLoadSelect: !!domRow?.querySelector(".cp-catalog-ammo-load"),
      domHasBuy: !!domRow?.querySelector(".cp-catalog-buy"),
      domNotDraggable: domRow?.getAttribute("draggable") !== "true"
    };
    for (const a of Object.values(ui.windows)) { if (a?.options?.classes?.includes?.("cp-catalog")) a.close(); }
    return out;
  });

  console.log("Ammo catalog rows:", JSON.stringify(R));
  expect(R.hasAmmoCat, "an 'Ammo' category exists in the filter taxonomy").toBe(true);
  expect(R.hasLoads, "load (modifier) options are passed to the template").toBe(true);
  expect(R.nineExists, "a 9mm ammo row is generated").toBe(true);
  expect(R.nineHasBoxSize, "9mm row carries a box size").toBe(true);
  expect(R.nineNoSourceKey, "ammo rows carry no compendium source key").toBe(true);
  expect(R.domRowExists, "9mm ammo row renders in the DOM").toBe(true);
  expect(R.domHasLoadSelect, "ammo row has a load dropdown").toBe(true);
  expect(R.domHasBuy, "ammo row has a Buy button").toBe(true);
  expect(R.domNotDraggable, "ammo rows are not drag-to-buy").toBe(true);
});

test("buying ammo from the catalog charges box price and stocks ammo", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    await game.settings.set("cyberpunk2020", "shoppingEnabled", true);
    await game.settings.set("cyberpunk2020", "playersCanBuyAmmo", true);
    const L = await import("/systems/cyberpunk2020/module/lookups.js");
    const mod = await import("/systems/cyberpunk2020/module/shop/catalog.js");

    const startFunds = 1000;
    const buyer = await Actor.create({ name: "__PW__ammobuy", type: "character", flags: { cyberpunk2020: { __pwtest: true } }, system: { eurobucks: startFunds } });
    const app = new mod.CatalogBrowser(buyer, { view: "catalog" });

    const boxes = 2, caliber = "9mm", load = "ap";
    const unit = L.getAmmoBoxPrice(caliber, load);
    const box = L.getCaliberBox(caliber).box;

    await app._buyAmmo(caliber, load, boxes);

    const fresh = game.actors.get(buyer.id);
    const ammo = fresh.itemTypes.ammo.find(a => L.normalizeCaliber(a.system?.caliber) === caliber && (a.system?.modifier ?? "standard") === load);
    return {
      unit, box, expectedCost: unit * boxes, expectedRounds: box * boxes,
      charged: startFunds - Number(fresh.system.eurobucks),
      ammoExists: !!ammo,
      ammoQty: Number(ammo?.system?.quantity ?? 0),
      ammoModifier: ammo?.system?.modifier ?? null
    };
  });

  console.log("Ammo buy:", JSON.stringify(R));
  expect(R.ammoExists, "an ammo item was stocked").toBe(true);
  expect(R.charged, "charged box price × boxes").toBe(R.expectedCost);
  expect(R.ammoQty, "stocked box size × boxes rounds").toBe(R.expectedRounds);
  expect(R.ammoModifier, "ammo carries the chosen load").toBe("ap");
});
