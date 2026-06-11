import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * Dual-core gas/chemical-cloud port: firing a Gas-effect weapon places a persistent cloud
 * (MeasuredTemplate circle on v13, Region ellipse on v14); the shim finds tokens inside it for
 * per-turn Stun saves. Run on BOTH rigs. Cloud is placed at the attacker token (no target id).
 */
test("gas cloud: placed (right backend) + token inside", async ({ page }) => {
  await joinAsGM(page);

  const r = await page.evaluate(async () => {
    const out = {};
    const mod = await import("/systems/cyberpunk2020/module/combat/area-shapes.js");
    out.usesRegions = mod.usesRegions();
    const flags = { cyberpunk2020: { __pwtest: true } };

    await game.settings.set("cyberpunk2020", "gasGrenadeCloudEnabled", true);

    const scene = await Scene.create({
      name: "__PW__gas", width: 4000, height: 4000,
      grid: { type: 1, size: 100, distance: 2, units: "m" }, padding: 0, flags,
    });
    await scene.activate();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) { if (canvas?.ready && canvas?.scene?.id === scene.id) break; await new Promise((r) => setTimeout(r, 200)); }
    out.canvasReady = !!canvas?.ready && canvas?.scene?.id === scene.id;

    const atkActor = await Actor.create({ name: "__PW__gasatk", type: "character", flags });
    const vicActor = await Actor.create({ name: "__PW__gasvic", type: "character", flags });
    const [atkTok] = await scene.createEmbeddedDocuments("Token", [{ name: "atk", x: 950, y: 950, width: 1, height: 1, actorId: atkActor.id, actorLink: true, flags }]); // centre (1000,1000)
    const [vicTok] = await scene.createEmbeddedDocuments("Token", [{ name: "vic", x: 1050, y: 950, width: 1, height: 1, actorId: vicActor.id, actorLink: true, flags }]); // centre (1100,1000): ~100px, in 5m(=250px) radius
    await new Promise((r) => setTimeout(r, 300));

    // No targetTokenId → cloud is placed at the attacker's token (resolved by actorId).
    Hooks.callAll("cyberpunk2020.weaponFired", {
      effectTypes: ["Gas"], attackerId: atkActor.id, blastRadius: 5, dotTurns: 3,
      stunSaveMod: -2, weaponName: "__PW__Gas",
    });
    await new Promise((r) => setTimeout(r, 900));

    const clouds = mod.areasByFlag(scene, "isGasCloud");
    out.cloudCount = clouds.length;
    if (clouds.length) {
      out.backendIsRegion = clouds[0].isRegion;
      const inside = mod.tokensInArea(clouds[0], scene.tokens.contents);
      out.victimInside = inside.some((t) => t.id === vicTok.id);
    }
    out.gasCardPosted = game.messages.contents.some((m) => (m.content || "").includes("Gas Cloud"));

    for (const c of clouds) await mod.deleteArea(c);
    const msgIds = game.messages.contents.filter((m) => (m.content || "").includes("__PW__Gas")).map((m) => m.id);
    if (msgIds.length) await ChatMessage.deleteDocuments(msgIds).catch(() => {});
    const other = game.scenes.find((s) => s.getFlag("cyberpunk2020", "__pwtest") !== true);
    if (other) await other.activate().catch(() => {});
    await scene.delete(); await atkActor.delete(); await vicActor.delete();
    return out;
  });
  console.log("GAS CLOUD:", JSON.stringify(r, null, 2));

  expect(r.cloudCount, "a gas cloud was created").toBeGreaterThan(0);
  expect(r.backendIsRegion, "cloud backend matches this core").toBe(r.usesRegions);
  expect(r.victimInside, "victim token is inside the cloud").toBe(true);
  expect(r.gasCardPosted, "Gas Cloud card posted").toBe(true);
});
