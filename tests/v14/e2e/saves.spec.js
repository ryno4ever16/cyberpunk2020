import { test, expect } from "@playwright/test";
import { loginRig, evalGameOrThrow, cleanupTestData } from "./rig-e2e-helpers.js";

/**
 * Rig-portable port of tests/e2e/saves.spec.js — identical body; login swapped to the rig (loginRig).
 *
 * QA §5/§6 — Stun & Death save thresholds + stabilization (CP2020 p.99-105).
 *
 *   Stun threshold  = max(1, BT − woundState + 1 − taserPenalty)   (roll ≤ to stay up)
 *   Death threshold = max(0, BT − mortalLevel)                     (roll ≤ to survive)
 *     mortalLevel = clamp(woundState − 4, 0..6); threshold 0 = automatic death.
 *   New damage clears a 'stabilized' flag (death saves resume).
 *
 * Threshold functions are pure exports — tested directly against a real actor.
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

test("§5/§6 stun & death thresholds, auto-death, and stabilization clears on damage", async () => {
  const R = await evalGameOrThrow(gmPage, async () => {
    const SR = await import("/systems/cyberpunk2020/module/combat/save-rolls.js");
    const DA = await import("/systems/cyberpunk2020/module/combat/DamageApplicator.js");
    const flags = { cyberpunk2020: { __pwtest: true } };

    // BT 8 actor; vary damage to move wound state.
    const a = await Actor.create({ name: "__PW__Saves", type: "character", flags, system: { stats: { bt: { base: 8 } } } });
    const btTotal = a.system.stats.bt.total;

    const stunAt = async (dmg) => { await a.update({ "system.damage": dmg }); return { ws: a.woundState(), stun: SR.getStunThreshold(a) }; };
    const deathAt = async (dmg) => { await a.update({ "system.damage": dmg }); return { ws: a.woundState(), death: SR.getDeathThreshold(a) }; };

    const stun0 = await stunAt(0);   // ws 0
    const stunLight = await stunAt(4);   // ws 1 (Light)
    const stunSerious = await stunAt(8); // ws 2 (Serious)
    const stunCritical = await stunAt(12); // ws 3

    const death0 = await deathAt(16); // ws 4 -> mortal 0 -> 8
    const death1 = await deathAt(20); // ws 5 -> mortal 1 -> 7
    const death2 = await deathAt(24); // ws 6 -> mortal 2 -> 6

    // Auto-death: low-BT actor pushed deep into Mortal so BT − mortalLevel = 0.
    const weak = await Actor.create({ name: "__PW__AutoDeath", type: "character", flags, system: { stats: { bt: { base: 4 } } } });
    await weak.update({ "system.damage": 32 }); // ws 8 -> mortalLevel clamp 4 -> 4-4 = 0
    const autoDeath = { btTotal: weak.system.stats.bt.total, ws: weak.woundState(), death: SR.getDeathThreshold(weak) };

    // Stabilization cleared by new damage.
    const stab = await Actor.create({ name: "__PW__Stable", type: "character", flags, system: { stats: { bt: { base: 5 } }, damage: 16 } });
    await stab.setFlag("cyberpunk2020", "stabilized", true);
    const stabBefore = !!stab.getFlag("cyberpunk2020", "stabilized");
    await DA.applyAreaDamages({
      target: stab, areaDamages: { Torso: [{ damage: 10 }] },
      ap: false, armorMode: DA.ARMOR_MODES.NONE, ablate: false, dryRun: false,
    });
    const stabAfter = !!stab.getFlag("cyberpunk2020", "stabilized");
    const stabMsg = game.messages.contents.some(m =>
      (m.content || "").includes("__PW__Stable") && (m.content || "").includes("Death Saves are required again"));

    for (const x of [a, weak, stab]) await x.delete().catch(() => {});
    return { btTotal, stun0, stunLight, stunSerious, stunCritical, death0, death1, death2, autoDeath, stabBefore, stabAfter, stabMsg };
  });

  console.log("Saves:", JSON.stringify(R));

  expect(R.btTotal).toBe(8);
  // Stun threshold decreases as wounds worsen: BT − ws + 1.
  expect(R.stun0.stun).toBe(9);
  expect(R.stunLight.stun).toBe(8);
  expect(R.stunSerious.stun).toBe(7);
  expect(R.stunCritical.stun).toBe(6);
  expect(R.stunSerious.stun, "Serious shows a lower threshold than Light").toBeLessThan(R.stunLight.stun);

  // Death threshold decreases as mortal level rises.
  expect(R.death0.death).toBe(8); // mortal 0
  expect(R.death1.death).toBe(7); // mortal 1
  expect(R.death2.death).toBe(6); // mortal 2

  // Auto-death when BT − mortalLevel == 0.
  expect(R.autoDeath.btTotal).toBe(4);
  expect(R.autoDeath.death, "BT 4 at Mortal 4 -> threshold 0 = automatic death").toBe(0);

  // Stabilization clears on new damage.
  expect(R.stabBefore).toBe(true);
  expect(R.stabAfter, "new damage clears the stabilized flag").toBe(false);
  expect(R.stabMsg, "a 'Death Saves are required again' message posts").toBe(true);
});
