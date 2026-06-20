import { test, expect } from "@playwright/test";
import { loginRig, evalGameOrThrow, cleanupTestData } from "./rig-e2e-helpers.js";

/**
 * Rig-portable port of tests/e2e/crippling.spec.js — identical body; login swapped to the rig (loginRig).
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await loginRig(p); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("C4 crippling: limb doubling + crippled/destroyed bands; Core path when off", async ({ page }) => {
  await loginRig(page);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const DA = await import("/systems/cyberpunk2020/module/combat/DamageApplicator.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    await game.settings.set("cyberpunk2020", "limbLossEnabled", true);
    await game.settings.set("cyberpunk2020", "headHitDoubling", true);

    // --- computeNetDamage math ---
    await game.settings.set("cyberpunk2020", "limbModel", "listenup");
    const limbDoubledOn = DA.computeNetDamage(5, 0, true, "rArm");  // limb: 5×2 → 10
    const headDoubledOn = DA.computeNetDamage(5, 0, true, "Head");  // head: 5 → ×2 → 10
    await game.settings.set("cyberpunk2020", "limbModel", "core");
    const limbPlainOff  = DA.computeNetDamage(5, 0, true, "rArm");  // off: 5 (no limb double)

    // --- apply with detailed ON: crippled then destroyed ---
    await game.settings.set("cyberpunk2020", "limbModel", "listenup");
    const a = await Actor.create({ name: "__PW__Crip", type: "character", flags, system: { stats: { bt: { base: 2 } }, damage: 0 } });
    await DA.applyAreaDamages({ target: a, areaDamages: { rArm: [{ damage: 5 }] }, ap: false, armorMode: "full", ablate: false, dryRun: false });
    const crippled = { damage: a.system.damage, status: a.getFlag("cyberpunk2020", "limbStatus")?.rArm ?? null };
    await DA.applyAreaDamages({ target: a, areaDamages: { lArm: [{ damage: 7 }] }, ap: false, armorMode: "full", ablate: false, dryRun: false });
    const destroyed = { damage: a.system.damage, status: a.getFlag("cyberpunk2020", "limbStatus")?.lArm ?? null };

    // --- apply with detailed OFF: Core path (no double, no crippling flag) ---
    await game.settings.set("cyberpunk2020", "limbModel", "core");
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
