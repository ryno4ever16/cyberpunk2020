import { test, expect } from "@playwright/test";
import { loginRig, evalGameOrThrow, cleanupTestData } from "./rig-e2e-helpers.js";

/**
 * Rig-portable port of tests/e2e/flechette.spec.js — identical body; login swapped to the rig (loginRig).
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await loginRig(p); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("flechette ¼ armor mult is preserved (not collapsed to AP-halve)", async ({ page }) => {
  await loginRig(page);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const flags = { cyberpunk2020: { __pwtest: true } };
    const actor = await Actor.create({ name: "__PW__FlechGunner", type: "character", flags });
    const [flech] = await actor.createEmbeddedDocuments("Item", [
      { name: "__PW__Flechette", type: "ammo", flags, system: { armorMultSoft: 0.25, armorMultHard: 0.25, penDamageMult: 0.5, spreadMode: "flechette" } },
    ]);
    const [ap] = await actor.createEmbeddedDocuments("Item", [
      { name: "__PW__AP", type: "ammo", flags, system: { armorMultSoft: 0.5, armorMultHard: 0.5 } },
    ]);
    const [weapon] = await actor.createEmbeddedDocuments("Item", [
      { name: "__PW__FlechGun", type: "weapon", flags, system: { weaponType: "Rifle", ammoItemId: flech.id } },
    ]);

    const flechPayload = weapon._getAmmoPayload();
    await weapon.update({ "system.ammoItemId": ap.id });
    const apPayload = weapon._getAmmoPayload();

    // The proper delivery: the "flechette" ammo MODIFIER seeds the spread + ¼ fields onto an item.
    const buy = await import("/systems/cyberpunk2020/module/dialog/buy-ammo.js");
    const L = await import("/systems/cyberpunk2020/module/lookups.js");
    const seeded = buy.ammoModifierSystemFields("flechette");
    const modMech = L.AMMO_MODIFIERS.flechette.mech;

    return { flechPayload, apPayload, seeded, modMech };
  });

  // Flechette: quarter mults preserved, NOT routed to ap, and the spread mode carries through.
  expect(R.flechPayload.armorMultSoft, "flechette keeps ×¼ soft").toBe(0.25);
  expect(R.flechPayload.armorMultHard, "flechette keeps ×¼ hard").toBe(0.25);
  expect(R.flechPayload.ap, "flechette is NOT treated as AP-halve").toBe(false);
  expect(R.flechPayload.spreadMode, "flechette fires a spread pattern").toBe("flechette");

  // Standard AP (exactly ×½): still uses the ap shortcut (mults reset to 1, ap=true).
  expect(R.apPayload.ap, "exact-½ AP still uses the ap path").toBe(true);
  expect(R.apPayload.armorMultHard, "ap path resets mult to 1").toBe(1);

  // The flechette ammo MODIFIER is the shippable delivery (lookups.js, git-tracked).
  expect(R.modMech.armorMultSoft, "modifier: ×¼ soft").toBe(0.25);
  expect(R.modMech.armorMultHard, "modifier: ×¼ hard").toBe(0.25);
  expect(R.seeded.spreadMode, "applying the flechette modifier seeds spreadMode").toBe("flechette");
  expect(R.seeded.armorMultSoft, "applying the flechette modifier seeds ×¼ armor").toBe(0.25);
  expect(R.seeded.penDamageMult, "flechette damage ×½").toBe(0.5);
});
