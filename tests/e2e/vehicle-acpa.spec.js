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

test("Phase 6 D-3: ACPA SOP-damage flow (armor stops weak hits; frame SOP → Torso shutdown)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const VD = await import("/systems/cyberpunk2020/module/vehicle/vehicle-damage.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const out = {};
    let acpa;
    try {
      acpa = await Actor.create({ name: "__PW__ACPA", type: "vehicle", flags,
        system: { isACPA: true, str: 40, sp: { front: 100, side: 0, rear: 0, top: 0, bottom: 0 }, sdp: { value: 100, max: 100 } } });
      out.powerDefault = acpa.system.powerHours;   // additive field default = 24
      out.coolingDefault = acpa.system.coolingTimer; // 0
      out.frameTorso = acpa.system.frameSOPMax?.torso;   // derived: STR40 → 30
      out.toughness = acpa.system.toughness;             // derived: STR40 → -10
      const sumSOP = (o) => Object.values(o || {}).reduce((a, v) => a + (Number(v) || 0), 0);
      out.sumMax = sumSOP(acpa.system.frameSOPMax);      // 10+10+10+20+20+30 = 100

      // (a) Weak hit vs SP 100 armor + Toughness → no penetration; the frame is untouched.
      await VD.applyVehicleDamageMM(acpa, { rawDamage: 20 });
      out.noPenFrameZero = sumSOP(acpa._source.system.frameSOP) === 0;
      out.noPenAlive = acpa._source.system.destroyed !== true;

      // (b) Strip the armor and hammer it: each big hit consumes the struck area's frame SOP, and the
      // Torso destroyed shuts the suit down (random area each hit; an external system absorbs ~50%).
      await acpa.update({ "system.sp": { front: 0, side: 0, rear: 0, top: 0, bottom: 0 } });
      let destroyed = false;
      for (let i = 0; i < 60 && !destroyed; i++) {
        await VD.applyVehicleDamageMM(acpa, { rawDamage: 999, basePen: 99 });
        destroyed = acpa._source.system.destroyed === true;
      }
      out.eventuallyDestroyed = destroyed;
      out.tookFrameDamage = sumSOP(acpa._source.system.frameSOP) < out.sumMax;
      out.sdpZeroOnShutdown = (acpa._source.system.sdp?.value ?? 1) === 0;
      out.maxPreserved = (acpa._source.system.sdp?.max ?? 0) === 100;
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
  expect(R.sumMax).toBe(100);
  expect(R.noPenFrameZero).toBe(true);     // armor + Toughness stopped the weak hit — frame untouched
  expect(R.noPenAlive).toBe(true);
  expect(R.eventuallyDestroyed).toBe(true); // Torso eventually destroyed → suit shuts down
  expect(R.tookFrameDamage).toBe(true);
  expect(R.sdpZeroOnShutdown).toBe(true);
  expect(R.maxPreserved).toBe(true);
});

/**
 * Phase 6 D-4a — Reality Interface + Reflex/Control (Maximum Metal p.64-65). Verifies the PURE
 * lookup tables + the effective-REF clamp, then the same values surfacing as DERIVED actor data
 * (additive defaults: Full-HUD Wideband + Advanced; switching the selects re-derives DFB/SIB/REF cap).
 */
