import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, setupSceneWithToken, waitForCanvasScene, cleanupTestData } from "../helpers/foundry.js";

/**
 * Vehicle — Phase 2: Idea-A canvas representation.
 * Deploying a vehicle creates a scalable art Tile locked over an invisible handle Token (the
 * combat object), linked both ways. The Tile is the control surface: moving it drags the handle
 * token + any boarded crew by the same delta; resizing it resizes the token footprint.
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("Phase 2: deploy links tile+token; moving the tile drags the token & boarded crew; resize syncs footprint", async ({ page }) => {
  await login(page, ACCOUNTS.gm, { canvas: true });
  await cleanupTestData(page).catch(() => {});
  const scene = await setupSceneWithToken(page, { activate: true, actorName: "__PW__SceneSeed" });
  await waitForCanvasScene(page, scene.sceneId);

  const R = await evalGameOrThrow(page, async (arg) => {
    const VC = await import("/systems/cyberpunk2020/module/vehicle/vehicle-canvas.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const sc = game.scenes.get(arg.sceneId);

    const vehicle = await Actor.create({ name: "__PW__DeployTank", type: "vehicle", flags, system: { sdp: { value: 100, max: 100 } } });
    const dep = await VC.deployVehicleToScene(vehicle, { x: 500, y: 500, gw: 4, gh: 2 });

    let token = sc.tokens.get(dep.tokenId);
    const tile = sc.tiles.get(dep.tileId);
    const out = {
      tokenHandle:   token?.flags?.cyberpunk2020?.vehicleHandle === true,
      tokenTileLink: token?.flags?.cyberpunk2020?.vehicleTileId === dep.tileId,
      tileTokenLink: tile?.flags?.cyberpunk2020?.vehicleTokenId === dep.tokenId,
      aligned:       token?.x === tile?.x && token?.y === tile?.y,
      tokenAlpha:    token?.alpha,
    };

    // A crew member boards the vehicle.
    const crewActor = await Actor.create({ name: "__PW__Crew", type: "character", flags, system: { stats: { bt: { base: 2 } } } });
    const [crew] = await sc.createEmbeddedDocuments("Token", [{ name: "__PW__Crew", x: 520, y: 520, actorId: crewActor.id, actorLink: true, width: 1, height: 1, flags }]);
    await VC.boardVehicle(crew, vehicle);

    // Move the tile (+300, +200) → handle token + crew follow (activeGM coupling hook).
    const t0 = { tokenX: token.x, tokenY: token.y, crewX: crew.x, crewY: crew.y };
    await tile.update({ x: tile.x + 300, y: tile.y + 200 });
    const dl = Date.now() + 8000;
    let tok = sc.tokens.get(dep.tokenId), cr = sc.tokens.get(crew.id);
    while (Date.now() < dl && !(tok.x === t0.tokenX + 300 && cr.x === t0.crewX + 300)) {
      await new Promise(r => setTimeout(r, 150));
      tok = sc.tokens.get(dep.tokenId); cr = sc.tokens.get(crew.id);
    }
    out.tokenMoved = { x: tok.x, y: tok.y }; out.expToken = { x: t0.tokenX + 300, y: t0.tokenY + 200 };
    out.crewMoved  = { x: cr.x, y: cr.y };   out.expCrew  = { x: t0.crewX + 300, y: t0.crewY + 200 };

    // Resize the tile → token footprint (grid units) follows.
    const gridSize = sc.grid?.size ?? 100;
    await tile.update({ width: 6 * gridSize, height: 3 * gridSize });
    const dl2 = Date.now() + 8000;
    let tok2 = sc.tokens.get(dep.tokenId);
    while (Date.now() < dl2 && tok2.width !== 6) { await new Promise(r => setTimeout(r, 150)); tok2 = sc.tokens.get(dep.tokenId); }
    out.tokenW = tok2.width; out.tokenH = tok2.height;

    return out;
  }, { sceneId: scene.sceneId });

  console.log("Vehicle Phase 2:", JSON.stringify(R));

  expect(R.tokenHandle, "handle token flagged").toBe(true);
  expect(R.tokenTileLink, "token → tile link").toBe(true);
  expect(R.tileTokenLink, "tile → token link").toBe(true);
  expect(R.aligned, "tile and token share a top-left").toBe(true);
  expect(R.tokenAlpha, "handle token is invisible").toBe(0);

  expect(R.tokenMoved, "handle token followed the tile").toEqual(R.expToken);
  expect(R.crewMoved, "boarded crew followed the tile").toEqual(R.expCrew);

  expect(R.tokenW, "tile resize → token width 6").toBe(6);
  expect(R.tokenH, "tile resize → token height 3").toBe(3);
});
