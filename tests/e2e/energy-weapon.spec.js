import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Energy/beam weapons recharge instead of consuming ammo (CP2020 FNFF: "Like lasers, microwavers
 * recharge from a wall socket"). They have a finite shot pool but reload by recharging — no ammo
 * Item required, even with ammo-tracking ON. Fixes the long-standing "needs Special ammo, none to
 * select" dead-end on the Microwaver/Lasers (ammoType "Special" / blank is not a buyable caliber).
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("classification: laser/microwave are energy; the compendium Microwaver is energy", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  const R = await evalGameOrThrow(page, async () => {
    const L = await import("/systems/cyberpunk2020/module/lookups.js");
    // The real compendium Microwaver.
    const pack = game.packs.get("cyberpunk2020.exotics");
    let microwaverEnergy = null, microwaverAmmo = null;
    if (pack) {
      const idx = await pack.getIndex({ fields: ["system.attackType", "system.ammoType"] });
      const e = idx.find(i => /microwaver/i.test(i.name));
      if (e) { microwaverEnergy = L.isEnergyAttackType(e.system?.attackType); microwaverAmmo = e.system?.ammoType ?? null; }
    }
    return {
      laser: L.isEnergyAttackType("Laser"),
      microwave: L.isEnergyAttackType("Microwave"),
      auto: L.isEnergyAttackType("Auto"),
      blank: L.isEnergyAttackType(""),
      drugs: L.isEnergyAttackType("Drugs"),
      microwaverEnergy, microwaverAmmo
    };
  });
  console.log("Energy classify:", JSON.stringify(R));
  expect(R.laser).toBe(true);
  expect(R.microwave).toBe(true);
  expect(R.auto).toBe(false);
  expect(R.blank).toBe(false);
  expect(R.drugs).toBe(false);
  expect(R.microwaverEnergy, "the compendium Microwaver classifies as energy").toBe(true);
  // It really does carry the un-buyable "Special" ammoType (the root of the user's dead-end).
  expect(R.microwaverAmmo).toBe("Special");
});

test("an empty energy weapon recharges on reload with no ammo Item (ammo-tracking ON)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const actor = await Actor.create({ name: "__PW__energy", type: "character", flags: { cyberpunk2020: { __pwtest: true } } });
    // ammoTracking defaults ON (flag unset). Make an energy weapon that's been fired dry.
    const [wpn] = await actor.createEmbeddedDocuments("Item", [{
      name: "__PW__Microwaver", type: "weapon",
      system: { weaponType: "Pistol", attackType: "Microwave", ammoType: "Special", shots: 10, shotsLeft: 0, rof: 2, range: 20 }
    }]);
    // Also a normal firearm with no linked ammo, fired dry — must NOT free-recharge.
    const [gun] = await actor.createEmbeddedDocuments("Item", [{
      name: "__PW__Pistol", type: "weapon",
      system: { weaponType: "Pistol", attackType: "SemiAuto", ammoType: "9mm", shots: 10, shotsLeft: 0, rof: 2, range: 50 }
    }]);

    const wpnItem = actor.items.get(wpn.id);
    const isEnergy = wpnItem.isEnergyWeapon();

    const { ModifiersDialog } = await import("/systems/cyberpunk2020/module/dialog/modifiers.js");

    const clickReload = async (weaponItem) => {
      const dlg = new ModifiersDialog({}, { weapon: weaponItem });
      dlg.render(true);
      const dl = Date.now() + 6000; let btn = null;
      while (Date.now() < dl) { const el = dlg.element?.[0]; btn = el?.querySelector(".reload"); if (btn) break; await new Promise(r => setTimeout(r, 100)); }
      if (btn) btn.click();
      await new Promise(r => setTimeout(r, 350)); // let the async weapon.update settle
      await dlg.close();
    };

    await clickReload(wpnItem);
    const energyAfter = Number(actor.items.get(wpn.id).system.shotsLeft);

    await clickReload(actor.items.get(gun.id));
    const gunAfter = Number(actor.items.get(gun.id).system.shotsLeft);

    return { isEnergy, energyAfter, gunAfter };
  });

  console.log("Energy recharge:", JSON.stringify(R));
  expect(R.isEnergy, "the test microwaver is an energy weapon").toBe(true);
  expect(R.energyAfter, "energy weapon recharged to capacity (10) on reload, no ammo needed").toBe(10);
  expect(R.gunAfter, "a normal gun with no linked ammo does NOT free-recharge").toBe(0);
});
