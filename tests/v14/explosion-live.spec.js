import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * Dual-core explosion port: firing an Explosive-effect weapon places a blast circle
 * (MeasuredTemplate circle on v13, Region ellipse on v14); the shim finds tokens inside it
 * for range-banded damage. Run on BOTH rigs.
 * Blast centre is the target token position (targetTokenId supplied); a victim token is placed
 * inside the blast radius so tokensInArea must find it.
 */
test("explosion: placed (right backend) + token inside blast", async ({ page }) => {
  await joinAsGM(page);

  const r = await page.evaluate(async () => {
    const out = {};
    const mod = await import("/systems/cyberpunk2020/module/combat/area-shapes.js");
    out.usesRegions = mod.usesRegions();
    const flags = { cyberpunk2020: { __pwtest: true } };

    await game.settings.set("cyberpunk2020", "explosivesEnabled", true);

    const scene = await Scene.create({
      name: "__PW__explosion", width: 4000, height: 4000,
      grid: { type: 1, size: 100, distance: 2, units: "m" }, padding: 0, flags,
    });
    await scene.activate();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) { if (canvas?.ready && canvas?.scene?.id === scene.id) break; await new Promise((r) => setTimeout(r, 200)); }
    out.canvasReady = !!canvas?.ready && canvas?.scene?.id === scene.id;

    const atkActor = await Actor.create({ name: "__PW__expatkr", type: "character", flags });
    const tgtActor = await Actor.create({ name: "__PW__exptgt", type: "character", flags });
    const vicActor = await Actor.create({ name: "__PW__expvic", type: "character", flags });

    // Attacker at (950,950) → centre (1000,1000)
    const [atkTok] = await scene.createEmbeddedDocuments("Token", [{ name: "atk", x: 950, y: 950, width: 1, height: 1, actorId: atkActor.id, actorLink: true, flags }]);
    // Target at (1050,950) → centre (1100,1000) — this becomes the blast centre
    const [tgtTok] = await scene.createEmbeddedDocuments("Token", [{ name: "tgt", x: 1050, y: 950, width: 1, height: 1, actorId: tgtActor.id, actorLink: true, flags }]);
    // Victim at (1150,950) → centre (1200,1000) — 100px from blast centre (1100,1000);
    // blast radius 5m = 250px on 100px/2m grid → well inside the blast
    const [vicTok] = await scene.createEmbeddedDocuments("Token", [{ name: "vic", x: 1150, y: 950, width: 1, height: 1, actorId: vicActor.id, actorLink: true, flags }]);
    await new Promise((r) => setTimeout(r, 300));

    // Fire the weaponFired hook with an Explosive payload.
    // baseDamage is computed from areaDamages; blastRadius must be > 0.
    Hooks.callAll("cyberpunk2020.weaponFired", {
      effectTypes: ["Explosive"],
      attackerId: atkActor.id,
      targetTokenId: tgtTok.id,
      areaDamages: { torso: [{ damage: 20 }] },
      blastRadius: 5,
      blastFullDamageWithin: 2,
      blastMultipliers: [0.5, 0.25, 0.125, 0.0625],
      weaponName: "__PW__Grenade",
    });
    await new Promise((r) => setTimeout(r, 900));

    const blasts = mod.areasByFlag(scene, "isExplosion");
    out.blastCount = blasts.length;
    if (blasts.length) {
      out.backendIsRegion = blasts[0].isRegion;
      const inside = mod.tokensInArea(blasts[0], scene.tokens.contents);
      out.victimInside = inside.some((t) => t.id === vicTok.id);
      // Confirm originX/originY are stored so _confirmExplosion can compute falloff.
      const f = blasts[0].doc.flags?.cyberpunk2020;
      out.hasOrigin = (f?.originX != null) && (f?.originY != null);
    }
    out.blastCardPosted = game.messages.contents.some((m) => (m.content || "").includes("Confirm Blast"));

    // cleanup
    for (const b of blasts) await mod.deleteArea(b);
    const msgIds = game.messages.contents.filter((m) => (m.content || "").includes("__PW__Grenade")).map((m) => m.id);
    if (msgIds.length) await ChatMessage.deleteDocuments(msgIds).catch(() => {});
    const other = game.scenes.find((s) => s.getFlag("cyberpunk2020", "__pwtest") !== true);
    if (other) await other.activate().catch(() => {});
    await scene.delete(); await atkActor.delete(); await tgtActor.delete(); await vicActor.delete();
    return out;
  });
  console.log("EXPLOSION:", JSON.stringify(r, null, 2));

  expect(r.blastCount, "a blast area was created").toBeGreaterThan(0);
  expect(r.backendIsRegion, "blast backend matches this core").toBe(r.usesRegions);
  expect(r.victimInside, "victim token is inside the blast").toBe(true);
  expect(r.hasOrigin, "originX/originY stored in flags for falloff").toBe(true);
  expect(r.blastCardPosted, "Confirm Blast card was posted").toBe(true);
});