test("Phase 6 D-4a: Reality Interface + Reflex/Control (pure lookups + derived stats)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const A = await import("/systems/cyberpunk2020/module/vehicle/vehicle-acpa.js");
    const out = { pure: {}, actor: {} };

    // PURE lookups (MM p.64-65).
    out.pure.apertureSib = A.realityInterface("APERTURE_BASED").sib;   // -6
    out.pure.apertureDfb = A.realityInterface("APERTURE_BASED").dfb;   // -2
    out.pure.vriDfb      = A.realityInterface("RUSSIAN_ARMS_VRI").dfb; // +3
    out.pure.fallbackRi  = A.realityInterface("nope").key;            // FULL_HUD_WIDEBAND
    out.pure.basicMax    = A.reflexControl("BASIC").maxRef;           // 8
    out.pure.basicMod    = A.reflexControl("BASIC").refMod;           // -2
    out.pure.basicCost   = A.reflexControl("BASIC").cost;             // -2000
    out.pure.highMax     = A.reflexControl("HIGH_BOOST").maxRef;      // 12
    out.pure.fallbackRc  = A.reflexControl("nope").key;              // ADVANCED
    // effective-REF clamp: Advanced(0)/cap10, Basic(-2)/cap8, LowBoost(+1)/cap11, then minus refDamage.
    out.pure.effAdv   = A.acpaEffectiveRef({ pilotRef: 9,  refMod: 0,  maxRef: 10 });               // 9
    out.pure.effBasic = A.acpaEffectiveRef({ pilotRef: 9,  refMod: -2, maxRef: 8 });                // 7
    out.pure.effCap   = A.acpaEffectiveRef({ pilotRef: 12, refMod: 1,  maxRef: 11 });               // 11 (capped)
    out.pure.effDmg   = A.acpaEffectiveRef({ pilotRef: 9,  refMod: 0,  maxRef: 10, refDamage: 3 }); // 6

    // DERIVED on a real ACPA actor — additive defaults are Full-HUD Wideband + Advanced.
    const flags = { cyberpunk2020: { __pwtest: true } };
    let acpa;
    try {
      acpa = await Actor.create({ name: "__PW__ACPA_D4a", type: "vehicle", flags,
        system: { isACPA: true, str: 40, pilotRef: 9 } });
      out.actor.defRi  = acpa.system.realityInterface;  // FULL_HUD_WIDEBAND
      out.actor.defRc  = acpa.system.reflexControl;      // ADVANCED
      out.actor.defDfb = acpa.system.dfb;                // +2
      out.actor.defSib = acpa.system.interfaceSib;       // 0
      out.actor.defMax = acpa.system.maxRef;             // 10
      out.actor.defEff = acpa.system.effectiveRef;       // clamp(9+0, 0..10) = 9

      // Switch to the worst interface + Basic control and re-derive.
      await acpa.update({ "system.realityInterface": "APERTURE_BASED", "system.reflexControl": "BASIC" });
      out.actor.aprDfb   = acpa.system.dfb;              // -2
      out.actor.aprSib   = acpa.system.interfaceSib;     // -6
      out.actor.basicMax = acpa.system.maxRef;           // 8
      out.actor.basicEff = acpa.system.effectiveRef;     // clamp(9-2, 0..8) = 7

      // Critical REF damage subtracts after the cap.
      await acpa.update({ "system.reflexControl": "ADVANCED", "system.refDamage": 3 });
      out.actor.dmgEff = acpa.system.effectiveRef;       // clamp(9+0, 0..10) = 9, − 3 = 6
    } finally {
      if (acpa) await acpa.delete().catch(() => {});
    }
    return out;
  });

  console.log("Phase 6 D-4a:", JSON.stringify(R));
  // PURE
  expect(R.pure.apertureSib).toBe(-6);
  expect(R.pure.apertureDfb).toBe(-2);
  expect(R.pure.vriDfb).toBe(3);
  expect(R.pure.fallbackRi).toBe("FULL_HUD_WIDEBAND");
  expect(R.pure.basicMax).toBe(8);
  expect(R.pure.basicMod).toBe(-2);
  expect(R.pure.basicCost).toBe(-2000);
  expect(R.pure.highMax).toBe(12);
  expect(R.pure.fallbackRc).toBe("ADVANCED");
  expect(R.pure.effAdv).toBe(9);
  expect(R.pure.effBasic).toBe(7);
  expect(R.pure.effCap).toBe(11);
  expect(R.pure.effDmg).toBe(6);
  // DERIVED
  expect(R.actor.defRi).toBe("FULL_HUD_WIDEBAND");
  expect(R.actor.defRc).toBe("ADVANCED");
  expect(R.actor.defDfb).toBe(2);
  expect(R.actor.defSib).toBe(0);
  expect(R.actor.defMax).toBe(10);
  expect(R.actor.defEff).toBe(9);
  expect(R.actor.aprDfb).toBe(-2);
  expect(R.actor.aprSib).toBe(-6);
  expect(R.actor.basicMax).toBe(8);
  expect(R.actor.basicEff).toBe(7);
  expect(R.actor.dmgEff).toBe(6);
});

/**
 * Phase 6 D-4b — SIB derivation + Armor Inventory weight/cost (Maximum Metal p.61-62). The SIB is the
 * power-to-weight initiative bonus: round(chassis Lift/Cap ÷ total loaded weight, 0.8 threshold) − 1 +
 * interface SIB. Verified vs the book's data-form worked example (cap≈2500 / 1235 kg → SIB +1).
 */
