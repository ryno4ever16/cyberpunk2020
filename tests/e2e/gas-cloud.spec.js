import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, setupSceneWithToken, waitForCanvasScene, cleanupTestData } from "../helpers/foundry.js";

/**
 * QA §13 — Gas grenade cloud.
 *   Firing gas ammo places a circle template (centered on target/attacker), prompts
 *   Stun Saves each turn for tokens inside, counts down, then disperses.
 *   Driven by the weaponFired hook (effectTypes includes "Gas") + the per-turn updateCombat handler.
 */

test.describe.configure({ mode: "serial" });

let gmCtx, gmPage, scene;

test.beforeAll(async ({ browser }) => {
  gmCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  gmPage = await gmCtx.newPage();
  await login(gmPage, ACCOUNTS.gm, { canvas: true });
  await cleanupTestData(gmPage).catch(() => {});
  scene = await setupSceneWithToken(gmPage, { activate: true, actorName: "__PW__GasVictim" });
  await waitForCanvasScene(gmPage, scene.sceneId);
  await gmPage.waitForFunction((id) => !!window.canvas?.tokens?.get(id), scene.tokenId, { timeout: 20_000 });
});

test.afterAll(async () => {
  if (gmPage) await cleanupTestData(gmPage).catch(() => {});
  if (gmCtx) await gmCtx.close();
});

test("§13 gas cloud places a template, prompts saves in-cloud, and disperses", async () => {
  const R = await evalGameOrThrow(gmPage, async (arg) => {
    await game.settings.set("cyberpunk2020", "gasGrenadeCloudEnabled", true);
    const countClouds = () => canvas.scene.templates.filter(t => t.getFlag("cyberpunk2020", "isGasCloud")).length;
    const cloudsBefore = countClouds();

    // Fire gas ammo: cloud centers on the victim's token, 2-turn duration.
    Hooks.callAll("cyberpunk2020.weaponFired", {
      attackerId: arg.actorId,
      targetTokenId: arg.tokenId,
      effectTypes: ["Gas"],
      blastRadius: 3,
      dotTurns: 2,
      stunSaveMod: -2,
      weaponName: "__PW__GasGun",
    });

    // Wait for the cloud template to appear.
    const dlClouds = Date.now() + 12_000;
    while (Date.now() < dlClouds && countClouds() <= cloudsBefore) await new Promise(r => setTimeout(r, 250));
    const cloudAppeared = countClouds() > cloudsBefore;
    const cloud = canvas.scene.templates.filter(t => t.getFlag("cyberpunk2020", "isGasCloud")).pop();
    const tok = canvas.tokens.get(arg.tokenId);
    const centeredOnVictim = cloud
      ? Math.abs(cloud.x - tok.center.x) < 2 && Math.abs(cloud.y - tok.center.y) < 2 : false;
    const cloudType = cloud?.t ?? null;

    // Put the victim in combat; each turn it's inside the cloud -> stun prompt + tick down.
    const combat = await Combat.create({ scene: arg.sceneId, flags: { cyberpunk2020: { __pwtest: true } } });
    await combat.createEmbeddedDocuments("Combatant", [
      { tokenId: arg.tokenId, sceneId: arg.sceneId, actorId: arg.actorId },
    ]);

    const msgCount = (kw) => game.messages.contents.filter(m => (m.content || "").includes(kw)).length;
    const stunBefore = msgCount("Stun Save");

    await combat.startCombat();
    // tick 1
    const dl1 = Date.now() + 10_000;
    while (Date.now() < dl1 && msgCount("Stun Save") <= stunBefore) await new Promise(r => setTimeout(r, 250));
    const stunPromptedTick1 = msgCount("Stun Save") > stunBefore;

    await combat.nextTurn(); // tick 2 -> turnsLeft 0 -> disperse
    const dl2 = Date.now() + 10_000;
    while (Date.now() < dl2 && countClouds() > cloudsBefore) await new Promise(r => setTimeout(r, 250));
    await new Promise(r => setTimeout(r, 600));
    const dispersed = countClouds() === cloudsBefore;
    const dispersedMsg = game.messages.contents.some(m => (m.content || "").includes("dispersed"));

    await combat.delete().catch(() => {});
    return { cloudAppeared, cloudType, centeredOnVictim, stunPromptedTick1, dispersed, dispersedMsg };
  }, { sceneId: scene.sceneId, tokenId: scene.tokenId, actorId: scene.actorId });

  console.log("Gas cloud:", JSON.stringify(R));

  expect(R.cloudAppeared, "gas ammo places a cloud template").toBe(true);
  expect(R.cloudType, "cloud is a circle template").toBe("circle");
  expect(R.centeredOnVictim, "cloud centers on the target token").toBe(true);
  expect(R.stunPromptedTick1, "a token in the cloud is prompted for a Stun Save each turn").toBe(true);
  expect(R.dispersed, "cloud is removed after its duration").toBe(true);
  expect(R.dispersedMsg, "a 'dispersed' message posts").toBe(true);
});
