import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * W4RST4R's Limb Rules (alternate limb model) + the Core hit-location display setting.
 *
 *   - W4RST4R hit-location table (1 Head, 2 R.Arm, 3 L.Arm, 4-7 Torso, 8 R.Leg, 9 L.Leg, 0 Groin).
 *   - Limb damage is NOT doubled: >8 net DISABLES, >12 SEVERS — either way a Mortal-0 Death Save.
 *     Head >8 auto-kills. Groin is a non-limb location (Torso armor; no limb rule).
 *   - activeLimbModel precedence W4RST4R > ListenUp > Core.
 *   - The Core hit-location display setting and W4RST4R are mutually exclusive (enabling W4RST4R
 *     forces Core-display and Listen Up off).
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("W4RST4R limb rules, hit-location table, Groin handling, and setting exclusivity", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const LK = await import("/systems/cyberpunk2020/module/lookups.js");
    const DA = await import("/systems/cyberpunk2020/module/combat/DamageApplicator.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const out = {};
    const S = (k) => game.settings.get("cyberpunk2020", k);
    const set = (k, v) => game.settings.set("cyberpunk2020", k, v);

    // Save originals
    const orig = { w4: S("w4rst4rLimbRules"), core: S("hitLocationCoreDisplay"), listen: S("limbCripplingDetailed"),
                   limb: S("limbLossEnabled"), head: S("headHitDoubling") };

    // --- W4RST4R hit-location table mapping ---
    const T = LK.W4RST4R_AREA_LOOKUP;
    out.table = { 1: T[1], 2: T[2], 3: T[3], 4: T[4], 7: T[7], 8: T[8], 9: T[9], 10: T[10] };

    // --- Mutual exclusivity: enabling W4RST4R forces Core-display + Listen Up off ---
    await set("limbLossEnabled", true);
    await set("hitLocationCoreDisplay", true);
    await set("limbCripplingDetailed", true);
    await set("w4rst4rLimbRules", true);
    await new Promise(r => setTimeout(r, 150));   // let onChange settle
    out.coreOffAfterW4 = S("hitLocationCoreDisplay");        // false
    out.listenOffAfterW4 = S("limbCripplingDetailed");       // false
    out.activeModel = DA.activeLimbModel();                  // "W4RST4R"

    await set("headHitDoubling", false);   // keep net deterministic for the head case

    // --- Limb damage rules (armorMode NONE → net = raw − BTM; BTM 2) ---
    const apply = (target, area, dmg) => DA.applyAreaDamages({
      target, areaDamages: { [area]: [{ damage: dmg }] },
      ap: false, armorMode: DA.ARMOR_MODES.NONE, ablate: false, dryRun: false,
    });
    const msgFor = (name, kw) => game.messages.contents.some(m => (m.content || "").includes(name) && (m.content || "").includes(kw));
    const limbStatus = (a) => game.actors.get(a.id)?.getFlag("cyberpunk2020", "limbStatus") ?? {};
    const mk = async (name) => Actor.create({ name, type: "character", flags, system: { stats: { bt: { base: 5 } } } }); // BTM 2

    // >8 (net 9 from raw 11) → DISABLED
    const disabled = await mk("__PW__W4Disabled");
    const dRes = await apply(disabled, "rArm", 11);
    out.disabledNet = dRes[0].netDamage;                     // 9 (NOT doubled)
    out.disabledMsg = msgFor("__PW__W4Disabled", "Limb Disabled");
    out.disabledStatus = limbStatus(disabled).rArm;          // "disabled"

    // >12 (net 13 from raw 15) → SEVERED
    const severed = await mk("__PW__W4Severed");
    await apply(severed, "lLeg", 15);
    out.severedMsg = msgFor("__PW__W4Severed", "Limb Severed");
    out.severedStatus = limbStatus(severed).lLeg;            // "severed"

    // exactly 8 net (raw 10) → no trigger
    const border = await mk("__PW__W4Border");
    await apply(border, "rArm", 10);
    out.borderMsg = msgFor("__PW__W4Border", "Limb ");       // neither Disabled nor Severed

    // Head >8 (net 9 from raw 11, doubling off) → AUTOMATIC DEATH
    const head = await mk("__PW__W4Head");
    await apply(head, "Head", 11);
    out.headMsg = msgFor("__PW__W4Head", "AUTOMATIC DEATH");

    // Groin: non-limb. raw 12 → net 10 applied as HP, but NO limb message; uses Torso SP path.
    const groin = await mk("__PW__W4Groin");
    const gRes = await apply(groin, "Groin", 12);
    out.groinNet = gRes[0].netDamage;                        // 10
    out.groinDamageApplied = (game.actors.get(groin.id)?.system?.damage ?? 0) > 0;
    out.groinNoLimbMsg = !msgFor("__PW__W4Groin", "Limb");

    // Restore
    await set("w4rst4rLimbRules", orig.w4);
    await set("hitLocationCoreDisplay", orig.core);
    await set("limbCripplingDetailed", orig.listen);
    await set("limbLossEnabled", orig.limb);
    await set("headHitDoubling", orig.head);

    for (const a of [disabled, severed, border, head, groin]) await a.delete().catch(() => {});
    return out;
  });

  console.log("W4RST4R:", JSON.stringify(R));

  // Hit-location table
  expect(R.table).toEqual({ 1: "Head", 2: "rArm", 3: "lArm", 4: "Torso", 7: "Torso", 8: "rLeg", 9: "lLeg", 10: "Groin" });

  // Mutual exclusivity
  expect(R.coreOffAfterW4, "enabling W4RST4R forces Core-display off").toBe(false);
  expect(R.listenOffAfterW4, "enabling W4RST4R forces Listen Up off").toBe(false);
  expect(R.activeModel, "active model is W4RST4R").toBe("W4RST4R");

  // Limb rules
  expect(R.disabledNet, "limb damage is NOT doubled (11 − BTM 2 = 9)").toBe(9);
  expect(R.disabledMsg, ">8 net → Limb Disabled message").toBe(true);
  expect(R.disabledStatus, ">8 net → limbStatus disabled").toBe("disabled");
  expect(R.severedMsg, ">12 net → Limb Severed message").toBe(true);
  expect(R.severedStatus, ">12 net → limbStatus severed").toBe("severed");
  expect(R.borderMsg, "exactly 8 net → no limb loss").toBe(false);
  expect(R.headMsg, "head >8 net → automatic death").toBe(true);

  // Groin = non-limb location, torso armor, damage applies, no limb message
  expect(R.groinNet, "groin net = 12 − BTM 2 = 10").toBe(10);
  expect(R.groinDamageApplied, "groin damage applied as HP").toBe(true);
  expect(R.groinNoLimbMsg, "groin triggers no limb-loss message").toBe(true);
});