test("Phase 6 D-4b: SIB derivation + Armor Inventory weight/cost (MM p.61-62)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const A = await import("/systems/cyberpunk2020/module/vehicle/vehicle-acpa.js");
    const out = { pure: {}, actor: {} };

    // PURE SIB (MM p.61). The 0.8 rounding threshold + "fraction-only → 0" + the −1.
    out.pure.sibBook    = A.acpaSib({ chassisCapacity: 2500, totalWeight: 1235, interfaceSib: 0 }); // 1 (2.02→2−1)
    out.pure.sibBook2   = A.acpaSib({ chassisCapacity: 2250, totalWeight: 1235, interfaceSib: 0 }); // 1 (1.82→2−1)
    out.pure.sibRoundUp = A.acpaSib({ chassisCapacity: 385,  totalWeight: 100 });                   // 3 (3.85→4−1)
    out.pure.sibRoundDn = A.acpaSib({ chassisCapacity: 379,  totalWeight: 100 });                   // 2 (3.79→3−1)
    out.pure.sibFrac    = A.acpaSib({ chassisCapacity: 50,   totalWeight: 100 });                   // -1 (0.5→0−1)
    out.pure.sibIface   = A.acpaSib({ chassisCapacity: 2000, totalWeight: 516, interfaceSib: 3 });  // 6 (3.88→4−1+3)

    // PURE Armor Inventory interpolation (MM p.62).
    out.pure.aw40    = A.acpaArmorWeight(40);    // 200
    out.pure.aw50    = A.acpaArmorWeight(50);    // 250
    out.pure.aw80    = A.acpaArmorWeight(80);    // 400
    out.pure.awClamp = A.acpaArmorWeight(100);   // 400 (clamped)
    out.pure.aw35    = A.acpaArmorWeight(35);    // 175 (interp 30→40)
    out.pure.ac40    = A.acpaArmorCost(40);      // 9600
    out.pure.ac80    = A.acpaArmorCost(80);      // 25600

    // DERIVED on a real ACPA: STR40 (chassis 200 kg, Lift/Cap 2000), shell SP40 (200 kg), Full-HUD (2 kg).
    const flags = { cyberpunk2020: { __pwtest: true } };
    let acpa;
    try {
      acpa = await Actor.create({ name: "__PW__ACPA_D4b", type: "vehicle", flags,
        system: { isACPA: true, str: 40, sp: { front: 40, side: 0, rear: 0, top: 0, bottom: 0 } } });
      out.actor.armorWeight = acpa.system.armorWeight;   // 200
      out.actor.totalDef    = acpa.system.totalWeight;   // 200 + 200 + 114 + 2 = 516
      out.actor.sibDef      = acpa.system.sib;           // 2000/516 = 3.88 → 4 − 1 = 3

      // +200 kg of systems → total 716 → ratio 2.79 (rounds down) → SIB 1.
      await acpa.update({ "system.systemsWeight": 200 });
      out.actor.totalSys = acpa.system.totalWeight;      // 716
      out.actor.sibSys   = acpa.system.sib;              // 1

      // Switch interface to Russian Arms VRI (3 kg, SIB +3) → total 717 → base 1 + 3 = SIB 4.
      await acpa.update({ "system.realityInterface": "RUSSIAN_ARMS_VRI" });
      out.actor.totalVri = acpa.system.totalWeight;      // 717
      out.actor.sibVri   = acpa.system.sib;              // 4

      // Command Computer adds 1 kg to the loaded weight.
      await acpa.update({ "system.commandComputer": true });
      out.actor.totalCmd = acpa.system.totalWeight;      // 718
    } finally {
      if (acpa) await acpa.delete().catch(() => {});
    }
    return out;
  });

  console.log("Phase 6 D-4b:", JSON.stringify(R));
  // PURE SIB
  expect(R.pure.sibBook).toBe(1);
  expect(R.pure.sibBook2).toBe(1);
  expect(R.pure.sibRoundUp).toBe(3);
  expect(R.pure.sibRoundDn).toBe(2);
  expect(R.pure.sibFrac).toBe(-1);
  expect(R.pure.sibIface).toBe(6);
  // PURE armor
  expect(R.pure.aw40).toBe(200);
  expect(R.pure.aw50).toBe(250);
  expect(R.pure.aw80).toBe(400);
  expect(R.pure.awClamp).toBe(400);
  expect(R.pure.aw35).toBe(175);
  expect(R.pure.ac40).toBe(9600);
  expect(R.pure.ac80).toBe(25600);
  // DERIVED
  expect(R.actor.armorWeight).toBe(200);
  expect(R.actor.totalDef).toBe(516);
  expect(R.actor.sibDef).toBe(3);
  expect(R.actor.totalSys).toBe(716);
  expect(R.actor.sibSys).toBe(1);
  expect(R.actor.totalVri).toBe(717);
  expect(R.actor.sibVri).toBe(4);
  expect(R.actor.totalCmd).toBe(718);
});

/**
 * Phase 6 D-4c — combat wiring. The derived build stats feed the resolvers: SIB + effective REF
 * drive ACPA initiative (via the actor's getRollData mapping onto the shared system formula), DFB
 * adds to the vehicle to-hit total, and the REF cap is the effective-REF prefill. Strictly gated to
 * ACPA — a plain vehicle's roll data is untouched.
 */
