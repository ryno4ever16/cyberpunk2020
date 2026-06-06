import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Polish: the MM-only vehicle-sheet fields (composite armor, sensors, anti-missile, weapon mounts)
 * are hidden when Maximum Metal is OFF and shown when it's ON. Renders a hidden test actor's sheet.
 */
test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("MM-only vehicle-sheet fields gate on the master toggle", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const flags = { cyberpunk2020: { __pwtest: true } };
    const origMM = game.settings.get("cyberpunk2020", "mmEnabled");
    const out = {};
    let veh, app;
    const sniff = (root) => ({
      composite: !!root.querySelector('[name="system.compositeArmor"]'),
      sensors: !!root.querySelector('[name="system.sensors"]'),
      antiMissile: !!root.querySelector('[name="system.antiMissile"]'),
      weapons: !!root.querySelector('.cp-weapons'),
      // a Core field that must ALWAYS be present
      sdp: !!root.querySelector('[name="system.sdp.value"]'),
    });
    try {
      veh = await Actor.create({ name: "__PW__HideVeh", type: "vehicle", flags });
      app = veh.sheet;

      await game.settings.set("cyberpunk2020", "mmEnabled", false);
      await app.render(true);
      await new Promise(r => setTimeout(r, 250));
      out.off = sniff(app.element[0] ?? app.element);
      await app.close();

      await game.settings.set("cyberpunk2020", "mmEnabled", true);
      await app.render(true);
      await new Promise(r => setTimeout(r, 250));
      out.on = sniff(app.element[0] ?? app.element);
      await app.close();
    } finally {
      await game.settings.set("cyberpunk2020", "mmEnabled", origMM);
      if (app?.rendered) await app.close().catch(() => {});
      if (veh) await veh.delete().catch(() => {});
    }
    return out;
  });

  console.log("MM hide:", JSON.stringify(R));
  // OFF: MM-only fields gone, Core field still present.
  expect(R.off.composite).toBe(false);
  expect(R.off.sensors).toBe(false);
  expect(R.off.antiMissile).toBe(false);
  expect(R.off.weapons).toBe(false);
  expect(R.off.sdp).toBe(true);
  // ON: all MM-only fields present.
  expect(R.on.composite).toBe(true);
  expect(R.on.sensors).toBe(true);
  expect(R.on.antiMissile).toBe(true);
  expect(R.on.weapons).toBe(true);
});
