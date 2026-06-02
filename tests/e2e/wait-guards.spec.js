import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, setupSceneWithToken, waitForCanvasScene, cleanupTestData } from "../helpers/foundry.js";

/**
 * QA §9 — Wait-for-Turn guards & edge cases (several are known-bug regression guards).
 *
 *  - Last combatant: pressing ⏸ when you're already last must do NOTHING — no
 *    flag, no turn advance, no round change (regression guard, fixed Session 12).
 *  - Round end clears every waiting flag.
 *  - Two combatants waiting on the same trigger both get the "YOUR MOMENT" alert.
 */

test.describe.configure({ mode: "serial" });

let gmCtx, gmPage, sceneId;

test.beforeAll(async ({ browser }) => {
  gmCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  gmPage = await gmCtx.newPage();
  await login(gmPage, ACCOUNTS.gm, { canvas: true });
  await cleanupTestData(gmPage).catch(() => {});
  const s = await setupSceneWithToken(gmPage, { activate: true, actorName: "__PW__WaitSeed" });
  await waitForCanvasScene(gmPage, s.sceneId);
  sceneId = s.sceneId;
  await evalGameOrThrow(gmPage, async () => { await game.settings.set("cyberpunk2020", "waitForTurnEnabled", true); });
});

test.afterAll(async () => {
  if (gmPage) await cleanupTestData(gmPage).catch(() => {});
  if (gmCtx) await gmCtx.close();
});

/** Fresh combat with N tokens at descending initiative; deletes any prior test combats. */
async function freshCombat(names, initiatives) {
  return evalGameOrThrow(gmPage, async (arg) => {
    for (const c of [...game.combats]) if (c.getFlag("cyberpunk2020", "__pwtest")) await c.delete().catch(() => {});
    const flags = { cyberpunk2020: { __pwtest: true } };
    const scene = game.scenes.get(arg.sceneId);
    const made = [];
    let x = 1000;
    for (const name of arg.names) {
      const a = await Actor.create({ name, type: "character", flags });
      const [t] = await scene.createEmbeddedDocuments("Token", [
        { name, x, y: 1000, actorId: a.id, actorLink: true, width: 1, height: 1, flags },
      ]);
      made.push({ name, actorId: a.id, tokenId: t.id });
      x += 200;
    }
    const combat = await Combat.create({ scene: arg.sceneId, flags });
    await combat.createEmbeddedDocuments("Combatant", made.map((m, i) => ({
      tokenId: m.tokenId, sceneId: arg.sceneId, actorId: m.actorId, initiative: arg.initiatives[i],
    })));
    await combat.startCombat();
    // Map each actor to its combatant id, in initiative (turn) order.
    const byName = {};
    for (const m of made) byName[m.name] = combat.turns.find(c => c.actorId === m.actorId).id;
    await ui.combat.render(true);
    return { byName, turn: combat.turn, round: combat.round };
  }, { sceneId, names, initiatives });
}

test("§9 Wait guard: ⏸ on the last combatant in order is a no-op", async () => {
  const c = await freshCombat(["__PW__First", "__PW__Last"], [20, 10]);
  // Advance so the last-in-order combatant (init 10) is active.
  await evalGameOrThrow(gmPage, async () => { await game.combat.nextTurn(); await ui.combat.render(true); });
  const lastId = c.byName["__PW__Last"];

  const btn = gmPage.locator(`.cp-wait-for-turn-btn[data-combatant-id="${lastId}"]`).first();
  await expect(btn, "⏸ shows on the active (last) combatant").toBeAttached({ timeout: 15_000 });
  await btn.dispatchEvent("click");
  await gmPage.waitForTimeout(1_500); // give any (buggy) state change time to land

  const state = await evalGameOrThrow(gmPage, (id) => {
    const cb = game.combat.combatants.get(id);
    return { waiting: !!cb.getFlag("cyberpunk2020", "waitingForTurn"), turn: game.combat.turn, round: game.combat.round };
  }, lastId);
  expect(state.waiting, "no waiting flag set").toBe(false);
  expect(state.turn, "turn not advanced").toBe(1);
  expect(state.round, "round not advanced").toBe(1);
});

test("§9 Wait: round end clears waiting flags", async () => {
  const c = await freshCombat(["__PW__W1", "__PW__W2"], [20, 10]);
  const w1 = c.byName["__PW__W1"];
  await evalGameOrThrow(gmPage, async (id) => {
    const cb = game.combat.combatants.get(id);
    await cb.setFlag("cyberpunk2020", "waitingForTurn", true);
    await cb.setFlag("cyberpunk2020", "waitingAfterId", "whatever");
    await game.combat.nextRound();
  }, w1);

  const dl = Date.now() + 8_000;
  const waiting = () => evalGameOrThrow(gmPage, (id) => !!game.combat.combatants.get(id).getFlag("cyberpunk2020", "waitingForTurn"), w1);
  let v = await waiting();
  while (Date.now() < dl && v) { await gmPage.waitForTimeout(200); v = await waiting(); }
  expect(v, "waiting flag cleared at round end").toBe(false);
});

test("§9 Wait: two combatants waiting on the same trigger both get alerts", async () => {
  // Order: Trigger(30) acts first; WaiterA(20) and WaiterB(10) both wait after it.
  const c = await freshCombat(["__PW__Trigger", "__PW__WaiterA", "__PW__WaiterB"], [30, 20, 10]);
  const trig = c.byName["__PW__Trigger"];
  await evalGameOrThrow(gmPage, async (arg) => {
    for (const id of [arg.a, arg.b]) {
      const cb = game.combat.combatants.get(id);
      await cb.setFlag("cyberpunk2020", "waitingForTurn", true);
      await cb.setFlag("cyberpunk2020", "waitingAfterId", arg.trig);
    }
    await game.combat.nextTurn(); // Trigger's turn ends → both waiters alerted
  }, { a: c.byName["__PW__WaiterA"], b: c.byName["__PW__WaiterB"], trig });

  const sawBoth = async () => evalGameOrThrow(gmPage, () => {
    const ms = game.messages.contents;
    const a = ms.some(m => (m.content || "").includes("YOUR MOMENT") && (m.content || "").includes("__PW__WaiterA"));
    const b = ms.some(m => (m.content || "").includes("YOUR MOMENT") && (m.content || "").includes("__PW__WaiterB"));
    return a && b;
  });
  const dl = Date.now() + 12_000;
  let both = await sawBoth();
  while (Date.now() < dl && !both) { await gmPage.waitForTimeout(300); both = await sawBoth(); }
  expect(both, "both waiters received a YOUR MOMENT alert").toBe(true);
});
