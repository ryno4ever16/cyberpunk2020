import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * QA §9 / §10 — the attack ModifiersDialog pre-fills, and aim-reset on fire.
 *
 * Two renderModifiersDialog hooks read the firing actor's flags and seed the
 * dialog fields (both keyed off app.options.weapon.actor):
 *   - aim:          select[name="aimRounds"] ← saved aimRounds flag (capped 3)
 *   - multi-action: input[name="extraMod"]   += −(count−1)×3 penalty
 * And a weaponFired hook clears accumulated aim once the shot goes off.
 *
 * Opening the dialog and reading the seeded values is render-only (no button
 * click), so it sidesteps the ModifiersDialog click-handler flakiness that
 * forced the reload test to be pulled. The aim-reset is a pure hook assertion.
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("§9/§10 ModifiersDialog pre-fills saved aim rounds and the multi-action penalty", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  await evalGameOrThrow(page, async () => {
    await game.settings.set("cyberpunk2020", "aimTrackingEnabled", true);
    await game.settings.set("cyberpunk2020", "multiActionPenaltyEnabled", true);
    const { ModifiersDialog } = await import("/systems/cyberpunk2020/module/dialog/modifiers.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const actor = await Actor.create({ name: "__PW__Gunner", type: "character", flags });
    const [weapon] = await actor.createEmbeddedDocuments("Item", [
      { name: "__PW__Pistol", type: "weapon", flags, system: { weaponType: "Pistol", rof: 1, shots: 8, shotsLeft: 8 } },
    ]);

    // Saved aim = 2. Two actions this round → penalty −(2−1)×3 = −3.
    // Stamp actionCountRound to the live round so _getActionCount doesn't treat it as stale.
    const round = game.combat?.round ?? 0;
    await actor.setFlag("cyberpunk2020", "aimRounds", 2);
    await actor.setFlag("cyberpunk2020", "actionCount", 2);
    await actor.setFlag("cyberpunk2020", "actionCountRound", round);

    for (const w of Object.values(ui.windows)) {
      if (w?.options?.id === "weapon-modifier") await w.close().catch(() => {});
    }
    const dlg = new ModifiersDialog(actor, {
      weapon,
      modifierGroups: [[
        { localKey: "Aiming", dataPath: "aimRounds", choices: [0, 1, 2, 3].map(x => ({ value: x, localKey: "Rounds", localData: { rounds: x } })) },
      ]],
      targetTokens: [],
      onConfirm: () => {},
    });
    await dlg.render(true);
  });

  await expect(page.locator('form.weapon-modifiers select[name="aimRounds"]'), "saved aim 2 pre-filled").toHaveValue("2");
  await expect(page.locator('form.weapon-modifiers input[name="extraMod"]'), "2 actions → −3 pre-filled").toHaveValue("-3");

  // Close the dialog so it doesn't linger.
  await evalGameOrThrow(page, async () => {
    for (const w of Object.values(ui.windows)) {
      if (w?.options?.id === "weapon-modifier") await w.close().catch(() => {});
    }
  });
});

test("§9 firing a weapon resets accumulated aim to 0", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const result = await evalGameOrThrow(page, async () => {
    await game.settings.set("cyberpunk2020", "aimTrackingEnabled", true);
    const flags = { cyberpunk2020: { __pwtest: true } };
    const actor = await Actor.create({ name: "__PW__Aimer2", type: "character", flags });
    await actor.setFlag("cyberpunk2020", "aimRounds", 3);
    const before = actor.getFlag("cyberpunk2020", "aimRounds") ?? 0;

    // Empty areaDamages → the damage-applying weaponFired handler bails out early;
    // only the aim-tracking reset listener acts.
    Hooks.callAll("cyberpunk2020.weaponFired", { attackerId: actor.id, areaDamages: {} });

    const dl = Date.now() + 5_000;
    let after = actor.getFlag("cyberpunk2020", "aimRounds") ?? 0;
    while (Date.now() < dl && after !== 0) { await new Promise(r => setTimeout(r, 150)); after = actor.getFlag("cyberpunk2020", "aimRounds") ?? 0; }
    return { before, after };
  });

  expect(result.before, "aim accumulated to 3").toBe(3);
  expect(result.after, "firing clears accumulated aim").toBe(0);
});
