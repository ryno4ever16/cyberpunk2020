import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

/**
 * Vehicle — Phase 6-1: PURE ACPA combat math (Maximum Metal p.52-60). No documents; just imports the
 * module and checks the System Hit / Critical / Integrity / melee / movement functions vs the book.
 */
test("Phase 6-1: ACPA combat math (pure, MM p.52-60)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);

  const R = await evalGameOrThrow(page, async () => {
    const A = await import("/systems/cyberpunk2020/module/vehicle/vehicle-acpa.js");
    return {
      ext5: A.externalSystemHit(5), ext6: A.externalSystemHit(6), ext1: A.externalSystemHit(1),
      sh2: A.acpaSystemHit(2), sh5: A.acpaSystemHit(5), sh8: A.acpaSystemHit(8), sh10: A.acpaSystemHit(10),
      ra2: A.acpaRollAgain(2), ra3: A.acpaRollAgain(3),
      intHalf: A.systemIntegrity({ sopLost: 5, sopTotal: 10 }),
      intLow: A.systemIntegrity({ sopLost: 2, sopTotal: 10 }),
      intDead: A.systemIntegrity({ sopLost: 11, sopTotal: 10 }),
      crit1: A.acpaCriticalEffect(1).type, crit3: A.acpaCriticalEffect(3).type, crit4: A.acpaCriticalEffect(4).type,
      crit6: A.acpaCriticalEffect(6).type, crit8: A.acpaCriticalEffect(8).type, crit9: A.acpaCriticalEffect(9).type, crit10: A.acpaCriticalEffect(10).type,
      punch36: A.acpaMeleeDamage(36, "punch"), crush36: A.acpaMeleeDamage(36, "crush"), kick36: A.acpaMeleeDamage(36, "kick"),
      punch18: A.acpaMeleeDamage(18, "punch"), kick45: A.acpaMeleeDamage(45, "kick"),
      run: A.acpaRunM({ sib: 5, ma: 8 }),
      jumpRun: A.acpaJumpM(39, { running: true }), jumpStat: A.acpaJumpM(39, { running: false }), jumpVert: A.acpaJumpM(39, { running: true, vertical: true }),
      lfBasic: A.linearFrameHitChance(14), lfAdv: A.linearFrameHitChance(30),
      // Body areas + critical→update writes.
      ba1: A.acpaBodyArea(1), ba2: A.acpaBodyArea(2), ba4: A.acpaBodyArea(4), ba6: A.acpaBodyArea(6), ba10: A.acpaBodyArea(10),
      cuSeize: A.acpaCriticalUpdate({ seizeUp: 0 }, A.acpaCriticalEffect(1), 5),
      cuStr: A.acpaCriticalUpdate({ strDamage: 0 }, A.acpaCriticalEffect(4), 4),
      cuRef: A.acpaCriticalUpdate({ refDamage: 0 }, A.acpaCriticalEffect(6), 5),
      cuPower: A.acpaCriticalUpdate({ powerHours: 24 }, A.acpaCriticalEffect(8), 3),
      cuIface: A.acpaCriticalUpdate({ interfaceOut: 0 }, A.acpaCriticalEffect(9), 4),
      cuShock: A.acpaCriticalUpdate({ sdp: { value: 50, max: 50 } }, A.acpaCriticalEffect(10), 3),
      // Per-round status decay.
      tick1: A.acpaTickStatus({ seizeUp: 2, interfaceOut: 1 }),
      tickEnd: A.acpaTickStatus({ seizeUp: 1 }),
      tickNone: A.acpaTickStatus({}),
      // Construction (MM p.61-62): per-area frame SOP + Chassis Inventory.
      areaSOP40: A.acpaAreaSOP(40),
      areaSOP16: A.acpaAreaSOP(16),
      cs40: A.chassisStats(40),
      cs12tough: A.chassisStats(12).toughness,
      cs52tough: A.chassisStats(52).toughness,
      cs38tough: A.chassisStats(38).toughness,
      cs10tough: A.chassisStats(10).toughness,
    };
  });

  console.log("Phase 6-1:", JSON.stringify(R));
  expect(R.ext5).toBe(true);  expect(R.ext6).toBe(false);  expect(R.ext1).toBe(true);
  expect(R.sh2).toBe("chassis"); expect(R.sh5).toBe("enclosed"); expect(R.sh8).toBe("weapons"); expect(R.sh10).toBe("rollAgain");
  expect(R.ra2).toBe("critical"); expect(R.ra3).toBe("systemHit");
  expect(R.intHalf).toEqual({ destroyed: false, inopChance: 0.75 });   // ≥ ½ SOP
  expect(R.intLow).toEqual({ destroyed: false, inopChance: 0.25 });    // < ½ SOP
  expect(R.intDead.destroyed).toBe(true);                              // exceeded
  expect(R.crit1).toBe("seizeUp"); expect(R.crit3).toBe("cooling"); expect(R.crit4).toBe("strLoss");
  expect(R.crit6).toBe("refLoss"); expect(R.crit8).toBe("powerLoss"); expect(R.crit9).toBe("interfaceOut"); expect(R.crit10).toBe("mechShock");
  // Melee: STR36 → X=4 → punch 4d10, crush 5d10, kick round(1.5×4)=6d10; STR18 → X=2 → punch 2d10; STR45 → X=5 → kick round(7.5)=8d10.
  expect(R.punch36.dice).toBe(4); expect(R.crush36.dice).toBe(5); expect(R.kick36.dice).toBe(6);
  expect(R.punch18.dice).toBe(2); expect(R.kick45.dice).toBe(8);
  // Movement: run (5+8)×3 = 39; running jump /4 = 9.75; standing /6 = 6.5; vertical = horizontal/3.
  expect(R.run).toBe(39);
  expect(R.jumpRun).toBeCloseTo(9.75, 2); expect(R.jumpStat).toBeCloseTo(6.5, 2); expect(R.jumpVert).toBeCloseTo(3.25, 2);
  expect(R.lfBasic).toBe(0.2); expect(R.lfAdv).toBe(0.3);
  expect(R.ba1).toBe("Head"); expect(R.ba2).toBe("Right Arm"); expect(R.ba4).toBe("Right Leg"); expect(R.ba6).toBe("Left Leg"); expect(R.ba10).toBe("Torso");
  expect(R.cuSeize.updates["system.seizeUp"]).toBe(5);
  expect(R.cuSeize.updates["system.immobilized"]).toBe(true);
  expect(R.cuStr.updates["system.strDamage"]).toBe(4);
  expect(R.cuRef.updates["system.refDamage"]).toBe(3);        // round(1d6=5 / 2)
  expect(R.cuPower.updates["system.powerHours"]).toBe(18);    // 24 − 3×2
  expect(R.cuIface.updates["system.interfaceOut"]).toBe(4);
  expect(R.cuShock.updates["system.sdp"].value).toBe(47);     // 50 − 3
  // Per-round decay: seize 2→1 (still seized), interface 1→0 (restored); seize 1→0 restores mobility.
  expect(R.tick1.updates["system.seizeUp"]).toBe(1);
  expect(R.tick1.updates["system.interfaceOut"]).toBe(0);
  expect(R.tickEnd.updates["system.seizeUp"]).toBe(0);
  expect(R.tickEnd.updates["system.immobilized"]).toBe(false);
  expect(Object.keys(R.tickNone.updates).length).toBe(0);
  // Per-area frame SOP: STR40 → Head/Arm 10, Leg 20, Torso 30; STR16 → 4/8/12.
  expect(R.areaSOP40).toEqual({ head: 10, rArm: 10, lArm: 10, rLeg: 20, lLeg: 20, torso: 30 });
  expect(R.areaSOP16).toEqual({ head: 4, rArm: 4, lArm: 4, rLeg: 8, lLeg: 8, torso: 12 });
  expect(R.cs40.toughness).toBe(-10);
  expect(R.cs40.cost).toBe(66000);
  expect(R.cs12tough).toBe(-5);
  expect(R.cs52tough).toBe(-12);
  expect(R.cs38tough).toBe(-9);    // picks the STR 37 row
  expect(R.cs10tough).toBe(-5);    // clamps to the STR 12 row
});

