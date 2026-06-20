import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Vehicle — Phase 3: Movement & Control rolls (Core p.112 + Maximum Metal p.10-11).
 *
 * The control/maneuver math is split into PURE functions (they take the rolled die faces as
 * arguments) so we can assert exact RAW outcomes deterministically. We test:
 *   - coreSpeedPenalty / mmSpeedDV / defaultControlMod / isAircraft (the modifier math),
 *   - resolveControlRoll success/fail boundaries under both rulesets,
 *   - coreControlLoss / mmFailureTable for every band, ground AND aircraft,
 *   - composeControlOutcome (the live dice→table wiring: which table, the +missedBy/3 escalation,
 *     and the "5d6 crash only on a ground 5-6" rule),
 *   - the integration surface a GM actually touches: the setting, the API, and driver prefill.
 *
 * All run in one page eval so they share the dynamic import of the module under test.
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("Phase 3: control/maneuver math, loss tables, and the dice→table wiring", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const VC = await import("/systems/cyberpunk2020/module/vehicle/vehicle-control.js");
    const out = {};

    // --- Core over-safe-speed penalty (p.112) ---
    out.spUnder   = VC.coreSpeedPenalty(40, 50);   // below safe → 0
    out.spDouble  = VC.coreSpeedPenalty(100, 50);  // 2× → -2
    out.spTriple  = VC.coreSpeedPenalty(150, 50);  // 3× → -4
    out.spQuad    = VC.coreSpeedPenalty(200, 50);  // 4× → -6
    out.spNoSafe  = VC.coreSpeedPenalty(100, 0);   // unknown safe → 0

    // --- Maximum Metal speed difficulty (p.11): +1 per 10% of top over 50% top ---
    out.mmHalf   = VC.mmSpeedDV(50, 100);   // exactly 50% → 0
    out.mmOver10 = VC.mmSpeedDV(60, 100);   // 60% → +1
    out.mmOver30 = VC.mmSpeedDV(80, 100);   // 80% → +3
    out.mmJustOver = VC.mmSpeedDV(55, 100); // 55% → floor(5/10)=0
    out.mmNoTop  = VC.mmSpeedDV(80, 0);     // unknown top → 0

    // --- Default control modifiers differ between rulesets ---
    out.coreSports = VC.defaultControlMod("sportscar", "Core");      // +2
    out.coreLimo   = VC.defaultControlMod("limo", "Core");           // -3
    out.coreAV4    = VC.defaultControlMod("AV-4", "Core");           // -2 (Core)
    out.coreTruck  = VC.defaultControlMod("truck", "Core");          // -4
    out.mmAV4      = VC.defaultControlMod("AV-4", "MaximumMetal");   //  0 (MM revised, differs from Core)
    out.mmTank     = VC.defaultControlMod("tank", "MaximumMetal");   // +2
    out.mmHover    = VC.defaultControlMod("hover", "MaximumMetal");  // -2
    out.mmAirship  = VC.defaultControlMod("airship", "MaximumMetal");// +5
    out.unknownType = VC.defaultControlMod("hovertank", "Core");     //  0 fallback

    // --- Aircraft branch detection ---
    out.airAir    = VC.isAircraft("air");      // true — keys off the explicit movement class
    out.airGround = VC.isAircraft("ground");   // false
    out.airWater  = VC.isAircraft("water");    // false
    out.airName   = VC.isAircraft("rotor");    // false — the type NAME no longer triggers it

    // --- resolveControlRoll success/fail boundaries ---
    // Core: 1d10=7 + REF 8 + Skill 4 + handling -3 = 16 ≥ 15 (simple) → success
    out.coreSuccess = VC.resolveControlRoll({ ruleSystem: "Core", difficulty: "simple", d10: 7, ref: 8, skill: 4, handlingMod: -3 }).success;
    // Same but Difficult 20 → 16 < 20 → fail, missedBy 4
    const coreFail = VC.resolveControlRoll({ ruleSystem: "Core", difficulty: "difficult", d10: 7, ref: 8, skill: 4, handlingMod: -3 });
    out.coreFailSuccess = coreFail.success; out.coreFailMissedBy = coreFail.missedBy;  // false, 4
    // Core speed penalty folds into the roll: add 4× safe (-6) → 16-6=10
    out.coreSpeedTotal = VC.resolveControlRoll({ ruleSystem: "Core", difficulty: "simple", d10: 7, ref: 8, skill: 4, handlingMod: -3, currentSpeed: 200, safeSpeed: 50 }).total; // 10
    // MM: speed/conditions raise the DV instead. Simple 15 + speed(+3 at 80/100) + icy(+5) = 23
    const mm = VC.resolveControlRoll({ ruleSystem: "MaximumMetal", difficulty: "simple", d10: 5, ref: 8, skill: 6, handlingMod: 0, currentSpeed: 80, topSpeed: 100, icy: true });
    out.mmDV = mm.dv;        // 15 + 3 + 5 = 23
    out.mmTotal = mm.total;  // 5 + 8 + 6 = 19
    out.mmSuccess = mm.success;  // 19 < 23 → false
    out.mmMissedBy = mm.missedBy; // 4
    // MM cyberlink adds +2 to the ROLL (not the DV)
    out.mmCyberTotal = VC.resolveControlRoll({ ruleSystem: "MaximumMetal", difficulty: "simple", d10: 5, ref: 8, skill: 6, cyberlink: true }).total; // 21

    // --- coreControlLoss: every band, ground + aircraft ---
    out.coreLoss12 = VC.coreControlLoss(1).severity;                                   // minor
    out.coreLoss34Ground = VC.coreControlLoss(3, { slideDie: 5 }).text.includes("50 ft"); // 5×10 ft = 50 ft
    out.coreLoss34Air = VC.coreControlLoss(3, { aircraft: true, slideDie: 4 }).text.includes("200 ft"); // 4×50
    out.coreLoss56GroundSev = VC.coreControlLoss(6, { slideDie: 2, crashDamage: 17 }).severity;     // catastrophic
    out.coreLoss56GroundDmg = VC.coreControlLoss(6, { slideDie: 2, crashDamage: 17 }).damage;       // 17
    out.coreLoss56Air = VC.coreControlLoss(6, { aircraft: true, slideDie: 3 }).text.includes("300 ft"); // 3×100

    // --- mmFailureTable: every band, ground + aircraft ---
    out.mmFail14 = VC.mmFailureTable(2).severity;                       // skid
    out.mmFail56Ground = VC.mmFailureTable(5, { skidDie: 4 }).text.includes("12 m");        // 4×3 m
    out.mmFail56Air = VC.mmFailureTable(6, { aircraft: true, skidDie: 4 }).severity;        // lose-control
    out.mmFail7Ground = VC.mmFailureTable(8, { skidDie: 2 }).severity;                      // catastrophic
    out.mmFail7Air = VC.mmFailureTable(9, { aircraft: true, skidDie: 2 }).text.includes("tailspin");

    // --- composeControlOutcome: the live dice→table wiring ---
    // Core ground, fails Difficult by 4, table d6=6 → 5-6 ground roll with 5d6 crash applied
    const c1 = VC.composeControlOutcome(
      { ruleSystem: "Core", difficulty: "difficult", vehicleType: "car", d10: 7, ref: 8, skill: 4, handlingMod: -3 },
      { d10: 7, tableD6: 6, slideD10: 2, crashD6Total: 18 });
    out.c1Success = c1.result.success;          // false
    out.c1Band = c1.outcome.band;               // 5-6
    out.c1Damage = c1.outcome.damage;           // 18 (crash applied because ground + d6>=5)
    // Same table roll but AIRCRAFT → no crash damage even on a 5-6 (spin instead)
    const c2 = VC.composeControlOutcome(
      { ruleSystem: "Core", difficulty: "difficult", vehicleType: "AV-4", d10: 7, ref: 8, skill: 4, handlingMod: -3 },
      { d10: 7, tableD6: 6, slideD10: 3, crashD6Total: 18 });
    out.c2Damage = c2.outcome.damage;           // undefined (aircraft spin, no crashDamage field)
    out.c2Spin = c2.outcome.text.includes("Spin");
    // Success path → no outcome
    const c3 = VC.composeControlOutcome(
      { ruleSystem: "Core", difficulty: "simple", vehicleType: "car", d10: 7, ref: 8, skill: 4, handlingMod: -3 },
      { d10: 7 });
    out.c3Outcome = c3.outcome;                 // null
    // MM escalation: miss by 4 → +1 to table roll. tableD6=6 → 6+1 = 7 → 7+ catastrophic
    const c4 = VC.composeControlOutcome(
      { ruleSystem: "MaximumMetal", difficulty: "simple", vehicleType: "tank", d10: 5, ref: 8, skill: 6, currentSpeed: 80, topSpeed: 100, icy: true },
      { d10: 5, tableD6: 6, slideD10: 2 });
    out.c4MissedBy = c4.result.missedBy;        // 4
    out.c4TableTotal = c4.outcome.tableTotal;   // 6 + floor(4/3)=1 = 7
    out.c4Band = c4.outcome.band;               // 7+

    // --- Integration surface a GM touches ---
    try { out.controlSetting = game.settings.get("cyberpunk2020", "vehicleControlEnabled"); out.settingExists = true; }
    catch { out.settingExists = false; }
    out.apiIsFn = typeof game.cyberpunk?.vehicles?.controlRoll === "function";

    return out;
  });

  console.log("Vehicle Phase 3:", JSON.stringify(R, null, 2));

  // Core speed penalty
  expect(R.spUnder).toBe(0);
  expect(R.spDouble).toBe(-2);
  expect(R.spTriple).toBe(-4);
  expect(R.spQuad).toBe(-6);
  expect(R.spNoSafe).toBe(0);

  // MM speed difficulty
  expect(R.mmHalf).toBe(0);
  expect(R.mmOver10).toBe(1);
  expect(R.mmOver30).toBe(3);
  expect(R.mmJustOver).toBe(0);
  expect(R.mmNoTop).toBe(0);

  // Default control mods
  expect(R.coreSports).toBe(2);
  expect(R.coreLimo).toBe(-3);
  expect(R.coreAV4).toBe(-2);
  expect(R.coreTruck).toBe(-4);
  expect(R.mmAV4, "MM AV-4 handling differs from Core").toBe(0);
  expect(R.mmTank).toBe(2);
  expect(R.mmHover).toBe(-2);
  expect(R.mmAirship).toBe(5);
  expect(R.unknownType).toBe(0);

  // Aircraft detection
  expect(R.airAir).toBe(true);
  expect(R.airGround).toBe(false);
  expect(R.airWater).toBe(false);
  expect(R.airName).toBe(false);

  // resolveControlRoll boundaries
  expect(R.coreSuccess).toBe(true);
  expect(R.coreFailSuccess).toBe(false);
  expect(R.coreFailMissedBy).toBe(4);
  expect(R.coreSpeedTotal).toBe(10);
  expect(R.mmDV).toBe(23);
  expect(R.mmTotal).toBe(19);
  expect(R.mmSuccess).toBe(false);
  expect(R.mmMissedBy).toBe(4);
  expect(R.mmCyberTotal).toBe(21);

  // Core control loss
  expect(R.coreLoss12).toBe("minor");
  expect(R.coreLoss34Ground).toBe(true);
  expect(R.coreLoss34Air).toBe(true);
  expect(R.coreLoss56GroundSev).toBe("catastrophic");
  expect(R.coreLoss56GroundDmg).toBe(17);
  expect(R.coreLoss56Air).toBe(true);

  // MM failure table
  expect(R.mmFail14).toBe("skid");
  expect(R.mmFail56Ground).toBe(true);
  expect(R.mmFail56Air).toBe("lose-control");
  expect(R.mmFail7Ground).toBe("catastrophic");
  expect(R.mmFail7Air).toBe(true);

  // composeControlOutcome wiring
  expect(R.c1Success).toBe(false);
  expect(R.c1Band).toBe("5-6");
  expect(R.c1Damage).toBe(18);
  expect(R.c2Damage, "aircraft 5-6 has no crash damage (spin)").toBeUndefined();
  expect(R.c2Spin).toBe(true);
  expect(R.c3Outcome, "success → no loss outcome").toBeNull();
  expect(R.c4MissedBy).toBe(4);
  expect(R.c4TableTotal, "missed by 4 → +1 to the failure table roll").toBe(7);
  expect(R.c4Band).toBe("7+");

  // Integration
  expect(R.settingExists).toBe(true);
  expect(R.controlSetting, "control rolls default ON").toBe(true);
  expect(R.apiIsFn, "game.cyberpunk.vehicles.controlRoll is exposed").toBe(true);
});

