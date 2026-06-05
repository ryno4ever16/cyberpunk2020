import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow } from "../helpers/foundry.js";

/**
 * Maximum Metal — modular settings gate.
 * The master `mmEnabled` toggle divorces all MM-overlay features from the core game:
 * effectiveVehicleRuleSystem() forces "Core" whenever MM is off, regardless of vehicleRuleSystem.
 */

test("Maximum Metal master toggle gates the vehicle ruleset", async ({ page }) => {
  await login(page, ACCOUNTS.gm);

  const R = await evalGameOrThrow(page, async () => {
    const S = await import("/systems/cyberpunk2020/module/settings.js");
    const out = {};
    const origMM = game.settings.get("cyberpunk2020", "mmEnabled");
    const origRule = game.settings.get("cyberpunk2020", "vehicleRuleSystem");
    try {
      out.settingExists = game.settings.settings.has("cyberpunk2020.mmEnabled");

      // Configure the vehicle ruleset to Maximum Metal, then flip only the master.
      await game.settings.set("cyberpunk2020", "vehicleRuleSystem", "MaximumMetal");

      await game.settings.set("cyberpunk2020", "mmEnabled", false);
      out.mmOff      = S.mmEnabled();                    // false
      out.gatedOff   = S.effectiveVehicleRuleSystem();   // "Core" — MM off forces Core

      await game.settings.set("cyberpunk2020", "mmEnabled", true);
      out.mmOn       = S.mmEnabled();                    // true
      out.gatedOn    = S.effectiveVehicleRuleSystem();   // "MaximumMetal" — MM on honors the setting
    } finally {
      await game.settings.set("cyberpunk2020", "mmEnabled", origMM);
      await game.settings.set("cyberpunk2020", "vehicleRuleSystem", origRule);
    }
    return out;
  });

  console.log("MM settings gate:", JSON.stringify(R));
  expect(R.settingExists).toBe(true);
  expect(R.mmOff).toBe(false);
  expect(R.gatedOff).toBe("Core");          // MM off → Core even though vehicleRuleSystem is MaximumMetal
  expect(R.mmOn).toBe(true);
  expect(R.gatedOn).toBe("MaximumMetal");   // MM on → the configured ruleset applies
});
