import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Cyberware migration data-safety regression (migrate.js).
 *
 * The migration re-syncs each cyberware from its compendium template, then copies back user values.
 * Three things it must NOT clobber:
 *   1. The installed body location the player chose (CyberBodyType.Type + Location / which limb+side).
 *   2. A player's custom rename (only stock names should relocalize).
 *   3. Items it can't confidently identify — an unrecognized name must NOT trigger a wholesale
 *      replacement (that substituted wrong items and clobbered unlocked homebrew packs).
 * Stock (recognized) names must still relocalize from the template (the multilingual feature).
 */
test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("migration preserves cyberware placement + custom names, and won't substitute on unknown names", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const { migrateItem } = await import("/systems/cyberpunk2020/module/migrate.js");
    const out = {};

    // A real cyberware template to match against (by sourceId).
    let entry = null, packCol = null;
    for (const n of ["cyberlimbs", "cyberware", "implants", "bioware", "cyberoptic"]) {
      const p = game.packs.get(`cyberpunk2020.${n}`);
      if (!p) continue;
      const idx = await p.getIndex();
      const arr = idx.contents ?? [...idx];
      const cw = arr.find(e => (e.type ?? "cyberware") === "cyberware");
      if (cw) { entry = cw; packCol = p.collection; break; }
    }
    out.templateName = entry?.name;
    if (!entry) return out;
    const sourceId = `Compendium.${packCol}.Item.${entry._id}`;

    let actor;
    try {
      actor = await Actor.create({ name: "__PW__CWFIX", type: "character", flags: { cyberpunk2020: { __pwtest: true } } });

      // (1) Stable id + player rename + a chosen limb/side.
      const [renamed] = await actor.createEmbeddedDocuments("Item", [{
        name: "__PW__ Custom Lefty Implant", type: "cyberware",
        flags: { core: { sourceId } },
        system: { CyberBodyType: { Type: "Arm", Location: "Left" }, MountZone: "" }
      }]);
      const u1 = await migrateItem(renamed);
      out.r1_matched = !!(u1?.system);
      out.r1_name = u1?.name;                                // custom name kept
      out.r1_cbtType = u1?.system?.CyberBodyType?.Type;      // "Arm" (was wiped to "" before the fix)
      out.r1_cbtLoc = u1?.system?.CyberBodyType?.Location;   // "Left"

      // (2) Stable id + the STOCK name → should still relocalize to the template name.
      const [stock] = await actor.createEmbeddedDocuments("Item", [{
        name: entry.name, type: "cyberware",
        flags: { core: { sourceId } },
        system: { CyberBodyType: { Type: "Leg", Location: "Right" } }
      }]);
      const u2 = await migrateItem(stock);
      out.r2_name = u2?.name;                                // template name
      out.r2_cbtType = u2?.system?.CyberBodyType?.Type;      // "Leg" (placement still preserved)

      // (3) No stable id + an unrecognized (homebrew/custom) name → must NOT be replaced.
      const [orphan] = await actor.createEmbeddedDocuments("Item", [{
        name: "__PW__ Totally Homebrew Widget 9000", type: "cyberware",
        system: { CyberBodyType: { Type: "Torso", Location: "" } }
      }]);
      const u3 = await migrateItem(orphan);
      out.r3_replaced = !!(u3?.system);                     // false → no wholesale replace
      out.r3_nameOverwritten = (u3?.name !== undefined) && (u3.name !== "__PW__ Totally Homebrew Widget 9000");
    } finally {
      if (actor) await actor.delete().catch(() => {});
    }
    return out;
  });

  console.log("CW migration fix:", JSON.stringify(R));
  // (1) placement + rename preserved
  expect(R.r1_matched).toBe(true);
  expect(R.r1_name).toBe("__PW__ Custom Lefty Implant");
  expect(R.r1_cbtType).toBe("Arm");
  expect(R.r1_cbtLoc).toBe("Left");
  // (2) stock name still relocalizes, placement still preserved
  expect(R.r2_name).toBe(R.templateName);
  expect(R.r2_cbtType).toBe("Leg");
  // (3) unknown name → no substitution, no name change
  expect(R.r3_replaced).toBe(false);
  expect(R.r3_nameOverwritten).toBe(false);
});

test("cyberware migration preserves the full runtime-state allowlist (install/links/chip/humanity)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const { migrateItem } = await import("/systems/cyberpunk2020/module/migrate.js");
    const out = {};
    let entry = null, packCol = null;
    for (const n of ["cyberlimbs", "cyberware", "implants", "bioware", "cyberoptic"]) {
      const p = game.packs.get(`cyberpunk2020.${n}`);
      if (!p) continue;
      const idx = await p.getIndex();
      const arr = idx.contents ?? [...idx];
      const cw = arr.find(e => (e.type ?? "cyberware") === "cyberware");
      if (cw) { entry = cw; packCol = p.collection; break; }
    }
    if (!entry) return out;
    const sourceId = `Compendium.${packCol}.Item.${entry._id}`;

    let actor;
    try {
      actor = await Actor.create({ name: "__PW__CWRUNTIME", type: "character", flags: { cyberpunk2020: { __pwtest: true } } });
      const [cw] = await actor.createEmbeddedDocuments("Item", [{
        name: entry.name, type: "cyberware",
        flags: { core: { sourceId } },
        system: {
          equipped: false, EffectActive: true, MountZone: "Arm",
          humanityLoss: 7, cost: 1500, weight: 2,
          CyberBodyType: { Type: "Arm", Location: "Right" },
          Module: { IsModule: true, ParentId: "PARENT123", SlotsTaken: 2 },
          CyberWorkType: { ChipActive: true, ChipSkills: { SKILLABC: 3 }, ItemId: "WPN42" }
        }
      }]);
      const u = await migrateItem(cw);
      out.matched = !!(u?.system);
      const s = u?.system ?? {};
      out.equipped = s.equipped; out.effectActive = s.EffectActive; out.mountZone = s.MountZone;
      out.humanityLoss = s.humanityLoss; out.cost = s.cost; out.weight = s.weight;
      out.modIsModule = s.Module?.IsModule; out.modParent = s.Module?.ParentId; out.modSlots = s.Module?.SlotsTaken;
      out.chipActive = s.CyberWorkType?.ChipActive; out.chipSkill = s.CyberWorkType?.ChipSkills?.SKILLABC; out.linkItemId = s.CyberWorkType?.ItemId;
      out.cbtLoc = s.CyberBodyType?.Location;
    } finally {
      if (actor) await actor.delete().catch(() => {});
    }
    return out;
  });

  console.log("CW runtime preserve:", JSON.stringify(R));
  expect(R.matched).toBe(true);
  expect(R).toMatchObject({
    equipped: false, effectActive: true, mountZone: "Arm",
    humanityLoss: 7, cost: 1500, weight: 2,
    modIsModule: true, modParent: "PARENT123", modSlots: 2,
    chipActive: true, chipSkill: 3, linkItemId: "WPN42", cbtLoc: "Right"
  });
});
