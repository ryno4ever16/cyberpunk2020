import { test, expect } from "@playwright/test";
import { loginRig, evalGameOrThrow, setupSceneWithToken, waitForCanvasScene, cleanupTestData } from "./rig-e2e-helpers.js";

/**
 * Rig-portable port of tests/e2e/multi-action.spec.js — identical body; login swapped to the rig (loginRig).
 */

test.describe.configure({ mode: "serial" });

let gmCtx, gmPage, scene;

test.beforeAll(async ({ browser }) => {
  gmCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  gmPage = await gmCtx.newPage();
  await loginRig(gmPage, null, { canvas: true });
  await cleanupTestData(gmPage).catch(() => {});
  scene = await setupSceneWithToken(gmPage, { activate: true, actorName: "__PW__Actor" });
  await waitForCanvasScene(gmPage, scene.sceneId);
});

test.afterAll(async () => {
  if (gmPage) await cleanupTestData(gmPage).catch(() => {});
  if (gmCtx) await gmCtx.close();
});

test("§10 weaponFired auto-increments action count; round end resets it", async () => {
  const R = await evalGameOrThrow(gmPage, async (arg) => {
    await game.settings.set("cyberpunk2020", "multiActionPenaltyEnabled", true);
    await game.settings.set("cyberpunk2020", "multiActionAutoTrack", true);
    const actor = game.actors.get(arg.actorId);
    await actor.unsetFlag("cyberpunk2020", "actionCount").catch(() => {});
    await actor.unsetFlag("cyberpunk2020", "actionCountRound").catch(() => {});

    const rawCount = () => Number(game.actors.get(arg.actorId).getFlag("cyberpunk2020", "actionCount") ?? 0);
    const fire = () => Hooks.callAll("cyberpunk2020.weaponFired", { attackerId: arg.actorId });
    const waitCount = async (target) => {
      const dl = Date.now() + 8_000;
      while (Date.now() < dl && rawCount() < target) await new Promise(r => setTimeout(r, 150));
      return rawCount();
    };

    fire(); const c1 = await waitCount(1);
    fire(); const c2 = await waitCount(2);
    const penaltyAt2 = c2 <= 1 ? 0 : -(c2 - 1) * 3;

    // Round reset: set a count at the current round, advance the round, expect it cleared.
    const combat = await Combat.create({ scene: arg.sceneId, flags: { cyberpunk2020: { __pwtest: true } } });
    await combat.createEmbeddedDocuments("Combatant", [
      { tokenId: arg.tokenId, sceneId: arg.sceneId, actorId: arg.actorId },
    ]);
    await combat.startCombat();
    const roundAtSet = combat.round;
    await actor.setFlag("cyberpunk2020", "actionCount", 3);
    await actor.setFlag("cyberpunk2020", "actionCountRound", roundAtSet);
    const beforeReset = rawCount();

    await combat.nextRound();
    const dl = Date.now() + 8_000;
    while (Date.now() < dl && rawCount() > 0) await new Promise(r => setTimeout(r, 150));
    const afterReset = rawCount();

    await combat.delete().catch(() => {});
    return { c1, c2, penaltyAt2, beforeReset, afterReset };
  }, { sceneId: scene.sceneId, tokenId: scene.tokenId, actorId: scene.actorId });

  console.log("Multi-action:", JSON.stringify(R));

  expect(R.c1, "first weaponFired -> action count 1").toBe(1);
  expect(R.c2, "second weaponFired -> action count 2").toBe(2);
  expect(R.penaltyAt2, "2 actions -> −3 penalty").toBe(-3);
  expect(R.beforeReset, "count set to 3 before round end").toBe(3);
  expect(R.afterReset, "round end clears the action count").toBe(0);
});
