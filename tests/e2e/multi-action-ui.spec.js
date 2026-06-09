import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, setupSceneWithToken, waitForCanvasScene, cleanupTestData } from "../helpers/foundry.js";

/**
 * QA §10 — Multi-action penalty: tracker badge + the "doesn't count" cases + gating.
 *
 * Auto-track ON: declaring Aim/Dodge/Parry increments actionCount. But the
 * CANCEL (second click) and the Aim RESET (4th click, 3→0) must NOT increment —
 * only real declarations cost an action. The ×N (−P) tracker badge reflects the
 * count, and both the master Penalty toggle and the Auto-Track toggle gate it.
 *
 * (The −3/−6 dialog pre-fill is covered by fire-path-prefill.spec.js + the
 * formula in multi-action.spec.js; round-end reset is in multi-action.spec.js.)
 */

test.describe.configure({ mode: "serial" });

let gmCtx, gmPage, scene, ids;

test.beforeAll(async ({ browser }) => {
  gmCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  gmPage = await gmCtx.newPage();
  await login(gmPage, ACCOUNTS.gm, { canvas: true });
  await cleanupTestData(gmPage).catch(() => {});
  scene = await setupSceneWithToken(gmPage, { activate: true, actorName: "__PW__MultiAct" });
  await waitForCanvasScene(gmPage, scene.sceneId);
  ids = await evalGameOrThrow(gmPage, async (arg) => {
    await game.settings.set("cyberpunk2020", "aimTrackingEnabled", true);
    await game.settings.set("cyberpunk2020", "activeDodgeParryEnabled", true);
    const combat = await Combat.create({ scene: arg.sceneId, flags: { cyberpunk2020: { __pwtest: true } } });
    await combat.createEmbeddedDocuments("Combatant", [
      { tokenId: arg.tokenId, sceneId: arg.sceneId, actorId: arg.actorId },
    ]);
    await combat.startCombat();
    await ui.combat.render(true);
    const combatant = combat.combatants.find(c => c.actorId === arg.actorId);
    return { actorId: arg.actorId, combatantId: combatant.id, round: combat.round };
  }, scene);
});

test.afterAll(async () => {
  if (gmPage) await cleanupTestData(gmPage).catch(() => {});
  if (gmCtx) await gmCtx.close();
});

// Resolve the control fresh each click — the tracker re-renders and swaps the <a>.
const click = async (selector) => {
  const loc = gmPage.locator(`${selector}[data-actor-id="${ids.actorId}"]`).first();
  await expect(loc).toBeAttached({ timeout: 15_000 });
  await loc.dispatchEvent("click");
};
const readCount = () => evalGameOrThrow(gmPage, (id) => Number(game.actors.get(id).getFlag("cyberpunk2020", "actionCount") ?? 0), ids.actorId);
const waitCount = async (target, ms = 6_000) => {
  const dl = Date.now() + ms;
  let v = await readCount();
  while (Date.now() < dl && v !== target) { await gmPage.waitForTimeout(150); v = await readCount(); }
  return v;
};
const resetCount = () => evalGameOrThrow(gmPage, async (id) => {
  const a = game.actors.get(id);
  for (const f of ["actionCount", "actionCountRound", "aimRounds", "dodging", "parrying"]) await a.unsetFlag("cyberpunk2020", f).catch(() => {});
}, ids.actorId);

