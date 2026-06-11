import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * Dual-core area-ray (shotgun spread) port: firing a weapon with spreadMode creates a ray pattern
 * (MeasuredTemplate ray on v13, Region polygon on v14); the shim finds tokens inside it.
 *
 * Note: the spread ray's LENGTH = the distance to the aimed target, so the target sits at the ray's
 * far TIP — a geometric boundary that contains()/testPoint() excludes on BOTH cores (pre-existing,
 * parity-consistent behaviour). So we assert containment on a MID-ray victim, which is the correct
 * test of the port; the target-at-tip membership is captured informationally only.
 */
test("spread zone: placed (right backend) + mid-ray victim inside", async ({ page }) => {
  await joinAsGM(page);

  const r = await page.evaluate(async () => {
    const out = {};
    const mod = await import("/systems/cyberpunk2020/module/combat/area-shapes.js");
    out.usesRegions = mod.usesRegions();
    const flags = { cyberpunk2020: { __pwtest: true } };

    await game.settings.set("cyberpunk2020", "shotgunSpreadEnabled", true);

    const scene = await Scene.create({
      name: "__PW__spread", width: 4000, height: 4000,
      grid: { type: 1, size: 100, distance: 2, units: "m" }, padding: 0, flags,
    });
    await scene.activate();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) { if (canvas?.ready && canvas?.scene?.id === scene.id) break; await new Promise((r) => setTimeout(r, 200)); }
    out.canvasReady = !!canvas?.ready && canvas?.scene?.id === scene.id;

    const atkActor = await Actor.create({ name: "__PW__spreadatk", type: "character", flags });
    const tgtActor = await Actor.create({ name: "__PW__spreadtgt", type: "character", flags });
    const vicActor = await Actor.create({ name: "__PW__spreadvic", type: "character", flags });

    // Attacker at (950,950) → centre (1000,1000).
    const [atkTok] = await scene.createEmbeddedDocuments("Token", [{ name: "atk", x: 950, y: 950, width: 1, height: 1, actorId: atkActor.id, actorLink: true, flags }]);
    // Aim target at (1250,950) → centre (1300,1000): due-east ~300px = 6m. Ray auto-aims East; its
    // length = distance to target, so the target ends up at the far tip (boundary).
    const [tgtTok] = await scene.createEmbeddedDocuments("Token", [{ name: "tgt", x: 1250, y: 950, width: 1, height: 1, actorId: tgtActor.id, actorLink: true, flags }]);
    // Victim MID-ray at (1100,950) → centre (1150,1000): 3m east, on the axis, well inside the ray.
    const [vicTok] = await scene.createEmbeddedDocuments("Token", [{ name: "vic", x: 1100, y: 950, width: 1, height: 1, actorId: vicActor.id, actorLink: true, flags }]);
    await new Promise((r) => setTimeout(r, 300));

    Hooks.callAll("cyberpunk2020.weaponFired", {
      spreadMode: "wide",
      attackerId: atkActor.id,
      targetTokenId: tgtTok.id,
      spreadWidthMedium: 2,
      spreadDamageMedium: "3d6",
      weaponName: "__PW__Shotgun",
    });
    await new Promise((r) => setTimeout(r, 900));

    const zones = mod.areasByFlag(scene, "isSpreadZone");
    out.zoneCount = zones.length;
    if (zones.length) {
      out.backendIsRegion = zones[0].isRegion;
      const inside = mod.tokensInArea(zones[0], scene.tokens.contents);
      out.victimInside = inside.some((t) => t.id === vicTok.id);     // mid-ray → must be inside
      out.targetAtTip = inside.some((t) => t.id === tgtTok.id);      // informational (boundary)
    }
    out.confirmCardPosted = game.messages.contents.some((m) => (m.content || "").includes("Confirm Spread Pattern"));

    for (const z of zones) await mod.deleteArea(z);
    const msgIds = game.messages.contents.filter((m) => (m.content || "").includes("__PW__Shotgun")).map((m) => m.id);
    if (msgIds.length) await ChatMessage.deleteDocuments(msgIds).catch(() => {});
    const other = game.scenes.find((s) => s.getFlag("cyberpunk2020", "__pwtest") !== true);
    if (other) await other.activate().catch(() => {});
    await scene.delete(); await atkActor.delete(); await tgtActor.delete(); await vicActor.delete();
    return out;
  });
  console.log("SPREAD ZONE:", JSON.stringify(r, null, 2));

  expect(r.zoneCount, "a spread zone was created").toBeGreaterThan(0);
  expect(r.backendIsRegion, "spread zone backend matches this core").toBe(r.usesRegions);
  expect(r.victimInside, "mid-ray victim is inside the spread pattern").toBe(true);
  expect(r.confirmCardPosted, "Confirm Spread Pattern card was posted").toBe(true);
});
