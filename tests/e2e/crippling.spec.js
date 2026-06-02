import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * C4 — Detailed crippling injuries (Listen Up), behind limbCripplingDetailed (default OFF).
 *
 * computeNetDamage centralizes the doubling: limbs double post-armor BEFORE BTM (Listen Up),
 * head doubles AFTER BTM (Core p.103). assessWoundSeverity then applies the bands:
 *   6–12 net → crippled, 13+ → destroyed.  With the toggle OFF, Core behaviour is unchanged
 *   (limb damage not doubled; >8 → death save, no crippling flag).
 *
 * Targets are unarmored BT 2 (BTM 0) so post-armor damage == raw and the doubling is exact.
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("C4 crippling: limb doubling + crippled/destroyed bands; Core path when off", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const DA = await import("/systems/cyberpunk2020/module/combat/DamageApplicator.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    await game.settings.set("cyberpunk2020", "limbLossEnabled", true);
    await game.settings.set("cyberpunk2020", "headHitDoubling", true);

    // --- computeNetDamage math ---
    await game.settings.set("cyberpunk2020", "limbCripplingDetailed", true);
    const limbDoubledOn = DA.computeNetDamage(5, 0, true, "rArm");  // limb: 5×2 → 10
    const headDoubledOn = DA.computeNetDamage(5, 0, true, "Head");  // head: 5 → ×2 → 10
    await game.settings.set("cyberpunk2020", "limbCripplingDetailed", false);
    const limbPlainOff  = DA.computeNetDamage(5, 0, true, "rArm");  // off: 5 (no limb double)

    // --- apply with detailed ON: crippled then destroyed ---
    await game.settings.set("cyberpunk2020", "limbCripplingDetailed", true);
    const a = await Actor.create({ name: "__PW__Crip", type: "character", flags, system: { stats: { bt: { base: 2 } }, damage: 0 } });
    await DA.applyAreaDamages({ target: a, areaDamages: { rArm: [{ damage: 5 }] }, ap: false, armorMode: "full", ablate: false, dryRun: false });
    const crippled = { damage: a.system.damage, status: a.getFlag("cyberpunk2020", "limbStatus")?.rArm ?? null };
    await DA.applyAreaDamages({ target: a, areaDamages: { lArm: [{ damage: 7 }] }, ap: false, armorMode: "full", ablate: false, dryRun: false });
    const destroyed = { damage: a.system.damage, status: a.getFlag("cyberpunk2020", "limbStatus")?.lArm ?? null };

    // --- apply with detailed OFF: Core path (no double, no crippling flag) ---
    await game.settings.set("cyberpunk2020", "limbCripplingDetailed", false);
    const b = await Actor.create({ name: "__PW__Core", type: "character", flags, system: { stats: { bt: { base: 2 } }, damage: 0 } });
    await DA.applyAreaDamages({ target: b, areaDamages: { rLeg: [{ damage: 12 }] }, ap: false, armorMode: "full", ablate: false, dryRun: false });
    const coreLimb = { damage: b.system.damage, status: b.getFlag("cyberpunk2020", "limbStatus")?.rLeg ?? null };

    return { limbDoubledOn, headDoubledOn, limbPlainOff, crippled, destroyed, coreLimb };
  });

  // doubling math
  expect(R.limbDoubledOn, "limb doubled (detailed): 5→10").toBe(10);
  expect(R.headDoubledOn, "head doubled: 5→10").toBe(10);
  expect(R.limbPlainOff, "limb NOT doubled (detailed off): 5").toBe(5);

  // detailed bands
  expect(R.crippled.damage, "crippled limb takes doubled 10 HP").toBe(10);
  expect(R.crippled.status, "6–12 net → crippled").toBe("crippled");
  expect(R.destroyed.status, "13+ net (7×2=14) → destroyed").toBe("destroyed");

  // Core path unchanged
  expect(R.coreLimb.damage, "Core: 12 applied, not doubled").toBe(12);
  expect(R.coreLimb.status, "Core path sets no crippling flag (death save instead)").toBeNull();
});
