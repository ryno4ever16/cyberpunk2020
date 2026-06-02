import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, setupSceneWithToken, cleanupTestData } from "../helpers/foundry.js";

/**
 * Regression test for the multi-GM DOT duplication fix (this session).
 *
 * Bug: `_hookDotEffects` ran on every connected GM client (gated only on isGM),
 * so N connected GMs each applied the per-turn DOT → HP loss multiplied by N.
 * Fix: gate on `game.users.activeGM` so only the primary GM applies it.
 *
 * How this proves the fix without depending on external sessions:
 *   We connect TWO of our own fixed-code GM clients (plus whatever else is
 *   connected → K active GMs total). The fix guarantees AT MOST ONE fixed GM
 *   (the active one) applies the tick; any other GMs that apply must be stale
 *   external clients. So the number of applications `g` must be < K whenever we
 *   have ≥2 fixed clients connected. A buggy build would give g === K.
 */

test.describe.configure({ mode: "serial" });

let gmCtx, gmPage, gm2Ctx, gm2Page;

test.beforeAll(async ({ browser }) => {
  gmCtx = await browser.newContext({ viewport: { width: 1400, height: 800 }, ignoreHTTPSErrors: true });
  gmPage = await gmCtx.newPage();
  await login(gmPage, ACCOUNTS.gm);

  gm2Ctx = await browser.newContext({ viewport: { width: 1400, height: 800 }, ignoreHTTPSErrors: true });
  gm2Page = await gm2Ctx.newPage();
  await login(gm2Page, ACCOUNTS.gm2); // Assistant Gamemaster — also a GM

  await cleanupTestData(gmPage).catch(() => {});
});

test.afterAll(async () => {
  if (gmPage) await cleanupTestData(gmPage).catch(() => {});
  if (gmCtx) await gmCtx.close();
  if (gm2Ctx) await gm2Ctx.close();
});

test("§16/§22 DOT applies once per tick despite multiple connected GMs", async () => {
  const ids = await setupSceneWithToken(gmPage, {
    activate: true,
    actorName: "__PW__MultiGMBurner",
    actorUpdate: { "system.stats.bt.base": 9, "system.damage": 0 },
  });

  const result = await evalGameOrThrow(gmPage, async (arg) => {
    const actor = game.actors.get(arg.actorId);
    const btm = Number(actor.system.stats.bt.modifier) || 0;
    await game.settings.set("cyberpunk2020", "fireDotEnabled", true);
    await actor.setFlag("cyberpunk2020", "fireDotState", [
      { location: "Torso", turnsLeft: 1, formula: "10", mult: 1 },
    ]);
    const start = Number(actor.system.damage) || 0;

    const combat = await Combat.create({ scene: arg.sceneId, flags: { cyberpunk2020: { __pwtest: true } } });
    await combat.createEmbeddedDocuments("Combatant", [
      { tokenId: arg.tokenId, sceneId: arg.sceneId, actorId: arg.actorId },
    ]);
    await combat.startCombat();

    const deadline = Date.now() + 12_000;
    let dmg = start;
    while (Date.now() < deadline) {
      dmg = Number(game.actors.get(arg.actorId).system.damage) || 0;
      if (dmg > start) break;
      await new Promise(r => setTimeout(r, 200));
    }
    // Allow any straggler client a moment to (incorrectly) pile on.
    await new Promise(r => setTimeout(r, 1500));
    dmg = Number(game.actors.get(arg.actorId).system.damage) || 0;

    const connectedGMs = game.users.contents.filter(u => u.active && u.isGM).map(u => u.name);
    await combat.delete().catch(() => {});

    return { btm, delta: dmg - start, connectedGMs, K: connectedGMs.length };
  }, ids);

  console.log("Multi-GM DOT result:", JSON.stringify(result));

  const perTick = Math.max(1, Math.floor(10 * 1) - result.btm); // 7
  expect(result.delta % perTick, "total is a whole number of per-application burns").toBe(0);
  const g = result.delta / perTick;
  console.log(`g (clients that applied) = ${g}; K (connected GMs) = ${result.K} [${result.connectedGMs.join(", ")}]`);

  expect(result.K, "this test needs the two fixed-code GM clients connected").toBeGreaterThanOrEqual(2);
  expect(g, "at least one GM applies").toBeGreaterThanOrEqual(1);
  // The crux: with >=2 fixed clients connected, the activeGM guard must keep at
  // least one of them from applying. A buggy (unguarded) build would give g === K.
  expect(g, "activeGM guard must suppress redundant fixed-GM applications (g must be < K)").toBeLessThan(result.K);
});