test("Phase 6 D-4c: combat wiring — SIB→initiative, DFB→to-hit, REF cap", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const A = await import("/systems/cyberpunk2020/module/vehicle/vehicle-acpa.js");
    const W = await import("/systems/cyberpunk2020/module/vehicle/vehicle-weapons.js");
    const out = { pure: {}, actor: {} };

    // PURE initiative roll-data mapping (suit derived stats → shared formula terms).
    const ird = A.acpaInitiativeRollData({ effectiveRef: 9, sib: 3, commandComputer: true });
    out.pure.irRef     = ird.stats.ref.total;        // 9
    out.pure.irMod     = ird.initiativeMod;          // 3 (SIB)
    out.pure.irImplant = ird.initiativeImplantMod;   // 1 (Command Computer)
    out.pure.irCombat  = ird.CombatSenseMod;         // 0

    // PURE DFB in the to-hit modifier total.
    out.pure.dfbAcpaTarget  = W.vehicleToHitModifier({ isACPATarget: true, dfb: 2 });  // 2 (no size mod)
    out.pure.dfbLargeTarget = W.vehicleToHitModifier({ targetLarge: true, dfb: 3 });   // 4 + 3 = 7
    out.pure.noDfb          = W.vehicleToHitModifier({ targetLarge: true });           // 4

    const flags = { cyberpunk2020: { __pwtest: true } };
    let acpa, plain;
    try {
      // ACPA: STR40 + SP40 → SIB 3 (D-4b); pilotRef 9 + Advanced (mod 0 / cap 10) → effective REF 9.
      acpa = await Actor.create({ name: "__PW__ACPA_D4c", type: "vehicle", flags,
        system: { isACPA: true, str: 40, sp: { front: 40, side: 0, rear: 0, top: 0, bottom: 0 }, pilotRef: 9 } });
      out.actor.sib    = acpa.system.sib;            // 3
      out.actor.effRef = acpa.system.effectiveRef;   // 9
      const rd = acpa.getRollData();
      out.actor.rdRef     = rd.stats?.ref?.total;      // 9
      out.actor.rdMod     = rd.initiativeMod;          // 3
      out.actor.rdImplant = rd.initiativeImplantMod;   // 0 (no Command Computer yet)

      // The shared initiative formula resolves the @-terms to effRef + SIB (+cmd) = 12; only the 1d10
      // is random. Evaluate and subtract the die result to confirm the fixed bonus.
      const formula = "1d10 + @stats.ref.total + @CombatSenseMod + @initiativeMod + @initiativeImplantMod";
      const roll = await new Roll(formula, acpa.getRollData()).evaluate();
      out.actor.initFixed = roll.total - roll.dice[0].total;   // 12

      // Command Computer adds +1 to the implant term.
      await acpa.update({ "system.commandComputer": true });
      out.actor.rdImplantCmd = acpa.getRollData().initiativeImplantMod;  // 1

      // A plain (non-ACPA) vehicle is untouched by the override (no injected initiative term).
      plain = await Actor.create({ name: "__PW__VEH_D4c", type: "vehicle", flags,
        system: { isACPA: false, sdp: { value: 50, max: 50 } } });
      out.actor.plainHasInitMod = (plain.getRollData().initiativeMod !== undefined);  // false
    } finally {
      if (acpa) await acpa.delete().catch(() => {});
      if (plain) await plain.delete().catch(() => {});
    }
    return out;
  });

  console.log("Phase 6 D-4c:", JSON.stringify(R));
  // PURE
  expect(R.pure.irRef).toBe(9);
  expect(R.pure.irMod).toBe(3);
  expect(R.pure.irImplant).toBe(1);
  expect(R.pure.irCombat).toBe(0);
  expect(R.pure.dfbAcpaTarget).toBe(2);
  expect(R.pure.dfbLargeTarget).toBe(7);
  expect(R.pure.noDfb).toBe(4);
  // DERIVED + getRollData
  expect(R.actor.sib).toBe(3);
  expect(R.actor.effRef).toBe(9);
  expect(R.actor.rdRef).toBe(9);
  expect(R.actor.rdMod).toBe(3);
  expect(R.actor.rdImplant).toBe(0);
  expect(R.actor.initFixed).toBe(12);
  expect(R.actor.rdImplantCmd).toBe(1);
  expect(R.actor.plainHasInitMod).toBe(false);
});

/**
 * Phase 6 D-4d-2 — acpaSystem Items (LIVE; requires the type registered by a world relaunch). Confirms
 * the type + "ACPA Systems (MM)" compendium (seeded with the 14-entry core catalog), and that mounting
 * system Items on an ACPA flows their weight into mountedSystemsWeight → total weight → SIB.
 */
test("Phase 6 D-4d-2: acpaSystem Items on an ACPA — weight→SIB + compendium seeded", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const out = {};
    out.typeRegistered = (game.documentTypes?.Item ?? []).includes("acpaSystem");
    const Sys = await import("/systems/cyberpunk2020/module/vehicle/vehicle-acpa-systems.js");
    const Cat = await import("/systems/cyberpunk2020/module/vehicle/vehicle-acpa-catalog.js");
    out.catalogSize = Object.keys(Sys.ACPA_SYSTEMS).length;     // full catalog (core + defensive)
    await Cat.seedAcpaSystemCompendium();                       // idempotent: back-fills any new entries
    const pack = game.packs?.get("cyberpunk2020.acpa-systems");
    out.packExists = !!pack;
    out.seededCount = pack ? (await pack.getIndex()).size : 0;

    const flags = { cyberpunk2020: { __pwtest: true } };
    let acpa;
    try {
      // STR40 + SP40 → baseline SIB 3, total 516 (chassis 200 + armor 200 + trooper 114 + Full-HUD 2).
      acpa = await Actor.create({ name: "__PW__ACPA_D4d2", type: "vehicle", flags,
        system: { isACPA: true, str: 40, sp: { front: 40, side: 0, rear: 0, top: 0, bottom: 0 } } });
      out.baseTotal   = acpa.system.totalWeight;          // 516
      out.baseSib     = acpa.system.sib;                  // 3
      out.baseMounted = acpa.system.mountedSystemsWeight; // 0

      // Mount a 50 kg Swimmer + a 20 kg Fire Extinguisher = 70 kg of systems → total 586.
      await acpa.createEmbeddedDocuments("Item", [
        { name: "Swimmer Unit",     type: "acpaSystem", system: { category: "movement", weight: 50, spaces: 2, sop: 60, area: "torso" } },
        { name: "Fire Extinguisher", type: "acpaSystem", system: { category: "utility",  weight: 20, spaces: 1, sop: 40, area: "torso" } },
      ]);
      out.sysCount     = acpa.itemTypes.acpaSystem.length;  // 2
      out.mounted      = acpa.system.mountedSystemsWeight;  // 70
      out.totalWithSys = acpa.system.totalWeight;           // 586
      out.sibWithSys   = acpa.system.sib;                   // 2000/586 = 3.41 → 3 − 1 = 2
    } finally {
      if (acpa) await acpa.delete().catch(() => {});
    }
    return out;
  });

  console.log("Phase 6 D-4d-2:", JSON.stringify(R));
  expect(R.typeRegistered).toBe(true);
  expect(R.packExists).toBe(true);
  expect(R.catalogSize).toBe(20);                // 14 core + 6 defensive/countermeasure
  expect(R.seededCount).toBe(R.catalogSize);     // compendium seeded to the full catalog
  expect(R.baseTotal).toBe(516);
  expect(R.baseSib).toBe(3);
  expect(R.baseMounted).toBe(0);
  expect(R.sysCount).toBe(2);
  expect(R.mounted).toBe(70);
  expect(R.totalWithSys).toBe(586);
  expect(R.sibWithSys).toBe(2);
});

