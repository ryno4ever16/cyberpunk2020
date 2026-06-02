import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, setupSceneWithToken, waitForCanvasScene, cleanupTestData } from "../helpers/foundry.js";

/**
 * Explosion refinements: HEP concussion (Listen Up p.105), cover occlusion (Core p.108), and
 * grenade scatter on a miss (Core grenade table). Shared scene; each test sets its own toggles.
 * Scene grid is 100px = 2m.
 */

test.describe.configure({ mode: "serial" });

let gmCtx, gmPage, sceneId;

test.beforeAll(async ({ browser }) => {
  gmCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  gmPage = await gmCtx.newPage();
  await login(gmPage, ACCOUNTS.gm, { canvas: true });
  await cleanupTestData(gmPage).catch(() => {});
  const s = await setupSceneWithToken(gmPage, { activate: true, actorName: "__PW__BlastSeed" }); // far at (1000,1000)
  await waitForCanvasScene(gmPage, s.sceneId);
  sceneId = s.sceneId;
  await evalGameOrThrow(gmPage, async () => { await game.settings.set("cyberpunk2020", "explosivesEnabled", true); });
});

test.afterAll(async () => {
  if (gmPage) {
    await evalGameOrThrow(gmPage, async () => {
      await game.settings.set("cyberpunk2020", "explosivesDetailed", false); // restore Core default
      await game.settings.set("cyberpunk2020", "areaEffectOcclusion", true);
    }).catch(() => {});
    await cleanupTestData(gmPage).catch(() => {});
  }
  if (gmCtx) await gmCtx.close();
});

const dmg = (id) => evalGameOrThrow(gmPage, (i) => game.actors.get(i)?.system.damage ?? 0, id);
const waitFor = async (id, pred, ms = 10_000) => {
  const dl = Date.now() + ms;
  let v = await dmg(id);
  while (Date.now() < dl && !pred(v)) { await gmPage.waitForTimeout(200); v = await dmg(id); }
  return v;
};
const mkToken = (name, x, y, extra = {}) => evalGameOrThrow(gmPage, async (arg) => {
  const flags = { cyberpunk2020: { __pwtest: true } };
  const sc = game.scenes.get(arg.sceneId);
  const a = await Actor.create({ name: arg.name, type: "character", flags, system: { stats: { bt: { base: 2 } }, damage: 0 } });
  if (arg.extra.armor) {
    await a.createEmbeddedDocuments("Item", [{ name: arg.name + " Plate", type: "armor", flags,
      system: { equipped: true, armorType: "hard", coverage: { Torso: { stoppingPower: arg.extra.armor } } } }]);
  }
  const [t] = await sc.createEmbeddedDocuments("Token", [{ name: arg.name, x: arg.x, y: arg.y, actorId: a.id, actorLink: true, width: 1, height: 1, flags }]);
  return { actorId: a.id, tokenId: t.id };
}, { sceneId, name, x, y, extra });

test("HEP concussion ignores armor SP and applies half the damage as permanent HP", async () => {
  await evalGameOrThrow(gmPage, async () => { await game.settings.set("cyberpunk2020", "explosivesDetailed", true); });
  // Armored (hard SP 20) token AT the blast center. Core would stop a 20 hit cold; HEP ignores SP.
  const center = await mkToken("__PW__HEPCenter", 1500, 1500, { armor: 20 });
  await evalGameOrThrow(gmPage, async (arg) => {
    Hooks.callAll("cyberpunk2020.weaponFired", {
      attackerId: null, targetTokenId: arg.tokenId,
      areaDamages: { Torso: [{ damage: 20 }] }, effectTypes: ["Explosive"],
      blastRadius: 10, blastFullDamageWithin: 1, blastMultipliers: [0.5, 0.25, 0.125, 0.0625],
      weaponName: "__PW__HEPGrenade",
    });
  }, { tokenId: center.tokenId });

  const btn = gmPage.locator(".cp-confirm-explosion").first();
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();

  // SP 20 ignored → 20 − BTM0 = 20 → half permanent = 10.
  expect(await waitFor(center.actorId, (v) => v === 10), "HEP: armor ignored, half of 20 = 10 permanent HP").toBe(10);
});

test("cover: a token behind a wall is exempt from the blast", async () => {
  await evalGameOrThrow(gmPage, async () => {
    await game.settings.set("cyberpunk2020", "explosivesDetailed", false);
    await game.settings.set("cyberpunk2020", "areaEffectOcclusion", true);
  });
  const center     = await mkToken("__PW__CovCenter", 700, 700);   // blast center
  const exposed    = await mkToken("__PW__CovExposed", 1000, 700); // 6m east, no wall
  const shielded   = await mkToken("__PW__CovShielded", 700, 1000); // 6m south, behind a wall
  // Wall between center and the shielded token (crosses x=700 at y=850).
  await evalGameOrThrow(gmPage, async (arg) => {
    const sc = game.scenes.get(arg.sceneId);
    await sc.createEmbeddedDocuments("Wall", [{ c: [600, 850, 800, 850] }]);
    Hooks.callAll("cyberpunk2020.weaponFired", {
      attackerId: null, targetTokenId: arg.tokenId,
      areaDamages: { Torso: [{ damage: 20 }] }, effectTypes: ["Explosive"],
      blastRadius: 10, blastFullDamageWithin: 1, blastMultipliers: [0.5, 0.25, 0.125, 0.0625],
      weaponName: "__PW__CoverFrag",
    });
  }, { sceneId, tokenId: center.tokenId });

  const btn = gmPage.locator(".cp-confirm-explosion").first();
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();

  expect(await waitFor(exposed.actorId, (v) => v > 0), "exposed token is hit").toBeGreaterThan(0);
  await gmPage.waitForTimeout(1_500);
  expect(await dmg(shielded.actorId), "token behind a wall is exempt").toBe(0);
});

test("scatter: a missed grenade rolls a new center (Grenade Table)", async () => {
  await evalGameOrThrow(gmPage, async () => { await game.settings.set("cyberpunk2020", "explosivesDetailed", false); });
  const tgt = await mkToken("__PW__ScatterTgt", 1300, 600);
  const before = await evalGameOrThrow(gmPage, async (arg) => {
    Hooks.callAll("cyberpunk2020.weaponFired", {
      attackerId: null, targetTokenId: arg.tokenId,
      areaDamages: { Torso: [{ damage: 10 }] }, effectTypes: ["Explosive"],
      blastRadius: 8, weaponName: "__PW__ScatterNade",
    });
    return true;
  }, { tokenId: tgt.tokenId });

  const scatterBtn = gmPage.locator(".cp-confirm-explosion-scatter").first();
  await expect(scatterBtn, "scatter button posted").toBeVisible({ timeout: 15_000 });
  await scatterBtn.click();

  // The scatter result is announced in chat (1d10 direction + 1d10 m).
  const sawScatter = async () => evalGameOrThrow(gmPage, () =>
    game.messages.contents.some(m => (m.content || "").includes("Scatter")));
  const dl = Date.now() + 10_000;
  let seen = await sawScatter();
  while (Date.now() < dl && !seen) { await gmPage.waitForTimeout(200); seen = await sawScatter(); }
  expect(seen, "a scatter result was posted").toBe(true);
});
