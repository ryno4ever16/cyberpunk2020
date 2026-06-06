import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Direct-fire shell selection (MM p.17). A cannon with Hi-Ex / HEAT shell variants now exposes a shell
 * picker in the fire dialog; the chosen round drives the shot (Pen/burst/HEAT) and is PERSISTED in
 * system.activeShell (survives + shows on the sheet weapon row). This drives the real dialog: open it
 * for a 120mm Cannon, confirm the picker + options, select HEAT, fire (no target → just posts), and
 * confirm the Pen synced to the HEAT value and activeShell was saved.
 */
test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("cannon shell picker drives the shot and persists activeShell", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const VW = await import("/systems/cyberpunk2020/module/vehicle/vehicle-weapons.js");
    const cat = await import("/systems/cyberpunk2020/module/vehicle/vehicle-weapon-catalog.js");
    const byName = Object.fromEntries(cat.SEED_VEHICLE_WEAPONS.map(w => [w.name, w]));
    const flags = { cyberpunk2020: { __pwtest: true } };
    const out = {};
    let veh, dlg;
    try {
      veh = await Actor.create({ name: "__PW__SHELLVEH", type: "vehicle", flags,
        system: { sp: { front: 0, side: 0, rear: 0, top: 0, bottom: 0 }, sdp: { value: 100, max: 100 } } });
      const [item] = await veh.createEmbeddedDocuments("Item", [
        { name: "120mm Cannon", type: "vehicleWeapon", system: byName["120mm Cannon"].system }
      ]);
      out.variantCount = item.system.shellVariants?.length ?? 0;   // 2 (Hi-Ex + HEAT)

      dlg = await VW.openVehicleFireDialog(veh, { itemId: item.id, name: item.name,
        penetration: item.system.penetration, rof: item.system.rof, arc: item.system.arc });
      await new Promise(r => setTimeout(r, 350));
      const root = dlg?.element?.[0] ?? dlg?.element;
      const sel = root?.querySelector("#cp-vf-shell");
      out.shellPresent = !!sel;
      out.shellOptions = sel ? sel.options.length : 0;            // base + Hi-Ex + HEAT = 3

      let heatIdx = -1;
      if (sel) for (const o of sel.options) if (/HEAT/.test(o.textContent)) heatIdx = Number(o.value);
      out.heatIdx = heatIdx;
      if (sel && heatIdx >= 0) {
        sel.value = String(heatIdx);
        sel.dispatchEvent(new Event("change"));
        out.penAfterSelect = Number(root.querySelector("#cp-vf-pen")?.value);   // 12 (HEAT Pen)
      }

      const fireBtn = root?.querySelector('button[data-button="fire"]')
        ?? [...(root?.querySelectorAll("button") ?? [])].find(b => /Fire/.test(b.textContent));
      fireBtn?.click();

      const deadline = Date.now() + 8000;
      let live = veh.items.get(item.id);
      while (Date.now() < deadline && !(live?.system?.activeShell)) {
        await new Promise(r => setTimeout(r, 150));
        live = veh.items.get(item.id);
      }
      out.activeShell = live?.system?.activeShell ?? "";          // "120mm HEAT"
    } finally {
      try { await dlg?.close?.(); } catch {}
      if (veh) await veh.delete().catch(() => {});
    }
    return out;
  });

  console.log("Shell select:", JSON.stringify(R));
  expect(R.variantCount).toBe(2);
  expect(R.shellPresent).toBe(true);
  expect(R.shellOptions).toBe(3);            // base + Hi-Ex + HEAT
  expect(R.heatIdx).toBeGreaterThan(0);
  expect(R.penAfterSelect).toBe(12);         // picking HEAT synced the Pen field to 12
  expect(R.activeShell).toBe("120mm HEAT");  // the loaded shell persisted on the weapon
});
