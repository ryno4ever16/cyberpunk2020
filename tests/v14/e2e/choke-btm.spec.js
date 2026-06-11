import { test, expect } from "@playwright/test";
import { loginRig, evalGameOrThrow, setupSceneWithToken, cleanupTestData } from "./rig-e2e-helpers.js";

/**
 * Rig-portable port of tests/e2e/choke-btm.spec.js — identical body; login swapped to the rig (loginRig).
 *
 * QA §8 (Choke) — Choke DOT now reduced by BTM.
 *
 * Per the "all damage to a player is reduced by BTM" rule, the per-turn Choke
 * damage was changed from raw `roll.total` to `max(1, roll.total - BTM)`.
 * Verified with a constant roll of 10 vs BTM 3 -> per-application 7.
 */

test.describe.configure({ mode: "serial" });

let gmCtx, gmPage;

test.beforeAll(async ({ browser }) => {
  gmCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  gmPage = await gmCtx.newPage();
  await loginRig(gmPage);
  await cleanupTestData(gmPage).catch(() => {});
});

test.afterAll(async () => {
  if (gmPage) await cleanupTestData(gmPage).catch(() => {});
  if (gmCtx) await gmCtx.close();
});

test("§8 choke DOT is reduced by BTM each turn", async () => {
  const ids = await setupSceneWithToken(gmPage, {
    activate: true,
    actorName: "__PW__Choked",
    actorUpdate: { "system.stats.bt.base": 9, "system.damage": 0 }, // BTM 3
  });

  const result = await evalGameOrThrow(gmPage, async (arg) => {
    const actor = game.actors.get(arg.actorId);
    const btm = Number(actor.system.stats.bt.modifier) || 0;
    await game.settings.set("cyberpunk2020", "specialMeleeEffectsEnabled", true);
    // Constant roll so BTM is exactly observable. Choke has no turn counter; one tick suffices.
    await actor.setFlag("cyberpunk2020", "chokeState", { formula: "10" });
    const start = Number(actor.system.damage) || 0;

    const combat = await Combat.create({ scene: arg.sceneId, flags: { cyberpunk2020: { __pwtest: true } } });
    await combat.createEmbeddedDocuments("Combatant", [
      { tokenId: arg.tokenId, sceneId: arg.sceneId, actorId: arg.actorId },
    ]);
    await combat.startCombat();

    const read = () => Number(game.actors.get(arg.actorId).system.damage) || 0;
    const hardDeadline = Date.now() + 15_000;
    let d = read();
    while (Date.now() < hardDeadline && d <= start) { await new Promise(r => setTimeout(r, 150)); d = read(); }
    // Settle (multiple GM clients apply asynchronously).
    let last = d, stableSince = Date.now();
    while (Date.now() < hardDeadline) {
      await new Promise(r => setTimeout(r, 200));
      const now = read();
      if (now !== last) { last = now; stableSince = Date.now(); }
      else if (Date.now() - stableSince >= 1500) break;
    }

    const stunPrompted = game.messages.contents.some(m =>
      (m.content || "").includes("Stun Save") && (m.content || "").includes(actor.name));
    const chokeMsg = game.messages.contents.some(m => (m.content || "").includes("after BTM"));

    await actor.unsetFlag("cyberpunk2020", "chokeState").catch(() => {});
    await combat.delete().catch(() => {});

    return {
      btm, delta: last - start, stunPrompted, chokeMsg,
      activeGMs: game.users.contents.filter(u => u.active && u.isGM).map(u => u.name),
    };
  }, ids);

  console.log("Choke BTM result:", JSON.stringify(result));

  const perTick = Math.max(1, 10 - result.btm); // 7
  expect(result.btm, "BT base 9 -> BTM 3").toBe(3);
  expect(result.delta, "choke applied HP damage").toBeGreaterThanOrEqual(perTick);
  expect(result.delta % perTick, "delta is a whole number of (rawRoll - BTM) per application").toBe(0);
  expect(result.delta % 10, "delta is NOT the un-reduced raw roll — BTM was subtracted").not.toBe(0);
  expect(result.stunPrompted, "choke posts a Stun Save prompt").toBe(true);
});