/**
 * Phase 6 D-4d-3 — per-system SOP damage wired into the resolver (LIVE). The System Hit category is
 * random, so we mount an enclosed system in every body area, strip the armor, and hammer the suit;
 * over many hits the "enclosed system" branch routes SOP to the struck area's mounted Item (damage +
 * destruction tracked on the Item). The exact absorb/destroy/overflow mechanics are pure-tested in 4d-1.
 */
test("Phase 6 D-4d-3: a System Hit damages a specific mounted system (live)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const VD = await import("/systems/cyberpunk2020/module/vehicle/vehicle-damage.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const out = {};
    let acpa;
    try {
      acpa = await Actor.create({ name: "__PW__ACPA_D4d3", type: "vehicle", flags,
        system: { isACPA: true, str: 40, sp: { front: 0, side: 0, rear: 0, top: 0, bottom: 0 }, sdp: { value: 100, max: 100 } } });
      // One enclosed system in every area (SOP 40: a single ~30-SOP hit accumulates without destroying;
      // a repeat to the same area destroys it and overflows to the frame).
      const areas = ["head", "rArm", "lArm", "rLeg", "lLeg", "torso"];
      await acpa.createEmbeddedDocuments("Item", areas.map(a => ({
        name: `Sys-${a}`, type: "acpaSystem", system: { category: "sensor", mount: "internal", area: a, sop: 40, weight: 1 }
      })));
      out.sysCountBefore = acpa.itemTypes.acpaSystem.length;  // 6

      // Hammer it: rawDamage 40 → SOP = 40 − 0 armor − 10 toughness = 30 per penetrating hit. Over many
      // hits ~15% route to the enclosed path and damage a mounted system in the struck area.
      for (let i = 0; i < 70; i++) {
        await VD.applyVehicleDamageMM(acpa, { rawDamage: 40, basePen: 50 });
      }
      const sysItems = acpa.itemTypes.acpaSystem;
      out.damagedCount  = sysItems.filter(it => (Number(it.system?.sopDamage) || 0) > 0 || it.system?.destroyed).length;
      out.destroyedCount = sysItems.filter(it => it.system?.destroyed).length;
      out.anyDamaged = out.damagedCount > 0;
    } finally {
      if (acpa) await acpa.delete().catch(() => {});
    }
    return out;
  });

  console.log("Phase 6 D-4d-3:", JSON.stringify(R));
  expect(R.sysCountBefore).toBe(6);
  expect(R.anyDamaged).toBe(true);   // the resolver routed SOP to specific mounted system Items
});

/**
 * Phase 6 D-5 — point-buy build validation + total cost (Maximum Metal p.61). PURE acpaBuildIssues
 * (SP ≤ 2×STR, weight ≤ chassis Lift/Capacity, per-area space budgets) + the derived buildCost on a
 * real ACPA (chassis + armor shell + interface + reflex/control + Command Computer + systems).
 */
