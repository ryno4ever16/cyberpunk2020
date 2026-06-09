import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Shopping (round-7: shops are world DATA, not Actors). Covers canonicity visibility, the category
 * taxonomy, the catalog index (no skills), ShopDef pricing (per-item override × shop discount), the
 * catalog window render, and a player buying from a published ShopDef with the GM stock-decrement relay.
 */

async function resetShops(page) {
  await evalGameOrThrow(page, async () => {
    for (const [k, v] of [["shoppingEnabled", true], ["shopAllowHomebrew", false], ["shopShowSource", true]]) { try { await game.settings.set("cyberpunk2020", k, v); } catch {} }
    for (const k of ["shopEnabledSources", "shops"]) { try { await game.settings.set("cyberpunk2020", k, {}); } catch {} }
  });
}

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); await resetShops(p); } catch {}
  await ctx.close();
});

test("canonicity, categories, catalog index (no skills), ShopDef pricing", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const out = {};
    const sup = await import("/systems/cyberpunk2020/module/shop/supplements.js");
    const cat = await import("/systems/cyberpunk2020/module/shop/categories.js");
    const pur = await import("/systems/cyberpunk2020/module/shop/purchase.js");
    const shops = await import("/systems/cyberpunk2020/module/shop/shops.js");

    // classifySupplement (incl. round-7 name fixes)
    out.cCore = sup.classifySupplement("Cyberpunk 2020").canon;
    out.cOfficial = sup.classifySupplement("Maximum Metal").canon;
    out.cNoncanon = sup.classifySupplement("Shadowrun").canon;
    out.cChromeLegacy = sup.classifySupplement("Chrome 2").supplement;     // "Chromebook 2" (split)
    out.cCorp = sup.classifySupplement("Corporate Report 2").supplement;   // "Corporate Report"
    out.cEurotour = sup.classifySupplement("Eurotour p.29").supplement;    // "Eurotour"

    // visibility tiers
    const cfgOff = { allowHomebrew: false, enabledSources: {} };
    out.coreVisPlayer = sup.isVisibleTo("Cyberpunk 2020 (Core)", "core", cfgOff, false);
    out.offVisPlayerDefault = sup.isVisibleTo("Maximum Metal", "official", cfgOff, false);
    out.offVisGM = sup.isVisibleTo("Maximum Metal", "official", cfgOff, true);
    out.homebrewAbsentGM = sup.isVisibleTo("Shadowrun", "noncanon", cfgOff, true);

    // categories
    out.catPistols = cat.categoryOfPack("pistols");
    out.catLimbs = cat.categoryOfPack("cyberlimbs");
    const packNames = cat.catalogPacks().map(p => p.metadata.name);
    out.excludesSkills = !packNames.some(n => /skill/i.test(n));
    out.excludesAmmo = !packNames.includes("ammo");

    // priceFor (style only — no markup)
    out.priceBase = pur.priceFor({ system: { cost: 100 } });
    out.priceStyle = pur.priceFor({ system: { cost: 100 } }, { styleMult: 3 });

    // ShopDef pricing: per-item override × shop discount
    const def = { id: "x", discountPct: 0, items: { "p.i": { price: 30, unlimited: true, qty: 0, fashion: false } } };
    out.effOverride = shops.effectivePrice(def, "p.i", 100, 1);          // 30
    out.effCatalog = shops.effectivePrice(def, "p.j", 100, 1);           // 100 (no override → catalog)
    out.effDiscount = shops.effectivePrice({ ...def, discountPct: 50 }, "p.i", 100, 1); // 15
    out.effStyle = shops.effectivePrice(def, "p.i", 100, 2);             // 60 (30 × style2)
    return out;
  });

  console.log("Shop:", JSON.stringify(R, null, 2));
  expect(R.cCore).toBe("core");
  expect(R.cOfficial).toBe("official");
  expect(R.cNoncanon).toBe("noncanon");
  expect(R.cChromeLegacy, "legacy Chrome 2 -> Chromebook 2 (split)").toBe("Chromebook 2");
  expect(R.cCorp).toBe("Corporate Report");
  expect(R.cEurotour).toBe("Eurotour");
  expect(R.coreVisPlayer).toBe(true);
  expect(R.offVisPlayerDefault).toBe(false);
  expect(R.offVisGM).toBe(true);
  expect(R.homebrewAbsentGM).toBe(false);
  expect(R.catPistols).toEqual({ category: "Weapons", sub: "Pistols" });
  expect(R.catLimbs).toEqual({ category: "Cyberware", sub: "Cyberlimbs" });
  expect(R.excludesSkills).toBe(true);
  expect(R.excludesAmmo).toBe(true);
  expect(R.priceBase).toBe(100);
  expect(R.priceStyle).toBe(300);
  expect(R.effOverride, "per-item override").toBe(30);
  expect(R.effCatalog, "no override → catalog cost").toBe(100);
  expect(R.effDiscount, "50% shop discount on 30").toBe(15);
  expect(R.effStyle, "style ×2 on 30").toBe(60);
});

