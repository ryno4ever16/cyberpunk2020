import { test, expect } from "@playwright/test";
import { loginRig, evalGameOrThrow, cleanupTestData } from "./rig-e2e-helpers.js";

/**
 * Rig-portable port of tests/e2e/cyberpsychosis.spec.js — identical body; login swapped to the rig (loginRig).
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await loginRig(p); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("N1 cyberpsychosis state derives from effective EMP; toggle gates it", async ({ page }) => {
  await loginRig(page);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const flags = { cyberpunk2020: { __pwtest: true } };
    await game.settings.set("cyberpunk2020", "cyberpsychosisTracking", true);

    const stateFor = async (empBase) => {
      const a = await Actor.create({ name: `__PW__CP${empBase}`, type: "character", flags, system: { stats: { emp: { base: empBase } } } });
      return a.system.stats.emp.cyberpsychosis;
    };

    const stable    = await stateFor(8);
    const cold      = await stateFor(3);
    const withdrawn = await stateFor(2);
    const socio     = await stateFor(1);
    const psycho    = await stateFor(0);

    // Toggle off → no derived state at all.
    await game.settings.set("cyberpunk2020", "cyberpsychosisTracking", false);
    const off = await Actor.create({ name: "__PW__CPoff", type: "character", flags, system: { stats: { emp: { base: 2 } } } });
    const offState = off.system.stats.emp.cyberpsychosis ?? null;
    await game.settings.set("cyberpunk2020", "cyberpsychosisTracking", true); // restore

    return { stable, cold, withdrawn, socio, psycho, offState };
  });

  expect(R.stable.state, "EMP 8 → stable").toBe("stable");
  expect(R.cold.state, "EMP 3 → cold").toBe("cold");
  expect(R.cold.atRisk, "EMP 3 is at risk").toBe(true);
  expect(R.cold.lost, "EMP 3 is not lost yet").toBe(false);
  expect(R.withdrawn.state, "EMP 2 → withdrawn").toBe("withdrawn");
  expect(R.socio.state, "EMP 1 → sociopathic").toBe("sociopathic");
  expect(R.psycho.state, "EMP 0 → cyberpsychotic").toBe("cyberpsychotic");
  expect(R.psycho.lost, "EMP 0 is lost to the chrome").toBe(true);
  expect(R.offState, "toggle off → no derived state").toBeNull();
});
