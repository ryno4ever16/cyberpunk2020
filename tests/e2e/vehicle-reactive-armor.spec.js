import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Reactive Armor (MM p.23). Explosive tiles that may halve a shaped-charge (HEAT) attack on a 1d10
 * (2-10), the roll degraded −1 per two prior shaped-charge / high-explosive hits and a tile consumed
 * each hit (rearmed via the sheet's "Replace" button). Stacks with Composite (¼ Pen if both fire).
 *
 * Two layers of coverage:
 *  1. The PURE `reactiveDeflection` helper, deterministically — including the book's own attrition
 *     example (an APC's reactive array drops from ~90% to 60% effective after absorbing 6 HE hits).
 *  2. Integration of the wear counter through the live resolver: a shaped-charge OR a high-explosive
 *     hit consumes a tile; a plain AP round does not; the counter persists on the actor and resets.
 */
test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("reactiveDeflection: fresh ~90%, degrades to 60% at 6 hits; HE wears but never fires", async ({ page }) => {
  await login(page, ACCOUNTS.gm);

  const R = await evalGameOrThrow(page, async () => {
    const { reactiveDeflection } = await import("/systems/cyberpunk2020/module/vehicle/vehicle-damage.js");
    const out = {};
    // Fresh array: 2-10 fires the tile (90%), a 1 fails (10%).
    out.fresh2 = reactiveDeflection({ installed: true, heat: true, priorHits: 0, d10: 2 });
    out.fresh1 = reactiveDeflection({ installed: true, heat: true, priorHits: 0, d10: 1 });
    // Book example: after 6 HE hits (−3) the incoming missile deflects only on a 5-10 (60%).
    out.worn5 = reactiveDeflection({ installed: true, heat: true, priorHits: 6, d10: 5 });
    out.worn4 = reactiveDeflection({ installed: true, heat: true, priorHits: 6, d10: 4 });
    // High-explosive (non-shaped): consumes a tile, but the tile never deflects HE.
    out.he = reactiveDeflection({ installed: true, heat: false, hiEx: true, priorHits: 0, d10: 10 });
    // Plain AP (neither shaped nor HE): no fire, no wear.
    out.ap = reactiveDeflection({ installed: true, heat: false, hiEx: false, priorHits: 3, d10: 10 });
    // Not installed: nothing happens and nothing is consumed.
    out.off = reactiveDeflection({ installed: false, heat: true, priorHits: 0, d10: 10 });
    // Deflection probability across all ten faces at 0 and 6 prior hits.
    const faces = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    out.pFresh = faces.filter(f => reactiveDeflection({ installed: true, heat: true, priorHits: 0, d10: f }).deflected).length;
    out.pWorn6 = faces.filter(f => reactiveDeflection({ installed: true, heat: true, priorHits: 6, d10: f }).deflected).length;
    return out;
  });

  console.log("reactiveDeflection:", JSON.stringify(R));
  expect(R.fresh2).toMatchObject({ fired: true, deflected: true, subtract: 0, newHits: 1 });
  expect(R.fresh1).toMatchObject({ fired: true, deflected: false, subtract: 0, newHits: 1 });
  expect(R.worn5).toMatchObject({ fired: true, deflected: true, subtract: 3, newHits: 7 });
  expect(R.worn4).toMatchObject({ fired: true, deflected: false, subtract: 3, newHits: 7 });
  expect(R.he).toMatchObject({ fired: false, deflected: false, newHits: 1 });   // HE wears a tile
  expect(R.ap).toMatchObject({ fired: false, deflected: false, newHits: 3 });   // AP leaves wear unchanged
  expect(R.off).toMatchObject({ fired: false, newHits: 0 });
  expect(R.pFresh).toBe(9);   // 90%
  expect(R.pWorn6).toBe(6);   // 60% — matches the book's APC example
});

test("reactive wear counter: HEAT + HE consume a tile, plain AP does not; persists + resets", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const { applyVehicleDamageMM } = await import("/systems/cyberpunk2020/module/vehicle/vehicle-damage.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const out = {};
    let veh;
    try {
      veh = await Actor.create({ name: "__PW__REACTIVE", type: "vehicle", flags,
        system: { sp: { front: 0, side: 0, rear: 0, top: 0, bottom: 0 }, sdp: { value: 5000, max: 5000 }, reactiveArmor: true } });
      out.start = veh.system.reactiveHits;                                                  // 0 (schema default)
      await applyVehicleDamageMM(veh, { basePen: 8, heat: true, hefPenetrator: true });     // shaped → wears
      out.afterHeat = veh.system.reactiveHits;                                              // 1
      await applyVehicleDamageMM(veh, { basePen: 8, heat: false, hefPenetrator: true });    // HE → wears
      out.afterHE = veh.system.reactiveHits;                                                // 2
      await applyVehicleDamageMM(veh, { basePen: 8, heat: false, hefPenetrator: false });   // plain AP → no wear
      out.afterAP = veh.system.reactiveHits;                                                // 2
      await veh.update({ "system.reactiveHits": 0 });                                       // "Replace" rearms
      out.afterReplace = veh.system.reactiveHits;                                           // 0
    } finally {
      if (veh) await veh.delete().catch(() => {});
    }
    return out;
  });

  console.log("reactive wear:", JSON.stringify(R));
  expect(R.start).toBe(0);
  expect(R.afterHeat).toBe(1);
  expect(R.afterHE).toBe(2);
  expect(R.afterAP).toBe(2);
  expect(R.afterReplace).toBe(0);
});
