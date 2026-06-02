import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, setupSceneWithToken, waitForCanvasScene, cleanupTestData } from "../helpers/foundry.js";

/**
 * QA §9 — Wait-for-Turn flow (CP2020 p.98), end-to-end through the UI.
 *
 *   ⏸ on the active combatant → "Wait for Turn" dialog → pick who to follow →
 *      sets waitingForTurn + waitingAfterId on the combatant and advances the turn.
 *   When the followed combatant ends their turn → the active GM posts a
 *      "YOUR MOMENT" alert to the waiting combatant.
 *   ⚡ on the waiting combatant → clears waitingForTurn (takes the delayed action).
 *
 * Three combatants (init 30/20/10 → waiter, follow, third). The waiter follows
 * the *middle* combatant so "their turn ends" is a plain turn advance (turn 1→2),
 * not a round wrap — a wrap would hit the round-reset branch and clear the flag
 * before the alert could fire.
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("§9 Wait flow: ⏸ declares wait, 'your moment' fires, ⚡ takes the action", async ({ page }) => {
  await login(page, ACCOUNTS.gm, { canvas: true });
  await cleanupTestData(page).catch(() => {});
  const base = await setupSceneWithToken(page, { activate: true, actorName: "__PW__Waiter" });
  await waitForCanvasScene(page, base.sceneId);

  const ids = await evalGameOrThrow(page, async (arg) => {
    await game.settings.set("cyberpunk2020", "waitForTurnEnabled", true);
    const flags = { cyberpunk2020: { __pwtest: true } };
    const scene = game.scenes.get(arg.sceneId);
    const mk = async (name, x) => {
      const a = await Actor.create({ name, type: "character", flags });
      const [t] = await scene.createEmbeddedDocuments("Token", [
        { name, x, y: 1000, actorId: a.id, actorLink: true, width: 1, height: 1, flags },
      ]);
      return { actorId: a.id, tokenId: t.id };
    };
    const follow = await mk("__PW__Follow", 1200); // the combatant the waiter will follow
    const third  = await mk("__PW__Third", 1400);

    const combat = await Combat.create({ scene: arg.sceneId, flags });
    await combat.createEmbeddedDocuments("Combatant", [
      { tokenId: arg.tokenId, sceneId: arg.sceneId, actorId: arg.actorId, initiative: 30 },
      { tokenId: follow.tokenId, sceneId: arg.sceneId, actorId: follow.actorId, initiative: 20 },
      { tokenId: third.tokenId,  sceneId: arg.sceneId, actorId: third.actorId,  initiative: 10 },
    ]);
    await combat.startCombat();
    const waiterC = combat.turns.find(t => t.actorId === arg.actorId);
    const followC = combat.turns.find(t => t.actorId === follow.actorId);
    await ui.combat.render(true);
    return {
      waiterCombatantId: waiterC.id,
      followCombatantId: followC.id,
      turn: combat.turn,
    };
  }, base);

  expect(ids.turn, "waiter (init 30) starts the round").toBe(0);

  const readWaiter = () => evalGameOrThrow(page, (cid) => {
    const c = game.combat?.combatants.get(cid);
    return {
      waiting: !!(c && c.getFlag("cyberpunk2020", "waitingForTurn")),
      after: (c && c.getFlag("cyberpunk2020", "waitingAfterId")) ?? null,
      turn: game.combat?.turn ?? null,
    };
  }, ids.waiterCombatantId);
  const waitForWaiter = async (predicate, ms = 8_000) => {
    const dl = Date.now() + ms;
    let s = await readWaiter();
    while (Date.now() < dl && !predicate(s)) { await page.waitForTimeout(200); s = await readWaiter(); }
    return s;
  };

  // --- ⏸ : open the Wait dialog, pick the follow target, confirm ---
  const waitBtn = page.locator(`.cp-wait-for-turn-btn[data-combatant-id="${ids.waiterCombatantId}"]`).first();
  await expect(waitBtn).toBeAttached({ timeout: 15_000 });
  await waitBtn.dispatchEvent("click");

  const select = page.locator("#cp-wait-target");
  await expect(select).toBeVisible({ timeout: 15_000 });
  await select.selectOption(ids.followCombatantId);
  const confirm = page.locator('button[data-button="confirm"]').first();
  await expect(confirm).toBeVisible({ timeout: 10_000 });
  await confirm.click();

  const declared = await waitForWaiter(s => s.waiting === true);
  expect(declared.waiting, "waiter is now waiting").toBe(true);
  expect(declared.after, "waiting after the follow combatant").toBe(ids.followCombatantId);
  expect(declared.turn, "handler advanced past the waiter's slot").toBe(1);

  // --- 'your moment' : end the followed combatant's turn (turn 1 → 2) ---
  await evalGameOrThrow(page, async () => { await game.combat.nextTurn(); await ui.combat.render(true); });

  const sawMoment = async () => evalGameOrThrow(page, () => game.messages.contents.some(m => {
    const c = m.content || "";
    return c.includes("YOUR MOMENT") && c.includes("__PW__Waiter");
  }));
  const momentDl = Date.now() + 12_000;
  let moment = await sawMoment();
  while (Date.now() < momentDl && !moment) { await page.waitForTimeout(300); moment = await sawMoment(); }
  expect(moment, "'YOUR MOMENT' alert posted for the waiter").toBe(true);
  // still waiting until the player acts
  expect((await readWaiter()).waiting, "still waiting before ⚡").toBe(true);

  // --- ⚡ : take the delayed action, clearing the wait flag ---
  const actBtn = page.locator(`.cp-wait-act-btn[data-combatant-id="${ids.waiterCombatantId}"]`).first();
  await expect(actBtn).toBeAttached({ timeout: 15_000 });
  await actBtn.dispatchEvent("click");
  const acted = await waitForWaiter(s => s.waiting === false);
  expect(acted.waiting, "wait cleared after ⚡").toBe(false);
});
