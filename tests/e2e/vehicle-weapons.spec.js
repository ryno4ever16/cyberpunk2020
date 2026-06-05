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

test("Phase 5: live bridge — firing a normal weapon at a vehicle token routes to the resolver", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const VW = await import("/systems/cyberpunk2020/module/vehicle/vehicle-weapons.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const out = {};
    const origRule = game.settings.get("cyberpunk2020", "vehicleRuleSystem");
    const origMM = game.settings.get("cyberpunk2020", "mmEnabled");
    await game.settings.set("cyberpunk2020", "mmEnabled", true);   // MM resolver now gated behind the master toggle

    // --- routeWeaponFiredToVehicle directly, Core: 50 damage − SP 40 = 10 to SDP ---
    await game.settings.set("cyberpunk2020", "vehicleRuleSystem", "Core");
    const car = await Actor.create({ name: "__PW__BridgeCar", type: "vehicle", flags, system: { sp: { front: 40 }, sdp: { value: 200, max: 200 } } });
    await VW.routeWeaponFiredToVehicle({ areaDamages: { Torso: [{ damage: 50 }] }, ap: false }, car);
    out.coreSDP = car._source.system.sdp.value;          // 190

    // --- MM: the bridge resolves the firing weapon by name for exact Penetration ---
    await game.settings.set("cyberpunk2020", "vehicleRuleSystem", "MaximumMetal");
    const gunner = await Actor.create({ name: "__PW__BridgeGunner", type: "npc", flags });
    await gunner.createEmbeddedDocuments("Item", [
      { name: "__PW__RailCannon", type: "weapon", flags, system: { damage: "6d10", ap: true, attackType: "" } },  // Pen 6
    ]);
    // Light vehicle (AV 2, Body 2): Pen 6 → score = 1d10 + (6−2) − 2 ≥ 3, always at least Minor, so
    // a damaged system / status is always recorded — a deterministic "the resolver did something".
    const tank = await Actor.create({ name: "__PW__BridgeTank", type: "vehicle", flags, system: { sp: { front: 40 }, sdp: { value: 40, max: 40 } } });
    const mm = await VW.routeWeaponFiredToVehicle(
      { attackerId: gunner.id, weaponName: "__PW__RailCannon", areaDamages: { Torso: [{ damage: 18 }] }, ap: true }, tank);
    out.mmHandled = mm;                                  // true
    out.tankChanged = tank._source.system.destroyed === true || (tank._source.system.damagedSystems?.length ?? 0) > 0 || tank._source.system.sdp.value < 40 || tank._source.system.onFire === true || tank._source.system.immobilized === true;

    // --- live: emit weaponFired at the vehicle token; the _hookWeaponFired divert handles it (Core) ---
    await game.settings.set("cyberpunk2020", "vehicleRuleSystem", "Core");
    const scene = await Scene.create({ name: "__PW__scene", width: 2000, height: 2000, grid: { type: 1, size: 100, distance: 2, units: "m" }, padding: 0, flags });
    const apc = await Actor.create({ name: "__PW__LiveAPC", type: "vehicle", flags, system: { sp: { front: 40 }, sdp: { value: 200, max: 200 } } });
    const [tok] = await scene.createEmbeddedDocuments("Token", [{ name: "__PW__LiveAPC", x: 100, y: 100, actorId: apc.id, actorLink: true, width: 4, height: 2, flags }]);
    Hooks.callAll("cyberpunk2020.weaponFired", {
      attackerId: gunner.id, weaponName: "__PW__RailCannon",
      areaDamages: { Torso: [{ damage: 60 }] }, ap: false,
      targetActorId: apc.id, targetTokenId: tok.id,
    });
    // the divert is async inside the hook — poll the committed SDP
    const dl = Date.now() + 8000;
    while (Date.now() < dl && apc._source.system.sdp.value === 200) await new Promise(r => setTimeout(r, 150));
    out.liveSDP = apc._source.system.sdp.value;          // 200 − (60 − 40) = 180

    await game.settings.set("cyberpunk2020", "vehicleRuleSystem", origRule);
    await game.settings.set("cyberpunk2020", "mmEnabled", origMM);
    for (const a of [car, gunner, tank, apc]) await a.delete().catch(() => {});
    await scene.delete().catch(() => {});
    return out;
  });

  console.log("Vehicle Phase 5 bridge:", JSON.stringify(R));
  expect(R.coreSDP, "Core bridge: 200 − (50 − 40) = 190").toBe(190);
  expect(R.mmHandled, "MM bridge handled the hit").toBe(true);
  expect(R.tankChanged, "MM bridge applied an effect to the tank (Pen 6 vs AV 2 penetrates)").toBe(true);
  expect(R.liveSDP, "live weaponFired at a vehicle token → 200 − 20 = 180").toBe(180);
});

