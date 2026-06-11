import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * Dual-core validation of the area-shapes shim against a LIVE rig. Run on BOTH:
 *   v14 (:30002) → expect a Region backend; v13 (:30003) → expect a MeasuredTemplate backend.
 * Same spec, self-validating: asserts the chosen backend matches the core's feature-detect, and
 * that token-in-area resolves correctly on whichever backend this core uses.
 */
test("area-shapes: createArea + tokensInArea on this core", async ({ page }) => {
  await joinAsGM(page);

  const r = await page.evaluate(async () => {
    const mod = await import("/systems/cyberpunk2020/module/combat/area-shapes.js");
    const out = {
      foundry: game.version ?? game.release?.version,
      usesRegions: mod.usesRegions(),
      supportsMT: mod.supportsMeasuredTemplates(),
      regionsSupported: mod.regionsSupported(),
    };
    const flags = { cyberpunk2020: { __pwtest: true } };
    const scene = await Scene.create({
      name: "__PW__as_scene", width: 3000, height: 3000,
      grid: { type: 1, size: 100, distance: 2, units: "m" }, padding: 0, flags,
    });
    // Activate + wait for canvas (the v13 template path needs the placeable's shape).
    await scene.activate();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (canvas?.ready && canvas?.scene?.id === scene.id) break;
      await new Promise((res) => setTimeout(res, 200));
    }
    out.canvasReady = !!canvas?.ready && canvas?.scene?.id === scene.id;

    const actor = await Actor.create({ name: "__PW__as_actor", type: "character", flags });
    // 1x1 token at doc (950,950) → centre (1000,1000); far token centre ~ (100,100)
    const [tok]  = await scene.createEmbeddedDocuments("Token", [{ name: "near", x: 950, y: 950, width: 1, height: 1, actorId: actor.id, actorLink: true, flags }]);
    const [tok2] = await scene.createEmbeddedDocuments("Token", [{ name: "far",  x: 50,  y: 50,  width: 1, height: 1, actorId: actor.id, flags }]);

    const handle = await mod.createArea(scene, { kind: "circle", x: 1000, y: 1000, radiusM: 5, color: "#88ff44", flags: { __pwtest: true } });
    out.handleType = handle?.type ?? null;
    out.isRegion  = handle?.isRegion ?? null;
    await new Promise((res) => setTimeout(res, 400)); // let the placeable/region settle

    const inside = mod.tokensInArea(handle, scene.tokens.contents);
    out.insideCount   = inside.length;
    out.nearInside    = inside.some((t) => t.id === tok.id);
    out.farExcluded   = !inside.some((t) => t.id === tok2.id);
    out.foundByFlag   = mod.areasByFlag(scene, "__pwtest").length;

    await mod.deleteArea(handle);
    const other = game.scenes.find((s) => s.getFlag("cyberpunk2020", "__pwtest") !== true);
    if (other) await other.activate().catch(() => {});
    await scene.delete(); await actor.delete();
    return out;
  });
  console.log("AREA-SHAPES LIVE:", JSON.stringify(r, null, 2));

  expect(r.handleType, "a backend doc was created").toBeTruthy();
  expect(r.isRegion, "backend matches this core's feature-detect").toBe(r.usesRegions);
  expect(r.foundByFlag, "areasByFlag finds the created area").toBeGreaterThan(0);
  expect(r.nearInside, "token at area centre is inside").toBe(true);
  expect(r.farExcluded, "distant token is excluded").toBe(true);
});
