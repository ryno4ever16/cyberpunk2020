import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Shopping (rebuilt 2026-06-07): canonicity visibility (core/official/homebrew), category taxonomy,
 * override pricing (no zone markup), the catalog index (no skills), shop-stock type filtering, and
 * the player-buy → GM stock-depletion relay.
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try {
    await login(p, ACCOUNTS.gm);
    await cleanupTestData(p);
    await evalGameOrThrow(p, async () => {
      for (const [k, v] of [["shoppingEnabled", false], ["shopAllowHomebrew", false], ["shopShowSource", true]]) { try { await game.settings.set("cyberpunk2020", k, v); } catch {} }
      try { await game.settings.set("cyberpunk2020", "shopEnabledSources", {}); } catch {}
    });
  } catch {}
  await ctx.close();
});

test("canonicity, categories, override pricing, catalog index (no skills), shop stock filter", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const out = {};
    const flags = { cyberpunk2020: { __pwtest: true } };
    const sup = await import("/systems/cyberpunk2020/module/shop/supplements.js");
    const cat = await import("/systems/cyberpunk2020/module/shop/categories.js");
    const pur = await import("/systems/cyberpunk2020/module/shop/purchase.js");

    // ── classifySupplement ──────────────────────────────────────────
    out.cCore = sup.classifySupplement("Cyberpunk 2020").canon;          // core
    out.cOfficial = sup.classifySupplement("Maximum Metal").canon;       // official
    out.cNoncanon = sup.classifySupplement("Shadowrun").canon;           // noncanon
    out.cUrl = sup.classifySupplement("https://datafortress2020.com/").canon; // noncanon
    out.cUntagged = sup.classifySupplement("").canon;                    // core (untagged)

    // ── visibility tiers ────────────────────────────────────────────
    const cfgOff = { allowHomebrew: false, enabledSources: {} };
    out.coreVisPlayer = sup.isVisibleTo("Cyberpunk 2020 (Core)", "core", cfgOff, false); // true
    out.offVisPlayerDefault = sup.isVisibleTo("Maximum Metal", "official", cfgOff, false); // false (off)
    out.offVisGM = sup.isVisibleTo("Maximum Metal", "official", cfgOff, true);            // true (GM sees)
    out.offVisPlayerEnabled = sup.isVisibleTo("Maximum Metal", "official", { allowHomebrew: false, enabledSources: { "Maximum Metal": true } }, false); // true
    out.homebrewAbsentGM = sup.isVisibleTo("Shadowrun", "noncanon", cfgOff, true);        // false (absent even for GM)
    out.homebrewGMAfterAllow = sup.isVisibleTo("Shadowrun", "noncanon", { allowHomebrew: true, enabledSources: {} }, true); // true (GM)
    out.homebrewPlayerAfterAllowOnly = sup.isVisibleTo("Shadowrun", "noncanon", { allowHomebrew: true, enabledSources: {} }, false); // false (not enabled)

    // ── categories ──────────────────────────────────────────────────
    out.catPistols = cat.categoryOfPack("pistols");            // Weapons/Pistols
    out.catComm = cat.categoryOfPack("communication");         // Gear/Communication
    out.catLimbs = cat.categoryOfPack("cyberlimbs");           // Cyberware/Cyberlimbs
    out.catNet = cat.categoryOfPack("netrunningEquipment");    // Netrunning
    out.catUnknown = cat.categoryOfPack("zzz-nope");           // Gear/Other
    const packNames = cat.catalogPacks().map(p => p.metadata.name);
    out.excludesSkills = !packNames.some(n => /skill/i.test(n));
    out.excludesAmmo = !packNames.includes("ammo");
    out.excludesSell = !packNames.includes("sellthedead");

    // ── override pricing (no markup) ────────────────────────────────
    out.priceBase = pur.priceFor({ system: { cost: 100 } });                 // 100
    out.priceStyle = pur.priceFor({ system: { cost: 100 } }, { styleMult: 3 }); // 300
    const shop = await Actor.create({ name: "__PW__shop", type: "shop", flags, system: { open: true } });
    out.freshShopSkills = shop.items.filter(i => i.type === "skill").length; // 0 — shops must NOT be seeded with default skills
    const [it] = await shop.createEmbeddedDocuments("Item", [{
      name: "__PW__Jacket", type: "misc", system: { cost: 50 },
      flags: { cyberpunk2020: { shop: { unlimited: false, qty: 5, price: 30 } } } }]); // override 30
    const buyer = await Actor.create({ name: "__PW__buyer", type: "character", flags, system: { eurobucks: 1000 } });
    out.buyOverrideOk = await pur.buyFromShop(shop, buyer, it, { qty: 2 });
    out.buyerFunds = buyer.system.eurobucks;                                   // 1000 - 30×2 = 940
    out.stockLeft = it.getFlag("cyberpunk2020", "shop")?.qty;                  // 3

    // ── shop stock via the BUILDER (drag-to-stock sheet retired): skills excluded; off-catalog items
    //    (no sourceKey) surface as "extras"; no skill-type rows ──────────────────────────────────
    await shop.createEmbeddedDocuments("Item", [{ name: "__PW__AVTech", type: "skill", system: { level: 0 } }]);
    const catmod = await import("/systems/cyberpunk2020/module/shop/catalog.js");
    const builder = new catmod.CatalogBrowser(null, { shop, mode: "build" });
    const bdata = await builder.getData();
    out.builderMode = bdata.mode;                                             // "build"
    out.extrasHasJacket = bdata.extras.some(r => r.name === "__PW__Jacket");  // true (no sourceKey → extra)
    out.extrasHasSkill = bdata.extras.some(r => r.name === "__PW__AVTech");   // false (skills excluded)
    out.rowsNoSkill = !bdata.rows.some(r => r.type === "skill");              // true

    return out;
  });

  console.log("Shop rebuild:", JSON.stringify(R, null, 2));

  expect(R.cCore).toBe("core");
  expect(R.cOfficial).toBe("official");
  expect(R.cNoncanon).toBe("noncanon");
  expect(R.cUrl).toBe("noncanon");
  expect(R.cUntagged).toBe("core");

  expect(R.coreVisPlayer, "core always visible").toBe(true);
  expect(R.offVisPlayerDefault, "official off for players by default").toBe(false);
  expect(R.offVisGM, "GM sees official").toBe(true);
  expect(R.offVisPlayerEnabled, "enabled official visible to players").toBe(true);
  expect(R.homebrewAbsentGM, "homebrew absent even for GM until allowed").toBe(false);
  expect(R.homebrewGMAfterAllow, "GM sees homebrew after allow").toBe(true);
  expect(R.homebrewPlayerAfterAllowOnly, "homebrew still off for players until enabled").toBe(false);

  expect(R.catPistols).toEqual({ category: "Weapons", sub: "Pistols" });
  expect(R.catComm).toEqual({ category: "Gear", sub: "Communication" });
  expect(R.catLimbs).toEqual({ category: "Cyberware", sub: "Cyberlimbs" });
  expect(R.catNet.category).toBe("Netrunning");
  expect(R.catUnknown).toEqual({ category: "Gear", sub: "Other" });
  expect(R.excludesSkills, "catalog excludes skills packs").toBe(true);
  expect(R.excludesAmmo).toBe(true);
  expect(R.excludesSell).toBe(true);

  expect(R.priceBase).toBe(100);
  expect(R.priceStyle).toBe(300);
  expect(R.buyOverrideOk).toBe(true);
  expect(R.buyerFunds, "override 30 × 2, no markup").toBe(940);
  expect(R.stockLeft, "limited stock depleted 5→3").toBe(3);

  expect(R.freshShopSkills, "fresh shop is NOT seeded with default skills").toBe(0);
  expect(R.builderMode).toBe("build");
  expect(R.extrasHasJacket, "off-catalog stock shows as a builder extra").toBe(true);
  expect(R.extrasHasSkill, "skills excluded from shop stock").toBe(false);
  expect(R.rowsNoSkill, "no skill-type rows in the builder").toBe(true);
});

