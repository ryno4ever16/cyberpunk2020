import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * N1 — Cyberpsychosis state (CP2020 p.73), derived from effective Empathy.
 *
 * The humanity→EMP math already existed; this verifies the NEW derived state:
 *   EMP ≥ 4 stable · 3 cold · 2 withdrawn · 1 sociopathic · ≤0 cyberpsychotic.
 * Driven deterministically via emp.base (no cyberware needed, so the state mapping
 * is isolated from the pre-existing equipped-cyberware loss summation).
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("N1 cyberpsychosis state derives from effective EMP; toggle gates it", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
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
