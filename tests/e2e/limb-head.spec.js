import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData, waitForCanvasScene } from "../helpers/foundry.js";

/**
 * QA §4 — Limb loss & head wounds (CP2020 p.103).
 *   > 8 net damage (after BTM) to an arm/leg  -> immediate Mortal 0 Death Save.
 *   > 8 net damage to the head                -> instant death (no save).
 *   Exactly 8 does NOT trigger. BTM can pull a hit under the threshold.
 *   Setting `limbLossEnabled` gates the whole feature.
 */

test.describe.configure({ mode: "serial" });

let gmCtx, gmPage;

test.beforeAll(async ({ browser }) => {
  gmCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  gmPage = await gmCtx.newPage();
  await login(gmPage, ACCOUNTS.gm);
  await cleanupTestData(gmPage).catch(() => {});
});

test.afterAll(async () => {
  if (gmPage) await cleanupTestData(gmPage).catch(() => {});
  if (gmCtx) await gmCtx.close();
});

test("§4 limb loss & head wound thresholds (>8 net, BTM prevention, disabled)", async () => {
  // Need a drawn canvas so head 'instant death' can toggle the dead status on a token.
  const sceneId = await evalGameOrThrow(gmPage, async () => {
    const scene = await Scene.create({
      name: "__PW__scene", width: 2000, height: 2000,
      grid: { type: 1, size: 100, distance: 2, units: "m" }, padding: 0,
      flags: { cyberpunk2020: { __pwtest: true } },
    });
    await scene.activate();
    return scene.id;
  });
  await waitForCanvasScene(gmPage, sceneId);

  const R = await evalGameOrThrow(gmPage, async (arg) => {
    const DA = await import("/systems/cyberpunk2020/module/combat/DamageApplicator.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const scene = game.scenes.get(arg.sceneId);

    let nx = 400;
    const makeWithToken = async (name, btBase) => {
      const a = await Actor.create({ name, type: "character", flags, system: { stats: { bt: { base: btBase } } } });
      const [tok] = await scene.createEmbeddedDocuments("Token", [{
        name, x: nx, y: 400, actorId: a.id, actorLink: true, width: 1, height: 1, flags,
      }]);
      nx += 200;
      return { a, tok };
    };
    const apply = (target, area, dmg) => DA.applyAreaDamages({
      target, areaDamages: { [area]: [{ damage: dmg }] },
      ap: false, armorMode: DA.ARMOR_MODES.NONE, ablate: false, dryRun: false,
    });
    const msgFor = (name, kw) => game.messages.contents.some(m =>
      (m.content || "").includes(name) && (m.content || "").includes(kw));

    const origLimb = game.settings.get("cyberpunk2020", "limbLossEnabled");
    const origHead = game.settings.get("cyberpunk2020", "headHitDoubling");
    await game.settings.set("cyberpunk2020", "limbLossEnabled", true);
    await game.settings.set("cyberpunk2020", "headHitDoubling", false); // keep net deterministic

    // 1) Limb > 8 net -> Limb Loss + death save. BTM 2; 11 - 2 = 9.
    const limbDeath = await makeWithToken("__PW__LimbDeath", 5);
    await apply(limbDeath.a, "rArm", 11);
    const out = {};
    out.limbDeathMsg = msgFor("__PW__LimbDeath", "Limb Loss");

    // 2) Limb exactly 8 -> no trigger. 10 - 2 = 8.
    const limbBorder = await makeWithToken("__PW__LimbBorder", 5);
    await apply(limbBorder.a, "rArm", 10);
    out.limbBorderMsg = msgFor("__PW__LimbBorder", "Limb Loss");

    // 3) Head > 8 net -> AUTOMATIC DEATH + dead status. 11 - 2 = 9.
    const headDeath = await makeWithToken("__PW__HeadDeath", 5);
    await apply(headDeath.a, "Head", 11);
    out.headDeathMsg = msgFor("__PW__HeadDeath", "AUTOMATIC DEATH");
    out.headDeadStatus = !!(game.actors.get(headDeath.a.id)?.statuses?.has?.("dead"));

    // 4) BTM saves the limb. BTM 3; 11 - 3 = 8 (not > 8).
    const btmSaved = await makeWithToken("__PW__BtmSaved", 9);
    await apply(btmSaved.a, "rArm", 11);
    out.btmSavedBtm = btmSaved.a.system.stats.bt.modifier;
    out.btmSavedMsg = msgFor("__PW__BtmSaved", "Limb Loss");

    // 5) Disabled -> no trigger even for a huge hit.
    await game.settings.set("cyberpunk2020", "limbLossEnabled", false);
    const disabled = await makeWithToken("__PW__LimbDisabled", 5);
    await apply(disabled.a, "rArm", 20);
    out.disabledMsg = msgFor("__PW__LimbDisabled", "Limb Loss");

    await game.settings.set("cyberpunk2020", "limbLossEnabled", origLimb);
    await game.settings.set("cyberpunk2020", "headHitDoubling", origHead);

    for (const s of [limbDeath, limbBorder, headDeath, btmSaved, disabled]) await s.a.delete().catch(() => {});
    return out;
  }, { sceneId });

  console.log("Limb/head:", JSON.stringify(R));

  expect(R.limbDeathMsg, "limb >8 net posts a Limb Loss death-save prompt").toBe(true);
  expect(R.limbBorderMsg, "exactly 8 net does NOT trigger limb loss").toBe(false);
  expect(R.headDeathMsg, "head >8 net posts AUTOMATIC DEATH").toBe(true);
  expect(R.headDeadStatus, "head >8 net toggles the dead status on the token").toBe(true);
  expect(R.btmSavedBtm, "BTM 3 actor").toBe(3);
  expect(R.btmSavedMsg, "BTM pulls the limb hit to 8 -> no trigger").toBe(false);
  expect(R.disabledMsg, "limbLossEnabled OFF -> no trigger").toBe(false);
});