test("catalog renders: no skills, category filters, GM source panel", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const flags = { cyberpunk2020: { __pwtest: true } };
    const buyer = await Actor.create({ name: "__PW__catbuyer", type: "character", flags, system: { eurobucks: 500 } });
    const mod = await import("/systems/cyberpunk2020/module/shop/catalog.js");
    const app = new mod.CatalogBrowser(buyer);
    const data = await app.getData();
    const out = {
      rowCount: data.rowCount,
      noSkills: !data.rows.some(r => /av\s*tech|accounting|athletics/i.test(r.name) && r.type === "skill"),
      noSkillType: !data.rows.some(r => r.type === "skill"),
      hasCats: data.cats.length > 0,
      hasWeaponsCat: data.cats.some(c => c.key === "Weapons" && c.subs.length > 0),
      hasSourcePanel: !!data.sourcePanel,
      // render DOM
    };
    app.render(true);
    const dl = Date.now() + 9000;
    let el = null;
    while (Date.now() < dl) { el = document.querySelector(".cp-catalog-window"); if (el?.querySelector(".cp-catalog-row, .cp-cat-chip")) break; await new Promise(r => setTimeout(r, 200)); }
    out.domRendered = !!el;
    out.domHasChips = !!el?.querySelector(".cp-cat-chip");
    out.domHasSearch = !!el?.querySelector(".cp-catalog-search");
    out.domHasSources = !!el?.querySelector(".cp-catalog-sources");
    for (const a of Object.values(ui.windows)) { if (a?.options?.classes?.includes?.("cp-catalog")) a.close(); }
    return out;
  });

  console.log("Catalog render:", JSON.stringify(R));
  expect(R.rowCount, "catalog has items").toBeGreaterThan(0);
  expect(R.noSkillType, "no skill-type items in catalog").toBe(true);
  expect(R.hasCats).toBe(true);
  expect(R.hasWeaponsCat, "Weapons category with sub-types").toBe(true);
  expect(R.hasSourcePanel, "GM source panel present").toBe(true);
  expect(R.domRendered).toBe(true);
  expect(R.domHasChips).toBe(true);
  expect(R.domHasSearch).toBe(true);
  expect(R.domHasSources, "GM sees source controls").toBe(true);
});

