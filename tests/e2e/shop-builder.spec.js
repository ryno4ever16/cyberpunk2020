import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Round-7 shops-as-data: a single window with a home directory + a ShopDef-driven builder/storefront.
 * Covers ShopDef CRUD, the builder vendor tray + inShop flags + economics + bulk add, the storefront
 * (curated-only vs fullSearch) with shop discount, the home directory, and window singleton navigation.
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try {
    await login(p, ACCOUNTS.gm);
    await cleanupTestData(p);
    await evalGameOrThrow(p, async () => {
      try { await game.settings.set("cyberpunk2020", "shoppingEnabled", false); } catch {}
      try { await game.settings.set("cyberpunk2020", "shops", {}); } catch {}
      try { const mod = await import("/systems/cyberpunk2020/module/shop/catalog.js"); for (const w of Object.values(ui.windows)) if (w instanceof mod.CatalogBrowser) await w.close(); } catch {}
    });
  } catch {}
  await ctx.close();
});

test("builder: ShopDef CRUD, vendor tray, inShop flags, economics, bulk add, remove", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await evalGameOrThrow(page, async () => { try { await game.settings.set("cyberpunk2020", "shops", {}); } catch {} });

  const R = await evalGameOrThrow(page, async () => {
    const out = {};
    await game.settings.set("cyberpunk2020", "shoppingEnabled", true);
    const mod = await import("/systems/cyberpunk2020/module/shop/catalog.js");
    const shops = await import("/systems/cyberpunk2020/module/shop/shops.js");

    const index = await mod.getCatalogIndex();
    const sample = index.find(i => i.category === "Weapons" && i.canon === "core" && i.cost > 0) || index.find(i => i.cost > 0);
    const extra = index.find(i => i.key !== sample.key && i.canon === "core");

    const def = await shops.createShop({ name: "__PW__build" });
    out.created = !!def && def.name === "__PW__build";

    await shops.addShopItem(def.id, sample.key);
    out.dupRejected = (await shops.addShopItem(def.id, sample.key)) === false;

    const builder = new mod.CatalogBrowser(null, { view: "build", shopId: def.id });
    let data = await builder.getData();
    out.isBuild = data.isBuild;
    out.vendorHasItem = data.vendor.some(v => v.sourceKey === sample.key);
    out.vendorCount = data.vendorCount;                                   // 1
    const row = data.rows.find(r => r.key === sample.key);
    out.rowInShop = !!row?.inShop;
    // default vendor price (no override) resolves to the catalog cost — NOT 0 (regression: a null
    // price override was being coerced to 0 by Number(null), making un-priced items free).
    const v0 = data.vendor.find(x => x.sourceKey === sample.key);
    out.sampleCost = sample.cost;          // > 0
    out.defaultEff = v0?.eff;              // == sample.cost

    // economics: price override + limited stock → effective price + vendor reflects
    await shops.setShopItem(def.id, sample.key, { price: 99, unlimited: false, qty: 3 });
    data = await builder.getData();
    const v = data.vendor.find(x => x.sourceKey === sample.key);
    out.vEff = v?.eff;          // 99
    out.vQty = v?.qty;          // 3
    out.vUnlimited = v?.unlimited; // false

    // bulk add: add the extra by API (the UI "Add all shown" calls addShopItems)
    await shops.addShopItems(def.id, [{ sourceKey: extra.key }]);
    out.afterBulk = Object.keys(shops.getShop(def.id).items).length; // 2

    // remove
    await shops.removeShopItem(def.id, sample.key);
    out.afterRemove = Object.keys(shops.getShop(def.id).items).length; // 1
    const data2 = await builder.getData();
    out.rowNoLongerInShop = !data2.rows.find(r => r.key === sample.key)?.inShop;

    await shops.deleteShop(def.id);
    out.deleted = shops.getShop(def.id) === null;
    return out;
  });

  console.log("Builder:", JSON.stringify(R, null, 2));
  expect(R.created).toBe(true);
  expect(R.dupRejected).toBe(true);
  expect(R.isBuild).toBe(true);
  expect(R.vendorHasItem).toBe(true);
  expect(R.vendorCount).toBe(1);
  expect(R.rowInShop).toBe(true);
  expect(R.sampleCost, "sample has a real cost").toBeGreaterThan(0);
  expect(R.defaultEff, "default vendor price = catalog cost (resolved, not 0)").toBe(R.sampleCost);
  expect(R.vEff, "override price").toBe(99);
  expect(R.vQty).toBe(3);
  expect(R.vUnlimited).toBe(false);
  expect(R.afterBulk).toBe(2);
  expect(R.afterRemove).toBe(1);
  expect(R.rowNoLongerInShop).toBe(true);
  expect(R.deleted).toBe(true);
});

