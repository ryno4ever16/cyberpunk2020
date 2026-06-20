import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow } from "../helpers/foundry.js";

/**
 * Confirms the RUNNING world has the Session-16 code loaded — not a stale build
 * the server launched before the edits. If these settings are missing, the
 * server needs to reload the system before any feature test is meaningful.
 */
test("running world has Session-16 settings + hooks loaded", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  const probe = await evalGameOrThrow(page, () => {
    const has = (k) => game.settings.settings.has("cyberpunk2020." + k);
    const hookCount = (name) => {
      const store = (typeof Hooks !== "undefined" && (Hooks.events || Hooks._hooks)) || {};
      const arr = store[name];
      return Array.isArray(arr) ? arr.length : (arr ? 1 : 0);
    };
    return {
      systemVersion: game.system.version,
      settings: {
        fireDotEnabled: has("fireDotEnabled"),
        fireDotStackMode: has("fireDotStackMode"),
        playersCanBuyAmmo: has("playersCanBuyAmmo"),
        ammoCaliberMigration: has("ammoCaliberMigration"),
        suppressiveFireSaves: has("suppressiveFireSaves"),
        damageAblation: has("damageAblation"),
      },
      hooks: {
        suppressiveFire: hookCount("cyberpunk2020.suppressiveFire"),
        weaponFired: hookCount("cyberpunk2020.weaponFired"),
        updateCombat: hookCount("updateCombat"),
      },
    };
  });
  console.log("PROBE:", JSON.stringify(probe, null, 2));

  // The Session-16 fire DOT setting + ammoCaliberMigration are the tell-tale of my edits.
  expect(probe.settings.fireDotEnabled, "fireDotEnabled setting (Session 16) should be registered").toBe(true);
  expect(probe.settings.ammoCaliberMigration, "ammoCaliberMigration setting (Session 16) should be registered").toBe(true);
  expect(probe.hooks.suppressiveFire, "suppressiveFire hook should have a listener").toBeGreaterThan(0);
});
