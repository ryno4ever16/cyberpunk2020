import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * Safety net for the actor sheet's cyberware-tab controls ahead of the Stage A2 native rewrite of
 * `_cpActivateCyberwareControls`: the anatomy body-type <select>, the per-skill chip-toggle, and the
 * equipped-item unequip control. Asserts each is wired to its effect so the rewrite can't misroute.
 *
 *   v14 (:30002)  npx playwright test --config playwright.v14.config.js v14/actor-cyberware-controls.spec.js
 *   v13 (:30003)  FVTT_URL=http://localhost:30003 (same command)
 *
 * Needs the rig world + FVTT_RIG_PASSWORD. DO NOT run automatically.
 */
test("actor-sheet V2: cyberware controls (anatomy / chip-toggle / unequip) are wired", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e?.message ?? e)));

  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [], present: {}, fired: {} };
    const fireChange = (el) => el.dispatchEvent(new Event("change", { bubbles: true }));

    let actor, skillId;
    try {
      actor = await Actor.create({ name: "ZZ Cyberware Probe", type: "character" });
      const [skill] = await actor.createEmbeddedDocuments("Item", [
        { name: "ZZ Probe Skill", type: "skill", system: { level: 1 } },
      ]);
      skillId = skill.id;

      const sheet = actor.sheet;
      await sheet.render({ force: true });
      await new Promise((r) => setTimeout(r, 700));
      const root = sheet.element;

      // anatomy-select: changing it sets the anatomyImage flag.
      const anatomy = root.querySelector(".anatomy-select");
      out.present.anatomy = !!anatomy;
      if (anatomy) {
        const opt = [...anatomy.options].map((o) => o.value).find((v) => v && v !== anatomy.value)
          ?? anatomy.value;
        anatomy.value = opt;
        fireChange(anatomy);
        await new Promise((r) => setTimeout(r, 250));
        out.fired.anatomyFlag = actor.getFlag("cyberpunk2020", "anatomyImage") === opt ? 1 : 0;
      }

      // chip-toggle: a skill with no linked chip → toggling writes system.isChipped on the skill.
      const liveSkill = actor.items.get(skillId);
      const skillUpdates = [];
      const origUpdate = liveSkill.update;
      liveSkill.update = function (data) { skillUpdates.push(Object.keys(data || {})); return Promise.resolve(liveSkill); };

      const chipToggle = root.querySelector(`.chip-toggle input[data-skill-id="${skillId}"]`);
      out.present.chipToggle = !!chipToggle;
      if (chipToggle) {
        chipToggle.checked = !chipToggle.checked;
        fireChange(chipToggle);
        await new Promise((r) => setTimeout(r, 250));
        out.fired.chipToggleUpdate = skillUpdates.some((keys) => keys.some((k) => k.startsWith("system.isChipped"))) ? 1 : 0;
      }
      liveSkill.update = origUpdate;

      // item-unequip (best-effort: only present if an equipped cyberware renders one).
      let unequipFired = 0;
      const origUnequip = sheet._onActiveUnequip;
      sheet._onActiveUnequip = function () { unequipFired++; return Promise.resolve(); };
      const unequip = root.querySelector(".item-unequip");
      out.present.unequip = !!unequip;
      if (unequip) { unequip.click(); await new Promise((r) => setTimeout(r, 150)); }
      sheet._onActiveUnequip = origUnequip;
      out.fired.unequip = unequipFired;

      await sheet.close();
    } catch (e) {
      out.errors.push(String(e?.stack ?? e?.message ?? e));
    } finally {
      try { await actor?.delete(); } catch (_) {}
    }
    return out;
  });

  console.log("cyberware-controls wiring:", JSON.stringify(result, null, 2));
  console.log("console errors:", JSON.stringify(consoleErrors, null, 2));

  expect(result.errors, "no thrown errors").toEqual([]);
  expect(result.present.anatomy, ".anatomy-select present").toBe(true);
  expect(result.fired.anatomyFlag, "anatomy change set the anatomyImage flag").toBe(1);
  expect(result.present.chipToggle, ".chip-toggle checkbox present for the skill").toBe(true);
  expect(result.fired.chipToggleUpdate, "chip-toggle change wrote system.isChipped").toBe(1);
  // unequip is best-effort (needs an equipped cyberware to render its control).
  if (result.present.unequip) {
    expect(result.fired.unequip, "item-unequip click called _onActiveUnequip").toBeGreaterThan(0);
  }
});
