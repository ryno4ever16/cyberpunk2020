import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow } from "../helpers/foundry.js";

/**
 * Vehicle — Phase 5g-1: PURE indirect-fire & bomb math (Maximum Metal p.8-9). No documents created;
 * just imports the module in the live game context and checks the deterministic functions against
 * the book's worked examples.
 */
test("Phase 5g-1: indirect/bomb math (pure, MM p.8-9)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);

  const R = await evalGameOrThrow(page, async () => {
    const M = await import("/systems/cyberpunk2020/module/vehicle/vehicle-indirect.js");
    return {
      // Shell travel: mortar 400 m/turn, artillery 600 m/turn.
      travelMortar500: M.shellTravelTurns(500, "mortar"),       // ceil(500/400) = 2
      travelArty1000: M.shellTravelTurns(1000, "artillery"),    // ceil(1000/600) = 2
      travelArty600: M.shellTravelTurns(600, "artillery"),      // 1
      // Indirect To-Hit numbers + spotter bonus.
      thFirst: M.indirectToHitNumber({}),                       // 25
      thRanged: M.indirectToHitNumber({ alreadyRangedIn: true }),// 10
      spotBonus: M.indirectToHitBonus({ spotterHW: 7, spotterINT: 8, firerHW: 5, mods: -10 }), // 7+2-10 = -1
      // Deviation (book examples): indirect 500m/miss12 = 60m; bomb 500m height/miss1 = 50m.
      devIndirect: M.indirectDeviationM(500, 12),               // 60
      devBomb: M.bombDeviationM(500, 1),                        // 50
      dir1: M.scatterDirectionDeg(1),                           // 0
      dir2: M.scatterDirectionDeg(2),                           // 36
      dir10: M.scatterDirectionDeg(10),                         // 324
      devVec: M.deviationVector({ distanceM: 60, d10: 1 }),     // {dx~60, dy~0, dirDeg 0}
      // Bombs.
      directPen: M.bombDirectPen(10),                           // 50
      aim1: M.diveBombAimBonus(1),                              // 0
      aim2: M.diveBombAimBonus(2),                              // 1
      aim4: M.diveBombAimBonus(4),                              // 3
      aim10: M.diveBombAimBonus(10),                            // 3 (capped)
      fallDive: M.bombFallSchedule(1225, { diveSpeed: 700 }),   // [700,350,175]
      fallNorm: M.bombFallTurns(500),                           // 3 (175/turn)
      // Warheads.
      whHeat: M.warheadProfile("heat", { pen: 11, burstM: 0 }),
      whWp: M.warheadProfile("wp", { pen: 6, burstM: 0 }),
      whCluster: M.warheadProfile("cluster", { pen: 8, burstM: 2 }),
      whChem: M.warheadProfile("chemical", { pen: 6, burstM: 3 }),
      whHE: M.warheadProfile("he", { pen: 6, burstM: 6 }),
      // Landing points (pixels): hit lands on aim; a miss deviates by the book formula × ppm.
      landHit: M.indirectLanding({ aim: { x: 1000, y: 1000 }, rangeM: 500, toHitTotal: 30, toHitNumber: 25, d10dir: 1, ppm: 50 }),
      landMiss: M.indirectLanding({ aim: { x: 1000, y: 1000 }, rangeM: 500, toHitTotal: 13, toHitNumber: 25, d10dir: 1, ppm: 50 }),
      bombLand: M.bombLanding({ aim: { x: 1000, y: 1000 }, heightM: 500, toHitTotal: 24, toHitNumber: 25, d10dir: 1, ppm: 50 }),
    };
  });

  console.log("Phase 5g-1:", JSON.stringify(R));

  expect(R.travelMortar500).toBe(2);
  expect(R.travelArty1000).toBe(2);
  expect(R.travelArty600).toBe(1);
  expect(R.thFirst).toBe(25);
  expect(R.thRanged).toBe(10);
  expect(R.spotBonus).toBe(-1);
  expect(R.devIndirect).toBe(60);     // MM p.8 worked example
  expect(R.devBomb).toBe(50);         // MM p.9 worked example
  expect(R.dir1).toBe(0);
  expect(R.dir2).toBe(36);
  expect(R.dir10).toBe(324);
  expect(Math.round(R.devVec.dx)).toBe(60);
  expect(Math.round(R.devVec.dy)).toBe(0);
  expect(R.devVec.dirDeg).toBe(0);
  expect(R.directPen).toBe(50);       // ×5
  expect(R.aim1).toBe(0);
  expect(R.aim2).toBe(1);
  expect(R.aim4).toBe(3);
  expect(R.aim10).toBe(3);
  expect(R.fallDive).toEqual([700, 350, 175]);   // MM p.9 worked example (700→350→175)
  expect(R.fallNorm).toBe(3);
  expect(R.whHeat).toEqual({ pen: 11, burstM: 4, heat: true });
  expect(R.whWp.pen).toBe(0);
  expect(R.whWp.dot.formula).toBe("3d6");
  expect(R.whCluster).toEqual({ pen: 4, burstM: 6, cluster: true });   // ×3 burst, Pen capped at 4
  expect(R.whChem).toEqual({ pen: 0, burstM: 9, gas: true });          // ×3 burst, no Pen
  expect(R.whHE).toEqual({ pen: 6, burstM: 6 });
  // Landing: hit on aim (no deviation); miss deviates 60m (=12×500/100) east → +3000px at ppm 50.
  expect(R.landHit.hit).toBe(true);
  expect(R.landHit.deviationM).toBe(0);
  expect(R.landMiss.hit).toBe(false);
  expect(R.landMiss.deviationM).toBe(60);
  expect(Math.round(R.landMiss.point.x)).toBe(4000);
  expect(R.bombLand.deviationM).toBe(50);            // 1×10×500/100
  expect(Math.round(R.bombLand.point.x)).toBe(3500);
});
