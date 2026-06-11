import { test, expect } from "@playwright/test";
import { loginRig, evalGameOrThrow, setupSceneWithToken, cleanupTestData } from "./rig-e2e-helpers.js";

/**
 * Rig-portable port of tests/e2e/fire-dot.spec.js — identical body; login swapped to the rig (loginRig).
 *
 * QA §22 — Fire / Incendiary DOT ticks with BTM applied.
 *
 * The fire DOT (API/incendiary ammo) is meant to: burn HP each turn, be reduced
 * by the target's BTM (Session-16 correction: "all damage to a player is reduced
 * by BTM"), diminish each turn (mult halves: full, then half), and burn out.
 *
 * To make BTM verifiable we use a CONSTANT damage formula ("10"): the tick rolls
 * exactly 10, so per-tick HP loss must equal max(1, floor(10 * mult) - BTM).
 *   - BTM 3, mult 1.0  -> 10 - 3 = 7
 *   - BTM 3, mult 0.5  -> floor(5) - 3 = 2
 * The effect is driven through the real updateCombat tick, not by calling internals.
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

test("§22 fire DOT burns HP each turn, reduced by BTM, diminishing, then burns out", async () => {
  // Tough target: BT base 9 -> BTM 3. Scene is NOT activated (no canvas needed;
  // the tick handles a null token gracefully).
  // activate:true — creating a token requires a fully-drawn canvas for that scene
  // (otherwise TokenDocument._onCreate throws "addChild of null"). The fire tick
  // itself works regardless of canvas; the active scene just makes token creation safe.
  const ids = await setupSceneWithToken(gmPage, {
    activate: true,
    actorName: "__PW__Burner",
    actorUpdate: { "system.stats.bt.base": 9, "system.damage": 0 },
  });

  const result = await evalGameOrThrow(gmPage, async (arg) => {
    const actor = game.actors.get(arg.actorId);
    const btm = Number(actor.system.stats.bt.modifier) || 0;

    // Ensure fire DOT is enabled for this check.
    await game.settings.set("cyberpunk2020", "fireDotEnabled", true);

    // Two-turn burn at the Torso with a constant roll so BTM is exactly observable.
    await actor.setFlag("cyberpunk2020", "fireDotState", [
      { location: "Torso", turnsLeft: 2, formula: "10", mult: 1 },
    ]);

    const damageStart = Number(actor.system.damage) || 0;

    // Build a combat with this token and start it -> updateCombat fires -> tick 1.
    const combat = await Combat.create({ scene: arg.sceneId, flags: { cyberpunk2020: { __pwtest: true } } });
    await combat.createEmbeddedDocuments("Combatant", [
      { tokenId: arg.tokenId, sceneId: arg.sceneId, actorId: arg.actorId },
    ]);
    await combat.startCombat();

    const read = () => Number(game.actors.get(arg.actorId).system.damage) || 0;
    // Wait for a tick to land AND fully settle. Multiple GM clients apply the DOT
    // asynchronously; returning on the first increment can capture a partial tick
    // (the straggler then contaminates the next tick). So after the first increase
    // we wait until the value stops changing for 1.5s, capturing the complete tick.
    const waitForStable = async (above) => {
      const hardDeadline = Date.now() + 15_000;
      let d = read();
      while (Date.now() < hardDeadline && d <= above) { await new Promise(r => setTimeout(r, 150)); d = read(); }
      let last = d, stableSince = Date.now();
      while (Date.now() < hardDeadline) {
        await new Promise(r => setTimeout(r, 200));
        const now = read();
        if (now !== last) { last = now; stableSince = Date.now(); }
        else if (Date.now() - stableSince >= 1500) break;
      }
      return last;
    };

    const afterTick1 = await waitForStable(damageStart);

    // Advance to next turn (single combatant -> wraps to next round) -> tick 2.
    await combat.nextTurn();
    const afterTick2 = await waitForStable(afterTick1);

    // Give the burnout/flag-clear write a beat to settle.
    await new Promise(r => setTimeout(r, 600));
    const liveActor = game.actors.get(arg.actorId);
    const fireFlag = liveActor.getFlag("cyberpunk2020", "fireDotState");
    const burnedOut = game.messages.contents.some(m => (m.content || "").includes("burns out"));
    const stunPrompted = game.messages.contents.some(m =>
      (m.content || "").includes("Stun Save") && (m.content || "").includes(liveActor.name));

    await combat.delete().catch(() => {});

    return {
      activeGMs: game.users.contents.filter(u => u.active && u.isGM).map(u => u.name),
      activeUsers: game.users.contents.filter(u => u.active).map(u => u.name),
      btm,
      damageStart,
      afterTick1,
      afterTick2,
      tick1Delta: afterTick1 - damageStart,
      tick2Delta: afterTick2 - afterTick1,
      fireFlagCleared: fireFlag === undefined || fireFlag === null || (Array.isArray(fireFlag) && fireFlag.length === 0),
      burnedOut,
      stunPrompted,
    };
  }, ids);

  console.log("Fire DOT result:", JSON.stringify(result, null, 2));

  // Per-application amounts (these encode BTM): tick1 = floor(10*1.0) - BTM,
  // tick2 = floor(10*0.5) - BTM. In a live world N GM clients may each apply the
  // tick (the multi-GM duplication this session also fixes; see multi-gm-dot.spec).
  // To stay robust to the client count — which can even differ between the two
  // ticks while another spec's clients are disconnecting — we assert each tick is
  // a whole multiple of its BTM-reduced per-application amount and is NOT a
  // multiple of the un-reduced / un-diminished amount.
  const RAW = 10;
  const perTick1 = Math.max(1, Math.floor(RAW * 1.0) - result.btm); // BTM 3 -> 7
  const perTick2 = Math.max(1, Math.floor(RAW * 0.5) - result.btm); // BTM 3 -> 2
  console.log(`per-application: tick1=${perTick1}, tick2=${perTick2}; activeGMs=${JSON.stringify(result.activeGMs)}`);

  expect(result.btm, "BT base 9 should derive BTM 3 (a non-zero reduction is under test)").toBe(3);
  expect(perTick1, "BTM must reduce the per-tick burn below the raw roll").toBeLessThan(RAW);

  // tick 1: BTM applied. Multiple of (raw - BTM), and NOT of the raw roll.
  expect(result.tick1Delta, "fire DOT applied HP damage on the combat turn").toBeGreaterThanOrEqual(perTick1);
  expect(result.tick1Delta % perTick1, "tick 1 is a whole number of (rawRoll - BTM) burns").toBe(0);
  expect(result.tick1Delta % RAW, "tick 1 is NOT the un-reduced raw roll — BTM was subtracted").not.toBe(0);

  // tick 2: diminished. Multiple of the halved per-application, and NOT of the full one.
  expect(result.tick2Delta, "fire DOT ticked again on the next turn").toBeGreaterThanOrEqual(perTick2);
  expect(result.tick2Delta % perTick2, "tick 2 is a whole number of the diminished burn").toBe(0);
  expect(result.tick2Delta % perTick1, "tick 2 is NOT the full burn — it diminished").not.toBe(0);
  expect(perTick2, "diminishing burn: per-application tick 2 < tick 1").toBeLessThan(perTick1);

  // Structural behavior (robust to client count):
  expect(result.fireFlagCleared, "fireDotState flag clears after the burn ends").toBe(true);
  expect(result.burnedOut, "a 'burns out' message should post").toBe(true);
  expect(result.stunPrompted, "each fire tick should post a Stun Save prompt").toBe(true);
});
