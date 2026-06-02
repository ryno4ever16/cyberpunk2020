import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, setupSceneWithToken, waitForCanvasScene, cleanupTestData } from "../helpers/foundry.js";

/**
 * C1 — Shotgun / flechette spread (CP2020 p.108).
 *
 * Firing buckshot (spreadMode != "single") emits weaponFired; _hookSpread lays a ray from the
 * attacker toward the target (width by range band) and posts a "Confirm Spread Pattern" button.
 * Confirming damages every token in the straight path (not the shooter) — no evasion.
 *
 * Scene grid is 100px = 2m (setupSceneWithToken). Targets are unarmored BT 2 (BTM 0) and the
 * spread damage is forced to a flat "6" so each in-path hit lands as a clean 6.
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("C1 spread: buckshot hits every token in the pattern, not the shooter", async ({ page }) => {
  await login(page, ACCOUNTS.gm, { canvas: true });
  await cleanupTestData(page).catch(() => {});
  const scene = await setupSceneWithToken(page, { activate: true, actorName: "__PW__Shooter" }); // attacker at (1000,1000)
  await waitForCanvasScene(page, scene.sceneId);

  const ids = await evalGameOrThrow(page, async (arg) => {
    await game.settings.set("cyberpunk2020", "shotgunSpreadEnabled", true);
    const flags = { cyberpunk2020: { __pwtest: true } };
    const sc = game.scenes.get(arg.sceneId);
    const mk = async (name, x, y) => {
      const a = await Actor.create({ name, type: "character", flags, system: { stats: { bt: { base: 2 } }, damage: 0 } });
      const [t] = await sc.createEmbeddedDocuments("Token", [{ name, x, y, actorId: a.id, actorLink: true, width: 1, height: 1, flags }]);
      return { actorId: a.id, tokenId: t.id };
    };
    // East line from the attacker. 100px = 2m, so width 4m = 200px (±100px), length 12m = 600px.
    const aim = await mk("__PW__SpreadAim", 1600, 1000); // 12m → Medium band (aim target, at the ray end)
    const v1  = await mk("__PW__SpreadV1", 1200, 1000);  // 4m along — clearly inside
    const v2  = await mk("__PW__SpreadV2", 1400, 1000);  // 8m along — clearly inside

    Hooks.callAll("cyberpunk2020.weaponFired", {
      attackerId:        arg.actorId,
      targetTokenId:     aim.tokenId,
      areaDamages:       { Torso: [{ damage: 6 }] }, // ignored by spread (it rolls its own)
      spreadMode:        "buckshot",
      spreadWidthShort:  4, spreadWidthMedium: 4, spreadWidthLong: 4,
      spreadDamageShort: "6", spreadDamageMedium: "6", spreadDamageLong: "6",
      weaponName:        "__PW__Boomstick",
    });
    return { attackerActorId: arg.actorId, v1: v1.actorId, v2: v2.actorId };
  }, scene);

  const btn = page.locator(".cp-confirm-spread-zone").first();
  await expect(btn, "spread confirm button posted").toBeVisible({ timeout: 15_000 });
  await btn.click();

  const dmg = (id) => evalGameOrThrow(page, (i) => game.actors.get(i)?.system.damage ?? 0, id);
  const waitFor = async (id, pred, ms = 10_000) => {
    const dl = Date.now() + ms;
    let v = await dmg(id);
    while (Date.now() < dl && !pred(v)) { await page.waitForTimeout(200); v = await dmg(id); }
    return v;
  };

  expect(await waitFor(ids.v1, (v) => v === 6), "victim 1 in the path took the spread (6)").toBe(6);
  expect(await waitFor(ids.v2, (v) => v === 6), "victim 2 in the path took the spread (6)").toBe(6);
  expect(await dmg(ids.attackerActorId), "the shooter is never in their own pattern").toBe(0);
});
