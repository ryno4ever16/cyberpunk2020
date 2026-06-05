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
