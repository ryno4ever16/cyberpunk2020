import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Auto-rangefinder regression: Foundry v13 REMOVED `canvas.grid.measureDistances`, which crashed
 * the rangefinder ("measureDistances is not a function") on a fresh v13 world. measureTokenDistance /
 * gridDistanceBetween now use the v12+/v13 `canvas.grid.measurePath` API. This places two tokens a
 * known number of squares apart on a live canvas and confirms a finite, correct distance (no throw).
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("measureTokenDistance returns a finite grid distance on v13 (no measureDistances crash)", async ({ page }) => {
  await login(page, ACCOUNTS.gm, { canvas: true });
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    // 100px squares, 2m per square.
    const scene = await Scene.create({
      name: "__PW__rfscene", width: 2000, height: 2000,
      grid: { type: 1, size: 100, distance: 2, units: "m" }, padding: 0,
      flags: { cyberpunk2020: { __pwtest: true } }
    });
    await scene.activate();
    let dl = Date.now() + 30000;
    while (Date.now() < dl) { if (canvas?.ready && canvas?.scene?.id === scene.id) break; await new Promise(r => setTimeout(r, 200)); }

    const a1 = await Actor.create({ name: "__PW__rfA", type: "character", flags: { cyberpunk2020: { __pwtest: true } } });
    const a2 = await Actor.create({ name: "__PW__rfB", type: "character", flags: { cyberpunk2020: { __pwtest: true } } });
    // 4 squares apart vertically (y 1000 -> 1400 = 400px = 4 squares = 8m).
    const [td1] = await scene.createEmbeddedDocuments("Token", [{ name: a1.name, x: 1000, y: 1000, actorId: a1.id, actorLink: true, width: 1, height: 1, flags: { cyberpunk2020: { __pwtest: true } } }]);
    const [td2] = await scene.createEmbeddedDocuments("Token", [{ name: a2.name, x: 1000, y: 1400, actorId: a2.id, actorLink: true, width: 1, height: 1, flags: { cyberpunk2020: { __pwtest: true } } }]);

    dl = Date.now() + 10000; let t1 = null, t2 = null;
    while (Date.now() < dl) { t1 = canvas.tokens.get(td1.id); t2 = canvas.tokens.get(td2.id); if (t1 && t2) break; await new Promise(r => setTimeout(r, 150)); }

    const rf = await import("/systems/cyberpunk2020/module/combat/rangefinding.js");
    let threw = false, dist = null, errMsg = null, pathDist = null;
    try { dist = rf.measureTokenDistance(t1, t2); } catch (e) { threw = true; errMsg = String(e?.message ?? e); }
    try { pathDist = rf.gridDistanceBetween(t1.center, t2.center); } catch (e) { pathDist = "THREW:" + (e?.message ?? e); }

    return {
      threw, errMsg, dist, pathDist,
      hasMeasurePath: typeof canvas.grid.measurePath === "function",
      hasOldApi: typeof canvas.grid.measureDistances === "function",
      gridDistance: canvas.scene.grid.distance, gridSize: canvas.scene.grid.size
    };
  });

  console.log("Rangefinder:", JSON.stringify(R));
  expect(R.threw, `measureTokenDistance must not throw (was: ${R.errMsg})`).toBe(false);
  expect(Number.isFinite(R.dist), "distance is a finite number").toBe(true);
  expect(R.dist, "4 squares × 2m = 8m (orthogonal, no diagonal)").toBeCloseTo(8, 1);
  expect(R.pathDist, "gridDistanceBetween matches").toBeCloseTo(8, 1);
  expect(R.hasMeasurePath, "v13 exposes grid.measurePath").toBe(true);
});
