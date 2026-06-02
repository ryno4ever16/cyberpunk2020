import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, setupSceneWithToken, waitForCanvasScene, cleanupTestData } from "../helpers/foundry.js";

/**
 * QA §9 / §8 — Active-defense + multi-action tracker controls (UI-driven).
 *
 * These three controls share the aim button's plumbing: a document-level click
 * listener keyed on hover-hidden combatant-control anchors. So we drive them the
 * same way — dispatch a bubbling click and poll the resulting actor flag.
 *
 *   .cp-dodge-btn      → toggles the actor's "dodging"  flag  (active combatant)
 *   .cp-parry-btn      → toggles the actor's "parrying" flag  (any owned combatant)
 *   .cp-add-action-btn → _incrementActionCount() → "actionCount" flag (active)
 *
 * multiActionAutoTrack is forced OFF so declaring dodge/parry does NOT bump
 * actionCount — that keeps the ➕ assertion exact. The auto-track path itself is
 * covered by multi-action.spec.js (weaponFired increments).
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("§9 tracker controls: dodge & parry toggle, ➕ increments actionCount", async ({ page }) => {
  await login(page, ACCOUNTS.gm, { canvas: true });
  await cleanupTestData(page).catch(() => {});
  const scene = await setupSceneWithToken(page, { activate: true, actorName: "__PW__Defender" });
  await waitForCanvasScene(page, scene.sceneId);

  const actorId = await evalGameOrThrow(page, async (arg) => {
    await game.settings.set("cyberpunk2020", "activeDodgeParryEnabled", true);
    await game.settings.set("cyberpunk2020", "multiActionPenaltyEnabled", true);
    await game.settings.set("cyberpunk2020", "multiActionAutoTrack", false);
    const actor = game.actors.get(arg.actorId);
    for (const f of ["dodging", "parrying", "actionCount", "actionCountRound"]) {
      await actor.unsetFlag("cyberpunk2020", f).catch(() => {});
    }
    const combat = await Combat.create({ scene: arg.sceneId, flags: { cyberpunk2020: { __pwtest: true } } });
    await combat.createEmbeddedDocuments("Combatant", [
      { tokenId: arg.tokenId, sceneId: arg.sceneId, actorId: arg.actorId },
    ]);
    await combat.startCombat();
    await ui.combat.render(true);
    return arg.actorId;
  }, scene);

  // Re-resolve the anchor on every click — the tracker re-renders after each toggle,
  // replacing the old <a>. Locators are lazy so .first() picks up the fresh element.
  const dispatchClick = async (selector) => {
    const loc = page.locator(`${selector}[data-actor-id="${actorId}"]`).first();
    await expect(loc).toBeAttached({ timeout: 15_000 });
    await loc.dispatchEvent("click");
  };
  const readFlag = (flag) => evalGameOrThrow(
    page,
    (a) => game.actors.get(a.id).getFlag("cyberpunk2020", a.flag) ?? null,
    { id: actorId, flag }
  );
  const waitForFlag = async (flag, predicate) => {
    const dl = Date.now() + 6_000;
    let v = await readFlag(flag);
    while (Date.now() < dl && !predicate(v)) { await page.waitForTimeout(200); v = await readFlag(flag); }
    return v;
  };

  // --- Dodge: declare then cancel ---
  await dispatchClick(".cp-dodge-btn");
  expect(await waitForFlag("dodging", (v) => v === true), "dodge declared").toBe(true);
  await dispatchClick(".cp-dodge-btn");
  expect(await waitForFlag("dodging", (v) => !v), "dodge cancelled").toBeFalsy();

  // --- Parry: declare then cancel ---
  await dispatchClick(".cp-parry-btn");
  expect(await waitForFlag("parrying", (v) => v === true), "parry declared").toBe(true);
  await dispatchClick(".cp-parry-btn");
  expect(await waitForFlag("parrying", (v) => !v), "parry cancelled").toBeFalsy();

  // --- Add action: each ➕ click increments actionCount (autoTrack off, so no dodge/parry bleed) ---
  await dispatchClick(".cp-add-action-btn");
  expect(await waitForFlag("actionCount", (v) => Number(v) === 1), "1st ➕ -> count 1").toBe(1);
  await dispatchClick(".cp-add-action-btn");
  expect(await waitForFlag("actionCount", (v) => Number(v) === 2), "2nd ➕ -> count 2").toBe(2);
});
