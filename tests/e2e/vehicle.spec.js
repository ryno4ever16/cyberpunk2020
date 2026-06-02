import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Vehicle — Phase 1: the new `vehicle` actor type + data model.
 * Verifies the type registers, the ruleset setting exists, and the derived stats compute:
 *   Armor Value = SP/20 (per facing), Body Value = SDP/20 (STR/20 for ACPA), destroyed at 0 SDP.
 *
 * NOTE: a new actor type registers server-side from system.json at world load. If `vehicle`
 * isn't in game.documentTypes.Actor, the Foundry world needs a reload to pick up the new type.
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("Phase 1: vehicle actor type, ruleset toggle, derived Armor/Body Value", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const out = {};
    out.typeRegistered = (game.documentTypes?.Actor ?? []).includes("vehicle");
    out.dataModelRegistered = !!CONFIG.Actor.dataModels?.vehicle;
    try { out.ruleDefault = game.settings.get("cyberpunk2020", "vehicleRuleSystem"); out.settingExists = true; }
    catch (e) { out.settingExists = false; }

    if (!out.typeRegistered) return out;   // can't create the actor without the registered type

    const flags = { cyberpunk2020: { __pwtest: true } };
    const tank = await Actor.create({ name: "__PW__Tank", type: "vehicle", flags,
      system: { sp: { front: 40, side: 20, rear: 20, top: 10, bottom: 10 }, sdp: { value: 200, max: 200 } } });
    out.armorFront = tank.system.armorValue.front;  // 40/20 = 2
    out.armorSide  = tank.system.armorValue.side;   // 20/20 = 1
    out.bodyValue  = tank.system.bodyValue;         // 200/20 = 10
    out.destroyed  = tank.system.destroyed;         // false (200 > 0)

    const acpa = await Actor.create({ name: "__PW__ACPA", type: "vehicle", flags, system: { isACPA: true, str: 80 } });
    out.acpaBody = acpa.system.bodyValue;           // STR 80 / 20 = 4

    const wreck = await Actor.create({ name: "__PW__Wreck", type: "vehicle", flags, system: { sdp: { value: 0, max: 100 } } });
    out.wreckDestroyed = wreck.system.destroyed;    // true (0 of 100)

    return out;
  });

  console.log("Vehicle Phase 1:", JSON.stringify(R));

  expect(R.settingExists, "vehicleRuleSystem setting registered").toBe(true);
  expect(R.ruleDefault, "default ruleset is Core").toBe("Core");
  expect(R.dataModelRegistered, "vehicle data model registered").toBe(true);
  expect(R.typeRegistered, "vehicle actor type registered (reload the world if this fails)").toBe(true);

  expect(R.armorFront, "front Armor Value = 40/20").toBe(2);
  expect(R.armorSide, "side Armor Value = 20/20").toBe(1);
  expect(R.bodyValue, "Body Value = 200/20").toBe(10);
  expect(R.destroyed, "not destroyed at 200 SDP").toBe(false);
  expect(R.acpaBody, "ACPA Body Value = STR 80 / 20").toBe(4);
  expect(R.wreckDestroyed, "destroyed at 0 SDP").toBe(true);
});
