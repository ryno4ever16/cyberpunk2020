import { test, expect } from "@playwright/test";
import { loginRig, evalGameOrThrow, cleanupTestData } from "./rig-e2e-helpers.js";

/**
 * Rig-portable port of tests/e2e/melee.spec.js — identical body; login swapped to the rig (loginRig).
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await loginRig(p); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("§8 martial grapple-chain effects, escape, enable toggle, and defense-skill pick", async ({ page }) => {
  await loginRig(page);
  await cleanupTestData(page).catch(() => {});

  const r = await evalGameOrThrow(page, async () => {
    const C = CONFIG.Item.documentClass;
    const flags = { cyberpunk2020: { __pwtest: true } };
    const attacker = await Actor.create({ name: "__PW__Attacker", type: "character", flags });
    const target   = await Actor.create({ name: "__PW__Target",   type: "character", flags });
    const F = (a, k) => a.getFlag("cyberpunk2020", k) ?? null;

    await game.settings.set("cyberpunk2020", "specialMeleeEffectsEnabled", true);

    await C._applyMartialHitEffects("Hold", target, attacker);
    const heldBy = F(target, "heldBy");

    await C._applyMartialHitEffects("Grapple", target, attacker);
    const grappledBy = F(target, "grappledBy");

    await C._applyMartialHitEffects("Choke", target, attacker);
    const chokeFormula = F(target, "chokeState")?.formula ?? null;

    await C._applyMartialHitEffects("Throw", target, attacker);
    const throwKnockdown = game.messages.contents.some(m =>
      (m.content || "").includes("__PW__Target") && /prone|knockdown/i.test(m.content || ""));

    // Escape clears every grapple-chain flag at once
    await C._applyMartialHitEffects("Escape", target, attacker);
    const afterEscape = {
      heldBy: F(target, "heldBy"), grappledBy: F(target, "grappledBy"), chokeState: F(target, "chokeState"),
    };

    // Modular toggle: disabled → no flag is written
    await game.settings.set("cyberpunk2020", "specialMeleeEffectsEnabled", false);
    await C._applyMartialHitEffects("Hold", target, attacker);
    const heldByWhenDisabled = F(target, "heldBy");
    await game.settings.set("cyberpunk2020", "specialMeleeEffectsEnabled", true); // restore world default

    // Defense picks the highest skill: Dodge 8 beats Brawling 5; rolls 1d10 + REF + skill
    const defender = await Actor.create({ name: "__PW__Defender2", type: "character", flags });
    await defender.update({ "system.stats.ref.base": 8 });
    await defender.createEmbeddedDocuments("Item", [
      { name: "Brawling", type: "skill", flags, system: { level: 5, stat: "ref" } },
      { name: "Dodge",    type: "skill", flags, system: { level: 8, stat: "ref" } },
    ]);
    const def = await C._rollMeleeDefense(defender);

    return {
      attackerId: attacker.id, heldBy, grappledBy, chokeFormula, throwKnockdown, afterEscape, heldByWhenDisabled,
      def: { skillName: def.skillName, skillVal: def.skillVal, ref: def.ref, total: def.total, rollTotal: def.roll.total },
    };
  });

  // Grapple chain sets the right flags pointing at the attacker
  expect(r.heldBy, "Hold sets heldBy = attacker").toBe(r.attackerId);
  expect(r.grappledBy, "Grapple sets grappledBy = attacker").toBe(r.attackerId);
  expect(r.chokeFormula, "Choke arms a 1d6 DOT").toBe("1d6");
  expect(r.throwKnockdown, "Throw posts a knockdown/prone chat").toBe(true);

  // Escape frees the target from all three at once
  expect(r.afterEscape.heldBy, "escape clears heldBy").toBeNull();
  expect(r.afterEscape.grappledBy, "escape clears grappledBy").toBeNull();
  expect(r.afterEscape.chokeState, "escape clears chokeState").toBeNull();

  // Modular rule respected: nothing happens when the optional rule is off
  expect(r.heldByWhenDisabled, "disabled setting → Hold is a no-op").toBeNull();

  // Contested defense uses the best skill and the REF stat
  expect(r.def.skillName, "best defense skill is Dodge (8 > 5)").toBe("Dodge");
  expect(r.def.skillVal, "best skill value").toBe(8);
  expect(r.def.ref, "REF feeds the defense roll").toBe(8);
  expect(r.def.total, "total === the evaluated roll total").toBe(r.def.rollTotal);
  // 1d10 + REF 8 + skill 8  →  17..26
  expect(r.def.total, "defense total in 1d10+8+8 range").toBeGreaterThanOrEqual(17);
  expect(r.def.total, "defense total in 1d10+8+8 range").toBeLessThanOrEqual(26);
});
