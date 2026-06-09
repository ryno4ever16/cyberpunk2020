import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Round-6 shop refactor ([[shopping-design]]): the catalog IS the shop. One CatalogBrowser serves
 * three modes — global "catalog", GM "build" (curation), player "storefront". Covers:
 *   • build: add/remove a real catalog item, dedup, inline economics, "in this shop" filter, extras;
 *   • global catalog GM "Add to shop ▾" list;
 *   • storefront: fullSearch OFF → curated-only (no search bar) / ON → full catalog + featured curated;
 *   • storefront buy applies the shop's per-item economics.
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try {
    await login(p, ACCOUNTS.gm);
    await cleanupTestData(p);
    await evalGameOrThrow(p, async () => { try { await game.settings.set("cyberpunk2020", "shoppingEnabled", false); } catch {} });
  } catch {}
  await ctx.close();
});

test("build mode: add/remove a real catalog item, dedup, economics, shop-only filter, extras", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const out = {};
    await game.settings.set("cyberpunk2020", "shoppingEnabled", true);
    const flags = { cyberpunk2020: { __pwtest: true } };
    const mod = await import("/systems/cyberpunk2020/module/shop/catalog.js");
    const pur = await import("/systems/cyberpunk2020/module/shop/purchase.js");

    // A real catalog weapon (always present: pistols/rifles etc.).
    const index = await mod.getCatalogIndex();
    const sample = index.find(i => i.category === "Weapons" && i.canon === "core") || index.find(i => i.category === "Weapons");
    out.haveSample = !!sample;

    const shop = await Actor.create({ name: "__PW__buildshop", type: "shop", flags, system: { open: false } });

    // Add the catalog item.
    const added = await pur.addItemToShop(shop, sample.packId, sample.id, { fashion: false });
    out.added = !!added;
    out.stockHasSourceKey = pur.shopStockOf(added).sourceKey === `${sample.packId}.${sample.id}`;
    // Dedup: a second add of the same catalog item is rejected.
    const dup = await pur.addItemToShop(shop, sample.packId, sample.id);
    out.dupRejected = dup === null;

    // Build getData: the catalog row for the sample is marked inShop with the embedded id.
    const builder = new mod.CatalogBrowser(null, { shop, mode: "build" });
    let bdata = await builder.getData();
    out.mode = bdata.mode;
    const row = bdata.rows.find(r => r.key === `${sample.packId}.${sample.id}`);
    out.rowInShop = !!row?.inShop;
    out.rowHasShopItemId = row?.shopItemId === added.id;
    out.noSkillRows = !bdata.rows.some(r => r.type === "skill");

    // Inline economics.
    await pur.setShopStock(added, { price: 99, unlimited: false, qty: 3 });
    bdata = await builder.getData();
    const row2 = bdata.rows.find(r => r.key === `${sample.packId}.${sample.id}`);
    out.econOverride = row2?.override;     // 99
    out.econUnlimited = row2?.unlimited;   // false
    out.econQty = row2?.stockQty;          // 3

    // "In this shop" filter narrows the catalog to curated rows only.
    builder._shopOnly = true;
    const filtered = await builder.getData();
    out.shopOnlyAllInShop = filtered.rows.length > 0 && filtered.rows.every(r => r.inShop);
    builder._shopOnly = false;

    // An off-catalog item (no sourceKey) shows up as an "extra".
    await shop.createEmbeddedDocuments("Item", [{ name: "__PW__custom", type: "misc", system: { cost: 10 } }]);
    const withExtra = await builder.getData();
    out.extraPresent = withExtra.extras.some(r => r.name === "__PW__custom");

    // Catalog mode exposes the shop in the GM "Add to shop" list.
    const cat = await (new mod.CatalogBrowser(null)).getData();
    out.shopListed = cat.shopList.some(s => s.id === shop.id);

    // Remove returns the row to not-in-shop.
    await pur.removeItemFromShop(shop, added.id);
    const afterRemove = await builder.getData();
    const row3 = afterRemove.rows.find(r => r.key === `${sample.packId}.${sample.id}`);
    out.removedNotInShop = !!row3 && !row3.inShop;

    return out;
  });

  console.log("Build mode:", JSON.stringify(R, null, 2));
  expect(R.haveSample, "a catalog weapon exists to add").toBe(true);
  expect(R.added).toBe(true);
  expect(R.stockHasSourceKey, "added item carries its catalog sourceKey").toBe(true);
  expect(R.dupRejected, "second add of the same item is rejected").toBe(true);
  expect(R.mode).toBe("build");
  expect(R.rowInShop, "catalog row marked in-shop after add").toBe(true);
  expect(R.rowHasShopItemId, "in-shop row carries the embedded item id").toBe(true);
  expect(R.noSkillRows).toBe(true);
  expect(R.econOverride, "price override").toBe(99);
  expect(R.econUnlimited, "unlimited toggled off").toBe(false);
  expect(R.econQty, "stock qty").toBe(3);
  expect(R.shopOnlyAllInShop, "shop-only filter shows only curated rows").toBe(true);
  expect(R.extraPresent, "off-catalog stock surfaces as an extra").toBe(true);
  expect(R.shopListed, "GM catalog lists the shop for Add-to-shop").toBe(true);
  expect(R.removedNotInShop, "row returns to not-in-shop after remove").toBe(true);
});

