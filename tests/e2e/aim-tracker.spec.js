import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, setupSceneWithToken, waitForCanvasScene, cleanupTestData } from "../helpers/foundry.js";

/**
 * QA §9 — Aim button on the combat tracker (UI-driven).
 *
 * Clicking the 🎯 control on the active combatant cycles accumulated aim rounds
 * 1 → 2 → 3 → 0 (reset). This also establishes the pattern for the other tracker
 * controls (dodge/parry/wait/add-action), which share the same click plumbing.
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("§9 Aim tracker button cycles aim rounds 1→2→3→0", async ({ page }) => {
  await login(page, ACCOUNTS.gm, { canvas: true });
  await cleanupTestData(page).catch(() => {});
  const scene = await setupSceneWithToken(page, { activate: true, actorName: "__PW__Aimer" });
  await waitForCanvasScene(page, scene.sceneId);

  const actorId = await evalGameOrThrow(page, async (arg) => {
    await game.settings.set("cyberpunk2020", "aimTrackingEnabled", true);
    const actor = game.actors.get(arg.actorId);
    await actor.unsetFlag("cyberpunk2020", "aimRounds").catch(() => {});
    const combat = await Combat.create({ scene: arg.sceneId, flags: { cyberpunk2020: { __pwtest: true } } });
    await combat.createEmbeddedDocuments("Combatant", [
      { tokenId: arg.tokenId, sceneId: arg.sceneId, actorId: arg.actorId },
    ]);
    await combat.startCombat();
    await ui.combat.render(true);          // ensure the tracker is drawn
    return arg.actorId;
  }, scene);

  const aimBtn = page.locator(`.cp-take-aim-btn[data-actor-id="${actorId}"]`).first();
  const readAim = () => evalGameOrThrow(page, (id) => Number(game.actors.get(id).getFlag("cyberpunk2020", "aimRounds") ?? 0), actorId);
  // The sidebar tracker controls are hover-revealed (hidden in headless), but the click
  // handler is a document-level listener — dispatch a bubbling click on the element directly.
  const clickAndExpect = async (expected) => {
    await expect(aimBtn).toBeAttached({ timeout: 15_000 });
    await aimBtn.dispatchEvent("click");
    const dl = Date.now() + 6_000;
    let v = await readAim();
    while (Date.now() < dl && v !== expected) { await page.waitForTimeout(200); v = await readAim(); }
    return v;
  };

  expect(await readAim(), "starts at 0").toBe(0);
  expect(await clickAndExpect(1), "1st click -> 1").toBe(1);
  expect(await clickAndExpect(2), "2nd click -> 2").toBe(2);
  expect(await clickAndExpect(3), "3rd click -> 3").toBe(3);
  expect(await clickAndExpect(0), "4th click resets to 0").toBe(0);
});