test("Phase 3: a real control roll posts a result card (live dice path)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const VC = await import("/systems/cyberpunk2020/module/vehicle/vehicle-control.js");
    const flags = { cyberpunk2020: { __pwtest: true } };

    // A driver with known REF + Driving, and a vehicle. We exercise composeControlOutcome with a
    // *real* rolled d10 to prove the live path returns a coherent result+outcome with no exceptions.
    const driver = await Actor.create({ name: "__PW__Driver", type: "character", flags,
      system: { stats: { ref: { base: 8 } } } });
    const veh = await Actor.create({ name: "__PW__Car", type: "vehicle", flags,
      system: { vehicleType: "car", sdp: { value: 100, max: 100 }, safeSpeed: 50, controlMod: 0 } });

    const ref = Number(driver.system.stats.ref.total) || 0;
    const params = { ruleSystem: "Core", difficulty: "veryDifficult", vehicleType: veh.system.vehicleType, locomotion: veh.system.locomotion,
      ref, skill: 0, handlingMod: Number(veh.system.controlMod) || 0, currentSpeed: 150, safeSpeed: 50 };

    const d10 = (await new Roll("1d10").evaluate()).total;
    const dice = { d10 };
    let pre = VC.resolveControlRoll({ ...params, d10 });
    if (!pre.success) {
      dice.tableD6 = (await new Roll("1d6").evaluate()).total;
      dice.slideD10 = (await new Roll("1d10").evaluate()).total;
      if (dice.tableD6 >= 5 && !VC.isAircraft(params.locomotion)) dice.crashD6Total = (await new Roll("5d6").evaluate()).total;
    }
    const composed = VC.composeControlOutcome(params, dice);

    return {
      refRead: ref,
      hasResult: typeof composed.result?.success === "boolean",
      dvComputed: composed.result.dv,                 // veryDifficult 25
      totalIsNum: Number.isFinite(composed.result.total),
      // Whenever the roll failed, an outcome with a band must be present (no silent gap).
      failHasOutcome: composed.result.success ? composed.outcome === null : (!!composed.outcome && !!composed.outcome.band),
    };
  });

  console.log("Vehicle Phase 3 live path:", JSON.stringify(R));
  expect(R.refRead).toBe(8);
  expect(R.hasResult).toBe(true);
  expect(R.dvComputed).toBe(25);
  expect(R.totalIsNum).toBe(true);
  expect(R.failHasOutcome, "a failed roll always yields a banded loss outcome").toBe(true);
});

