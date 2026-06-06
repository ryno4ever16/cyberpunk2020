import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow } from "../helpers/foundry.js";

/**
 * Phase 6 D-4d-1 — ACPA systems catalog + construction/damage math (Maximum Metal p.61-79, charts
 * Appendix A). PURE: imports the module and checks the catalog, the SOP rule, the per-area spaces
 * table, mounted-systems aggregation/overage, and the per-system SOP damage pick. No documents.
 */
test("Phase 6 D-4d-1: ACPA systems catalog + spaces + per-system SOP damage (pure)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);

  const R = await evalGameOrThrow(page, async () => {
    const S = await import("/systems/cyberpunk2020/module/vehicle/vehicle-acpa-systems.js");
    const out = {};

    // Catalog + SOP rule.
    out.radarExists = !!S.acpaSystemDef("RADAR");
    out.unknownNull = S.acpaSystemDef("NOPE") === null;
    out.radarSop    = S.acpaSystemSop(S.acpaSystemDef("RADAR"));     // 15 (direct)
    out.spOnlySop   = S.acpaSystemSop({ sp: 10, sop: 0 });           // 30 (3× SP)
    out.zeroSop     = S.acpaSystemSop({ sp: 0, sop: 0 });            // 0

    // Per-area spaces (internal + external = internal − 1).
    const sp16 = S.acpaAreaSpaces(16), sp30 = S.acpaAreaSpaces(30), sp45 = S.acpaAreaSpaces(45);
    out.sp16 = [sp16.head.internal, sp16.head.external, sp16.rArm.internal, sp16.torso.internal, sp16.torso.external];  // [2,1,2,3,2]
    out.sp30 = [sp30.head.internal, sp30.rArm.internal, sp30.torso.internal];                                          // [2,3,4]
    out.sp45 = [sp45.head.internal, sp45.rArm.internal, sp45.torso.internal, sp45.rLeg.external];                       // [3,4,5,3]

    // Mounted aggregation: weight/cost + spaces split internal/external by area.
    const mounted = [
      { key: "RADAR", area: "head" },                              // 5kg, 0.5 internal head
      { key: "FIRE_EXTINGUISHER", area: "torso" },                 // 20kg, 1 internal torso
      { key: "SENSORY_EXTENSIONS", area: "rArm", mount: "external" }, // 2kg, 0.5 external rArm
    ];
    const sum = S.acpaSystemsSummary(mounted);
    out.totalWeight = sum.totalWeight;                  // 27
    out.totalCost   = sum.totalCost;                    // 2000
    out.headInt = sum.byArea.head.internal;             // 0.5
    out.torsoInt = sum.byArea.torso.internal;           // 1
    out.rArmExt = sum.byArea.rArm.external;             // 0.5

    // Overage: 3 extinguishers (1 internal each) in the head of a STR16 suit (head internal = 2) → +1 over.
    const over = S.acpaSpacesOver(
      [{ key: "FIRE_EXTINGUISHER", area: "head" }, { key: "FIRE_EXTINGUISHER", area: "head" }, { key: "FIRE_EXTINGUISHER", area: "head" }],
      16);
    out.headOver = over.head.internal;                  // 3 − 2 = +1
    out.torsoOver = over.torso.internal;                // 0 − 3 = -3 (within budget; STR16 torso internal = 3)

    // Per-system SOP damage: first live system in the struck area takes the hit; destroyed at SOP.
    const base = [{ key: "RADAR", area: "head", sopDamage: 0 }];
    const soft = S.acpaHitSystem(base, "head", 10);
    out.softKey = soft.hitKey; out.softDead = soft.destroyed; out.softDmg = soft.updated[0].sopDamage; out.softOver = soft.overflow; // RADAR, false, 10, 0
    const kill = S.acpaHitSystem(base, "head", 20);
    out.killDead = kill.destroyed; out.killDmg = kill.updated[0].sopDamage; out.killOver = kill.overflow; // true, 15 (clamped), 5
    const miss = S.acpaHitSystem(base, "torso", 20);
    out.missIndex = miss.index; out.missOver = miss.overflow;  // -1, 20 (falls through to frame)
    // A destroyed system is skipped — the next live one in the area takes the hit.
    const twoSys = [{ key: "RADAR", area: "head", destroyed: true }, { key: "INFRARED", area: "head" }];
    const skip = S.acpaHitSystem(twoSys, "head", 3);
    out.skipIndex = skip.index; out.skipKey = skip.hitKey;     // 1, INFRARED

    return out;
  });

  console.log("Phase 6 D-4d-1:", JSON.stringify(R));
  expect(R.radarExists).toBe(true);
  expect(R.unknownNull).toBe(true);
  expect(R.radarSop).toBe(15);
  expect(R.spOnlySop).toBe(30);
  expect(R.zeroSop).toBe(0);
  expect(R.sp16).toEqual([2, 1, 2, 3, 2]);
  expect(R.sp30).toEqual([2, 3, 4]);
  expect(R.sp45).toEqual([3, 4, 5, 3]);
  expect(R.totalWeight).toBe(27);
  expect(R.totalCost).toBe(2000);
  expect(R.headInt).toBe(0.5);
  expect(R.torsoInt).toBe(1);
  expect(R.rArmExt).toBe(0.5);
  expect(R.headOver).toBe(1);
  expect(R.torsoOver).toBe(-3);
  expect(R.softKey).toBe("RADAR");
  expect(R.softDead).toBe(false);
  expect(R.softDmg).toBe(10);
  expect(R.softOver).toBe(0);
  expect(R.killDead).toBe(true);
  expect(R.killDmg).toBe(15);
  expect(R.killOver).toBe(5);
  expect(R.missIndex).toBe(-1);
  expect(R.missOver).toBe(20);
  expect(R.skipIndex).toBe(1);
  expect(R.skipKey).toBe("INFRARED");
});