test("storefront mode: curated-only vs fullSearch; buy applies shop economics", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const out = {};
    await game.settings.set("cyberpunk2020", "shoppingEnabled", true);
    const flags = { cyberpunk2020: { __pwtest: true } };
    const mod = await import("/systems/cyberpunk2020/module/shop/catalog.js");
    const pur = await import("/systems/cyberpunk2020/module/shop/purchase.js");

    const index = await mod.getCatalogIndex();
    const sample = index.find(i => i.category === "Weapons" && i.canon === "core") || index.find(i => i.category === "Weapons");

    const shop = await Actor.create({ name: "__PW__frontshop", type: "shop", flags, system: { open: true, fullSearch: false } });
    const added = await pur.addItemToShop(shop, sample.packId, sample.id);
    await pur.setShopStock(added, { price: 77, unlimited: true });

    const buyer = await Actor.create({ name: "__PW__frontbuyer", type: "character", flags, system: { eurobucks: 1000 } });

    // fullSearch OFF → curated-only, no search bar, exactly the one curated row.
    let sf = new mod.CatalogBrowser(buyer, { shop, mode: "storefront" });
    let sdata = await sf.getData();
    out.noSearch = sdata.noSearch;                         // true
    out.curatedOnlyCount = sdata.rowCount;                 // 1
    out.curatedRowIsCurated = sdata.rows[0]?.curated === true && sdata.rows[0]?.shopItemId === added.id;
    out.curatedPrice = sdata.rows[0]?.price;               // 77 (override)

    // fullSearch ON → whole visible catalog, with the curated item featured.
    await shop.update({ "system.fullSearch": true });
    sf = new mod.CatalogBrowser(buyer, { shop, mode: "storefront" });
    sdata = await sf.getData();
    out.fullSearch = sdata.fullSearch;                     // true
    out.fullRowCountBig = sdata.rowCount > 1;              // true (whole catalog)
    const feat = sdata.rows.find(r => r.shopItemId === added.id);
    out.featuredPresent = !!feat && feat.featured === true;
    out.featuredFirst = sdata.rows[0]?.featured === true;  // featured sorts first

    // Buy the curated item via the storefront → shop economics (override 77, no markup).
    await sf._shopBuy(added.id, { qty: 2, styleMult: 1, styleLabel: "" });
    out.buyerFunds = buyer.system.eurobucks;               // 1000 - 77×2 = 846
    out.buyerGotItem = !!buyer.items.find(i => i.name === sample.name);

    return out;
  });

  console.log("Storefront:", JSON.stringify(R, null, 2));
  expect(R.noSearch, "curated-only storefront hides the search bar").toBe(true);
  expect(R.curatedOnlyCount, "curated-only shows exactly the stocked item").toBe(1);
  expect(R.curatedRowIsCurated).toBe(true);
  expect(R.curatedPrice, "curated row uses the price override").toBe(77);
  expect(R.fullSearch).toBe(true);
  expect(R.fullRowCountBig, "fullSearch shows the whole catalog").toBe(true);
  expect(R.featuredPresent, "curated item is featured in fullSearch").toBe(true);
  expect(R.featuredFirst, "featured rows sort first").toBe(true);
  expect(R.buyerFunds, "storefront buy charges override 77 × 2").toBe(846);
  expect(R.buyerGotItem).toBe(true);
});

test("singletons: re-opening focuses one window (global catalog + per-shop)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const out = {};
    await game.settings.set("cyberpunk2020", "shoppingEnabled", true);
    const flags = { cyberpunk2020: { __pwtest: true } };
    const mod = await import("/systems/cyberpunk2020/module/shop/catalog.js");
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const browsers = (pred = () => true) => Object.values(ui.windows).filter(w => w instanceof mod.CatalogBrowser && pred(w));
    for (const w of browsers()) await w.close();
    await wait(100);
    await mod.getCatalogIndex();   // warm the index so windows render (and register) promptly

    // Global catalog opened twice → still ONE window.
    mod.openCatalogBrowser(null); await wait(300);
    mod.openCatalogBrowser(null); await wait(300);
    out.globalCount = browsers(w => !w.shop).length;       // 1

    // A shop opened twice in build mode → ONE window for that shop.
    const shop = await Actor.create({ name: "__PW__singShop", type: "shop", flags, system: { open: false } });
    mod.openShopBuilder(shop); await wait(150);
    mod.openShopBuilder(shop); await wait(150);
    out.shopCount = browsers(w => w.shop?.id === shop.id).length; // 1

    // Switching to the storefront REUSES that same shop window (mode flips, no duplicate).
    mod.openShopStorefront(shop, null); await wait(150);
    out.shopCountAfterStore = browsers(w => w.shop?.id === shop.id).length; // 1
    out.storeMode = browsers(w => w.shop?.id === shop.id)[0]?.mode;         // "storefront"

    for (const w of browsers()) await w.close();
    return out;
  });

  console.log("Singletons:", JSON.stringify(R));
  expect(R.globalCount, "one global catalog window").toBe(1);
  expect(R.shopCount, "one window per shop").toBe(1);
  expect(R.shopCountAfterStore, "storefront reuses the shop window").toBe(1);
  expect(R.storeMode).toBe("storefront");
});
