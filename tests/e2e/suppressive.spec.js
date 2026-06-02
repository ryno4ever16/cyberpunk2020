import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import {
  login, evalGameOrThrow, setupSceneWithToken, waitForCanvasScene, cleanupTestData,
} from "../helpers/foundry.js";

/**
 * QA §11 — Suppressive Fire.
 *
 * The reported bug: firing in suppressive mode placed no fire-zone template on
 * the canvas. Root cause (Session 16): `Hooks.callAll` is local to the firing
 * client and the handler was gated on isGM, so a PLAYER firing reached nobody.
 * Fix: place directly if active GM, else relay to the GM over the socket.
 *
 * Two things to prove at runtime, which static analysis could not:
 *   1. The MeasuredTemplate creation actually works on Foundry v13 (GM-direct).
 *   2. A player firing suppressive results in the GM placing the template
 *      (the socket relay fix).
 */

test.describe.configure({ mode: "serial" });

let gmCtx, gmPage, scene;

test.beforeAll(async ({ browser }) => {
  gmCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  gmPage = await gmCtx.newPage();
  await login(gmPage, ACCOUNTS.gm, { canvas: true });
  await cleanupTestData(gmPage).catch(() => {}); // clear any stragglers from prior runs
  scene = await setupSceneWithToken(gmPage, { activate: true, actorName: "__PW__Shooter" });
  await waitForCanvasScene(gmPage, scene.sceneId);
  // Wait for the token to exist as a canvas placeable (the suppressive code finds it there)
  await gmPage.waitForFunction(
    (id) => !!window.canvas?.tokens?.get(id),
    scene.tokenId,
    { timeout: 20_000 }
  );
});

test.afterAll(async () => {
  if (gmPage) await cleanupTestData(gmPage).catch(() => {});
  if (gmCtx) await gmCtx.close();
});

/** Trigger suppressive fire from the given page and wait for a new zone template on the GM's canvas. */
async function triggerAndWaitForZone(triggerPage, payload, gmReadPage) {
  const before = await evalGameOrThrow(gmReadPage, () =>
    canvas.scene.templates.filter(t => t.getFlag("cyberpunk2020", "isSuppressiveZone")).length
  );

  await evalGameOrThrow(triggerPage, (p) => {
    Hooks.callAll("cyberpunk2020.suppressiveFire", p);
    return true;
  }, payload);

  // Poll the GM canvas for the new template (callAll does not await async listeners,
  // and the relay path crosses the socket twice over the network — both need time).
  return evalGameOrThrow(gmReadPage, async (arg) => {
    const deadline = Date.now() + 25_000;
    let zones = [];
    let msgHit = false;
    const checkMsg = () => game.messages.contents.some(m =>
      (m.content || "").includes("Confirm Fire Zone") && (m.content || "").includes(arg.weaponName));
    // The template and its "Confirm Fire Zone" chat message are created back-to-back
    // and (on the relay path) broadcast separately, so they can arrive a tick apart.
    // Wait for BOTH before reporting.
    while (Date.now() < deadline) {
      zones = canvas.scene.templates.filter(t => t.getFlag("cyberpunk2020", "isSuppressiveZone"));
      msgHit = checkMsg();
      if (zones.length > arg.before && msgHit) break;
      await new Promise(r => setTimeout(r, 250));
    }
    const newest = zones[zones.length - 1];
    return {
      count: zones.length,
      added: zones.length - arg.before,
      newestType: newest?.t ?? null,
      newestActorId: newest?.getFlag("cyberpunk2020", "actorId") ?? null,
      newestX: newest?.x ?? null,
      newestY: newest?.y ?? null,
      confirmButtonPosted: msgHit,
    };
  }, { before, weaponName: payload.weaponName });
}

test("§11 GM-direct: suppressive fire places a fire-zone template on the canvas", async () => {
  const tokenCenter = await evalGameOrThrow(gmPage, (id) => {
    const tok = canvas.tokens.get(id);
    return { x: tok.center.x, y: tok.center.y };
  }, scene.tokenId);

  const result = await triggerAndWaitForZone(gmPage, {
    saveDC: 15,
    dmgFormula: "1d6",
    weaponName: "__PW__SuppressorA",
    actorId: scene.actorId,
    attackerTokenId: scene.tokenId,
    zoneWidth: 3,
    weaponRange: 30,
  }, gmPage);

  console.log("GM-direct suppressive result:", JSON.stringify(result));
  expect(result.added, "exactly one new suppressive zone template should appear").toBe(1);
  expect(result.newestType, "template should be a ray").toBe("ray");
  expect(result.newestActorId).toBe(scene.actorId);
  // Origin is anchored to the attacker token center
  expect(Math.abs(result.newestX - tokenCenter.x)).toBeLessThan(2);
  expect(Math.abs(result.newestY - tokenCenter.y)).toBeLessThan(2);
  expect(result.confirmButtonPosted, "a Confirm Fire Zone prompt should be posted to chat").toBe(true);

  // Clear the zone(s) so the relay test starts from a clean slate
  await evalGameOrThrow(gmPage, async () => {
    const ids = canvas.scene.templates.filter(t => t.getFlag("cyberpunk2020", "isSuppressiveZone")).map(t => t.id);
    if (ids.length) await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", ids);
    return ids.length;
  });
});

test("§11 relay: a PLAYER firing suppressive makes the GM place the template", async ({ browser }) => {
  const playerCtx = await browser.newContext({ viewport: { width: 1400, height: 800 }, ignoreHTTPSErrors: true });
  const playerPage = await playerCtx.newPage();
  try {
    await login(playerPage, ACCOUNTS.player1);

    // Sanity: the player is NOT the active GM, so this MUST go through the socket relay.
    const playerInfo = await evalGameOrThrow(playerPage, () => ({
      isGM: game.user.isGM,
      isActiveGM: game.users.activeGM?.id === game.user.id,
    }));
    expect(playerInfo.isGM).toBe(false);
    expect(playerInfo.isActiveGM).toBe(false);

    // Player fires; GM (gmPage) should end up with the template.
    const result = await triggerAndWaitForZone(playerPage, {
      saveDC: 14,
      dmgFormula: "2d6",
      weaponName: "__PW__SuppressorB",
      actorId: scene.actorId,
      attackerTokenId: scene.tokenId,
      zoneWidth: 2,
      weaponRange: 25,
    }, gmPage);

    console.log("Player-relay suppressive result:", JSON.stringify(result));
    expect(result.added, "player-fired suppressive should relay to the GM and place exactly one template").toBe(1);
    expect(result.newestType).toBe("ray");
    expect(result.newestActorId).toBe(scene.actorId);
    expect(result.confirmButtonPosted).toBe(true);
  } finally {
    await playerCtx.close();
  }
});
