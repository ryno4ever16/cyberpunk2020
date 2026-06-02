import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * QA §20 — Ammo caliber label cleanup (CONTAINED variant).
 *
 * The real one-shot sweep `migrateAmmoCalibers()` is world-wide and gated by a
 * WORLD-scoped setting (ammoCaliberMigration); exercising it means re-arming the
 * gate and sweeping every real weapon — shared-world mutation. So this test does
 * NOT call it. Instead it validates the migration's per-weapon contract on tagged
 * `__PW__` weapons only, using the REAL exported caliber code so it's faithful:
 *
 *   1. Cosmetic-only: a weapon stored with the legacy typo ("7.56") ALREADY
 *      matches canonical "7.62" ammo at runtime — so the cleanup can never break
 *      a weapon (matches the migrate.js safety comment).
 *   2. The cleanup target equals normalizeCaliber(typo) — exactly what the remap
 *      table encodes ("7.56"→"7.62", "7.565"→"7.62sov").
 *   3. After rewriting the stored label, the weapon still matches the right ammo
 *      and still honours the 7.62 NATO≠Soviet split.
 *   4. The canonical value is a normalization fixed point (idempotent).
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("§20 caliber cleanup is cosmetic-only and yields a working canonical label", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const L = await import("/systems/cyberpunk2020/module/lookups.js");
    const flags = { cyberpunk2020: { __pwtest: true } };

    // Two tagged world weapons stored with the exact legacy typos the migration targets.
    const a = await Item.create({ name: "__PW__Rifle756",  type: "weapon", flags, system: { ammoType: "7.56" } });
    const b = await Item.create({ name: "__PW__Rifle7565", type: "weapon", flags, system: { ammoType: "7.565" } });
    const before = { a: a.system.ammoType, b: b.system.ammoType };

    // (1) Cosmetic-only: the typo-labelled weapons already accept canonical ammo at runtime.
    const worksBeforeCleanup = {
      a: L.caliberMatches(a.system.ammoType, "7.62"),      // "7.56" weapon already takes 7.62 NATO
      b: L.caliberMatches(b.system.ammoType, "7.62sov"),   // "7.565" weapon already takes 7.62 Soviet
    };

    // (2) The migration's per-weapon effect: rewrite the stored label to its canonical form.
    // canonical comes from the REAL exported normalizeCaliber — the same values the remap encodes.
    const canonA = L.normalizeCaliber(a.system.ammoType);
    const canonB = L.normalizeCaliber(b.system.ammoType);
    await a.update({ "system.ammoType": canonA });
    await b.update({ "system.ammoType": canonB });
    const after = { a: a.system.ammoType, b: b.system.ammoType };

    // (3) Cleaned labels still match the right ammo and keep the NATO≠Soviet split.
    const worksAfterCleanup = {
      aTakesNato: L.caliberMatches(after.a, "7.62"),
      aRejectsSov: L.caliberMatches(after.a, "7.62sov"),
      bTakesSovTypo: L.caliberMatches(after.b, "7.565"),  // legacy ammo still normalizes & loads
      bRejectsNato: L.caliberMatches(after.b, "7.62"),
    };

    // (4) Idempotent: re-normalizing the canonical value changes nothing.
    const idempotent = { a: L.normalizeCaliber(canonA) === canonA, b: L.normalizeCaliber(canonB) === canonB };

    await a.delete().catch(() => {});
    await b.delete().catch(() => {});
    return { before, worksBeforeCleanup, canonA, canonB, after, worksAfterCleanup, idempotent };
  });

  console.log("Caliber migration (contained):", JSON.stringify(R));

  // Starting typos
  expect(R.before.a).toBe("7.56");
  expect(R.before.b).toBe("7.565");

  // (1) cleanup is purely cosmetic — weapons already function with the typo label
  expect(R.worksBeforeCleanup.a, "typo 7.56 weapon already accepts 7.62 ammo").toBe(true);
  expect(R.worksBeforeCleanup.b, "typo 7.565 weapon already accepts 7.62 Soviet ammo").toBe(true);

  // (2) cleanup target = canonical normalization = the remap table's values
  expect(R.canonA, "7.56 → 7.62").toBe("7.62");
  expect(R.canonB, "7.565 → 7.62sov").toBe("7.62sov");
  expect(R.after.a, "stored label rewritten to canonical").toBe("7.62");
  expect(R.after.b, "stored label rewritten to canonical").toBe("7.62sov");

  // (3) cleaned labels still work + the split holds
  expect(R.worksAfterCleanup.aTakesNato, "cleaned NATO weapon takes 7.62 ammo").toBe(true);
  expect(R.worksAfterCleanup.aRejectsSov, "cleaned NATO weapon rejects Soviet ammo").toBe(false);
  expect(R.worksAfterCleanup.bTakesSovTypo, "cleaned Soviet weapon still loads legacy 7.565 ammo").toBe(true);
  expect(R.worksAfterCleanup.bRejectsNato, "cleaned Soviet weapon rejects NATO ammo").toBe(false);

  // (4) idempotent fixed points
  expect(R.idempotent.a).toBe(true);
  expect(R.idempotent.b).toBe(true);
});
