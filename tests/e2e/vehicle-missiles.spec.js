import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow } from "../helpers/foundry.js";

/**
 * Vehicle — Phase 5f (rules core): guided missiles & countermeasures (MM p.9-10, p.24).
 * Pure, deterministic math: speed/flight-time, guidance to-hit, paint, intercept, countermeasures.
 */

test("Phase 5f: missile rules core (guidance, flight, intercept, countermeasures)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);

  const R = await evalGameOrThrow(page, async () => {
    const M = await import("/systems/cyberpunk2020/module/vehicle/vehicle-missiles.js");
    const out = {};

    // Speed / flight time / min range.
    out.spActive = M.missileSpeed("active");        // 1500
    out.spSemi   = M.missileSpeed("semiActive");    // 750
    out.spOver   = M.missileSpeed("semiActive", 900); // override 900
    out.tti2     = M.turnsToImpact(3000, 1500);     // 2
    out.tti1     = M.turnsToImpact(700, 750);       // 1
    out.tti3     = M.turnsToImpact(1600, 750);      // 3
    out.minR     = M.minRange(5000);                // 500

    // Guidance to-hit: active uses missile Skill, semi-active uses operator bonus.
    out.active   = M.resolveMissileToHit({ guidance: "active", d10: 5, missileSkill: 15, operatorBonus: 99, targetNumber: 10 }); // 20 vs 10 hit (operator ignored)
    out.semi     = M.resolveMissileToHit({ guidance: "semiActive", d10: 5, operatorBonus: 10, targetNumber: 15 });               // 15 vs 15 hit
    out.jammed   = M.resolveMissileToHit({ guidance: "semiActive", d10: 5, operatorBonus: 10, targetNumber: 15, difficultyMods: 10 }); // 15 vs 25 miss

    // Paint (Hellfire).
    out.paintHit  = M.resolvePaintHit(5);   // true
    out.paintMiss = M.resolvePaintHit(1);   // false

    // Anti-missile intercept.
    out.intDestroy = M.interceptResult(5, 0).outcome;  // destroyed
    out.intBurst   = M.interceptResult(3, 0).outcome;  // burst
    out.intFail    = M.interceptResult(1, 2).outcome;  // 1-2 = -1 → fail
    out.intMulti   = M.interceptResult(6, 2).outcome;  // 6-2 = 4 → destroyed

    // Countermeasure +Difficulty by homing method.
    out.cmRadar   = M.countermeasureModifier(["chaff", "flares"], "radar");   // chaff 10 (+ flares 0) = 10
    out.cmThermal = M.countermeasureModifier(["flares"], "thermal");          // 10
    out.cmJam     = M.countermeasureModifier(["jamming"], "radar");           // 15
    out.cmNone    = M.countermeasureModifier(["chaff"], "thermal");           // chaff doesn't affect thermal → 0

    // Detection.
    out.elecYes = M.electronicDetect(2);          // true (90%)
    out.elecNo  = M.electronicDetect(1);          // false
    out.dvFlight = M.visualDetectDV("inFlight");  // 20
    out.dvFiring = M.visualDetectDV("firing");    // 10

    return out;
  });

  console.log("Phase 5f rules:", JSON.stringify(R));

  expect(R.spActive).toBe(1500);
  expect(R.spSemi).toBe(750);
  expect(R.spOver).toBe(900);
  expect(R.tti2).toBe(2);
  expect(R.tti1).toBe(1);
  expect(R.tti3).toBe(3);
  expect(R.minR).toBe(500);

  expect(R.active.hit).toBe(true);
  expect(R.active.total).toBe(20);
  expect(R.semi.hit).toBe(true);
  expect(R.jammed.hit).toBe(false);
  expect(R.jammed.dv).toBe(25);

  expect(R.paintHit).toBe(true);
  expect(R.paintMiss).toBe(false);

  expect(R.intDestroy).toBe("destroyed");
  expect(R.intBurst).toBe("burst");
  expect(R.intFail).toBe("fail");
  expect(R.intMulti).toBe("destroyed");

  expect(R.cmRadar).toBe(10);
  expect(R.cmThermal).toBe(10);
  expect(R.cmJam).toBe(15);
  expect(R.cmNone).toBe(0);

  expect(R.elecYes).toBe(true);
  expect(R.elecNo).toBe(false);
  expect(R.dvFlight).toBe(20);
  expect(R.dvFiring).toBe(10);
});
