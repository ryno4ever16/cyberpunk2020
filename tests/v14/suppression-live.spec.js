import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * Dual-core suppression port: firing suppressive fire places a zone (MeasuredTemplate ray on v13,
 * Region polygon on v14), and the shim finds the token inside it. Run on BOTH rigs.
 * No targets set → the zone auto-aims East (+x); target is placed due-east, in range.
 */
test("suppression: fire zone created (right backend) + target inside", async ({ page }) => {
  await joinAsGM(page);

  const r = await page.evaluate(async () => {
    const out = {};
    const mod = await import("/systems/cyberpunk2020/module/combat/area-shapes.js");
    out.usesRegions = mod.usesRegions();
    const flags = { cyberpunk2020: { __pwtest: true } };

    await game.settings.set("cyberpunk2020", "suppressiveFireSaves", true);

    const scene = await Scene.create({
      name: "__PW__supp", width: 4000, height: 4000,
      grid: { type: 1, size: 100, distance: 2, units: "m" }, padding: 0, flags,
    });
    await scene.activate();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) { if (canvas?.ready && canvas?.scene?.id === scene.id) break; await new Promise((r) => setTimeout(r, 200)); }
    out.canvasReady = !!canvas?.ready && canvas?.scene?.id === scene.id;

    const atkActor = await Actor.create({ name: "__PW__atk", type: "character", flags });
    const tgtActor = await Actor.create({ name: "__PW__tgt", type: "character", flags });
    const [atkTok] = await scene.createEmbeddedDocuments("Token", [{ name: "atk", x: 950, y: 950, width: 1, height: 1, actorId: atkActor.id, actorLink: true, flags }]);
    const [tgtTok] = await scene.createEmbeddedDocuments("Token", [{ name: "tgt", x: 1250, y: 950, width: 1, height: 1, actorId: tgtActor.id, actorLink: true, flags }]); // centre (1300,1000): due-east, ~300px, in range
    await new Promise((r) => setTimeout(r, 300));

    Hooks.callAll("cyberpunk2020.suppressiveFire", {
      saveDC: 15, dmgFormula: "2d6", weaponName: "__PW__MG", actorId: atkActor.id,
      attackerTokenId: atkTok.id, zoneWidth: 2, weaponRange: 50,
    });
    await new Promise((r) => setTimeout(r, 900)); // async place + chat card

    const zones = mod.areasByFlag(scene, "isSuppressiveZone");
    out.zoneCount = zones.length;
    if (zones.length) {
      out.backendIsRegion = zones[0].isRegion;
      const inside = mod.tokensInArea(zones[0], scene.tokens.contents);
      out.targetInside = inside.some((t) => t.id === tgtTok.id);
    }
    out.confirmCardPosted = game.messages.contents.some((m) => (m.content || "").includes("Confirm Fire Zone"));

    // cleanup
    for (const z of zones) await mod.deleteArea(z);
    const msgIds = game.messages.contents.filter((m) => (m.content || "").includes("__PW__")).map((m) => m.id);
    if (msgIds.length) await ChatMessage.deleteDocuments(msgIds).catch(() => {});
    const other = game.scenes.find((s) => s.getFlag("cyberpunk2020", "__pwtest") !== true);
    if (other) await other.activate().catch(() => {});
    await scene.delete(); await atkActor.delete(); await tgtActor.delete();
    return out;
  });
  console.log("SUPPRESSION:", JSON.stringify(r, null, 2));

  expect(r.zoneCount, "a fire zone was created").toBeGreaterThan(0);
  expect(r.backendIsRegion, "zone backend matches this core").toBe(r.usesRegions);
  expect(r.targetInside, "target token is inside the fire zone").toBe(true);
  expect(r.confirmCardPosted, "Confirm Fire Zone card was posted").toBe(true);
});
