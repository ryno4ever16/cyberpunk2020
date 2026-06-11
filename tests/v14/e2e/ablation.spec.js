import { test, expect } from "@playwright/test";
import { loginRig, evalGameOrThrow, cleanupTestData } from "./rig-e2e-helpers.js";

/**
 * Rig-portable port of tests/e2e/ablation.spec.js — identical body; login swapped to the rig (loginRig).
 *
 * QA §3 — Armor ablation (CP2020: SP -1 per penetrating hit at that location).
 *
 * Exercises the real pipeline `applyAreaDamages` (NOT dry-run) with ablate on/off.
 * applyAreaDamages is called directly (one client), so there is no multi-GM
 * duplication to worry about — it runs exactly once here.
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

test("§3 armor ablates by 1 per penetrating hit; not when blocked or disabled", async () => {
  const R = await evalGameOrThrow(gmPage, async () => {
    const DA = await import("/systems/cyberpunk2020/module/combat/DamageApplicator.js");
    const flags = { cyberpunk2020: { __pwtest: true } };

    // Fresh armored actor per scenario (ablation mutates the armor item permanently).
    const makeArmored = async (sp = 18) => {
      const a = await Actor.create({ name: "__PW__Ablate", type: "character", flags, system: { stats: { bt: { base: 5 } } } });
      const [armor] = await a.createEmbeddedDocuments("Item", [{
        name: "__PW__Vest", type: "armor",
        system: { equipped: true, armorType: "soft", coverage: { Torso: { stoppingPower: sp } } },
      }]);
      return { a, armor };
    };
    const itemSP = (armor) => Number(armor.system.coverage?.Torso?.stoppingPower) || 0;
    const locSP  = (a) => Number(a.system.hitLocations?.Torso?.stoppingPower) || 0;
    const apply = (target, dmg, ablate) => DA.applyAreaDamages({
      target, areaDamages: { Torso: [{ damage: dmg }] },
      ap: false, armorMode: DA.ARMOR_MODES.FULL, ablate, dryRun: false,
    });

    // 1) Penetrating hit with ablate ON: SP 18 -> 17.
    const s1 = await makeArmored(18);
    const before1 = itemSP(s1.armor);
    await apply(s1.a, 25, true); // 25 > 18 -> penetrates
    const after1Item = itemSP(s1.armor);
    const after1Loc = locSP(s1.a);

    // 2) Blocked hit (<= SP): no ablation.
    const s2 = await makeArmored(18);
    await apply(s2.a, 10, true); // 10 <= 18 -> stopped
    const after2Item = itemSP(s2.armor);

    // 3) Ablation disabled: penetrating hit, ablate OFF -> SP unchanged.
    const s3 = await makeArmored(18);
    await apply(s3.a, 25, false);
    const after3Item = itemSP(s3.armor);

    // 4) Two penetrating hits same location -> SP drops by 2.
    const s4 = await makeArmored(18);
    await apply(s4.a, 25, true);
    await apply(s4.a, 25, true);
    const after4Item = itemSP(s4.armor);

    for (const s of [s1, s2, s3, s4]) await s.a.delete().catch(() => {});
    return { before1, after1Item, after1Loc, after2Item, after3Item, after4Item };
  });

  console.log("Ablation:", JSON.stringify(R));

  expect(R.before1, "vest starts at SP 18").toBe(18);
  expect(R.after1Item, "penetrating hit ablates the armor item by 1 -> 17").toBe(17);
  expect(R.after1Loc, "derived location SP also reflects 17").toBe(17);
  expect(R.after2Item, "blocked hit does not ablate").toBe(18);
  expect(R.after3Item, "ablation disabled -> SP unchanged").toBe(18);
  expect(R.after4Item, "two penetrating hits -> SP 16").toBe(16);
});