test("Phase 5 polish: mount to-hit + Good Shot, mount storage, and the fire dialog gate", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const VW = await import("/systems/cyberpunk2020/module/vehicle/vehicle-weapons.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const out = {};

    // --- resolveVehicleToHit: hit/miss + Good Shot steps ---
    const a = VW.resolveVehicleToHit({ d10: 8, ref: 7, skill: 5, mods: 4, targetNumber: 15 }); // 24 ≥ 15, over 9 → 0
    out.aHit = a.hit; out.aGS = a.goodShotSteps;
    const b = VW.resolveVehicleToHit({ d10: 8, ref: 10, skill: 5, mods: 4, targetNumber: 15 }); // 27, over 12 → 1
    out.bGS = b.goodShotSteps;
    const c = VW.resolveVehicleToHit({ d10: 1, ref: 0, skill: 0, mods: 0, targetNumber: 15 }); // miss
    out.cHit = c.hit; out.cGS = c.goodShotSteps;

    // --- mount storage round-trips (AnyField array of plain objects) ---
    const veh = await Actor.create({ name: "__PW__MountVeh", type: "vehicle", flags,
      system: { sp: { front: 40 }, sdp: { value: 100, max: 100 } } });
    await veh.update({ "system.weaponMounts": [{ name: "20mm", penetration: 6, rof: 30, arc: "turret" }] });
    const m = veh.system.weaponMounts?.[0] ?? {};
    out.mountName = m.name; out.mountPen = m.penetration; out.mountRof = m.rof; out.mountArc = m.arc;

    // --- fire dialog gate ---
    const orig = game.settings.get("cyberpunk2020", "vehicleDamageEnabled");
    await game.settings.set("cyberpunk2020", "vehicleDamageEnabled", false);
    out.disabled = await VW.openVehicleFireDialog(veh, m);              // null
    await game.settings.set("cyberpunk2020", "vehicleDamageEnabled", true);
    const dlg = await VW.openVehicleFireDialog(veh, m);
    out.enabledDialog = !!(dlg && typeof dlg.close === "function");
    if (dlg?.close) await dlg.close();
    const charActor = await Actor.create({ name: "__PW__NotVehFire", type: "character", flags });
    out.nonVehicle = await VW.openVehicleFireDialog(charActor, m);      // null
    await game.settings.set("cyberpunk2020", "vehicleDamageEnabled", orig);

    for (const x of [veh, charActor]) await x.delete().catch(() => {});
    return out;
  });

  console.log("Vehicle Phase 5 fire:", JSON.stringify(R));
  expect(R.aHit).toBe(true);
  expect(R.aGS, "24 vs 15 → over by 9 → 0 Good Shot steps").toBe(0);
  expect(R.bGS, "27 vs 15 → over by 12 → 1 Good Shot step").toBe(1);
  expect(R.cHit).toBe(false);
  expect(R.cGS).toBe(0);

  expect(R.mountName).toBe("20mm");
  expect(R.mountPen).toBe(6);
  expect(R.mountRof).toBe(30);
  expect(R.mountArc).toBe("turret");

  expect(R.disabled, "fire dialog gated off → null").toBeNull();
  expect(R.enabledDialog, "fire dialog opens for a vehicle").toBe(true);
  expect(R.nonVehicle, "non-vehicle → null").toBeNull();
});
