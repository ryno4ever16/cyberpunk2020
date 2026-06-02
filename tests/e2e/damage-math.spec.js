import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * QA §2 — Damage math (CP2020 p.98-99).
 *
 * Drives the REAL pipeline export `resolveAreaDamages` (dry-run of applyAreaDamages)
 * against real actors with real equipped armor items, so the SP aggregation,
 * proportional armor, AP/hollow-point multipliers, BTM, and head doubling are all
 * exercised exactly as in play — but with no writes (no multi-GM / ablation noise).
 *
 * The exported functions are reached via dynamic import of the live system module.
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

test("§2 damage math: SP, AP, hollow-point, armor modes, BTM, head doubling, minimum-1", async () => {
  const R = await evalGameOrThrow(gmPage, async () => {
    const DA = await import("/systems/cyberpunk2020/module/combat/DamageApplicator.js");
    const MODES = DA.ARMOR_MODES;
    const flags = { cyberpunk2020: { __pwtest: true } };

    // Actor with soft armor SP 18 at the Torso; BT base 5 -> BTM 2.
    const armored = await Actor.create({ name: "__PW__Armored", type: "character", flags, system: { stats: { bt: { base: 5 } } } });
    await armored.createEmbeddedDocuments("Item", [{
      name: "__PW__SoftVest", type: "armor",
      system: { equipped: true, armorType: "soft", coverage: { Torso: { stoppingPower: 18 } } },
    }]);

    // Unarmored, BTM 2.
    const bare = await Actor.create({ name: "__PW__Bare", type: "character", flags, system: { stats: { bt: { base: 5 } } } });
    // Unarmored, BTM 0 (BT base 2 = Very Weak).
    const weak = await Actor.create({ name: "__PW__Weak", type: "character", flags, system: { stats: { bt: { base: 2 } } } });

    const torsoSP = armored.system.hitLocations?.Torso?.stoppingPower ?? null;
    const armoredBtm = armored.system.stats.bt.modifier;
    const bareBtm = bare.system.stats.bt.modifier;
    const weakBtm = weak.system.stats.bt.modifier;

    const hit = async (target, area, dmg, opts = {}) => {
      const res = await DA.resolveAreaDamages({
        target, areaDamages: { [area]: [{ damage: dmg }] },
        ap: !!opts.ap, edged: !!opts.edged,
        armorMultSoft: opts.armorMultSoft ?? 1.0, armorMultHard: opts.armorMultHard ?? 1.0,
        penDamageMult: opts.penDamageMult ?? 1.0,
        armorMode: opts.armorMode ?? MODES.FULL, coverSP: opts.coverSP ?? 0,
      });
      return res[0];
    };

    const origHeadDouble = game.settings.get("cyberpunk2020", "headHitDoubling");

    // Armor stops a weak shot (10 vs SP 18).
    const stopped = await hit(armored, "Torso", 10);
    // AP halves SP -> 9; same 15 dmg penetrates AP but not normal.
    const normal15 = await hit(armored, "Torso", 15);
    const ap15 = await hit(armored, "Torso", 15, { ap: true, penDamageMult: 0.5 });
    // Hollow-point worsens soft SP (x2 -> 36).
    const hp = await hit(armored, "Torso", 20, { armorMultSoft: 2.0, penDamageMult: 1.5 });
    // Armor mode NONE: SP ignored, BTM still applies (10 - BTM2 = 8).
    const modeNone = await hit(armored, "Torso", 10, { armorMode: MODES.NONE });
    // Armor mode SIMPLE: flat SP subtract (10 vs 18 -> stopped).
    const modeSimple = await hit(armored, "Torso", 10, { armorMode: MODES.SIMPLE });

    // Head doubling ON: head net = 2x torso net for an identical unarmored hit.
    await game.settings.set("cyberpunk2020", "headHitDoubling", true);
    const headOn = await hit(bare, "Head", 10);
    const torsoCompare = await hit(bare, "Torso", 10);
    const headBarely = await hit(bare, "Head", 3); // afterSP 3 - BTM2 = 1, doubled -> 2

    // Head doubling OFF: head == torso.
    await game.settings.set("cyberpunk2020", "headHitDoubling", false);
    const headOff = await hit(bare, "Head", 10);

    await game.settings.set("cyberpunk2020", "headHitDoubling", origHeadDouble);

    // Minimum 1 HP on a penetrating hit even when BTM would zero it.
    const min1a = await hit(bare, "Torso", 2); // 2 - BTM2 = 0 -> 1
    const min1b = await hit(bare, "Torso", 1); // 1 - BTM2 < 0 -> 1
    // BTM 0 actor takes full penetrating damage.
    const btm0 = await hit(weak, "Torso", 7); // 7 - 0 = 7

    for (const a of [armored, bare, weak]) await a.delete().catch(() => {});

    return {
      torsoSP, armoredBtm, bareBtm, weakBtm,
      stopped, normal15, ap15, hp, modeNone, modeSimple,
      headOn, torsoCompare, headBarely, headOff, min1a, min1b, btm0,
    };
  });

  console.log("Damage math:", JSON.stringify(R, null, 2));

  // Preconditions
  expect(R.torsoSP, "soft vest gives Torso SP 18").toBe(18);
  expect(R.armoredBtm).toBe(2);
  expect(R.bareBtm).toBe(2);
  expect(R.weakBtm).toBe(0);

  // Armor stops the shot
  expect(R.stopped.penetrates).toBe(false);
  expect(R.stopped.netDamage).toBe(0);
  expect(R.stopped.spUsed).toBe(18);

  // AP halves SP
  expect(R.normal15.penetrates, "15 vs SP18 normal is stopped").toBe(false);
  expect(R.ap15.spUsed, "AP halves SP 18 -> 9").toBe(9);
  expect(R.ap15.penetrates, "15 vs SP9 (AP) penetrates").toBe(true);

  // Hollow-point worsens soft SP
  expect(R.hp.spUsed, "hollow-point x2 soft SP -> 36").toBe(36);

  // Armor modes
  expect(R.modeNone.spUsed, "armor mode NONE ignores SP").toBe(0);
  expect(R.modeNone.netDamage, "NONE: 10 - BTM2 = 8 (BTM still applies)").toBe(8);
  expect(R.modeSimple.spUsed, "SIMPLE: flat SP subtract").toBe(18);
  expect(R.modeSimple.netDamage, "SIMPLE: 10 vs 18 stopped").toBe(0);

  // Head doubling
  expect(R.torsoCompare.netDamage, "torso: 10 - BTM2 = 8").toBe(8);
  expect(R.headOn.netDamage, "head doubling: 2 x 8 = 16").toBe(16);
  expect(R.headBarely.netDamage, "barely-penetrating head: floor to 1 then double = 2").toBe(2);
  expect(R.headOff.netDamage, "doubling OFF: head == torso").toBe(8);

  // Minimum 1 HP + BTM 0
  expect(R.min1a.netDamage, "penetrating hit floors at 1 HP").toBe(1);
  expect(R.min1b.netDamage, "penetrating hit floors at 1 HP").toBe(1);
  expect(R.btm0.netDamage, "BTM 0: full 7 HP").toBe(7);
});
