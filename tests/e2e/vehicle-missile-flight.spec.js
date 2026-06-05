import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Vehicle — Phase 5f-2: stateful missile flight. Launch spawns a hidden tracked token; advancing
 * a round moves it toward the target; on the impact round it rolls its guidance to-hit and (on a
 * hit) resolves through the dispatcher, then the token is removed.
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("Phase 5f-2: missile launch, flight advance, and impact", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const F = await import("/systems/cyberpunk2020/module/vehicle/vehicle-missile-flight.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const out = {};
    const origMM = game.settings.get("cyberpunk2020", "mmEnabled");
    const origRule = game.settings.get("cyberpunk2020", "vehicleRuleSystem");
    let scene, shooter, target, missileTok;
    try {
      await game.settings.set("cyberpunk2020", "mmEnabled", true);
      await game.settings.set("cyberpunk2020", "vehicleRuleSystem", "MaximumMetal");
      scene = await Scene.create({ name: "__PW__missilescene", width: 6000, height: 2000, grid: { type: 1, size: 100, distance: 2, units: "m" }, padding: 0, flags });
      shooter = await Actor.create({ name: "__PW__Shooter", type: "npc", flags });
      target = await Actor.create({ name: "__PW__TgtVeh", type: "vehicle", flags, system: { sp: { front: 0, side: 0, rear: 0, top: 0, bottom: 0 }, sdp: { value: 200, max: 200 } } });
      const [sTok] = await scene.createEmbeddedDocuments("Token", [{ name: "__PW__Shooter", x: 0, y: 0, width: 1, height: 1, actorId: shooter.id, flags }]);
      const [tTok] = await scene.createEmbeddedDocuments("Token", [{ name: "__PW__TgtVeh", x: 4000, y: 0, width: 4, height: 2, actorId: target.id, actorLink: true, flags }]);

      // Launch.
      missileTok = await F.launchMissile({ scene, shooterToken: sTok, targetToken: tTok, missile: {
        guidance: "semiActive", penetration: 30, operatorBonus: 99, targetNumber: 0, weaponName: "__PW__Missile" } });
      out.launched = !!missileTok;
      const mf = missileTok?.flags?.cyberpunk2020?.missile;
      out.hasFlight = !!mf;
      out.hidden = missileTok?.hidden === true;
      out.tti = mf?.turnsToImpact;
      out.targetSet = mf?.targetTokenId === tTok.id;

      // Force a 2-turn flight to exercise the move step.
      await missileTok.update({ ["flags.cyberpunk2020.missile.turnsToImpact"]: 2 });
      const x0 = scene.tokens.get(missileTok.id).x;
      await F.advanceMissiles(scene);
      const mAfter = scene.tokens.get(missileTok.id);
      out.stillFlying = !!mAfter;
      out.movedCloser = !!mAfter && mAfter.x > x0;
      out.ttiAfter = mAfter?.flags?.cyberpunk2020?.missile?.turnsToImpact;

      // Next advance → impact: token removed, target damaged (Pen 30 vs AV 0 → catastrophic).
      await F.advanceMissiles(scene);
      out.tokenGone = !scene.tokens.get(missileTok.id);
      out.targetDamaged = target._source.system.sdp.value < 200 || target._source.system.destroyed === true;
    } finally {
      await game.settings.set("cyberpunk2020", "mmEnabled", origMM);
      await game.settings.set("cyberpunk2020", "vehicleRuleSystem", origRule);
      if (scene) await scene.delete().catch(() => {});
      for (const a of game.actors.filter(x => x.name?.startsWith("__PW__"))) await a.delete().catch(() => {});
    }
    return out;
  });

  console.log("Phase 5f-2 flight:", JSON.stringify(R));
  expect(R.launched).toBe(true);
  expect(R.hasFlight).toBe(true);
  expect(R.hidden).toBe(true);
  expect(R.tti).toBeGreaterThanOrEqual(1);
  expect(R.targetSet).toBe(true);
  expect(R.stillFlying).toBe(true);
  expect(R.movedCloser).toBe(true);
  expect(R.ttiAfter).toBe(1);
  expect(R.tokenGone).toBe(true);
  expect(R.targetDamaged).toBe(true);
});
