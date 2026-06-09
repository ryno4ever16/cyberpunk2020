import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Services feature (Shopping #15): classifier, one-off pay-and-confirm, recurring Pay, the
 * Services tab (gated on the Shopping setting), and a real-data classification review of the
 * Rentals & Services pack (printed for manual review — not asserted).
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

test("service classifier, one-off pay, recurring pay, gear-tab exclusion + Services tab render", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const out = {};
    const flags = { cyberpunk2020: { __pwtest: true } };
    const svc = await import("/systems/cyberpunk2020/module/shop/services.js");

    // ── classifier ──────────────────────────────────────────────────
    out.cRent  = svc.classifyService({ name: "Apartment Rent (Medium)", system: {} }, "rentalandservices"); // recurring
    out.cPhone = svc.classifyService({ name: "Cellular Phone Service", system: {} }, "rentalandservices");   // recurring
    out.cTaxi  = svc.classifyService({ name: "Taxi Fare", system: {} }, "rentalandservices");                // oneoff
    out.cClinic= svc.classifyService({ name: "Clinic Visit", system: {} }, "rentalandservices");             // oneoff
    out.cGun   = svc.classifyService({ name: "Militech Ronin", system: {} }, "weapons");                     // gear
    out.cOverride = svc.classifyService({ name: "Apartment Rent", system: { serviceMode: "gear" } }, "rentalandservices"); // gear (override wins)
    out.cServiceNoKw = svc.classifyService({ name: "Mysterious Arrangement", system: {} }, "rentalandservices"); // oneoff (in-pack default)

    // ── one-off pay-and-confirm (no item) ───────────────────────────
    const a1 = await Actor.create({ name: "__PW__svcBuyer", type: "character", flags, system: { eurobucks: 1000 } });
    out.oneoffOk = await svc.payOneOffService(a1, { name: "__PW__TaxiRide", system: { cost: 30 } }, { unitPrice: 30 });
    out.a1Funds = a1.system.eurobucks;                                   // 970
    out.a1NoItem = a1.items.filter(i => i.name === "__PW__TaxiRide").length; // 0 (no item)

    // ── recurring Pay (deduct, no item change) ──────────────────────
    const [rent] = await a1.createEmbeddedDocuments("Item", [{
      name: "__PW__Rent", type: "misc", system: { cost: 200, serviceMode: "recurring", servicePeriod: "month" } }]);
    out.payOk = await svc.payService(a1, rent);
    out.a1FundsAfterPay = a1.system.eurobucks;                           // 970 - 200 = 770
    out.rentStillThere = !!a1.items.get(rent.id);                        // true (pay doesn't remove)

    // ── gear-tab exclusion + Services tab render (shopping ON) ──────
    await game.settings.set("cyberpunk2020", "shoppingEnabled", true);
    const a2 = await Actor.create({ name: "__PW__svcSheet", type: "character", flags, system: { eurobucks: 5000 } });
    await a2.createEmbeddedDocuments("Item", [
      { name: "__PW__RentSvc", type: "misc", system: { cost: 1000, serviceMode: "recurring", servicePeriod: "month" } },
      { name: "__PW__PlainGear", type: "misc", system: { cost: 50 } }
    ]);
    a2.sheet.render(true);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) { if (a2.sheet.rendered && a2.sheet.element?.[0]?.querySelector('[data-tab="services"]')) break; await new Promise(r => setTimeout(r, 150)); }
    await new Promise(r => setTimeout(r, 300));
    const el = a2.sheet.element?.[0] ?? a2.sheet.element;
    const servicesTab = el?.querySelector('.tab[data-tab="services"]');
    const gearTab = el?.querySelector('.tab[data-tab="gear"]');
    out.hasServicesNav = !!el?.querySelector('nav [data-tab="services"]');
    out.serviceOnServicesTab = (servicesTab?.textContent || "").includes("__PW__RentSvc");
    out.serviceNotOnGearTab = !(gearTab?.textContent || "").includes("__PW__RentSvc");
    out.gearStillOnGearTab = (gearTab?.textContent || "").includes("__PW__PlainGear");
    out.hasPayButton = !!servicesTab?.querySelector(".cp-service-pay");
    await a2.sheet.close();
    await game.settings.set("cyberpunk2020", "shoppingEnabled", false);

    return out;
  });

  console.log("Services spec:", JSON.stringify(R, null, 2));

  expect(R.cRent).toBe("recurring");
  expect(R.cPhone).toBe("recurring");
  expect(R.cTaxi).toBe("oneoff");
  expect(R.cClinic).toBe("oneoff");
  expect(R.cGun).toBe("gear");
  expect(R.cOverride, "explicit serviceMode override wins").toBe("gear");
  expect(R.cServiceNoKw, "in-pack with no keyword → one-off default").toBe("oneoff");

  expect(R.oneoffOk).toBe(true);
  expect(R.a1Funds, "one-off deducts 30").toBe(970);
  expect(R.a1NoItem, "one-off creates no item").toBe(0);

  expect(R.payOk).toBe(true);
  expect(R.a1FundsAfterPay, "recurring pay deducts 200").toBe(770);
  expect(R.rentStillThere, "pay doesn't remove the service").toBe(true);

  expect(R.hasServicesNav, "Services nav tab shown when shopping is on").toBe(true);
  expect(R.serviceOnServicesTab, "recurring service appears on Services tab").toBe(true);
  expect(R.serviceNotOnGearTab, "recurring service NOT on gear tab").toBe(true);
  expect(R.gearStillOnGearTab, "plain gear stays on gear tab").toBe(true);
  expect(R.hasPayButton, "Pay button present").toBe(true);
});

test("REVIEW: classify the live Rentals & Services pack (printed, not asserted)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  const R = await evalGameOrThrow(page, async () => {
    const svc = await import("/systems/cyberpunk2020/module/shop/services.js");
    const pack = game.packs.find(p => p.metadata?.type === "Item" && /rental|service/i.test(`${p.metadata?.name} ${p.title}`));
    if (!pack) return { error: "no rentals/services pack found", packs: game.packs.filter(p => p.metadata?.type === "Item").map(p => p.metadata?.name) };
    const idx = await pack.getIndex({ fields: ["system.serviceMode", "system.source", "system.cost"] });
    const buckets = { recurring: [], oneoff: [], gear: [] };
    for (const e of idx) {
      const cls = svc.classifyService({ name: e.name, system: { serviceMode: e.system?.serviceMode, source: e.system?.source } }, pack.metadata.name);
      buckets[cls].push(`${e.name} (${e.system?.cost ?? "?"}eb)`);
    }
    return { pack: pack.metadata.name, total: idx.size ?? idx.length,
      counts: { recurring: buckets.recurring.length, oneoff: buckets.oneoff.length, gear: buckets.gear.length },
      recurring: buckets.recurring.sort(), oneoff: buckets.oneoff.sort(), gear: buckets.gear.sort() };
  });
  console.log("SERVICE_REVIEW " + JSON.stringify(R, null, 2));
  expect(R.error, R.error ? `pack not found; item packs: ${JSON.stringify(R.packs)}` : undefined).toBeUndefined();
});
