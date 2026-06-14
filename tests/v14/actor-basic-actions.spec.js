import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * Safety net for the actor sheet's "basic actions" click handlers (stat / skill / initiative /
 * stun-death rolls, the damage box, etc.) ahead of the Stage A2 native-DOM rewrite of
 * `_cpActivateBasicActorActions`. Upstream wires these as a single delegated click listener on the
 * root that dispatches via `target.closest(...)`; this spec proves each element is still wired to
 * its action so the rewrite can't silently misroute one.
 *
 * Strategy: spy the actor roll methods (record + no-op so there are no chat/combat side effects),
 * click each element that is present, and assert that every present element fired its action.
 *
 *   v14 (:30002)  npx playwright test --config playwright.v14.config.js v14/actor-basic-actions.spec.js
 *   v13 (:30003)  FVTT_URL=http://localhost:30003 (same command)
 *
 * Needs the rig world + FVTT_RIG_PASSWORD. DO NOT run automatically.
 */
test("actor-sheet V2: basic-action elements are wired to their actions", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e?.message ?? e)));

  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [], present: {}, fired: {} };
    let actor;
    try {
      actor = await Actor.create({ name: "ZZ BasicActions Probe", type: "character" });
      await actor.createEmbeddedDocuments("Item", [
        { name: "ZZ Probe Skill", type: "skill", system: { level: 3 } },
      ]);

      const sheet = actor.sheet;
      await sheet.render({ force: true });
      await new Promise((r) => setTimeout(r, 700));
      const root = sheet.element;

      // selector -> the action we expect it to trigger
      const MAP = {
        ".stat-roll": "rollStat",
        ".facedown-roll": "rollFacedown",
        ".recognition-roll": "rollRecognition",
        ".skill-roll": "rollSkill",
        ".roll-initiative": "addToCombatAndRollInitiative",
        ".stun-death-save": "rollStunDeath",
      };

      // Spy the actor roll methods: record a call, do nothing else (no chat/combat side effects).
      const restores = [];
      for (const action of new Set(Object.values(MAP))) {
        out.fired[action] = 0;
        if (typeof actor[action] === "function") {
          actor[action] = function () { out.fired[action]++; };
          restores.push(() => { delete actor[action]; });
        }
      }
      // The damage box writes system.damage via actor.update — record without persisting.
      out.fired["update:system.damage"] = 0;
      const origUpdate = actor.update;
      actor.update = function (data) {
        if (data && Object.keys(data).some((k) => k === "system.damage")) out.fired["update:system.damage"]++;
        return Promise.resolve(actor);
      };
      restores.push(() => { actor.update = origUpdate; });

      const clickIf = (sel) => {
        const el = root.querySelector(sel);
        out.present[sel] = !!el;
        if (el) el.click();
      };

      for (const sel of Object.keys(MAP)) clickIf(sel);
      clickIf(".damage");

      await new Promise((r) => setTimeout(r, 200));
      restores.forEach((fn) => fn());
      await sheet.close();
    } catch (e) {
      out.errors.push(String(e?.stack ?? e?.message ?? e));
    } finally {
      try { await actor?.delete(); } catch (_) {}
    }
    return out;
  });

  console.log("basic-actions wiring:", JSON.stringify(result, null, 2));
  console.log("console errors:", JSON.stringify(consoleErrors, null, 2));

  expect(result.errors, "no thrown errors").toEqual([]);

  // Must have rendered the core, always-present controls (guards against a trivially-empty pass).
  expect(result.present[".stat-roll"], ".stat-roll present").toBe(true);
  expect(result.present[".skill-roll"], ".skill-roll present (skill added)").toBe(true);
  expect(result.present[".roll-initiative"], ".roll-initiative present").toBe(true);
  expect(result.present[".stun-death-save"], ".stun-death-save present").toBe(true);

  // Every element that IS present must have fired its action (the dispatch is what the rewrite changes).
  const SEL_TO_ACTION = {
    ".stat-roll": "rollStat",
    ".facedown-roll": "rollFacedown",
    ".recognition-roll": "rollRecognition",
    ".skill-roll": "rollSkill",
    ".roll-initiative": "addToCombatAndRollInitiative",
    ".stun-death-save": "rollStunDeath",
    ".damage": "update:system.damage",
  };
  for (const [sel, action] of Object.entries(SEL_TO_ACTION)) {
    if (result.present[sel]) {
      expect(result.fired[action], `${sel} click fired ${action}`).toBeGreaterThan(0);
    }
  }
});
