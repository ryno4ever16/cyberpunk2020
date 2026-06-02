import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, setupSceneWithToken, waitForCanvasScene, cleanupTestData } from "../helpers/foundry.js";

/**
 * QA §8 — Choke DOT stops on death (regression guard, fixed Session 12).
 *
 * The per-turn Choke handler must NOT apply 1d6 to an actor who is already dead;
 * it should just clear the chokeState flag. Set the choked actor dead, arm a
 * choke, advance to its turn, and assert: HP unchanged + chokeState cleared.
 *
 * (The live BTM-reduced choke tick is covered by choke-btm.spec.js.)
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("§8 a dead choked target takes no choke damage; flag is cleared", async ({ page }) => {
  await login(page, ACCOUNTS.gm, { canvas: true });
  await cleanupTestData(page).catch(() => {});
  const seed = await setupSceneWithToken(page, { activate: true, actorName: "__PW__Other" });
  await waitForCanvasScene(page, seed.sceneId);

  const ids = await evalGameOrThrow(page, async (arg) => {
    await game.settings.set("cyberpunk2020", "specialMeleeEffectsEnabled", true);
    const flags = { cyberpunk2020: { __pwtest: true } };
    const scene = game.scenes.get(arg.sceneId);

    // The choked, already-dead actor (acts AFTER "Other" so we can advance onto its turn).
    const choked = await Actor.create({ name: "__PW__Choked", type: "character", flags, system: { damage: 5 } });
    const [chokedTok] = await scene.createEmbeddedDocuments("Token", [
      { name: choked.name, x: 1300, y: 1000, actorId: choked.id, actorLink: true, width: 1, height: 1, flags },
    ]);
    await choked.createEmbeddedDocuments("ActiveEffect", [{ name: "Dead", statuses: ["dead"], flags }]);
    await choked.setFlag("cyberpunk2020", "chokeState", { formula: "1d6" });

    const combat = await Combat.create({ scene: arg.sceneId, flags });
    await combat.createEmbeddedDocuments("Combatant", [
      { tokenId: arg.tokenId, sceneId: arg.sceneId, actorId: arg.actorId, initiative: 20 },     // Other, turn 0
      { tokenId: chokedTok.id, sceneId: arg.sceneId, actorId: choked.id, initiative: 10 },        // Choked, turn 1
    ]);
    await combat.startCombat();
    return { chokedActorId: choked.id, isDead: choked.statuses.has("dead"), damageBefore: choked.system.damage };
  }, seed);

  expect(ids.isDead, "choked actor is marked dead").toBe(true);
  expect(ids.damageBefore, "starting HP damage").toBe(5);

  // Advance onto the choked (dead) actor's turn → the per-turn Choke handler runs for it.
  await evalGameOrThrow(page, async () => { await game.combat.nextTurn(); });

  // chokeState should clear; damage must NOT increase.
  const readState = () => evalGameOrThrow(page, (id) => {
    const a = game.actors.get(id);
    return { damage: Number(a.system.damage) || 0, choke: a.getFlag("cyberpunk2020", "chokeState") ?? null };
  }, ids.chokedActorId);

  const dl = Date.now() + 8_000;
  let s = await readState();
  while (Date.now() < dl && s.choke !== null) { await page.waitForTimeout(200); s = await readState(); }

  expect(s.choke, "chokeState cleared on a dead actor").toBeNull();
  expect(s.damage, "no choke damage applied to a dead actor").toBe(5);
});