test("§10 auto-track counts declarations; aim-reset and dodge/parry cancel do NOT", async () => {
  await evalGameOrThrow(gmPage, async () => {
    await game.settings.set("cyberpunk2020", "multiActionPenaltyEnabled", true);
    await game.settings.set("cyberpunk2020", "multiActionAutoTrack", true);
  });
  await resetCount();

  // Aim declarations count (1→2→3); the 4th click resets aim to 0 and must NOT count.
  await click(".cp-take-aim-btn"); expect(await waitCount(1), "aim 1 counts").toBe(1);
  await click(".cp-take-aim-btn"); expect(await waitCount(2), "aim 2 counts").toBe(2);
  await click(".cp-take-aim-btn"); expect(await waitCount(3), "aim 3 counts").toBe(3);
  await click(".cp-take-aim-btn"); // resets aim 3→0
  await gmPage.waitForTimeout(1_500);
  expect(await readCount(), "aim RESET does not count").toBe(3);
  expect(await evalGameOrThrow(gmPage, (id) => Number(game.actors.get(id).getFlag("cyberpunk2020", "aimRounds") ?? 0), ids.actorId), "aim cleared").toBe(0);

  // Dodge: declare counts, cancel does not.
  await resetCount();
  await click(".cp-dodge-btn"); expect(await waitCount(1), "dodge declare counts").toBe(1);
  await click(".cp-dodge-btn"); // cancel
  await gmPage.waitForTimeout(1_500);
  expect(await readCount(), "dodge CANCEL does not count").toBe(1);

  // Parry: declare counts, cancel does not.
  await resetCount();
  await click(".cp-parry-btn"); expect(await waitCount(1), "parry declare counts").toBe(1);
  await click(".cp-parry-btn"); // cancel
  await gmPage.waitForTimeout(1_500);
  expect(await readCount(), "parry CANCEL does not count").toBe(1);
});

test("§10 tracker badge shows ×count and the penalty", async () => {
  await evalGameOrThrow(gmPage, async (arg) => {
    await game.settings.set("cyberpunk2020", "multiActionPenaltyEnabled", true);
    const a = game.actors.get(arg.actorId);
    await a.setFlag("cyberpunk2020", "actionCount", 2);
    await a.setFlag("cyberpunk2020", "actionCountRound", game.combat?.round ?? 0);
    await ui.combat.render(true);
  }, { actorId: ids.actorId });

  // The badge lives in the hover-hidden combatant-controls area, so assert it's in
  // the DOM with the right text rather than visible (same constraint as the buttons).
  // v13 renders the tracker in two containers (#combat + #combat-popout); the badge correctly appears in
  // both, so scope to the first (same pattern the other tracker specs use).
  const badge = gmPage.locator(`[data-combatant-id="${ids.combatantId}"] .cp-action-count-badge`).first();
  await expect(badge, "badge appears for a combatant with actions").toBeAttached({ timeout: 15_000 });
  await expect(badge, "badge shows ×2 and the −3 penalty").toContainText("×2");
  await expect(badge).toContainText("-3");
});

test("§10 gating: master toggle off and auto-track off both suppress counting", async () => {
  // Penalty disabled → no auto-track, no badge.
  await resetCount();
  await evalGameOrThrow(gmPage, async () => {
    await game.settings.set("cyberpunk2020", "multiActionPenaltyEnabled", false);
    await game.settings.set("cyberpunk2020", "multiActionAutoTrack", true);
    await ui.combat.render(true);
  });
  await click(".cp-take-aim-btn");
  await gmPage.waitForTimeout(1_500);
  expect(await readCount(), "penalty disabled → aim declare does not count").toBe(0);
  await expect(gmPage.locator(`[data-combatant-id="${ids.combatantId}"] .cp-action-count-badge`), "no badge when disabled").toHaveCount(0);

  // Auto-track off (penalty on) → declarations don't count, but the manual ➕ still does.
  await resetCount();
  await evalGameOrThrow(gmPage, async () => {
    await game.settings.set("cyberpunk2020", "multiActionPenaltyEnabled", true);
    await game.settings.set("cyberpunk2020", "multiActionAutoTrack", false);
    await ui.combat.render(true);
  });
  await click(".cp-take-aim-btn");
  await gmPage.waitForTimeout(1_500);
  expect(await readCount(), "auto-track off → aim declare does not count").toBe(0);
  await click(".cp-add-action-btn");
  expect(await waitCount(1), "manual ➕ still counts with auto-track off").toBe(1);
});
