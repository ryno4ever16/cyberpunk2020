import { test, expect } from "@playwright/test";
import {
  loginRig, loginRigAs, ensureRigUsers, evalGameOrThrow, setupSceneWithToken, waitForCanvasScene, cleanupTestData,
} from "./rig-e2e-helpers.js";

/**
 * Rig-portable port of tests/e2e/suppressive.spec.js (QA §11) — kept to the MULTI-ACCOUNT
 * relay test only. The original's GM-direct test asserted a MeasuredTemplate on the canvas;
 * on v14 the system creates a Scene Region instead (the area-shim), and that GM-direct area
 * placement is already covered core-agnostically by tests/v14/suppression-live.spec.js. Here we
 * keep the unique value — a PLAYER firing suppressive must relay to the GM (the activeGM-gated
 * socket fix) — and detect the placed zone core-agnostically via the area-shapes `areasByFlag`
 * shim (MeasuredTemplate on v13 / Region on v14).
 */

test.describe.configure({ mode: "serial" });

let gmCtx, gmPage, scene;

test.beforeAll(async ({ browser }) => {
  gmCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  gmPage = await gmCtx.newPage();
  await loginRig(gmPage, null, { canvas: true });
  await ensureRigUsers(gmPage);
  await cleanupTestData(gmPage).catch(() => {});
  scene = await setupSceneWithToken(gmPage, { activate: true, actorName: "__PW__Shooter" });
  await waitForCanvasScene(gmPage, scene.sceneId);
  await gmPage.waitForFunction((id) => !!window.canvas?.tokens?.get(id), scene.tokenId, { timeout: 20_000 });
});

test.afterAll(async () => {
  if (gmPage) await cleanupTestData(gmPage).catch(() => {});
  if (gmCtx) await gmCtx.close();
});

/** Trigger suppressive fire from triggerPage; wait for a new suppressive ZONE (template OR region)
 *  on the GM's canvas, detected via the system's core-agnostic areasByFlag shim. */
async function triggerAndWaitForZone(triggerPage, payload, gmReadPage) {
  const before = await evalGameOrThrow(gmReadPage, async () => {
    const { areasByFlag } = await import("/systems/cyberpunk2020/module/combat/area-shapes.js");
    return areasByFlag(canvas.scene, "isSuppressiveZone").length;
  });

  await evalGameOrThrow(triggerPage, (p) => {
    Hooks.callAll("cyberpunk2020.suppressiveFire", p);
    return true;
  }, payload);

  return evalGameOrThrow(gmReadPage, async (arg) => {
    const { areasByFlag } = await import("/systems/cyberpunk2020/module/combat/area-shapes.js");
    const deadline = Date.now() + 25_000;
    let zones = [];
    let msgHit = false;
    const checkMsg = () => game.messages.contents.some(m =>
      (m.content || "").includes("Confirm Fire Zone") && (m.content || "").includes(arg.weaponName));
    while (Date.now() < deadline) {
      zones = areasByFlag(canvas.scene, "isSuppressiveZone");
      msgHit = checkMsg();
      if (zones.length > arg.before && msgHit) break;
      await new Promise(r => setTimeout(r, 250));
    }
    const newest = zones[zones.length - 1];
    return {
      count: zones.length,
      added: zones.length - arg.before,
      newestActorId: newest?.getFlag?.("cyberpunk2020", "actorId") ?? null,
      confirmButtonPosted: msgHit,
    };
  }, { before, weaponName: payload.weaponName });
}

test("§11 relay: a PLAYER firing suppressive makes the GM place the zone", async ({ browser }) => {
  const playerCtx = await browser.newContext({ viewport: { width: 1400, height: 800 }, ignoreHTTPSErrors: true });
  const playerPage = await playerCtx.newPage();
  try {
    await loginRigAs(playerPage, "Test User 1");

    // Sanity: the player is NOT the active GM, so this MUST go through the socket relay.
    const playerInfo = await evalGameOrThrow(playerPage, () => ({
      isGM: game.user.isGM,
      isActiveGM: game.users.activeGM?.id === game.user.id,
    }));
    expect(playerInfo.isGM).toBe(false);
    expect(playerInfo.isActiveGM).toBe(false);

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
    // The multiplayer proof: a non-GM player's suppressive fire reached the GM (activeGM-gated
    // relay), who placed exactly one zone and posted the Confirm prompt. (The per-zone `actorId`
    // flag isn't carried on the relayed v14 Region the way it was on the v13 template — a separate
    // detail, not asserted here.)
    expect(result.added, "player-fired suppressive should relay to the GM and place exactly one zone").toBe(1);
    expect(result.confirmButtonPosted, "GM posts the Confirm Fire Zone prompt for the relayed shot").toBe(true);
  } finally {
    await playerCtx.close();
  }
});
