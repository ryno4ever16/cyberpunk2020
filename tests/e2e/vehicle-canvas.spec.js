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

/**
 * Real multi-vehicle GM interactions the single-vehicle happy path never exercised:
 *   - deploy() refuses bad input (null / non-vehicle actor) instead of throwing,
 *   - with TWO vehicles on the scene, moving vehicle A drags ONLY A's boarded crew (not B's),
 *   - re-boarding crew from A to B switches allegiance: they follow B and no longer follow A.
 * These guard against the same class of bug as the original canvas failure: coupling that looks
 * right for one object but leaks or mis-targets once a second one exists.
 */
test("Phase 2: deploy guards + two-vehicle crew isolation + re-board switches allegiance", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  // The crew-follow coupling lives in the updateToken DOCUMENT hook, which fires on any scene
  // regardless of whether the canvas is drawn — so this test deliberately uses a NON-active scene
  // and drives token updates through the document API. That isolates the coupling logic and avoids
  // the flaky canvas-draw wait that a second activating test in this file would race on.
  const R = await evalGameOrThrow(page, async () => {
    const VC = await import("/systems/cyberpunk2020/module/vehicle/vehicle-canvas.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const sc = await Scene.create({
      name: "__PW__scene", width: 2000, height: 2000,
      grid: { type: 1, size: 100, distance: 2, units: "m" }, padding: 0, flags,
    });
    const srcX = (id) => sc.tokens.get(id)?._source?.x;          // committed (non-animated) x
    const pollX = async (id, want) => {
      const dl = Date.now() + 8000;
      while (Date.now() < dl && srcX(id) !== want) await new Promise(r => setTimeout(r, 150));
      return srcX(id);
    };
    const out = {};

    // --- deploy guards: bad input returns null, no throw ---
    out.deployNull = await VC.deployVehicleToScene(null);                       // null
    const charActor = await Actor.create({ name: "__PW__NotAVehicle", type: "character", flags });
    out.deployNonVehicle = await VC.deployVehicleToScene(charActor);            // null (wrong type)

    // --- two vehicles, two crew ---
    const vA = await Actor.create({ name: "__PW__VehA", type: "vehicle", flags, system: { sdp: { value: 50, max: 50 } } });
    const vB = await Actor.create({ name: "__PW__VehB", type: "vehicle", flags, system: { sdp: { value: 50, max: 50 } } });
    const depA = await VC.deployVehicleToScene(vA, { scene: sc, x: 200, y: 200, gw: 4, gh: 2 });
    const depB = await VC.deployVehicleToScene(vB, { scene: sc, x: 1000, y: 1000, gw: 4, gh: 2 });

    const crewActor = await Actor.create({ name: "__PW__C1", type: "character", flags });
    const crew2Actor = await Actor.create({ name: "__PW__C2", type: "character", flags });
    const [c1] = await sc.createEmbeddedDocuments("Token", [{ name: "__PW__C1", x: 220, y: 220, actorId: crewActor.id, actorLink: true, width: 1, height: 1, flags }]);
    const [c2] = await sc.createEmbeddedDocuments("Token", [{ name: "__PW__C2", x: 1020, y: 1020, actorId: crew2Actor.id, actorLink: true, width: 1, height: 1, flags }]);
    await VC.boardVehicle(c1, vA);   // c1 rides A
    await VC.boardVehicle(c2, vB);   // c2 rides B

    // Move A by +300. c1 (on A) should follow; c2 (on B) must NOT move.
    const c1Start = srcX(c1.id), c2Start = srcX(c2.id);
    await sc.tokens.get(depA.tokenId).update({ x: srcX(depA.tokenId) + 300 });
    out.c1Followed = await pollX(c1.id, c1Start + 300) === c1Start + 300;
    await new Promise(r => setTimeout(r, 600));                 // give any stray hook time to fire
    out.c2StayedOnAMove = srcX(c2.id) === c2Start;              // B's crew untouched by A's move

    // Re-board c1 from A to B, then move B by +200. c1 must now follow B...
    await VC.disembark(sc.tokens.get(c1.id));
    await VC.boardVehicle(sc.tokens.get(c1.id), vB);
    const c1AfterReboard = srcX(c1.id), c2BeforeBMove = srcX(c2.id);
    await sc.tokens.get(depB.tokenId).update({ x: srcX(depB.tokenId) + 200 });
    out.c1FollowsBNow = await pollX(c1.id, c1AfterReboard + 200) === c1AfterReboard + 200;
    out.c2AlsoFollowsB = await pollX(c2.id, c2BeforeBMove + 200) === c2BeforeBMove + 200;

    // ...and c1 must NO LONGER follow A.
    const c1Parked = srcX(c1.id);
    await sc.tokens.get(depA.tokenId).update({ x: srcX(depA.tokenId) + 150 });
    await new Promise(r => setTimeout(r, 1000));
    out.c1IgnoresOldVehicle = srcX(c1.id) === c1Parked;

    return out;
  });

  console.log("Vehicle multi:", JSON.stringify(R));

  expect(R.deployNull, "deploy(null) returns null, no throw").toBeNull();
  expect(R.deployNonVehicle, "deploy(non-vehicle) returns null").toBeNull();
  expect(R.c1Followed, "A's crew follows A").toBe(true);
  expect(R.c2StayedOnAMove, "B's crew does NOT move when A moves").toBe(true);
  expect(R.c1FollowsBNow, "re-boarded crew follows its new vehicle B").toBe(true);
  expect(R.c2AlsoFollowsB, "B's own crew still follows B").toBe(true);
  expect(R.c1IgnoresOldVehicle, "re-boarded crew no longer follows the old vehicle A").toBe(true);
});