test("storefront: curated-only vs fullSearch; shop discount applied on buy", async ({ page }) => {
  await login(page, ACCOUNTS.gm);

  const R = await evalGameOrThrow(page, async () => {
    const out = {};
    await game.settings.set("cyberpunk2020", "shoppingEnabled", true);
    const flags = { cyberpunk2020: { __pwtest: true } };
    const mod = await import("/systems/cyberpunk2020/module/shop/catalog.js");
    const shops = await import("/systems/cyberpunk2020/module/shop/shops.js");

    const index = await mod.getCatalogIndex();
    const sample = index.find(i => i.category === "Weapons" && i.canon === "core") || index.find(i => i.category === "Weapons");
    const def = await shops.createShop({ name: "__PW__front" });
    await shops.addShopItem(def.id, sample.key);
    await shops.setShopItem(def.id, sample.key, { price: 100, unlimited: true });
    await shops.updateShop(def.id, { open: true, discountPct: 20 });

    const buyer = await Actor.create({ name: "__PW__frontbuyer", type: "character", flags, system: { eurobucks: 1000 } });

    // curated-only (fullSearch off): exactly the one stocked item, lighter chrome (no filters)
    let sf = new mod.CatalogBrowser(buyer, { view: "storefront", shopId: def.id });
    let d = await sf.getData();
    out.curatedCount = d.rowCount;             // 1
    out.curatedCurated = d.rows[0]?.curated === true;
    out.noFilters = d.showFilters !== true;    // lighter chrome
    out.discPrice = d.rows[0]?.eff;            // 100 × (1-0.2) = 80

    // fullSearch ON: whole catalog + curated featured
    await shops.updateShop(def.id, { fullSearch: true });
    sf = new mod.CatalogBrowser(buyer, { view: "storefront", shopId: def.id });
    d = await sf.getData();
    out.fullBig = d.rowCount > 1;
    out.featured = d.rows.find(r => r.sourceKey === sample.key)?.featured === true;

    // buy applies the discount
    await sf._shopBuy(sample.key, { qty: 1, styleMult: 1, styleLabel: "" });
    out.funds = buyer.system.eurobucks;        // 1000 - 80 = 920

    await shops.deleteShop(def.id);
    return out;
  });

  console.log("Storefront:", JSON.stringify(R, null, 2));
  expect(R.curatedCount).toBe(1);
  expect(R.curatedCurated).toBe(true);
  expect(R.noFilters, "curated storefront drops the heavy filters").toBe(true);
  expect(R.discPrice, "100 with 20% shop discount").toBe(80);
  expect(R.fullBig).toBe(true);
  expect(R.featured).toBe(true);
  expect(R.funds, "charged the discounted 80").toBe(920);
});

test("home directory + singleton window navigation", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await evalGameOrThrow(page, async () => { try { await game.settings.set("cyberpunk2020", "shops", {}); } catch {} });

  const R = await evalGameOrThrow(page, async () => {
    const out = {};
    await game.settings.set("cyberpunk2020", "shoppingEnabled", true);
    await game.settings.set("cyberpunk2020", "shops", {}); // clear (incl. any one-time migration output)
    const mod = await import("/systems/cyberpunk2020/module/shop/catalog.js");
    const shops = await import("/systems/cyberpunk2020/module/shop/shops.js");
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const wins = () => Object.values(ui.windows).filter(w => w instanceof mod.CatalogBrowser);
    for (const w of wins()) await w.close();

    const a = await shops.createShop({ name: "__PW__home1" });
    await shops.createShop({ name: "__PW__home2" });

    // home directory lists Catalog + the shops
    const home = new mod.CatalogBrowser(null, { view: "home" });
    const hd = await home.getData();
    out.homeShops = hd.shops.length;       // 2
    out.canCreate = hd.canCreate;          // GM

    // singleton: openShopWindow twice → one window; navigation reuses it
    mod.openShopWindow(null, { view: "home" }); await wait(300);
    mod.openShopWindow(null, { view: "home" }); await wait(300);
    out.windowCount = wins().length;       // 1
    // home cards are normal-sized, not stretched to fill the window (regression guard)
    const cards = [...(wins()[0]?.element?.[0]?.querySelectorAll(".cp-home-entry") ?? [])].map(b => Math.round(b.getBoundingClientRect().height));
    out.cardCount = cards.length;          // Catalog + 2 shops + Create = 4
    out.maxCardH = Math.max(0, ...cards);  // ~80, not ~300
    mod.openShopWindow(null, { view: "build", shopId: a.id }); await wait(250);
    out.stillOne = wins().length;          // 1
    out.nowBuild = wins()[0]?.view;        // "build"

    for (const w of wins()) await w.close();
    await shops.deleteShop(a.id);
    await game.settings.set("cyberpunk2020", "shops", {});
    return out;
  });

  console.log("Home/singleton:", JSON.stringify(R));
  expect(R.homeShops, "home lists both shops").toBe(2);
  expect(R.canCreate, "GM can create").toBe(true);
  expect(R.windowCount, "one shop window (singleton)").toBe(1);
  expect(R.stillOne, "navigation reuses the window").toBe(1);
  expect(R.nowBuild).toBe("build");
  expect(R.cardCount, "Catalog + 2 shops + Create").toBe(4);
  expect(R.maxCardH, "home cards are normal-sized, not stretched").toBeGreaterThan(0);
  expect(R.maxCardH, "home cards are normal-sized, not stretched").toBeLessThan(140);
});
