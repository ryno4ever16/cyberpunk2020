import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, setupSceneWithToken, waitForCanvasScene, cleanupTestData } from "../helpers/foundry.js";

/**
 * Vehicle — Phase 2 (corrected): a vehicle is a single VISIBLE, scalable token.
 *
 * Asserts the things a GM actually does:
 *   - the handle token is VISIBLE (alpha > 0) and selectable,
 *   - it is sized to a footprint and is resizable (scalable to fit any image),
 *   - it sorts BELOW crew so passengers render on top,
 *   - MOVING THE TOKEN drags boarded crew by the same delta (disembarked crew don't follow),
 *   - redeploy is idempotent (no stacking), and no orphan tile is created.
 *
 * NOTE: in v13 a token's `.x`/`.width` getters reflect the in-progress ANIMATION; the committed
 * value is on `._source`. We assert `_source` (and poll the async crew-follow update).
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("Phase 2: visible scalable vehicle token; moving it drags crew; redeploy idempotent", async ({ page }) => {
  await login(page, ACCOUNTS.gm, { canvas: true });
  await cleanupTestData(page).catch(() => {});
  const scene = await setupSceneWithToken(page, { activate: true, actorName: "__PW__SceneSeed" });
  await waitForCanvasScene(page, scene.sceneId);

  const R = await evalGameOrThrow(page, async (arg) => {
    const VC = await import("/systems/cyberpunk2020/module/vehicle/vehicle-canvas.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const sc = game.scenes.get(arg.sceneId);
    const src = (id) => sc.tokens.get(id)?._source;     // committed (non-animated) values

    const vehicle = await Actor.create({ name: "__PW__Rig", type: "vehicle", flags, system: { sdp: { value: 100, max: 100 } } });
    const dep = await VC.deployVehicleToScene(vehicle, { x: 500, y: 500, gw: 4, gh: 2 });
    const s0 = src(dep.tokenId);

    const out = {
      visible:     s0.alpha > 0,
      handleFlag:  s0.flags?.cyberpunk2020?.vehicleHandle === true,
      footprintW:  s0.width, footprintH: s0.height,
      belowCrew:   s0.sort < 0,
      linkedActor: s0.actorId === vehicle.id,
      tileCount:   sc.tiles.filter(t => t.flags?.cyberpunk2020?.vehicleActorId === vehicle.id).length,
    };

    // Scalable: resizing the footprint commits (art scales to it).
    await sc.tokens.get(dep.tokenId).update({ width: 6, height: 3 });
    out.resizedW = src(dep.tokenId).width;
    out.resizedH = src(dep.tokenId).height;

    // Crew boards, then the vehicle moves → crew follows by the same delta.
    const crewActor = await Actor.create({ name: "__PW__Crew", type: "character", flags, system: { stats: { bt: { base: 2 } } } });
    const [crew] = await sc.createEmbeddedDocuments("Token", [{ name: "__PW__Crew", x: 520, y: 520, actorId: crewActor.id, actorLink: true, width: 1, height: 1, flags }]);
    await VC.boardVehicle(crew, vehicle);

    const vBefore = src(dep.tokenId).x;
    const cBefore = src(crew.id).x, cBeforeY = src(crew.id).y;
    await sc.tokens.get(dep.tokenId).update({ x: vBefore + 300, y: src(dep.tokenId).y + 150 });
    out.tokenMoved = src(dep.tokenId).x === vBefore + 300;          // committed immediately

    // Crew-follow runs in the async updateToken hook — poll the committed crew position.
    const expCrewX = cBefore + 300, expCrewY = cBeforeY + 150;
    const dl = Date.now() + 8000;
    while (Date.now() < dl && src(crew.id).x !== expCrewX) await new Promise(r => setTimeout(r, 150));
    out.crewFollowed = { x: src(crew.id).x, y: src(crew.id).y };
    out.crewExpected = { x: expCrewX, y: expCrewY };

    // Disembarked crew should NOT follow.
    await VC.disembark(sc.tokens.get(crew.id));
    const cStay = src(crew.id).x;
    await sc.tokens.get(dep.tokenId).update({ x: src(dep.tokenId).x + 100 });
    await new Promise(r => setTimeout(r, 1200));
    out.disembarkedStaysPut = src(crew.id).x === cStay;

    // Redeploy is idempotent.
    const dep2 = await VC.deployVehicleToScene(vehicle, { x: 900, y: 900 });
    out.redeployExisting = dep2.existing === true;
    out.handleCount = sc.tokens.filter(t => t.actorId === vehicle.id && t.flags?.cyberpunk2020?.vehicleHandle).length;
    return out;
  }, { sceneId: scene.sceneId });

  console.log("Vehicle Phase 2 (corrected):", JSON.stringify(R));

  expect(R.visible, "handle token is visible (alpha > 0)").toBe(true);
  expect(R.handleFlag, "flagged as a vehicle handle").toBe(true);
  expect(R.linkedActor, "token linked to the vehicle actor").toBe(true);
  expect(R.belowCrew, "vehicle sorts below crew").toBe(true);
  expect(R.tileCount, "no orphan tile created").toBe(0);
  expect(R.footprintW, "initial footprint width").toBe(4);
  expect(R.resizedW, "token is resizable/scalable — width").toBe(6);
  expect(R.resizedH, "token is resizable/scalable — height").toBe(3);

  expect(R.tokenMoved, "the token committed its move").toBe(true);
  expect(R.crewFollowed, "boarded crew followed the move").toEqual(R.crewExpected);
  expect(R.disembarkedStaysPut, "disembarked crew does NOT follow").toBe(true);

  expect(R.redeployExisting, "redeploy reuses the existing token").toBe(true);
  expect(R.handleCount, "still exactly one vehicle handle token").toBe(1);
});
