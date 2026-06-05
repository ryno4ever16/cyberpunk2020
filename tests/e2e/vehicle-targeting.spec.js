import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Vehicle — Phase 5c: the unified targeting spine.
 *   - computeFacing      — diegetic facing from token geometry + elevation (MM p.6 flank rules)
 *   - resolvePenVsPerson — MM p.8 "Personnel vs Anti-Vehicle Weapons" (LUCK save → Pen−AV)
 *   - personnelArmorValue— mean proportional per-location SP ÷ 20 (the p.8 worked example → AV 1)
 *   - dispatchAttack     — 4-way routing by (source scale × target type)
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("Phase 5c: facing geometry + MM p.8 resolution (pure math)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);

  const R = await evalGameOrThrow(page, async () => {
    const T = await import("/systems/cyberpunk2020/module/vehicle/vehicle-targeting.js");
    const out = {};

    // Facing: target faces "up" (rotation 0 → facing vector (0,-1)). dx,dy = target→attacker.
    out.front  = T.computeFacing({ dx: 0, dy: -100, rotationDeg: 0 });   // attacker ahead → front
    out.rear   = T.computeFacing({ dx: 0, dy: 100,  rotationDeg: 0 });   // attacker behind → rear
    out.side   = T.computeFacing({ dx: 100, dy: 0,  rotationDeg: 0 });   // attacker beside → side
    out.top    = T.computeFacing({ dx: 10, dy: 0, dz: 50,  rotationDeg: 0 }); // steep from above
    out.bottom = T.computeFacing({ dx: 10, dy: 0, dz: -50, rotationDeg: 0 }); // steep from below
    out.rotFront = T.computeFacing({ dx: 100, dy: 0, rotationDeg: 90 });  // target faces east, attacker east → front

    // MM p.8 resolution.
    out.grazed     = T.resolvePenVsPerson({ pen: 21, av: 1, luckTotal: 16 }); // ≥15 → grazed
    out.stopped    = T.resolvePenVsPerson({ pen: 4, av: 6, luckTotal: 10 });  // diff ≤0 → 2d6 + strip 10×4
    out.example    = T.resolvePenVsPerson({ pen: 3, av: 1, luckTotal: 10 });  // book example → 20 dmg
    out.penetrated = T.resolvePenVsPerson({ pen: 21, av: 1, luckTotal: 10 }); // (21−1)×10 = 200

    return out;
  });

  console.log("Phase 5c math:", JSON.stringify(R));

  expect(R.front).toBe("front");
  expect(R.rear).toBe("rear");
  expect(R.side).toBe("side");
  expect(R.top).toBe("top");
  expect(R.bottom).toBe("bottom");
  expect(R.rotFront).toBe("front");

  expect(R.grazed.outcome).toBe("grazed");
  expect(R.grazed.armorMult).toBe(0.5);
  expect(R.stopped.outcome).toBe("stopped");
  expect(R.stopped.spStripped).toBe(40);          // 10 × Pen 4
  expect(R.example.outcome).toBe("penetrated");
  expect(R.example.damage).toBe(20);              // MM p.8 worked example (Pen 3 − AV 1 = 2 → 20)
  expect(R.penetrated.damage).toBe(200);
});

test("Phase 5c: personal Armor Value + dispatcher routing (integration)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const T = await import("/systems/cyberpunk2020/module/vehicle/vehicle-targeting.js");
    const DA = await import("/systems/cyberpunk2020/module/combat/DamageApplicator.js");
    const out = {};
    let victim, veh;
    try {
      // Personal AV: SP19 jacket covering 3 of 6 locations → mean 9.5 → 10 → AV 1 (MM p.8 example).
      [victim] = await Actor.createDocuments([{ name: "ZZTEST p8 victim", type: "character" }]);
      await victim.createEmbeddedDocuments("Item", [{
        name: "ZZTEST Jacket", type: "armor",
        system: { equipped: true, coverage: {
          Head: { stoppingPower: 19 }, Torso: { stoppingPower: 19 }, lArm: { stoppingPower: 19 }
        } }
      }]);
      out.av19 = DA.personnelArmorValue(victim);
      out.avNaked = DA.personnelArmorValue(await Actor.createDocuments([{ name: "ZZTEST naked", type: "character" }]).then(a => a[0]));

      // Dispatcher routing contract.
      [veh] = await Actor.createDocuments([{
        name: "ZZTEST disp veh", type: "vehicle",
        system: { sdp: { value: 100, max: 100 }, sp: { front: 0, side: 0, rear: 0, top: 0, bottom: 0 } }
      }]);
      out.dispVehPen        = await T.dispatchAttack({ scale: "penetration", penetration: 5, facing: "front" }, veh);          // true
      out.dispVehPersonnel  = await T.dispatchAttack({ scale: "personnel", areaDamages: { Torso: [{ damage: 50 }] } }, veh);   // true
      out.dispPersonPen     = await T.dispatchAttack({ scale: "penetration", penetration: 5, weaponName: "Test AV gun" }, victim); // true (posts LUCK prompt)
      out.dispPersonNormal  = await T.dispatchAttack({ scale: "personnel", areaDamages: { Torso: [{ damage: 5 }] } }, victim); // false (existing pipeline)
    } finally {
      if (victim) await victim.delete().catch(() => {});
      if (veh) await veh.delete().catch(() => {});
      // remove the throwaway naked actor + any leftover ZZTEST actors
      for (const a of game.actors.filter(x => x.name?.startsWith("ZZTEST"))) await a.delete().catch(() => {});
    }
    return out;
  });

  console.log("Phase 5c integration:", JSON.stringify(R));

  expect(R.av19).toBe(1);            // mean proportional SP → AV 1 (the book example)
  expect(R.avNaked).toBe(0);
  expect(R.dispVehPen).toBe(true);
  expect(R.dispVehPersonnel).toBe(true);
  expect(R.dispPersonPen).toBe(true);
  expect(R.dispPersonNormal).toBe(false);
});
