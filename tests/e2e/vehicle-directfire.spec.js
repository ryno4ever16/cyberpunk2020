import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Vehicle — Phase 5d: Class A direct-fire from the weapon Item.
 *   - rangeBand       — Normal/Long/Extreme from distance vs the weapon's range (MM p.6 falloff)
 *   - mountArcBears   — firing-arc bearing (turret 360°, fixed front, articulated side; MM p.11/15)
 *   - HEAT/Hi-Ex      — Penetration is NOT reduced by range (threaded through the MM resolver)
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("Phase 5d: range bands + arc bearing + HEAT range-immunity", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const VT = await import("/systems/cyberpunk2020/module/vehicle/vehicle-targeting.js");
    const VD = await import("/systems/cyberpunk2020/module/vehicle/vehicle-damage.js");
    const out = {};

    // Range bands (weapon range 100: ≤50 normal, ≤100 long, else extreme).
    out.rbNormal  = VT.rangeBand(40, 100);
    out.rbLong    = VT.rangeBand(80, 100);
    out.rbExtreme = VT.rangeBand(150, 100);

    // Arc bearing (where the target sits relative to the firer).
    out.arcTurret    = VT.mountArcBears("rear", "turret");   // true (360°)
    out.arcFrontOK   = VT.mountArcBears("front", "front");   // true
    out.arcFrontNo   = VT.mountArcBears("rear", "front");    // false (fixed forward)
    out.arcSideFront = VT.mountArcBears("front", "side");    // true
    out.arcSideNo    = VT.mountArcBears("rear", "side");     // false
    out.arcTopNo     = VT.mountArcBears("top", "front");     // false (no high-angle traverse)

    // HEAT / Hi-Ex range immunity (pure mmEffectivePenetration).
    out.penNormal  = VD.mmEffectivePenetration({ basePen: 8, range: "normal" });                    // 8
    out.penExtreme = VD.mmEffectivePenetration({ basePen: 8, range: "extreme" });                   // 4 (−50%)
    out.penHEAT    = VD.mmEffectivePenetration({ basePen: 8, range: "extreme", hefPenetrator: true }); // 8 (immune)

    // Through the resolver: a HEAT shell at Extreme keeps full Pen.
    let veh;
    try {
      [veh] = await Actor.createDocuments([{
        name: "ZZTEST df veh", type: "vehicle",
        system: { sdp: { value: 100, max: 100 }, sp: { front: 0, side: 0, rear: 0, top: 0, bottom: 0 } }
      }]);
      out.resolverPenHEAT = (await VD.applyVehicleDamageMM(veh, { basePen: 8, range: "extreme", hefPenetrator: true })).pen; // 8
      out.resolverPenAP   = (await VD.applyVehicleDamageMM(veh, { basePen: 8, range: "extreme" })).pen;                       // 4
    } finally {
      if (veh) await veh.delete().catch(() => {});
      for (const a of game.actors.filter(x => x.name?.startsWith("ZZTEST"))) await a.delete().catch(() => {});
    }
    return out;
  });

  console.log("Phase 5d:", JSON.stringify(R));

  expect(R.rbNormal).toBe("normal");
  expect(R.rbLong).toBe("long");
  expect(R.rbExtreme).toBe("extreme");

  expect(R.arcTurret).toBe(true);
  expect(R.arcFrontOK).toBe(true);
  expect(R.arcFrontNo).toBe(false);
  expect(R.arcSideFront).toBe(true);
  expect(R.arcSideNo).toBe(false);
  expect(R.arcTopNo).toBe(false);

  expect(R.penNormal).toBe(8);
  expect(R.penExtreme).toBe(4);
  expect(R.penHEAT).toBe(8);
  expect(R.resolverPenHEAT).toBe(8);   // HEAT keeps full Pen at Extreme through the resolver
  expect(R.resolverPenAP).toBe(4);     // a normal round loses 50% at Extreme
});