test("player buys from a published shop; limited stock depletes via GM relay", async ({ browser }) => {
  const gmCtx = await browser.newContext({ ignoreHTTPSErrors: true });
  const gm = await gmCtx.newPage();
  const plCtx = await browser.newContext({ ignoreHTTPSErrors: true });
  const pl = await plCtx.newPage();
  try {
    await login(gm, ACCOUNTS.gm);
    await cleanupTestData(gm).catch(() => {});
    const ids = await evalGameOrThrow(gm, async () => {
      const flags = { cyberpunk2020: { __pwtest: true } };
      const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER, OBSERVER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER;
      const player = game.users.find(u => u.name === "Test User 1");
      const buyer = await Actor.create({ name: "__PW__pbuyer", type: "character", flags, system: { eurobucks: 500 }, ownership: { default: 0, [player.id]: OWNER } });
      const shop = await Actor.create({ name: "__PW__pshop", type: "shop", flags, system: { open: true }, ownership: { default: OBSERVER } });
      const [item] = await shop.createEmbeddedDocuments("Item", [{ name: "__PW__pgood", type: "misc", system: { cost: 50 }, flags: { cyberpunk2020: { shop: { unlimited: false, qty: 4 } } } }]);
      return { buyerId: buyer.id, shopId: shop.id, itemId: item.id };
    });

    await login(pl, ACCOUNTS.player1);
    const buyRes = await evalGameOrThrow(pl, async (o) => {
      const pur = await import("/systems/cyberpunk2020/module/shop/purchase.js");
      const shop = game.actors.get(o.shopId), buyer = game.actors.get(o.buyerId), item = shop.items.get(o.itemId);
      const ok = await pur.buyFromShop(shop, buyer, item, { qty: 2 });
      return { ok, isGM: game.user.isGM, funds: buyer.system.eurobucks, hasItem: !!buyer.items.find(i => i.name === "__PW__pgood"), seesActiveGM: !!game.users.activeGM };
    }, ids);

    const stockLeft = await evalGameOrThrow(gm, async (o) => {
      const shop = game.actors.get(o.shopId);
      const deadline = Date.now() + 12000;
      while (Date.now() < deadline) { const q = shop.items.get(o.itemId)?.getFlag("cyberpunk2020", "shop")?.qty; if (q === 2) return q; await new Promise(r => setTimeout(r, 250)); }
      return shop.items.get(o.itemId)?.getFlag("cyberpunk2020", "shop")?.qty;
    }, ids);

    console.log("Player buy:", JSON.stringify(buyRes), "stockLeft:", stockLeft);
    expect(buyRes.isGM).toBe(false);
    expect(buyRes.ok).toBe(true);
    expect(buyRes.funds, "player charged 500 - 50×2 (no markup)").toBe(400);
    expect(buyRes.hasItem).toBe(true);
    expect(stockLeft, "limited stock depleted 4→2 via GM relay").toBe(2);

    await cleanupTestData(gm).catch(() => {});
  } finally {
    await plCtx.close();
    await gmCtx.close();
  }
});
