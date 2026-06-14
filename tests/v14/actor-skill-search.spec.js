import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * Behaviour contract for the actor sheet's skill search, invariant across the Stage A2 switch from
 * our re-render filter (`_filterSkills` in _prepareContext) to upstream's in-place DOM filter
 * (`_cpApplySkillFilterToDOM`). Either way: typing a query shows only skills whose name matches, and
 * clearing shows them all again. Asserted by VISIBILITY (offsetParent), which is correct for both
 * implementations — ours doesn't render non-matches; his renders them with display:none.
 *
 *   v14 (:30002)  npx playwright test --config playwright.v14.config.js v14/actor-skill-search.spec.js
 *   v13 (:30003)  FVTT_URL=http://localhost:30003 (same command)
 *
 * Needs the rig world + FVTT_RIG_PASSWORD. DO NOT run automatically.
 */
test("actor-sheet V2: skill search shows only name-matches, clear restores all", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e?.message ?? e)));

  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [] };
    let actor;
    try {
      actor = await Actor.create({ name: "ZZ SkillSearch Probe", type: "character" });
      const made = await actor.createEmbeddedDocuments("Item", [
        { name: "ZZAlphaSkill", type: "skill", system: { level: 1 } },
        { name: "ZZBetaSkill", type: "skill", system: { level: 1 } },
        { name: "ZZGammaSkill", type: "skill", system: { level: 1 } },
      ]);
      const ids = Object.fromEntries(made.map((s) => [s.name, s.id]));

      const sheet = actor.sheet;
      await sheet.render({ force: true });           // skills tab is the default-active tab
      await new Promise((r) => setTimeout(r, 700));
      const root = sheet.element;

      const isVisible = (id) => {
        const row = root.querySelector(`.field.skill[data-item-id="${id}"]`)
          || root.querySelector(`[data-item-id="${id}"]`);
        return !!row && row.offsetParent !== null;
      };
      const snapshot = () => ({
        alpha: isVisible(ids.ZZAlphaSkill),
        beta: isVisible(ids.ZZBetaSkill),
        gamma: isVisible(ids.ZZGammaSkill),
      });

      out.initial = snapshot();

      // Type a query that matches only Alpha.
      const input = root.querySelector("input.skill-search");
      out.hasSearch = !!input;
      if (input) {
        input.value = "ZZALPHA";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 350)); // covers our 120ms debounce + re-render
      }
      out.afterFilter = snapshot();

      // Clear via the × button.
      const clearBtn = root.querySelector('[data-action="clear-skill-search"], .skill-search-clear');
      out.hasClear = !!clearBtn;
      if (clearBtn) {
        clearBtn.click();
        await new Promise((r) => setTimeout(r, 350));
      }
      out.afterClear = snapshot();

      await sheet.close();
    } catch (e) {
      out.errors.push(String(e?.stack ?? e?.message ?? e));
    } finally {
      try { await actor?.delete(); } catch (_) {}
    }
    return out;
  });

  console.log("skill-search:", JSON.stringify(result, null, 2));
  console.log("console errors:", JSON.stringify(consoleErrors, null, 2));

  expect(result.errors, "no thrown errors").toEqual([]);
  expect(result.hasSearch, "skill-search input present").toBe(true);

  // Initially all three are visible.
  expect(result.initial, "all skills visible initially").toEqual({ alpha: true, beta: true, gamma: true });
  // After filtering for ZZALPHA, only Alpha is visible.
  expect(result.afterFilter, "only the name-match is visible after filtering")
    .toEqual({ alpha: true, beta: false, gamma: false });
  // Clearing restores all three.
  if (result.hasClear) {
    expect(result.afterClear, "all skills visible after clearing").toEqual({ alpha: true, beta: true, gamma: true });
  }
});
