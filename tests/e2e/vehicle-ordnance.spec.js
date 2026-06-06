import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Vehicle — Phase 5g-2: warhead burst resolution. Runs on a NON-ACTIVE scene (passed explicitly) so
 * it never disturbs whatever scene is on screen. Verifies: HE Pen burst damages a vehicle in radius;
 * White Phosphorus sets personnel alight (fireDotState) and vehicles onFire; chemical leaves a gas cloud.
 */
test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("Phase 5g-2: warhead bursts (HE / WP / chemical)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const O = await import("/systems/cyberpunk2020/module/vehicle/vehicle-ordnance.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const out = {};
    const origMM = game.settings.get("cyberpunk2020", "mmEnabled");
    const origRule = game.settings.get("cyberpunk2020", "vehicleRuleSystem");
    let scene, veh, ped;
    try {
      await game.settings.set("cyberpunk2020", "mmEnabled", true);
      await game.settings.set("cyberpunk2020", "vehicleRuleSystem", "MaximumMetal");

      scene = await Scene.create({ name: "__PW__ordnance", width: 4000, height: 4000, grid: { type: 1, size: 100, distance: 2, units: "m" }, padding: 0, flags });
      veh = await Actor.create({ name: "__PW__OVeh", type: "vehicle", flags, system: { sp: { front: 0, side: 0, rear: 0, top: 0, bottom: 0 }, sdp: { value: 200, max: 200 } } });
      ped = await Actor.create({ name: "__PW__OPed", type: "npc", flags });
      const [vTok] = await scene.createEmbeddedDocuments("Token", [{ name: "__PW__OVeh", x: 1000, y: 1000, width: 4, height: 2, actorId: veh.id, actorLink: true, flags }]);
      const [pTok] = await scene.createEmbeddedDocuments("Token", [{ name: "__PW__OPed", x: 1180, y: 1080, width: 1, height: 1, actorId: ped.id, actorLink: true, flags }]);
      const vc = { x: vTok.x + (vTok.width * 100) / 2, y: vTok.y + (vTok.height * 100) / 2 };   // (1200,1100)
      const pc = { x: pTok.x + 50, y: pTok.y + 50 };                                              // (1230,1130)

      // (a) HE burst centred on the vehicle: Pen 20 vs AV 0 → SDP drops.
      await O.resolveWarheadBurst({ scene, origin: vc, warhead: "", pen: 20, burstM: 6, payload: { weaponName: "__PW__HE" } });
      out.vehDamaged = veh._source.system.sdp.value < 200;

      // (b) White Phosphorus burst on the pedestrian: catches fire (fireDotState); vehicle onFire too.
      await O.resolveWarheadBurst({ scene, origin: pc, warhead: "wp", pen: 6, burstM: 4, payload: { weaponName: "__PW__WP" } });
      out.pedOnFire = Array.isArray(ped.getFlag("cyberpunk2020", "fireDotState")) && ped.getFlag("cyberpunk2020", "fireDotState").length > 0;
      out.vehOnFire = veh._source.system.onFire === true;

      // (c) Chemical burst → a lingering gas cloud template on this scene.
      const before = scene.templates.filter(t => t.flags?.cyberpunk2020?.isGasCloud).length;
      await O.resolveWarheadBurst({ scene, origin: vc, warhead: "chemical", pen: 0, burstM: 3, payload: { weaponName: "__PW__Chem" } });
      out.gasClouds = scene.templates.filter(t => t.flags?.cyberpunk2020?.isGasCloud).length - before;
    } finally {
      await game.settings.set("cyberpunk2020", "mmEnabled", origMM);
      await game.settings.set("cyberpunk2020", "vehicleRuleSystem", origRule);
      if (scene) await scene.delete().catch(() => {});
      for (const a of game.actors.filter(x => x.name?.startsWith("__PW__"))) await a.delete().catch(() => {});
    }
    return out;
  });

  console.log("Phase 5g-2:", JSON.stringify(R));
  expect(R.vehDamaged).toBe(true);   // HE Pen burst hit the vehicle
  expect(R.pedOnFire).toBe(true);    // WP set the pedestrian alight
  expect(R.vehOnFire).toBe(true);    // WP set the vehicle onFire
  expect(R.gasClouds).toBe(1);       // chemical left one gas cloud
});