test("catalog view renders: no skills, category filters, GM source panel", async ({ page }) => {
  await login(page, ACCOUNTS.gm);

  const R = await evalGameOrThrow(page, async () => {
    await game.settings.set("cyberpunk2020", "shoppingEnabled", true);
    const flags = { cyberpunk2020: { __pwtest: true } };
    const buyer = await Actor.create({ name: "__PW__catbuyer", type: "character", flags, system: { eurobucks: 500 } });
    const mod = await import("/systems/cyberpunk2020/module/shop/catalog.js");
    const app = new mod.CatalogBrowser(buyer, { view: "catalog" });
    const data = await app.getData();
    const out = { rowCount: data.rowCount, noSkillType: !data.rows.some(r => r.type === "skill"), hasWeaponsCat: data.cats.some(c => c.key === "Weapons" && c.subs.length > 0), hasSourcePanel: !!data.sourcePanel };
    app.render(true);
    const dl = Date.now() + 9000;
    let el = null;
    while (Date.now() < dl) { el = document.querySelector(".cp-catalog-window"); if (el?.querySelector(".cp-catalog-row, .cp-cat-chip")) break; await new Promise(r => setTimeout(r, 200)); }
    out.domHasChips = !!el?.querySelector(".cp-cat-chip");
    out.domHasSources = !!el?.querySelector(".cp-catalog-sources");
    for (const a of Object.values(ui.windows)) { if (a?.options?.classes?.includes?.("cp-catalog")) a.close(); }
    return out;
  });

  console.log("Catalog render:", JSON.stringify(R));
  expect(R.rowCount).toBeGreaterThan(0);
  expect(R.noSkillType).toBe(true);
  expect(R.hasWeaponsCat).toBe(true);
  expect(R.hasSourcePanel).toBe(true);
  expect(R.domHasChips).toBe(true);
  expect(R.domHasSources).toBe(true);
});

test("player buys from a published ShopDef; limited stock depletes via GM relay", async ({ browser }) => {
  const gmCtx = await browser.newContext({ ignoreHTTPSErrors: true });
  const gm = await gmCtx.newPage();
  const plCtx = await browser.newContext({ ignoreHTTPSErrors: true });
  const pl = await plCtx.newPage();
  try {
    await login(gm, ACCOUNTS.gm);
    await cleanupTestData(gm).catch(() => {});
    const ids = await evalGameOrThrow(gm, async () => {
      await game.settings.set("cyberpunk2020", "shoppingEnabled", true);
      const flags = { cyberpunk2020: { __pwtest: true } };
      const player = game.users.find(u => u.name === "Test User 1");
      const buyer = await Actor.create({ name: "__PW__pbuyer", type: "character", flags, system: { eurobucks: 500 }, ownership: { default: 0, [player.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER } });
      const shopsMod = await import("/systems/cyberpunk2020/module/shop/catalog.js");
      const shops = await import("/systems/cyberpunk2020/module/shop/shops.js");
      // A real catalog item (core weapon) to stock.
      const index = await shopsMod.getCatalogIndex();
      const sample = index.find(i => i.category === "Weapons" && i.canon === "core") || index.find(i => i.category === "Weapons");
      const def = await shops.createShop({ name: "__PW__pshop" });
      await shops.addShopItem(def.id, sample.key);
      await shops.setShopItem(def.id, sample.key, { price: 50, unlimited: false, qty: 4 });
      await shops.updateShop(def.id, { open: true });
      return { buyerId: buyer.id, shopId: def.id, sourceKey: sample.key };
    });

    await login(pl, ACCOUNTS.player1);
    const buyRes = await evalGameOrThrow(pl, async (o) => {
      const mod = await import("/systems/cyberpunk2020/module/shop/catalog.js");
      const buyer = game.actors.get(o.buyerId);
      const win = new mod.CatalogBrowser(buyer, { view: "storefront", shopId: o.shopId });
      await win._shopBuy(o.sourceKey, { qty: 2, styleMult: 1, styleLabel: "" });
      return { isGM: game.user.isGM, funds: buyer.system.eurobucks, hasItem: buyer.items.size > 0, seesActiveGM: !!game.users.activeGM };
    }, ids);

    const stockLeft = await evalGameOrThrow(gm, async (o) => {
      const shops = await import("/systems/cyberpunk2020/module/shop/shops.js");
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) { const q = shops.getShop(o.shopId)?.items?.[o.sourceKey]?.qty; if (q === 2) return q; await new Promise(r => setTimeout(r, 250)); }
      return shops.getShop(o.shopId)?.items?.[o.sourceKey]?.qty;
    }, ids);

    console.log("Player buy:", JSON.stringify(buyRes), "stockLeft:", stockLeft);
    expect(buyRes.isGM).toBe(false);
    expect(buyRes.funds, "player charged 500 - 50×2").toBe(400);
    expect(buyRes.hasItem).toBe(true);
    expect(stockLeft, "limited stock depleted 4→2 via GM relay").toBe(2);

    await cleanupTestData(gm).catch(() => {});
    await resetShops(gm).catch(() => {});
  } finally {
    await plCtx.close();
    await gmCtx.close();
  }
});
