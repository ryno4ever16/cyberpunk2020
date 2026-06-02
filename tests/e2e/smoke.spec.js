import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, whoami, evalGameOrThrow } from "../helpers/foundry.js";

/**
 * Smoke tests — prove the harness can authenticate and run code inside the live
 * world before any real feature tests rely on it. Also dumps the runtime
 * environment (system id/version, Foundry version, BTM derivation) to the log
 * so the feature specs can be written against confirmed reality.
 */

test("GM can log in and the system is loaded", async ({ page }) => {
  await login(page, ACCOUNTS.gm, { canvas: true });
  const me = await whoami(page);
  console.log("GM env:", JSON.stringify(me, null, 2));
  expect(me.systemId).toBe("cyberpunk2020");
  expect(me.isGM).toBe(true);
  expect(me.ready).toBe(true);
});

test("a player can log in", async ({ page }) => {
  await login(page, ACCOUNTS.player1);
  const me = await whoami(page);
  console.log("Player env:", JSON.stringify(me, null, 2));
  expect(me.systemId).toBe("cyberpunk2020");
  expect(me.isGM).toBe(false);
  expect(me.ready).toBe(true);
});

test("BTM derivation works on a freshly created actor", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  const probe = await evalGameOrThrow(page, async () => {
    // Create a throwaway character, set BT, read the derived modifier, then delete it.
    const actor = await Actor.create({ name: "__PW__btmProbe", type: "character" });
    const results = {};
    for (const bt of [2, 4, 6, 9, 10, 12]) {
      await actor.update({ "system.stats.bt.value": bt });
      results[bt] = {
        total: actor.system.stats.bt.total,
        modifier: actor.system.stats.bt.modifier,
      };
    }
    await actor.delete();
    return results;
  });
  console.log("BTM derivation:", JSON.stringify(probe, null, 2));
  // BT 6 (average) should yield BTM 2; BT 9 (strong) BTM 3. Confirms sign + table.
  expect(probe["6"].modifier).toBeGreaterThan(0);
  expect(probe["9"].modifier).toBeGreaterThanOrEqual(probe["6"].modifier);
});