test("Phase 6 D-5: build validation + total cost (pure + derived)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const S = await import("/systems/cyberpunk2020/module/vehicle/vehicle-acpa-systems.js");
    const out = { pure: {}, actor: {} };

    // PURE acpaBuildIssues — count the flagged issues for each scenario.
    out.pure.legal      = S.acpaBuildIssues({ str: 40, armorSP: 80, totalWeight: 500, chassisCapacity: 2000, spacesOver: {} }).length;             // 0 (SP = 2×40 OK)
    out.pure.spOver     = S.acpaBuildIssues({ str: 40, armorSP: 90, totalWeight: 500, chassisCapacity: 2000 }).length;                              // 1 (SP > 80)
    out.pure.overweight = S.acpaBuildIssues({ str: 40, armorSP: 40, totalWeight: 2500, chassisCapacity: 2000 }).length;                             // 1
    out.pure.spacesOver = S.acpaBuildIssues({ str: 40, armorSP: 40, totalWeight: 500, chassisCapacity: 2000, spacesOver: { torso: { internal: 2, external: 0 }, head: { internal: 0, external: 1 } } }).length; // 2
    out.pure.combined   = S.acpaBuildIssues({ str: 40, armorSP: 100, totalWeight: 2500, chassisCapacity: 2000, spacesOver: { torso: { internal: 1, external: 0 } } }).length; // 3

    // DERIVED buildCost: STR40 chassis 66000 + armor SP40 9600 + Full-HUD 2400 + Advanced 0 = 78000.
    const flags = { cyberpunk2020: { __pwtest: true } };
    let acpa;
    try {
      acpa = await Actor.create({ name: "__PW__ACPA_D5", type: "vehicle", flags,
        system: { isACPA: true, str: 40, sp: { front: 40, side: 0, rear: 0, top: 0, bottom: 0 } } });
      out.actor.baseCost = acpa.system.buildCost;   // 78000
      // + a 2000 eb system + Command Computer (5000) → 85000.
      await acpa.createEmbeddedDocuments("Item", [{ name: "Medic", type: "acpaSystem", system: { category: "utility", cost: 2000, weight: 3, area: "torso" } }]);
      await acpa.update({ "system.commandComputer": true });
      out.actor.withExtras  = acpa.system.buildCost;          // 78000 + 2000 + 5000 = 85000
      out.actor.mountedCost = acpa.system.mountedSystemsCost; // 2000
    } finally {
      if (acpa) await acpa.delete().catch(() => {});
    }
    return out;
  });

  console.log("Phase 6 D-5:", JSON.stringify(R));
  expect(R.pure.legal).toBe(0);
  expect(R.pure.spOver).toBe(1);
  expect(R.pure.overweight).toBe(1);
  expect(R.pure.spacesOver).toBe(2);
  expect(R.pure.combined).toBe(3);
  expect(R.actor.baseCost).toBe(78000);
  expect(R.actor.withExtras).toBe(85000);
  expect(R.actor.mountedCost).toBe(2000);
});

/**
 * Phase 6 polish #1 — external systems take hits and shield the suit (MM p.55). The 50% "external
 * system" branch now routes SOP to an external-mounted system in the struck area (instead of a GM
 * note); a surviving external system spares the suit proper, a destroyed one overflows to the frame.
 */
test("Phase 6 polish: external systems take hits and shield the suit (live)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const VD = await import("/systems/cyberpunk2020/module/vehicle/vehicle-damage.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const out = {};
    let acpa;
    try {
      acpa = await Actor.create({ name: "__PW__ACPA_EXT", type: "vehicle", flags,
        system: { isACPA: true, str: 40, sp: { front: 0, side: 0, rear: 0, top: 0, bottom: 0 }, sdp: { value: 100, max: 100 } } });
      // One EXTERNAL system per area; over many hits the external branch routes SOP to them.
      const areas = ["head", "rArm", "lArm", "rLeg", "lLeg", "torso"];
      await acpa.createEmbeddedDocuments("Item", areas.map(a => ({
        name: `Ext-${a}`, type: "acpaSystem", system: { category: "sensor", mount: "external", area: a, sop: 40, weight: 1 }
      })));
      for (let i = 0; i < 70; i++) await VD.applyVehicleDamageMM(acpa, { rawDamage: 40, basePen: 50 });
      const ext = acpa.itemTypes.acpaSystem;
      out.extDamaged = ext.filter(it => (Number(it.system?.sopDamage) || 0) > 0 || it.system?.destroyed).length;
      out.anyExtDamaged = out.extDamaged > 0;
    } finally { if (acpa) await acpa.delete().catch(() => {}); }
    return out;
  });

  console.log("Phase 6 polish ext:", JSON.stringify(R));
  expect(R.anyExtDamaged).toBe(true);   // external hits now damage external-mounted systems
});

/**
 * Phase 6 polish #2 — cooling failure → heatstroke escalation (MM p.55), reconciling the minutes vs
 * rounds scales. The 2d10-minute build-up ticks down in real round-time (0.05 min/round); on expiry
 * the pilot makes an escalating Stun/Shock Save each round (Serious → Critical → Mortal → out). PURE.
 */
