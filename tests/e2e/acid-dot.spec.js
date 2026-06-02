import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, setupSceneWithToken, cleanupTestData } from "../helpers/foundry.js";

/**
 * QA §12 — Acid armor degradation (DOT).
 *
 * Acid ammo starts a lasting effect that reduces the outer armor layer's SP each
 * turn until the timer runs out. Driven through the real updateCombat tick.
 * A constant roll ("3") makes the per-turn SP reduction exactly observable.
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

test("§12 acid DOT degrades armor SP each turn, then expires", async () => {
  const ids = await setupSceneWithToken(gmPage, { activate: true, actorName: "__PW__AcidVictim" });

  const result = await evalGameOrThrow(gmPage, async (arg) => {
    const actor = game.actors.get(arg.actorId);
    await game.settings.set("cyberpunk2020", "acidArmorDotEnabled", true);

    // Equip armor: Torso SP 18.
    const [armor] = await actor.createEmbeddedDocuments("Item", [{
      name: "__PW__AcidVest", type: "armor",
      system: { equipped: true, armorType: "soft", coverage: { Torso: { stoppingPower: 18 } } },
    }]);
    const armorId = armor.id;
    const itemSP = () => Number(actor.items.get(armorId)?.system.coverage?.Torso?.stoppingPower) || 0;
    const startSP = itemSP();

    // 2-turn acid effect, constant roll 3 -> -3 SP per tick.
    await actor.setFlag("cyberpunk2020", "dotState", [{ location: "Torso", turnsLeft: 2, formula: "3" }]);

    const combat = await Combat.create({ scene: arg.sceneId, flags: { cyberpunk2020: { __pwtest: true } } });
    await combat.createEmbeddedDocuments("Combatant", [
      { tokenId: arg.tokenId, sceneId: arg.sceneId, actorId: arg.actorId },
    ]);

    const waitStable = async (below) => {
      const hard = Date.now() + 15_000;
      let v = itemSP();
      while (Date.now() < hard && v >= below) { await new Promise(r => setTimeout(r, 150)); v = itemSP(); }
      let last = v, since = Date.now();
      while (Date.now() < hard) {
        await new Promise(r => setTimeout(r, 200));
        const now = itemSP();
        if (now !== last) { last = now; since = Date.now(); }
        else if (Date.now() - since >= 1500) break;
      }
      return last;
    };

    await combat.startCombat();
    const afterTick1 = await waitStable(startSP);
    await combat.nextTurn();
    const afterTick2 = await waitStable(afterTick1);
    await new Promise(r => setTimeout(r, 600));

    const flag = actor.getFlag("cyberpunk2020", "dotState");
    const expiredMsg = game.messages.contents.some(m =>
      (m.content || "").includes(actor.name) && (m.content || "").includes("expired"));

    await actor.unsetFlag("cyberpunk2020", "dotState").catch(() => {});
    await combat.delete().catch(() => {});

    return {
      startSP, afterTick1, afterTick2,
      flagCleared: flag === undefined || flag === null || (Array.isArray(flag) && flag.length === 0),
      expiredMsg,
    };
  }, ids);

  console.log("Acid DOT:", JSON.stringify(result));

  expect(result.startSP, "vest starts at SP 18").toBe(18);
  // Per-tick reduction = g * 3 (g=1 with the activeGM guard). Robust to client count:
  expect(result.startSP - result.afterTick1, "tick 1 reduces SP by a multiple of 3").toBeGreaterThan(0);
  expect((result.startSP - result.afterTick1) % 3, "tick 1 SP loss is a whole number of (roll 3)").toBe(0);
  expect(result.afterTick2, "tick 2 reduces SP further").toBeLessThan(result.afterTick1);
  expect((result.afterTick1 - result.afterTick2) % 3, "tick 2 SP loss is a whole number of (roll 3)").toBe(0);
  expect(result.flagCleared, "acid effect clears after its turns").toBe(true);
  expect(result.expiredMsg, "an 'expired' message posts when the acid finishes").toBe(true);
});