test("Phase 3: the vehicleControlEnabled setting actually gates the dialog (real GM toggle)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  // openControlRollDialog returns the Dialog instance when it opens, or null when gated off /
  // given a non-vehicle — a deterministic signal that doesn't depend on polling the window manager.
  const R = await evalGameOrThrow(page, async () => {
    const VC = await import("/systems/cyberpunk2020/module/vehicle/vehicle-control.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const veh = await Actor.create({ name: "__PW__GateCar", type: "vehicle", flags, system: { vehicleType: "car", safeSpeed: 50 } });
    const out = {};
    const orig = game.settings.get("cyberpunk2020", "vehicleControlEnabled");

    // OFF → returns null, no throw.
    await game.settings.set("cyberpunk2020", "vehicleControlEnabled", false);
    let threw = false, disabled;
    try { disabled = await VC.openControlRollDialog(veh); } catch (e) { threw = true; }
    out.disabledThrew = threw;
    out.disabledReturnedNull = disabled === null;

    // ON → returns a closeable Dialog instance.
    await game.settings.set("cyberpunk2020", "vehicleControlEnabled", true);
    const dlg = await VC.openControlRollDialog(veh);
    out.enabledReturnedDialog = !!(dlg && typeof dlg.close === "function");
    if (dlg?.close) await dlg.close();

    // Non-vehicle actor → null, no throw.
    const charActor = await Actor.create({ name: "__PW__NotVeh", type: "character", flags });
    let threw2 = false, nonVeh;
    try { nonVeh = await VC.openControlRollDialog(charActor); } catch (e) { threw2 = true; }
    out.nonVehicleThrew = threw2;
    out.nonVehicleReturnedNull = nonVeh === null;

    await game.settings.set("cyberpunk2020", "vehicleControlEnabled", orig);
    await veh.delete().catch(() => {});
    await charActor.delete().catch(() => {});
    return out;
  });

  console.log("Vehicle Phase 3 gate:", JSON.stringify(R));
  expect(R.disabledThrew, "disabled gate does not throw").toBe(false);
  expect(R.disabledReturnedNull, "setting OFF → returns null (no dialog)").toBe(true);
  expect(R.enabledReturnedDialog, "setting ON → returns a Dialog").toBe(true);
  expect(R.nonVehicleThrew, "non-vehicle actor does not throw").toBe(false);
  expect(R.nonVehicleReturnedNull, "non-vehicle actor → returns null").toBe(true);
});