test("Phase 6 polish: cooling → heatstroke escalation (per-round, pure)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);

  const R = await evalGameOrThrow(page, async () => {
    const A = await import("/systems/cyberpunk2020/module/vehicle/vehicle-acpa.js");
    const out = {};
    out.cool1 = A.acpaTickStatus({ coolingTimer: 0.1 }).updates["system.coolingTimer"];   // 0.05 (counts down)
    const exp = A.acpaTickStatus({ coolingTimer: 0.05 });
    out.expCool = exp.updates["system.coolingTimer"];        // 0
    out.expHeat = exp.updates["system.heatstrokeLevel"];     // 1 (Serious)
    out.heat2 = A.acpaTickStatus({ coolingTimer: 0, heatstrokeLevel: 1 }).updates["system.heatstrokeLevel"]; // 2
    out.heat3 = A.acpaTickStatus({ coolingTimer: 0, heatstrokeLevel: 2 }).updates["system.heatstrokeLevel"]; // 3
    out.heatCap = A.acpaTickStatus({ coolingTimer: 0, heatstrokeLevel: 9 }).updates["system.heatstrokeLevel"]; // 4 (capped)
    out.noneKeys = Object.keys(A.acpaTickStatus({}).updates).length;  // 0 (no cooling/heat → no updates)
    return out;
  });

  console.log("Phase 6 polish cooling:", JSON.stringify(R));
  expect(R.cool1).toBe(0.05);
  expect(R.expCool).toBe(0);
  expect(R.expHeat).toBe(1);
  expect(R.heat2).toBe(2);
  expect(R.heat3).toBe(3);
  expect(R.heatCap).toBe(4);
  expect(R.noneKeys).toBe(0);
});

/**
 * Phase 6 polish #3 — pilot-actor link (LIVE). A linked pilot character drives the suit's effective
 * REF (over the manual fallback), and frame-breach overflow wounds that pilot (firing the normal
 * stun/death-save automation via the updateActor hook).
 */
test("Phase 6 polish: pilot link drives REF + takes frame-overflow damage (live)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const VD = await import("/systems/cyberpunk2020/module/vehicle/vehicle-damage.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const out = {};
    let pilot, acpa;
    try {
      pilot = await Actor.create({ name: "__PW__Pilot", type: "character", flags, system: { stats: { ref: { base: 8 } } } });
      out.pilotRefTotal = Number(pilot.system?.stats?.ref?.total) || 0;   // 8

      // Manual pilotRef is deliberately 5 — the linked pilot's REF (8) must win.
      acpa = await Actor.create({ name: "__PW__ACPA_PILOT", type: "vehicle", flags,
        system: { isACPA: true, str: 40, sp: { front: 0, side: 0, rear: 0, top: 0, bottom: 0 }, sdp: { value: 100, max: 100 }, pilotId: pilot.id, pilotRef: 5 } });
      out.effRefLinked = acpa.system.effectiveRef;   // clamp(8 + 0 Advanced, 0..10) = 8

      // Hammer the (armor-stripped) suit; frame overflow wounds the pilot.
      const before = Number(game.actors.get(pilot.id)?.system?.damage) || 0;
      for (let i = 0; i < 60; i++) await VD.applyVehicleDamageMM(acpa, { rawDamage: 999, basePen: 99 });
      out.pilotDmgAfter = Number(game.actors.get(pilot.id)?.system?.damage) || 0;
      out.pilotTookDamage = out.pilotDmgAfter > before;
    } finally {
      if (acpa) await acpa.delete().catch(() => {});
      if (pilot) await pilot.delete().catch(() => {});
    }
    return out;
  });

  console.log("Phase 6 polish pilot:", JSON.stringify(R));
  expect(R.pilotRefTotal).toBe(8);
  expect(R.effRefLinked).toBe(8);       // linked pilot REF used, not the manual fallback (5)
  expect(R.pilotTookDamage).toBe(true); // frame-breach overflow wounded the pilot
});

/**
 * Phase 6 polish #4 — real rolled damage threads into the ACPA SOP flow (LIVE). The same Pen-1 attack
 * does nothing via the Pen×10 estimate (10 − Toughness 10 = 0 SOP) but penetrates and destroys the
 * frame once the firer supplies the weapon's actual rolled damage (rawDamage).
 */
test("Phase 6 polish: real rolled damage threads to the ACPA SOP flow (live)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const VT = await import("/systems/cyberpunk2020/module/vehicle/vehicle-targeting.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const sumSOP = (o) => Object.values(o || {}).reduce((a, v) => a + (Number(v) || 0), 0);
    const out = {};
    let acpa;
    try {
      acpa = await Actor.create({ name: "__PW__ACPA_RAW", type: "vehicle", flags,
        system: { isACPA: true, str: 40, sp: { front: 0, side: 0, rear: 0, top: 0, bottom: 0 }, sdp: { value: 100, max: 100 } } });
      // (a) Pen 1, NO rawDamage → incoming = Pen×10 = 10; − Toughness 10 → SOP 0 → never penetrates.
      for (let i = 0; i < 12; i++) await VT.dispatchAttack({ scale: "penetration", penetration: 1, facing: "front" }, acpa);
      out.noRawFrameSum = sumSOP(acpa._source.system.frameSOP);     // 0 (frame untouched)
      out.noRawDestroyed = acpa._source.system.destroyed === true;   // false
      // (b) Same Pen 1, but rawDamage 500 → SOP 490 → penetrates; frame eventually destroyed.
      let destroyed = false;
      for (let i = 0; i < 30 && !destroyed; i++) {
        await VT.dispatchAttack({ scale: "penetration", penetration: 1, rawDamage: 500, facing: "front" }, acpa);
        destroyed = acpa._source.system.destroyed === true;
      }
      out.rawDestroyed = destroyed;
    } finally { if (acpa) await acpa.delete().catch(() => {}); }
    return out;
  });

  console.log("Phase 6 polish rawdmg:", JSON.stringify(R));
  expect(R.noRawFrameSum).toBe(0);      // Pen×10 (10) − Toughness 10 = 0 → no penetration
  expect(R.noRawDestroyed).toBe(false);
  expect(R.rawDestroyed).toBe(true);    // threaded real damage (500) penetrates + destroys the frame
});

