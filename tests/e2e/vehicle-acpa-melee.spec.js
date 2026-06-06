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

test("Phase 6-5: ACPA status section + melee button render for ACPA only", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const flags = { cyberpunk2020: { __pwtest: true } };
    const origMM = game.settings.get("cyberpunk2020", "mmEnabled");
    const out = {};
    let acpa, plain, a1, a2;
    try {
      await game.settings.set("cyberpunk2020", "mmEnabled", true);
      acpa = await Actor.create({ name: "__PW__ACPAS", type: "vehicle", flags, system: { isACPA: true, str: 40 } });
      a1 = acpa.sheet; await a1.render(true); await new Promise(r => setTimeout(r, 250));
      let root = a1.element[0] ?? a1.element;
      out.acpaStr = !!root.querySelector('[name="system.strDamage"]');
      out.acpaPower = !!root.querySelector('[name="system.powerHours"]');
      out.acpaMelee = !!root.querySelector('.cp-acpa-melee');
      await a1.close();

      plain = await Actor.create({ name: "__PW__PLAIN", type: "vehicle", flags, system: { isACPA: false } });
      a2 = plain.sheet; await a2.render(true); await new Promise(r => setTimeout(r, 250));
      root = a2.element[0] ?? a2.element;
      out.plainStr = !!root.querySelector('[name="system.strDamage"]');
      out.plainMelee = !!root.querySelector('.cp-acpa-melee');
      await a2.close();
    } finally {
      await game.settings.set("cyberpunk2020", "mmEnabled", origMM);
      if (a1?.rendered) await a1.close().catch(() => {});
      if (a2?.rendered) await a2.close().catch(() => {});
      if (acpa) await acpa.delete().catch(() => {});
      if (plain) await plain.delete().catch(() => {});
    }
    return out;
  });

  console.log("Phase 6-5:", JSON.stringify(R));
  expect(R.acpaStr).toBe(true);
  expect(R.acpaPower).toBe(true);
  expect(R.acpaMelee).toBe(true);
  expect(R.plainStr).toBe(false);
  expect(R.plainMelee).toBe(false);
});
