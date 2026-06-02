import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, setupSceneWithToken, waitForCanvasScene, cleanupTestData } from "../helpers/foundry.js";

/**
 * C2 — Explosions & grenades (CP2020 p.108).
 *
 * Firing Explosive ammo emits weaponFired; _hookExplosion lays a circle at the target and posts a
 * "Confirm Blast" button. Confirming damages every token in the blast with range-banded falloff
 * outward from the center (blastMultipliers): full damage within blastFullDamageWithin, less beyond.
 *
 * Scene grid is 100px = 2m. Base blast damage 20, radius 10m, full-damage core 1m. A token at the
 * center takes the full 20; a token 6m out takes a reduced amount; the attacker (well outside) none.
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("C2 explosion: blast damages tokens with distance falloff, spares the distant shooter", async ({ page }) => {
  await login(page, ACCOUNTS.gm, { canvas: true });
  await cleanupTestData(page).catch(() => {});
  const scene = await setupSceneWithToken(page, { activate: true, actorName: "__PW__Grenadier" }); // attacker at (1000,1000)
  await waitForCanvasScene(page, scene.sceneId);

  const ids = await evalGameOrThrow(page, async (arg) => {
    await game.settings.set("cyberpunk2020", "explosivesEnabled", true);
    const flags = { cyberpunk2020: { __pwtest: true } };
    const sc = game.scenes.get(arg.sceneId);
    const mk = async (name, x, y) => {
      const a = await Actor.create({ name, type: "character", flags, system: { stats: { bt: { base: 2 } }, damage: 0 } });
      const [t] = await sc.createEmbeddedDocuments("Token", [{ name, x, y, actorId: a.id, actorLink: true, width: 1, height: 1, flags }]);
      return { actorId: a.id, tokenId: t.id };
    };
    // Blast far from the attacker (1000,1000): center (1500,1500), edge 6m south of center.
    const center = await mk("__PW__BlastCenter", 1500, 1500); // at the blast center → full damage
    const edge   = await mk("__PW__BlastEdge", 1500, 1800);   // 300px = 6m from center → falloff

    Hooks.callAll("cyberpunk2020.weaponFired", {
      attackerId:            arg.actorId,
      targetTokenId:         center.tokenId,
      areaDamages:           { Torso: [{ damage: 20 }] }, // base blast damage
      effectTypes:           ["Explosive"],
      blastRadius:           10,
      blastFullDamageWithin: 1,
      blastMultipliers:      [0.5, 0.25, 0.125, 0.0625],
      weaponName:            "__PW__Frag",
    });
    return { attackerActorId: arg.actorId, centerId: center.actorId, edgeId: edge.actorId };
  }, scene);

  const btn = page.locator(".cp-confirm-explosion").first();
  await expect(btn, "blast confirm button posted").toBeVisible({ timeout: 15_000 });
  await btn.click();

  const dmg = (id) => evalGameOrThrow(page, (i) => game.actors.get(i)?.system.damage ?? 0, id);
  const waitFor = async (id, pred, ms = 10_000) => {
    const dl = Date.now() + ms;
    let v = await dmg(id);
    while (Date.now() < dl && !pred(v)) { await page.waitForTimeout(200); v = await dmg(id); }
    return v;
  };

  const center = await waitFor(ids.centerId, (v) => v > 0);
  const edge   = await waitFor(ids.edgeId, (v) => v > 0);

  expect(center, "token at the blast center takes the full base damage").toBe(20);
  expect(edge, "token 6m out takes reduced (falloff) damage").toBeGreaterThan(0);
  expect(edge, "falloff: edge < center").toBeLessThan(center);
  expect(await dmg(ids.attackerActorId), "attacker is outside the 10m blast").toBe(0);
});
