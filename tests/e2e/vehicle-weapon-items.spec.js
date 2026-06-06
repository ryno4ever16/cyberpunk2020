import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Vehicle — Phase 5b: the catalogued `vehicleWeapon` Item type + the verified seed catalog.
 *
 * The DataModel (CONFIG.Item.dataModels.vehicleWeapon) and the seed catalog module load on a fresh
 * page nav, so they are always asserted. CREATING an Item of the new type (and the new compendium)
 * depends on template.json/system.json, which Foundry reads only at world launch — so those parts
 * run only once the world has been relaunched (the disclosed one-time reload). The spec reports
 * `relaunchPending` and stays green either way; re-run after the reload to exercise creation.
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("Phase 5b: vehicleWeapon data model + verified seed catalog", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const cat = await import("/systems/cyberpunk2020/module/vehicle/vehicle-weapon-catalog.js");
    const out = {};

    // ── Seed catalog (pure data — always live) ──────────────────────────────
    out.seedCount = cat.SEED_VEHICLE_WEAPONS.length;
    const byName = Object.fromEntries(cat.SEED_VEHICLE_WEAPONS.map(w => [w.name, w]));
    out.classSet = [...new Set(cat.SEED_VEHICLE_WEAPONS.map(w => w.system.weaponClass))].sort();
    out.autocannonPen = byName["20mm Autocannon"]?.system.penetration;          // 4
    const cannon = byName["105mm Cannon"];
    out.cannonVariants = cannon?.system.shellVariants?.length;                   // 2
    out.cannonHasHEAT = !!cannon?.system.shellVariants?.some(v => v.heat && v.pen === 11);
    out.hellfirePaint = byName["Hellfire"]?.system.guidance;                     // "paint"
    out.hellfirePen = byName["Hellfire"]?.system.penetration;                    // 21
    out.rocketHiEx = !!byName["2.75\" Rocket"]?.system.hiEx;                     // true
    out.coneAngle = byName["BRP Ripple Flechette Pack"]?.system.coneAngle;       // 60

    // ── Data model registration (set at init from system JS — always live) ──
    const DM = CONFIG.Item?.dataModels?.vehicleWeapon;
    out.modelRegistered = !!DM;
    const fields = DM ? Object.keys(DM.defineSchema()) : [];
    out.hasFields = ["weaponClass", "penetration", "heat", "guidance", "shellVariants", "burst", "wa"]
      .every(f => fields.includes(f));

    // ── Item creation (needs template.json/system.json → world relaunch) ────
    out.typeValid = (game.documentTypes?.Item ?? []).includes("vehicleWeapon");
    out.packPresent = !!game.packs?.get("cyberpunk2020.vehicle-weapons");
    out.relaunchPending = !out.typeValid;

    // Re-seed the compendium to the full catalog (idempotent back-fill of newly-added weapons).
    if (out.packPresent && game.user?.isGM) {
      await cat.seedVehicleWeaponCompendium();
      out.packCount = (await game.packs.get("cyberpunk2020.vehicle-weapons").getIndex()).size;
    }

    if (out.typeValid) {
      let veh;
      try {
        [veh] = await Actor.createDocuments([{ name: "ZZTEST MM Vehicle", type: "vehicle" }]);
        await veh.createEmbeddedDocuments("Item", [{
          name: "20mm Autocannon", type: "vehicleWeapon", system: byName["20mm Autocannon"].system
        }]);
        const mounts = veh.itemTypes.vehicleWeapon ?? veh.items.filter(i => i.type === "vehicleWeapon");
        out.embeddedCount = mounts.length;                                       // 1
        out.embeddedPen = mounts[0]?.system.penetration;                          // 4
        out.embeddedClass = mounts[0]?.system.weaponClass;                        // "directFire"
      } finally {
        if (veh) await veh.delete().catch(() => {});
      }
    }

    return out;
  });

  console.log("Phase 5b vehicleWeapon:", JSON.stringify(R));

  // Seed catalog — verified against MM (always asserted). Expanded with the ACPA weapon roster.
  expect(R.seedCount).toBe(24);
  expect(R.classSet).toEqual(["artillery", "bomb", "burst", "cone", "directFire", "melee", "missile", "rocket", "special"]);
  expect(R.autocannonPen).toBe(4);
  expect(R.cannonVariants).toBe(2);
  expect(R.cannonHasHEAT).toBe(true);
  expect(R.hellfirePaint).toBe("paint");
  expect(R.hellfirePen).toBe(21);
  expect(R.rocketHiEx).toBe(true);
  expect(R.coneAngle).toBe(60);

  // Data model registered with the expected fields (always asserted).
  expect(R.modelRegistered).toBe(true);
  expect(R.hasFields).toBe(true);

  // Item creation — only once the world has been relaunched (new type/pack registered).
  if (R.relaunchPending) {
    console.warn("Phase 5b: world relaunch pending — vehicleWeapon type/pack not yet registered. Re-run after reload to exercise item creation.");
  } else {
    expect(R.packPresent).toBe(true);
    expect(R.embeddedCount).toBe(1);
    expect(R.embeddedPen).toBe(4);
    expect(R.embeddedClass).toBe("directFire");
    if (R.packCount != null) expect(R.packCount).toBeGreaterThanOrEqual(R.seedCount);  // compendium back-filled
  }
});
