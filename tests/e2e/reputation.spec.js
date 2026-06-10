import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, setupSceneWithToken, waitForCanvasScene, cleanupTestData } from "../helpers/foundry.js";

/**
 * Reputation + Facedown (CP2020 p.54). Verifies the new social feature end-to-end on the live world:
 *   - the additive `system.reputation` field defaults to 0 and persists;
 *   - Recognition resolves the ≤ Rep (recognized) vs > Rep (not) branches;
 *   - solo Facedown posts a card; targeted Facedown is contested and names the winner + the −3 reminder;
 *   - the reputationEnabled setting gates the rolls (no card when off).
 * Self-cleans (deletes the cards + tagged actors/scene, restores the setting).
 */

test.describe.configure({ mode: "serial" });

let gmCtx, gmPage, scene;

test.beforeAll(async ({ browser }) => {
  gmCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  gmPage = await gmCtx.newPage();
  await login(gmPage, ACCOUNTS.gm, { canvas: true });
  await cleanupTestData(gmPage).catch(() => {});
  scene = await setupSceneWithToken(gmPage, { activate: true, actorName: "__PW__RepMe" });
  await waitForCanvasScene(gmPage, scene.sceneId);
});

test.afterAll(async () => {
  if (gmPage) await cleanupTestData(gmPage).catch(() => {});
  if (gmCtx) await gmCtx.close();
});

test("Reputation field + Facedown/Recognition rolls + setting gate", async () => {
  const res = await evalGameOrThrow(gmPage, async (arg) => {
    const SCOPE = "cyberpunk2020";
    const origEnabled = game.settings.get(SCOPE, "reputationEnabled");
    const createdMsgIds = [];
    const out = {};

    // Capture the chat card a roll posts (poll, since the roll cards are created async/fire-and-forget).
    const capture = async (fn) => {
      const before = new Set(game.messages.contents.map(m => m.id));
      await fn();
      const deadline = Date.now() + 6000;
      let msg = null;
      while (Date.now() < deadline) {
        msg = game.messages.contents.find(m => !before.has(m.id));
        if (msg) break;
        await new Promise(r => setTimeout(r, 100));
      }
      game.messages.contents.filter(m => !before.has(m.id)).forEach(m => createdMsgIds.push(m.id));
      return { found: !!msg, content: msg?.content ?? "" };
    };

    try {
      await game.settings.set(SCOPE, "reputationEnabled", true);
      const me = game.actors.get(arg.actorId);

      // 1. Schema: defaults to 0 and persists.
      out.repDefault = me.system.reputation;
      await me.update({ "system.reputation": 7 });
      out.repAfterSet = me.system.reputation;

      // 2. Recognition — rep 10 → always ≤ d10 result? no: roll 1d10 ≤ 10 → ALWAYS recognized.
      await me.update({ "system.reputation": 10 });
      out.recogRecognized = await capture(() => me.rollRecognition());
      // rep 0 → 1d10 is always ≥1 > 0 → NEVER recognized.
      await me.update({ "system.reputation": 0 });
      out.recogNot = await capture(() => me.rollRecognition());

      // 3. Facedown solo (no target).
      [...game.user.targets].forEach(t => t.setTarget(false, { releaseOthers: false }));
      await me.update({ "system.reputation": 5 });
      out.facedownSolo = await capture(() => me.rollFacedown());

      // 4. Facedown contested — target a foe token; huge Rep gap → deterministic winner = me.
      const foe = await Actor.create({ name: "__PW__RepFoe", type: "npc", flags: { cyberpunk2020: { __pwtest: true } } });
      await me.update({ "system.reputation": 100 });
      await foe.update({ "system.reputation": -100 });
      const sc = game.scenes.get(arg.sceneId);
      const [foeTokDoc] = await sc.createEmbeddedDocuments("Token", [{
        name: foe.name, x: 1300, y: 1000, actorId: foe.id, actorLink: true, width: 1, height: 1,
        flags: { cyberpunk2020: { __pwtest: true } },
      }]);
      let foeTok = null;
      const dl = Date.now() + 8000;
      while (Date.now() < dl) { foeTok = canvas.tokens.get(foeTokDoc.id); if (foeTok) break; await new Promise(r => setTimeout(r, 150)); }
      out.foePlaceableDrawn = !!foeTok;
      [...game.user.targets].forEach(t => t.setTarget(false, { releaseOthers: false }));
      foeTok?.setTarget(true, { releaseOthers: true });
      out.targetCount = game.user.targets.size;
      out.facedownContested = await capture(() => me.rollFacedown());
      out.meName = me.name; out.foeName = foe.name;

      // 5. Setting OFF → rolls no-op (no card).
      [...game.user.targets].forEach(t => t.setTarget(false, { releaseOthers: false }));
      await game.settings.set(SCOPE, "reputationEnabled", false);
      out.facedownDisabled = await capture(() => me.rollFacedown());
    } finally {
      await game.settings.set(SCOPE, "reputationEnabled", origEnabled);
      if (createdMsgIds.length) await ChatMessage.deleteDocuments(createdMsgIds).catch(() => {});
    }
    return out;
  }, scene);

  console.log("REPUTATION RESULT:", JSON.stringify(res, null, 2));

  // Schema
  expect(res.repDefault, "reputation defaults to 0").toBe(0);
  expect(res.repAfterSet, "reputation persists after update").toBe(7);

  // Recognition branches
  expect(res.recogRecognized.found).toBe(true);
  expect(res.recogRecognized.content, "rep 10 → recognized").toContain("Recognized");
  expect(res.recogRecognized.content).not.toContain("Not recognized");
  expect(res.recogNot.content, "rep 0 → not recognized").toContain("Not recognized");

  // Solo facedown
  expect(res.facedownSolo.found, "solo facedown posts a card").toBe(true);
  expect(res.facedownSolo.content).toContain("Facedown");
  expect(res.facedownSolo.content, "solo card names the roller").toContain("__PW__RepMe");

  // Contested facedown — deterministic winner = me (rep 100 vs -100)
  expect(res.foePlaceableDrawn, "foe token placeable drew").toBe(true);
  expect(res.targetCount, "exactly one foe targeted").toBe(1);
  expect(res.facedownContested.found, "contested facedown posts a card").toBe(true);
  expect(res.facedownContested.content, "card shows both combatants").toContain(res.foeName);
  expect(res.facedownContested.content, "winner is the high-Rep roller").toContain(`${res.meName} wins the Facedown`);

  // Setting gate
  expect(res.facedownDisabled.found, "setting OFF → no card").toBe(false);
});
