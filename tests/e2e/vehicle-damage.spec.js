import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Vehicle — Phase 4: the damage resolver (Core p.112 + Maximum Metal p.4-6).
 *
 * Pure, deterministic functions take the rolled die faces as arguments and are asserted exactly:
 *   coreVehicleDamage / coreCrashDamage, mmEffectivePenetration, mmEffectiveArmor,
 *   mmDamageSeverity, mmSurfaceDamage, mmHitLocation, mmSubLocation, acpaHitLocation,
 *   damageControlIgnores. Then live application: Core writes SDP; MM sets destroyed on a
 *   catastrophic; and the setting gates the dialog.
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("Phase 4: damage math (Core + Maximum Metal tables)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const VD = await import("/systems/cyberpunk2020/module/vehicle/vehicle-damage.js");
    const out = {};

    // --- Core: SP subtract, AP halves SP, remainder to SDP, destroyed at 0 ---
    out.core = VD.coreVehicleDamage({ rawDamage: 60, sp: 40, currentSDP: 100 });           // through 20, SDP 80
    out.coreAP = VD.coreVehicleDamage({ rawDamage: 60, sp: 40, currentSDP: 100, ap: true }); // SP 20, through 40, SDP 60
    out.coreKill = VD.coreVehicleDamage({ rawDamage: 200, sp: 40, currentSDP: 100 });        // destroyed

    // --- Core crash: floor(speed/20) d6 × weight; occupants half ---
    out.crash = VD.coreCrashDamage({ speed: 85, weightClass: "heavy", rolled: 14 });  // 4d6 × 3; 14×3=42, occ 21

    // --- MM penetration: Good Shot +½ base/step, multi-round +¼ base, range falloff ---
    out.penGoodShot = VD.mmEffectivePenetration({ basePen: 8, goodShotSteps: 1 });   // 8 + round(4) = 12
    out.penRounds   = VD.mmEffectivePenetration({ basePen: 8, extraRounds: 3 });      // 8 + round(2)*3 = 14
    out.penLong     = VD.mmEffectivePenetration({ basePen: 20, range: "long" });      // round(15) = 15
    out.penExtreme  = VD.mmEffectivePenetration({ basePen: 20, range: "extreme" });   // 10
    out.penHEF      = VD.mmEffectivePenetration({ basePen: 20, range: "extreme", hefPenetrator: true }); // 20 (no falloff)

    // --- MM flank armor ---
    out.avFront  = VD.mmEffectiveArmor(10, "front");   // 10
    out.avSide   = VD.mmEffectiveArmor(10, "side");    // ceil(7.5) = 8
    out.avTop    = VD.mmEffectiveArmor(10, "top");     // ceil(5) = 5
    out.avRear   = VD.mmEffectiveArmor(9, "rear");     // ceil(4.5) = 5

    // --- MM damage severity table ---
    out.sevNoPen = VD.mmDamageSeverity({ pen: 3, effectiveArmorValue: 5, bodyValue: 0, d10: 9 }).severity; // noPenetration
    out.sevSurf  = VD.mmDamageSeverity({ pen: 5, effectiveArmorValue: 5, bodyValue: 3, d10: 1 }).severity; // 1+0-3=-2 surface
    out.sevMinor = VD.mmDamageSeverity({ pen: 8, effectiveArmorValue: 5, bodyValue: 0, d10: 1 }).severity; // 1+3=4 minor
    out.sevMajor = VD.mmDamageSeverity({ pen: 8, effectiveArmorValue: 5, bodyValue: 0, d10: 4 }).severity; // 4+3=7 major
    out.sevCat   = VD.mmDamageSeverity({ pen: 10, effectiveArmorValue: 5, bodyValue: 0, d10: 5 }).severity; // 5+5=10 catastrophic

    // --- MM surface / hit location / sub-location / ACPA / damage control ---
    out.surfNo   = VD.mmSurfaceDamage(6, 5).itemDamaged;             // false (<7)
    out.surfYes  = VD.mmSurfaceDamage(8, 5).destroyed;              // true (basePen >= 3)
    out.surfSurv = VD.mmSurfaceDamage(8, 2).destroyed;             // false (basePen <= 2)
    out.locHull  = VD.mmHitLocation(5, "front");                   // Hull
    out.locMotive= VD.mmHitLocation(1, "front");                   // Motive Gear
    out.locTurret= VD.mmHitLocation(8, "front");                   // Turret
    out.locFuel  = VD.mmHitLocation(1, "rear");                    // 1-2 = -1 → Fuel
    out.subEngine= VD.mmSubLocation(3, "Hull", "front");           // 3+1=4 → Engine
    out.subCargo = VD.mmSubLocation(1, "Hull", "front");           // 2 → Cargo/Ammo
    out.subTurWpn= VD.mmSubLocation(9, "Turret", "front");         // 10 → Weapon
    out.acpa0    = VD.acpaHitLocation(0);                          // Power Cell
    out.acpaLegs = VD.acpaHitLocation(2);                          // Legs
    out.acpaTorso= VD.acpaHitLocation(9);                          // Torso/Head
    out.dcIgnore = VD.damageControlIgnores(6);                     // true
    out.dcFail   = VD.damageControlIgnores(5);                     // false

    return out;
  });

  console.log("Vehicle Phase 4 math:", JSON.stringify(R));

  expect(R.core).toMatchObject({ spUsed: 40, through: 20, newSDP: 80, destroyed: false });
  expect(R.coreAP).toMatchObject({ spUsed: 20, through: 40, newSDP: 60 });
  expect(R.coreKill.destroyed).toBe(true);
  expect(R.crash).toMatchObject({ numD6: 4, weightMult: 3, vehicleDamage: 42, occupantDamage: 21 });

  expect(R.penGoodShot).toBe(12);
  expect(R.penRounds).toBe(14);
  expect(R.penLong).toBe(15);
  expect(R.penExtreme).toBe(10);
  expect(R.penHEF).toBe(20);

  expect(R.avFront).toBe(10);
  expect(R.avSide).toBe(8);
  expect(R.avTop).toBe(5);
  expect(R.avRear).toBe(5);

  expect(R.sevNoPen).toBe("noPenetration");
  expect(R.sevSurf).toBe("surface");
  expect(R.sevMinor).toBe("minor");
  expect(R.sevMajor).toBe("major");
  expect(R.sevCat).toBe("catastrophic");

  expect(R.surfNo).toBe(false);
  expect(R.surfYes).toBe(true);
  expect(R.surfSurv).toBe(false);
  expect(R.locHull).toBe("Hull");
  expect(R.locMotive).toBe("Motive Gear");
  expect(R.locTurret).toBe("Turret");
  expect(R.locFuel).toBe("Fuel");
  expect(R.subEngine).toBe("Engine");
  expect(R.subCargo).toBe("Cargo/Ammo");
  expect(R.subTurWpn).toBe("Weapon");
  expect(R.acpa0).toBe("Power Cell");
  expect(R.acpaLegs).toBe("Legs");
  expect(R.acpaTorso).toBe("Torso/Head");
  expect(R.dcIgnore).toBe(true);
  expect(R.dcFail).toBe(false);
});

