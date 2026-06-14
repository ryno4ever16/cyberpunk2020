import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * Safety net for the actor sheet's form-control handlers ahead of the Stage A2 native rewrite of
 * `_cpActivateActorFormControls`. Upstream wires these as native `change`/`input`/`click` listeners
 * on the root, dispatched via `target.matches(...)`. This spec dispatches a `change` event on each
 * control and asserts it still writes the right thing — so the rewrite can't misroute one.
 *
 * Covered (change handlers): SDP current, skill-sort, skill-ask-mod, initiative modifier, stun-death
 * modifier. (skill-level change shares the same dispatch; its body — saveSkillLevel — is ported
 * verbatim, so it's not separately asserted here.)
 *
 *   v14 (:30002)  npx playwright test --config playwright.v14.config.js v14/actor-form-controls.spec.js
 *   v13 (:30003)  FVTT_URL=http://localhost:30003 (same command)
 *
 * Needs the rig world + FVTT_RIG_PASSWORD. DO NOT run automatically.
 */
test("actor-sheet V2: form-control change handlers write the right field", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e?.message ?? e)));

  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [], present: {}, fired: {} };
    const fireChange = (el) => el.dispatchEvent(new Event("change", { bubbles: true }));

    let actor, skillId;
    try {
      actor = await Actor.create({ name: "ZZ FormControls Probe", type: "character" });
      const [skill] = await actor.createEmbeddedDocuments("Item", [
        { name: "ZZ Probe Skill", type: "skill", system: { level: 1 } },
      ]);
      skillId = skill.id;

      const sheet = actor.sheet;
      await sheet.render({ force: true });
      await new Promise((r) => setTimeout(r, 700));
      const root = sheet.element;

      // Spies: record what was written, do not persist (avoids side effects + re-render churn).
      const actorUpdates = [];
      const restores = [];
      const origActorUpdate = actor.update;
      actor.update = function (data) { actorUpdates.push(Object.keys(data || {})); return Promise.resolve(actor); };
      restores.push(() => { actor.update = origActorUpdate; });

      out.fired.sortSkills = 0;
      const origSort = actor.sortSkills;
      actor.sortSkills = function () { out.fired.sortSkills++; return Promise.resolve(actor); };
      restores.push(() => { actor.sortSkills = origSort; });

      const liveSkill = actor.items.get(skillId);
      const skillUpdates = [];
      const origSkillUpdate = liveSkill.update;
      liveSkill.update = function (data) { skillUpdates.push(Object.keys(data || {})); return Promise.resolve(liveSkill); };
      restores.push(() => { liveSkill.update = origSkillUpdate; });

      const hasKey = (arr, prefix) => arr.some((keys) => keys.some((k) => k.startsWith(prefix)));

      // SDP current
      const sdp = root.querySelector('input[name^="system.sdp.current."]');
      out.present.sdp = !!sdp;
      if (sdp) { sdp.value = "3"; fireChange(sdp); }

      // skill-sort
      const sort = root.querySelector(".skill-sort > select, .skill-sort select");
      out.present.skillSort = !!sort;
      if (sort) { fireChange(sort); }

      // initiative modifier
      const initMod = root.querySelector(".roll-initiative-modificator");
      out.present.initMod = !!initMod;
      if (initMod) { initMod.value = "2"; fireChange(initMod); }

      // stun-death modifier
      const sdMod = root.querySelector(".roll-stun-death-modificator");
      out.present.stunDeathMod = !!sdMod;
      if (sdMod) { sdMod.value = "2"; fireChange(sdMod); }

      // skill-ask-mod (checkbox)
      const askMod = root.querySelector(`.skill-ask-mod[data-skill-id="${skillId}"]`) || root.querySelector(".skill-ask-mod");
      out.present.askMod = !!askMod;
      if (askMod) { askMod.checked = !askMod.checked; fireChange(askMod); }

      await new Promise((r) => setTimeout(r, 250));
      restores.forEach((fn) => fn());

      out.fired["sdp:update"] = hasKey(actorUpdates, "system.sdp.current.") ? 1 : 0;
      out.fired["initMod:update"] = hasKey(actorUpdates, "system.initiativeMod") ? 1 : 0;
      out.fired["stunDeathMod:update"] = hasKey(actorUpdates, "system.StunDeathMod") ? 1 : 0;
      out.fired["askMod:update"] = hasKey(skillUpdates, "system.askMods") ? 1 : 0;

      await sheet.close();
    } catch (e) {
      out.errors.push(String(e?.stack ?? e?.message ?? e));
    } finally {
      try { await actor?.delete(); } catch (_) {}
    }
    return out;
  });

  console.log("form-control wiring:", JSON.stringify(result, null, 2));
  console.log("console errors:", JSON.stringify(consoleErrors, null, 2));

  expect(result.errors, "no thrown errors").toEqual([]);
  if (result.present.sdp) expect(result.fired["sdp:update"], "SDP change wrote system.sdp.current.*").toBe(1);
  if (result.present.skillSort) expect(result.fired.sortSkills, "skill-sort change called sortSkills").toBeGreaterThan(0);
  if (result.present.initMod) expect(result.fired["initMod:update"], "initiative mod change wrote system.initiativeMod").toBe(1);
  if (result.present.stunDeathMod) expect(result.fired["stunDeathMod:update"], "stun-death mod change wrote system.StunDeathMod").toBe(1);
  if (result.present.askMod) expect(result.fired["askMod:update"], "ask-mod change wrote system.askMods").toBe(1);
  // Guard against a trivially-empty pass: at least the always-present SDP + modifiers must be there.
  expect(result.present.sdp || result.present.initMod || result.present.stunDeathMod, "some form controls present").toBe(true);
});
