import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Drag-to-buy: dropping a shop row on a character sheet purchases it for that actor. The DOM drag itself
 * is hard to simulate headlessly, so this drives the engine the drop calls:
 *   - purchaseCatalogItem (the reusable buy fn, with an explicit buyer) charges eb + creates the item(s);
 *   - purchaseByDrop shows the quick confirm → Buy charges + creates (with the chosen quantity);
 *   - a recurring service routes to a Services-tab item.
 * Self-cleans (tagged actors).
 */

const SYS = "/systems/cyberpunk2020/module/shop/catalog.js";
const SVC = "/systems/cyberpunk2020/module/shop/services.js";

test.describe.configure({ mode: "serial" });

let gmCtx, gmPage;

test.beforeAll(async ({ browser }) => {
  gmCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  gmPage = await gmCtx.newPage();
  await login(gmPage, ACCOUNTS.gm);
  await cleanupTestData(gmPage).catch(() => {});
  await evalGameOrThrow(gmPage, () => game.settings.set("cyberpunk2020", "shoppingEnabled", true));
});

test.afterAll(async () => {
  if (gmPage) await cleanupTestData(gmPage).catch(() => {});
  if (gmCtx) await gmCtx.close();
});

test("purchaseCatalogItem charges + creates (the engine the drop reuses)", async () => {
  const res = await evalGameOrThrow(gmPage, async () => {
    const cat = await import("/systems/cyberpunk2020/module/shop/catalog.js");
    const all = await cat.getCatalogIndex();
    const gear = all.find(i => i.type === "misc" && i.category === "Gear" && i.sub !== "Fashion" && i.sub !== "Rentals & Services" && i.cost > 0);
    if (!gear) return { __pwError: true, message: "no priced gear item found" };
    const i = gear.key.lastIndexOf(".");
    const packId = gear.key.slice(0, i), itemId = gear.key.slice(i + 1);

    const buyer = await Actor.create({ name: "__PW__DragBuyer1", type: "character", flags: { cyberpunk2020: { __pwtest: true } } });
    await buyer.update({ "system.eurobucks": 100000 });
    const eb0 = buyer.system.eurobucks;
    await cat.purchaseCatalogItem(buyer, packId, itemId, { qty: 2 });
    const live = game.actors.get(buyer.id);
    return {
      name: gear.name, cost: gear.cost, eb0, eb1: live.system.eurobucks,
      itemCount: live.items.filter(it => it.name === gear.name).length,
    };
  });
  console.log("ENGINE:", JSON.stringify(res));
  expect(res.eb0 - res.eb1, "charged unit cost × 2").toBe(res.cost * 2);
  expect(res.itemCount, "two copies created").toBe(2);
});

test("purchaseByDrop → confirm dialog → Buy charges + creates the chosen quantity", async () => {
  // Kick off the drop-purchase (it awaits the confirm dialog); capture context for verification.
  const ctx = await evalGameOrThrow(gmPage, async () => {
    const cat = await import("/systems/cyberpunk2020/module/shop/catalog.js");
    const all = await cat.getCatalogIndex();
    const gear = all.find(i => i.type === "misc" && i.category === "Gear" && i.sub !== "Fashion" && i.sub !== "Rentals & Services" && i.cost > 0);
    const buyer = await Actor.create({ name: "__PW__DragBuyer2", type: "character", flags: { cyberpunk2020: { __pwtest: true } } });
    await buyer.update({ "system.eurobucks": 100000 });
    window.__cpDrag = { done: false };
    cat.purchaseByDrop(buyer, { sourceKey: gear.key }).then(() => { window.__cpDrag.done = true; });
    return { buyerId: buyer.id, name: gear.name, cost: gear.cost, eb0: buyer.system.eurobucks };
  });

  // The confirm dialog: set quantity 3 and click Buy.
  const qty = gmPage.locator('input[name="qty"]').last();
  await expect(qty, "confirm dialog rendered with a quantity field").toBeVisible({ timeout: 10_000 });
  await qty.fill("3");
  await gmPage.locator('button[data-button="buy"]').last().click();

  const res = await evalGameOrThrow(gmPage, async (arg) => {
    const deadline = Date.now() + 6000;
    while (Date.now() < deadline && !window.__cpDrag?.done) await new Promise(r => setTimeout(r, 100));
    const buyer = game.actors.get(arg.buyerId);
    return { eb1: buyer.system.eurobucks, itemCount: buyer.items.filter(it => it.name === arg.name).length };
  }, ctx);

  console.log("DRAG-BUY:", JSON.stringify({ ...ctx, ...res }));
  expect(ctx.eb0 - res.eb1, "dialog Buy charged unit cost × 3").toBe(ctx.cost * 3);
  expect(res.itemCount, "three copies created").toBe(3);
});

test("recurring service routes to a Services-tab item + charges", async () => {
  const res = await evalGameOrThrow(gmPage, async () => {
    const cat = await import("/systems/cyberpunk2020/module/shop/catalog.js");
    const svc = await import("/systems/cyberpunk2020/module/shop/services.js");
    const pack = game.packs.find(p => p.metadata?.name === "rentalandservices");
    if (!pack) return { __pwError: true, message: "no rentalandservices pack" };
    const idx = await pack.getIndex();
    let doc = null;
    for (const e of idx) {
      const d = await pack.getDocument(e._id);
      if (svc.classifyService(d, "rentalandservices") === "recurring") { doc = d; break; }
    }
    if (!doc) return { __pwError: true, message: "no recurring service found" };

    const buyer = await Actor.create({ name: "__PW__DragBuyer3", type: "character", flags: { cyberpunk2020: { __pwtest: true } } });
    await buyer.update({ "system.eurobucks": 100000 });
    const eb0 = buyer.system.eurobucks;
    await cat.purchaseCatalogItem(buyer, pack.collection, doc.id, { qty: 1 });
    const live = game.actors.get(buyer.id);
    const made = live.items.find(it => it.name === doc.name);
    return {
      name: doc.name, cost: Number(doc.system?.cost) || 0, eb0, eb1: live.system.eurobucks,
      itemMade: !!made, serviceMode: made?.system?.serviceMode ?? null,
    };
  });
  console.log("SERVICE:", JSON.stringify(res));
  expect(res.itemMade, "recurring service created a tracked item").toBe(true);
  expect(res.serviceMode, "tagged as recurring").toBe("recurring");
  expect(res.eb0 - res.eb1, "charged one period").toBe(res.cost);
});