test("Phase 4: live application (Core writes SDP, MM catastrophic destroys), and the setting gates the dialog", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const VD = await import("/systems/cyberpunk2020/module/vehicle/vehicle-damage.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const out = {};

    // Core: 60 damage − SP 40 = 20 to SDP → 200 - 20 = 180 (read committed _source value).
    const car = await Actor.create({ name: "__PW__DmgCar", type: "vehicle", flags,
      system: { sp: { front: 40 }, sdp: { value: 200, max: 200 } } });
    await VD.applyVehicleDamageCore(car, { rawDamage: 60, facing: "front" });
    out.coreSDP = car._source.system.sdp.value;        // 180

    // MM: huge penetration vs tiny AV/Body → always catastrophic → destroyed.
    const tank = await Actor.create({ name: "__PW__DmgTank", type: "vehicle", flags,
      system: { sp: { front: 40 }, sdp: { value: 200, max: 200 } } });   // AV 2, Body 10
    const mm = await VD.applyVehicleDamageMM(tank, { basePen: 100, facing: "front" });
    out.mmSeverity = mm.severity;                       // catastrophic
    out.mmDestroyed = tank._source.system.destroyed;    // true

    // MM non-penetrating hit: basePen 1 vs AV 2 → no penetration, not destroyed.
    const tank2 = await Actor.create({ name: "__PW__DmgTank2", type: "vehicle", flags,
      system: { sp: { front: 40 }, sdp: { value: 200, max: 200 } } });
    const mm2 = await VD.applyVehicleDamageMM(tank2, { basePen: 1, facing: "front" });
    out.mmNoPen = mm2.severity;                         // noPenetration
    out.mmNoPenDestroyed = tank2._source.system.destroyed;  // false

    // Setting gate.
    const orig = game.settings.get("cyberpunk2020", "vehicleDamageEnabled");
    await game.settings.set("cyberpunk2020", "vehicleDamageEnabled", false);
    out.disabled = await VD.openVehicleDamageDialog(car);       // null
    await game.settings.set("cyberpunk2020", "vehicleDamageEnabled", true);
    const dlg = await VD.openVehicleDamageDialog(car);
    out.enabledDialog = !!(dlg && typeof dlg.close === "function");
    if (dlg?.close) await dlg.close();
    const charActor = await Actor.create({ name: "__PW__NotVeh2", type: "character", flags });
    out.nonVehicle = await VD.openVehicleDamageDialog(charActor);  // null
    await game.settings.set("cyberpunk2020", "vehicleDamageEnabled", orig);

    for (const a of [car, tank, tank2, charActor]) await a.delete().catch(() => {});
    return out;
  });

  console.log("Vehicle Phase 4 live:", JSON.stringify(R));
  expect(R.coreSDP, "Core: 200 − (60−40) = 180").toBe(180);
  expect(R.mmSeverity, "huge pen vs tiny AV → catastrophic").toBe("catastrophic");
  expect(R.mmDestroyed, "catastrophic destroys the vehicle").toBe(true);
  expect(R.mmNoPen, "pen 1 vs AV 2 → no penetration").toBe("noPenetration");
  expect(R.mmNoPenDestroyed, "a non-penetrating hit does not destroy").toBe(false);
  expect(R.disabled, "setting OFF → dialog returns null").toBeNull();
  expect(R.enabledDialog, "setting ON → dialog opens").toBe(true);
  expect(R.nonVehicle, "non-vehicle actor → null").toBeNull();
});