/**
 * Phase 6 polish — Basic Reflex/Control is stricter on a military STR42+ frame: REF−3 instead of −2
 * (MM p.65). acpaReflexMod applies the heavy-frame variant; the suit's refMod/effectiveRef reflect it.
 */
test("Phase 6 polish: Basic control is REF-3 on STR42+ frames (pure + derived)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const A = await import("/systems/cyberpunk2020/module/vehicle/vehicle-acpa.js");
    const out = { pure: {}, actor: {} };
    out.pure.basicLight = A.acpaReflexMod("BASIC", 40);    // -2 (< STR42)
    out.pure.basicHeavy = A.acpaReflexMod("BASIC", 42);    // -3 (STR42+ military frame)
    out.pure.advHeavy   = A.acpaReflexMod("ADVANCED", 50); // 0 (only Basic has the heavy penalty)

    const flags = { cyberpunk2020: { __pwtest: true } };
    let acpa;
    try {
      acpa = await Actor.create({ name: "__PW__ACPA_BASIC", type: "vehicle", flags,
        system: { isACPA: true, str: 42, reflexControl: "BASIC", pilotRef: 9 } });
      out.actor.refMod42 = acpa.system.refMod;        // -3
      out.actor.eff42    = acpa.system.effectiveRef;  // clamp(9 − 3, 0..8) = 6
      await acpa.update({ "system.str": 40 });
      out.actor.refMod40 = acpa.system.refMod;        // -2 (light frame)
      out.actor.eff40    = acpa.system.effectiveRef;  // clamp(9 − 2, 0..8) = 7
    } finally { if (acpa) await acpa.delete().catch(() => {}); }
    return out;
  });

  console.log("Phase 6 polish basic:", JSON.stringify(R));
  expect(R.pure.basicLight).toBe(-2);
  expect(R.pure.basicHeavy).toBe(-3);
  expect(R.pure.advHeavy).toBe(0);
  expect(R.actor.refMod42).toBe(-3);
  expect(R.actor.eff42).toBe(6);
  expect(R.actor.refMod40).toBe(-2);
  expect(R.actor.eff40).toBe(7);
});

/**
 * Phase 6 deferral B — per-weapon SOP. A SOP-tracked ACPA weapon (vehicleWeapon with system.sop > 0,
 * mounted in a body area) takes damage when the "internal weapon" System-Hit branch lands in its area,
 * and repairAcpa restores it. Weapons without SOP data still fall through to the frame.
 */
test("Phase 6 deferral B: a 'weapons' System Hit damages a SOP-tracked ACPA weapon (live)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const VD = await import("/systems/cyberpunk2020/module/vehicle/vehicle-damage.js");
    const AC = await import("/systems/cyberpunk2020/module/vehicle/vehicle-acpa-combat.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const out = {};
    let acpa;
    try {
      acpa = await Actor.create({ name: "__PW__ACPA_WPN", type: "vehicle", flags,
        system: { isACPA: true, str: 40, sp: { front: 0, side: 0, rear: 0, top: 0, bottom: 0 }, sdp: { value: 100, max: 100 } } });
      const areas = ["head", "rArm", "lArm", "rLeg", "lLeg", "torso"];
      await acpa.createEmbeddedDocuments("Item", areas.map(a => ({
        name: `Gun-${a}`, type: "vehicleWeapon", system: { penetration: 4, area: a, sop: 40 }
      })));
      out.wpnCount = acpa.itemTypes.vehicleWeapon.length;   // 6
      for (let i = 0; i < 80; i++) await VD.applyVehicleDamageMM(acpa, { rawDamage: 40, basePen: 50 });
      const wpns = acpa.itemTypes.vehicleWeapon;
      out.anyWpnDamaged = wpns.some(w => (Number(w.system?.sopDamage) || 0) > 0 || w.system?.destroyed);
      await AC.repairAcpa(acpa);
      out.afterRepairDamaged = acpa.itemTypes.vehicleWeapon.filter(w => (Number(w.system?.sopDamage) || 0) > 0 || w.system?.destroyed).length; // 0
    } finally { if (acpa) await acpa.delete().catch(() => {}); }
    return out;
  });

  console.log("Phase 6 deferral B:", JSON.stringify(R));
  expect(R.wpnCount).toBe(6);
  expect(R.anyWpnDamaged).toBe(true);      // a SOP-tracked weapon took the "internal weapon" hit
  expect(R.afterRepairDamaged).toBe(0);    // repair restored the weapons
});
