import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Vehicle — Phase 5 (foundation): the PC↔vehicle firing bridge + MM to-hit math (MM p.4-5).
 *
 *   averageDamageFromFormula / isSmallArms — read a weapon's damage dice,
 *   penetrationFactor / weaponToPenetration — convert a personnel weapon to a vehicle Penetration
 *     (round(avg/10), ×2 AP, ×½ d6 small arms),
 *   vehicleToHitModifier — total the common vehicle to-hit modifiers (Large +4, stationary +4,
 *     speed −1/20mph, turret +2, vehicle link +2, …; ACPA takes no size mod),
 *   goodShotSteps / roundsPerHit — Good Shot (+1/10 over) and high-ROF rounds-per-hit.
 *
 * Then a live bridge check: weaponToPenetration on a real weapon Item, fed into the Phase 4
 * resolver, penetrates a soft target and bounces off a hard one.
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("Phase 5: penetration-factor bridge + to-hit modifiers (math)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const VW = await import("/systems/cyberpunk2020/module/vehicle/vehicle-weapons.js");
    const out = {};

    // Average damage from a formula
    out.avg5d6   = VW.averageDamageFromFormula("5d6");       // 5 × 3.5 = 17.5
    out.avg2d6p1 = VW.averageDamageFromFormula("2d6+1");     // 7 + 1 = 8
    out.avg1d10  = VW.averageDamageFromFormula("1d10");      // 5.5
    out.avg6d6p2 = VW.averageDamageFromFormula("6d6+2");     // 21 + 2 = 23

    out.smallYes = VW.isSmallArms("5d6");                    // true
    out.smallNo  = VW.isSmallArms("3d10+2");                 // false

    // Penetration factor: round(avg/10), ×2 AP, ×½ small arms
    out.pfRifleAP   = VW.penetrationFactor({ avgDamage: 23, ap: true });                  // round(2.3)=2 ×2 = 4
    out.pfAutocannon= VW.penetrationFactor({ avgDamage: 60 });                            // 6
    out.pfSMG       = VW.penetrationFactor({ avgDamage: 17.5, smallArms: true });         // round(1.75)=2 ×½ = 1
    out.pfPistol    = VW.penetrationFactor({ avgDamage: 8, smallArms: true });            // round(0.8)=1 ×½ = round(0.5)=1

    // Vehicle to-hit modifiers
    out.thBase     = VW.vehicleToHitModifier({ targetLarge: true });                       // +4
    out.thStationary = VW.vehicleToHitModifier({ targetLarge: true, stationary: true });   // +8
    out.thMoving   = VW.vehicleToHitModifier({ targetLarge: true, targetSpeedMph: 65 });   // +4 − 3 = +1
    out.thStraight = VW.vehicleToHitModifier({ targetLarge: true, targetSpeedMph: 65, movingStraightAt: true }); // +4 − 1 = +3
    out.thLoaded   = VW.vehicleToHitModifier({ targetLarge: true, turret: true, vehicleLink: true, firerMoving: true, darkObscured: true }); // 4+2+2-3-3 = 2
    out.thACPA     = VW.vehicleToHitModifier({ targetLarge: true, isACPATarget: true });   // 0 (no size mod)

    // Good Shot + multiple rounds
    out.gs0  = VW.goodShotSteps(18, 12);   // over 6 → 0
    out.gs2  = VW.goodShotSteps(34, 12);   // over 22 → 2
    out.rof30  = VW.roundsPerHit(30);      // 5
    out.rof100 = VW.roundsPerHit(100);     // 10
    out.rof1   = VW.roundsPerHit(10);      // 1

    return out;
  });

  console.log("Vehicle Phase 5 math:", JSON.stringify(R));

  expect(R.avg5d6).toBe(17.5);
  expect(R.avg2d6p1).toBe(8);
  expect(R.avg1d10).toBe(5.5);
  expect(R.avg6d6p2).toBe(23);
  expect(R.smallYes).toBe(true);
  expect(R.smallNo).toBe(false);

  expect(R.pfRifleAP).toBe(4);
  expect(R.pfAutocannon).toBe(6);
  expect(R.pfSMG).toBe(1);
  expect(R.pfPistol).toBe(1);

  expect(R.thBase).toBe(4);
  expect(R.thStationary).toBe(8);
  expect(R.thMoving).toBe(1);
  expect(R.thStraight).toBe(3);
  expect(R.thLoaded).toBe(2);
  expect(R.thACPA).toBe(0);

  expect(R.gs0).toBe(0);
  expect(R.gs2).toBe(2);
  expect(R.rof30).toBe(5);
  expect(R.rof100).toBe(10);
  expect(R.rof1).toBe(1);
});

test("Phase 5: live bridge — a real weapon's Penetration vs vehicle armor (Phase 4 resolver)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const VW = await import("/systems/cyberpunk2020/module/vehicle/vehicle-weapons.js");
    const VD = await import("/systems/cyberpunk2020/module/vehicle/vehicle-damage.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const out = {};

    const actor = await Actor.create({ name: "__PW__Gunner", type: "character", flags });

    // The small-arms rule bites: a 6d6+2 AP weapon uses d6, so it's "small arms" → ×½.
    // round(23/10)=2, ×2 AP = 4, ×½ small arms = 2. (Anti-vehicle weapons use d10 to avoid this.)
    const [d6gun] = await actor.createEmbeddedDocuments("Item", [
      { name: "__PW__6d6AP", type: "weapon", flags, system: { damage: "6d6+2", ap: true, weaponType: "Heavy", attackType: "" } },
    ]);
    out.penSmallArms = VW.weaponToPenetration(actor.items.get(d6gun.id));   // 2

    // A proper anti-vehicle weapon: 6d10 AP → avg 33, round(3.3)=3, ×2 AP = Pen 6 (d10, not small arms).
    const [atgm] = await actor.createEmbeddedDocuments("Item", [
      { name: "__PW__ATGM", type: "weapon", flags, system: { damage: "6d10", ap: true, weaponType: "Heavy", attackType: "" } },
    ]);
    out.pen = VW.weaponToPenetration(actor.items.get(atgm.id));     // 6

    // vs a light vehicle (SP 40 → AV 2): Pen 6 − AV 2 ≥ 0 → penetrates.
    const apc = await Actor.create({ name: "__PW__APC", type: "vehicle", flags, system: { sp: { front: 40 }, sdp: { value: 100, max: 100 } } });
    const soft = await VD.applyVehicleDamageMM(apc, { basePen: out.pen, facing: "front" });
    out.softSeverity = soft.severity;          // not "noPenetration"

    // vs a heavy tank (SP 200 → AV 10): Pen 6 − AV 10 < 0 → no penetration (surface only).
    const tank = await Actor.create({ name: "__PW__HeavyTank", type: "vehicle", flags, system: { sp: { front: 200 }, sdp: { value: 400, max: 400 } } });
    const hard = await VD.applyVehicleDamageMM(tank, { basePen: out.pen, facing: "front" });
    out.hardSeverity = hard.severity;          // "noPenetration"

    for (const a of [actor, apc, tank]) await a.delete().catch(() => {});
    return out;
  });

  console.log("Vehicle Phase 5 live:", JSON.stringify(R));
  expect(R.penSmallArms, "6d6+2 AP → small-arms ×½ → Penetration 2").toBe(2);
  expect(R.pen, "6d10 AP → Penetration 6").toBe(6);
  expect(R.softSeverity, "Pen 6 vs AV 2 penetrates").not.toBe("noPenetration");
  expect(R.hardSeverity, "Pen 6 vs AV 10 bounces").toBe("noPenetration");
});