test("Phase 6-2: ACPA penetrating damage applies + catastrophic destroys", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const VD = await import("/systems/cyberpunk2020/module/vehicle/vehicle-damage.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const out = {};
    let acpa;
    try {
      acpa = await Actor.create({ name: "__PW__ACPA", type: "vehicle", flags,
        system: { isACPA: true, str: 40, sp: { front: 0, side: 0, rear: 0, top: 0, bottom: 0 }, sdp: { value: 100, max: 100 } } });
      out.powerDefault = acpa.system.powerHours;   // additive field default = 24
      out.coolingDefault = acpa.system.coolingTimer; // 0
      out.frameTorso = acpa.system.frameSOPMax?.torso;   // derived: STR40 → 30
      out.toughness = acpa.system.toughness;             // derived: STR40 → -10

      // Catastrophic: overwhelming Penetration vs AV 0 → suit destroyed (no throw on the ACPA branch).
      await VD.applyVehicleDamageMM(acpa, { basePen: 999, facing: "front" });
      out.destroyed = acpa._source.system.destroyed === true;
      out.sdpZero = (acpa._source.system.sdp?.value ?? 1) === 0;
      out.maxPreserved = (acpa._source.system.sdp?.max ?? 0) === 100;   // dot-path doesn't wipe max
    } finally {
      if (acpa) await acpa.delete().catch(() => {});
    }
    return out;
  });

  console.log("Phase 6-2 apply:", JSON.stringify(R));
  expect(R.powerDefault).toBe(24);
  expect(R.coolingDefault).toBe(0);
  expect(R.frameTorso).toBe(30);    // derived per-area frame SOP (STR40 Torso = 75%)
  expect(R.toughness).toBe(-10);    // derived Chassis Inventory Toughness Mod
  expect(R.destroyed).toBe(true);
  expect(R.sdpZero).toBe(true);
  expect(R.maxPreserved).toBe(true);
});
