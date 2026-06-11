import { test, expect } from "@playwright/test";
import { loginRig, evalGameOrThrow, cleanupTestData } from "./rig-e2e-helpers.js";

/**
 * Rig-portable port of tests/e2e/layering.spec.js — identical body; login swapped to the rig (loginRig).
 */

test.describe.configure({ mode: "serial" });

let gmCtx, gmPage;

test.beforeAll(async ({ browser }) => {
  gmCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  gmPage = await gmCtx.newPage();
  await loginRig(gmPage);
  await cleanupTestData(gmPage).catch(() => {});
});

test.afterAll(async () => {
  if (gmPage) await cleanupTestData(gmPage).catch(() => {});
  if (gmCtx) await gmCtx.close();
});

test("§14 Core layering: 2nd layer +1 EV, 3rd +2 more; setting OFF removes it", async () => {
  const R = await evalGameOrThrow(gmPage, async () => {
    const flags = { cyberpunk2020: { __pwtest: true } };
    const origApply = game.settings.get("cyberpunk2020", "applyLayerEVPenalty");
    const origSystem = game.settings.get("cyberpunk2020", "layerRuleSystem");
    await game.settings.set("cyberpunk2020", "applyLayerEVPenalty", true);
    await game.settings.set("cyberpunk2020", "layerRuleSystem", "Core");

    // REF base 5, no wounds. Zero-encumbrance Torso armor pieces.
    const a = await Actor.create({ name: "__PW__Layered", type: "character", flags, system: { stats: { ref: { base: 5 } } } });
    const baseRef = a.system.stats.ref.total;

    const addLayer = async (n) => {
      await a.createEmbeddedDocuments("Item", [{
        name: `__PW__Layer${n}`, type: "armor",
        system: { equipped: true, armorType: "soft", encumbrance: 0, coverage: { Torso: { stoppingPower: 5 } } },
      }]);
      return { ev: a.system.layerEVPenalty, ref: a.system.stats.ref.total };
    };

    const one = await addLayer(1);
    const two = await addLayer(2);
    const three = await addLayer(3);

    await game.settings.set("cyberpunk2020", "applyLayerEVPenalty", false);
    a.prepareData();
    const off = { ev: a.system.layerEVPenalty, ref: a.system.stats.ref.total };

    await game.settings.set("cyberpunk2020", "applyLayerEVPenalty", origApply);
    await game.settings.set("cyberpunk2020", "layerRuleSystem", origSystem);
    await a.delete().catch(() => {});
    return { baseRef, one, two, three, off };
  });

  console.log("Layering:", JSON.stringify(R));

  expect(R.baseRef, "REF base 5, unarmored").toBe(5);
  expect(R.one.ev, "1 layer -> no EV penalty").toBe(0);
  expect(R.one.ref).toBe(5);
  expect(R.two.ev, "2nd layer -> +1 EV").toBe(1);
  expect(R.two.ref, "REF drops by 1").toBe(4);
  expect(R.three.ev, "3rd layer -> +3 total EV").toBe(3);
  expect(R.three.ref, "REF drops by 3").toBe(2);
  expect(R.off.ev, "applyLayerEVPenalty OFF -> no layer EV").toBe(0);
  expect(R.off.ref, "REF restored with penalty off").toBe(5);
});
