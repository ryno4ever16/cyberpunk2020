import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Phase 6-3: ACPA melee dialog gating + the melee→Penetration conversion. (The full hit/dispatch
 * path needs a target on the canvas; exercised in playtest.)
 */
test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("Phase 6-3: ACPA melee gates + Pen conversion", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const M = await import("/systems/cyberpunk2020/module/vehicle/vehicle-acpa-combat.js");
    const A = await import("/systems/cyberpunk2020/module/vehicle/vehicle-acpa.js");
    const W = await import("/systems/cyberpunk2020/module/vehicle/vehicle-weapons.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const out = {};
    let veh, acpa;
    try {
      out.apiFn = typeof game.cyberpunk?.vehicles?.acpaMelee === "function";
      try { game.user.targets.clear(); } catch {}

      veh = await Actor.create({ name: "__PW__NV", type: "vehicle", flags, system: { isACPA: false } });
      out.nonAcpaNull = (await M.openAcpaMeleeDialog(veh)) === null;   // not powered armor → refused

      acpa = await Actor.create({ name: "__PW__AM", type: "vehicle", flags, system: { isACPA: true, str: 36 } });
      out.noTargetNull = (await M.openAcpaMeleeDialog(acpa)) === null; // no target → refused

      // Pen conversion: STR36 punch = 4d10 → avg 22 → Pen round(22/10) = 2.
      const dice = A.acpaMeleeDamage(36, "punch").dice;
      out.dice = dice;
      out.pen = W.penetrationFactor({ avgDamage: dice * 5.5 });
    } finally {
      if (veh) await veh.delete().catch(() => {});
      if (acpa) await acpa.delete().catch(() => {});
    }
    return out;
  });

  console.log("Phase 6-3:", JSON.stringify(R));
  expect(R.apiFn).toBe(true);
  expect(R.nonAcpaNull).toBe(true);
  expect(R.noTargetNull).toBe(true);
  expect(R.dice).toBe(4);
  expect(R.pen).toBe(2);
});
