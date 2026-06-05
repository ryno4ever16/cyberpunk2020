import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Vehicle — Phase 5e: area weapons + composite armor.
 *   - Composite Armor halves the Penetration of shaped-charge (HEAT) weapons only (MM p.23).
 *   (Burst / cone template geometry is covered by the pure helpers below as 5e progresses.)
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("Phase 5e: composite armor halves HEAT Penetration (MM p.23)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const VD = await import("/systems/cyberpunk2020/module/vehicle/vehicle-damage.js");
    const out = {};
    let compVeh, plainVeh;
    const mk = (name, composite) => Actor.createDocuments([{
      name, type: "vehicle",
      system: { sdp: { value: 200, max: 200 }, sp: { front: 0, side: 0, rear: 0, top: 0, bottom: 0 }, compositeArmor: composite }
    }]).then(a => a[0]);
    try {
      compVeh = await mk("ZZTEST comp veh", true);
      plainVeh = await mk("ZZTEST plain veh", false);
      out.heatComposite   = (await VD.applyVehicleDamageMM(compVeh,  { basePen: 8, heat: true })).pen;                    // 4 (halved)
      out.hiExComposite   = (await VD.applyVehicleDamageMM(compVeh,  { basePen: 8, heat: false, hefPenetrator: true })).pen; // 8 (composite halves HEAT only)
      out.heatPlain       = (await VD.applyVehicleDamageMM(plainVeh, { basePen: 8, heat: true })).pen;                    // 8 (no composite)
    } finally {
      if (compVeh) await compVeh.delete().catch(() => {});
      if (plainVeh) await plainVeh.delete().catch(() => {});
      for (const a of game.actors.filter(x => x.name?.startsWith("ZZTEST"))) await a.delete().catch(() => {});
    }
    return out;
  });

  console.log("Phase 5e composite:", JSON.stringify(R));
  expect(R.heatComposite).toBe(4);   // HEAT Pen 8 → 4 vs composite
  expect(R.hiExComposite).toBe(8);   // a regular Hi-Ex round is NOT halved by composite
  expect(R.heatPlain).toBe(8);       // no composite → full HEAT Pen
});

test("Phase 5e: burst + cone geometry (pure)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);

  const R = await evalGameOrThrow(page, async () => {
    const A = await import("/systems/cyberpunk2020/module/vehicle/vehicle-area.js");
    const out = {};
    // Circle radius 50 around (100,100).
    out.cIn   = A.pointInCircle(120, 100, 100, 100, 50);   // dist 20 → in
    out.cEdge = A.pointInCircle(150, 100, 100, 100, 50);   // dist 50 → in
    out.cOut  = A.pointInCircle(160, 100, 100, 100, 50);   // dist 60 → out
    // Cone from origin facing east (0°), half-angle 30, range 100.
    out.coneFwd    = A.pointInCone(50, 0, 0, 0, 0, 30, 100);    // straight ahead → in
    out.coneEdge   = A.pointInCone(50, 28, 0, 0, 0, 30, 100);   // ~29.2° → in
    out.coneWide   = A.pointInCone(50, 50, 0, 0, 0, 30, 100);   // 45° → out
    out.coneBack   = A.pointInCone(-50, 0, 0, 0, 0, 30, 100);   // behind → out
    out.coneFar    = A.pointInCone(150, 0, 0, 0, 0, 30, 100);   // beyond range → out
    out.coneOrigin = A.pointInCone(0, 0, 0, 0, 0, 30, 100);     // origin → in
    return out;
  });

  console.log("Phase 5e geometry:", JSON.stringify(R));
  expect(R.cIn).toBe(true);
  expect(R.cEdge).toBe(true);
  expect(R.cOut).toBe(false);
  expect(R.coneFwd).toBe(true);
  expect(R.coneEdge).toBe(true);
  expect(R.coneWide).toBe(false);
  expect(R.coneBack).toBe(false);
  expect(R.coneFar).toBe(false);
  expect(R.coneOrigin).toBe(true);
});
