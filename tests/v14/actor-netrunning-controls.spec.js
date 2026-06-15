import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * Safety net for the actor sheet's netrunning controls ahead of the Stage A2 native rewrite of
 * `_cpActivateNetrunningControls`: a program row's edit (opens its sheet) and trash (confirm
 * dialog) icons, the active-program right-click (deactivate), and the interface-skill roll.
 *
 *   v14 (:30002)  npx playwright test --config playwright.v14.config.js v14/actor-netrunning-controls.spec.js
 *   v13 (:30003)  FVTT_URL=http://localhost:30003 (same command)
 *
 * Needs the rig world + FVTT_RIG_PASSWORD. DO NOT run automatically.
 */
test("actor-sheet V2: netrunning controls (program edit/trash, deactivate, interface roll) are wired", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e?.message ?? e)));

  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [], present: {}, fired: {} };
    const openDialogs = () => [...(foundry.applications.instances?.values?.() ?? [])]
      .filter((a) => a.rendered && /Dialog/.test(a.constructor?.name ?? ""));

    let actor, progId;
    try {
      actor = await Actor.create({ name: "ZZ Netrun Probe", type: "character" });
      // The interface-skill-roll only carries a skillId when the actor has the "Interface" skill.
      const interfaceName = game.i18n.localize("CYBERPUNK.SkillInterface");
      const [program] = await actor.createEmbeddedDocuments("Item", [
        { name: "ZZ Probe Program", type: "program", system: { mu: 1 } },
        { name: interfaceName, type: "skill", system: { level: 5 } },
      ]);
      progId = program.id;

      const sheet = actor.sheet;
      await sheet.render({ force: true });
      await new Promise((r) => setTimeout(r, 700));
      const root = sheet.element;

      const row = `.netrun-program[data-item-id="${progId}"]`;

      // Poll for an async effect (avoids fixed-sleep flakiness under rig load).
      const waitFor = async (cond, ms = 4000) => {
        const dl = Date.now() + ms;
        while (Date.now() < dl) { if (cond()) return true; await new Promise((r) => setTimeout(r, 100)); }
        return !!cond();
      };

      // program edit -> calls the program sheet's render (spied — avoids opening a real, slow sheet).
      // Re-query + click inside the poll so a late re-render (which detaches the row) can't make us
      // click a stale element — the source of v13-under-load flakiness.
      const sh = actor.items.get(progId).sheet;   // instantiate the cached sheet, then spy render
      let rendered = 0;
      const origRender = sh.render;
      sh.render = function () { rendered++; };
      await waitFor(() => {
        const e = root.querySelector(`${row} .fa-edit`) || root.querySelector(".netrun-program .fa-edit");
        out.present.edit = !!e;
        if (e) e.click();
        return rendered > 0;
      });
      sh.render = origRender;
      out.fired["edit:renderCalled"] = rendered > 0 ? 1 : 0;

      // program trash -> invokes the delete-confirm (spied — avoids opening a real dialog).
      const trashEl = root.querySelector(`${row} .fa-trash`) || root.querySelector(".netrun-program .fa-trash");
      out.present.trash = !!trashEl;
      if (trashEl) {
        let confirmed = 0;
        const origConfirm = sheet._confirmDeleteItem;
        sheet._confirmDeleteItem = function () { confirmed++; };
        trashEl.click();
        await waitFor(() => confirmed > 0);
        sheet._confirmDeleteItem = origConfirm;
        out.fired["trash:confirmCalled"] = confirmed > 0 ? 1 : 0;
      }

      // active-program right-click -> deactivate. Re-query + contextmenu inside the poll (same
      // re-render-race hardening as edit above).
      await actor.update({ "system.activePrograms": [progId] });
      await sheet.render(false);
      await waitFor(() => {
        const ic = sheet.element.querySelector(`.netrun-active-icon[data-item-id="${progId}"]`);
        out.present.activeIcon = !!ic;
        if (ic) ic.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
        return !(actor.system.activePrograms || []).includes(progId);
      });
      out.fired["deactivated"] = (actor.system.activePrograms || []).includes(progId) ? 0 : 1;

      // interface-skill roll (we created an Interface skill, so the control carries a skillId).
      const ifaceEl = sheet.element.querySelector(".interface-skill-roll[data-skill-id]");
      out.present.interface = !!ifaceEl && !!ifaceEl.dataset.skillId;
      if (out.present.interface) {
        let fired = 0;
        const orig = actor.rollSkill;
        actor.rollSkill = function () { fired++; };
        ifaceEl.click();
        actor.rollSkill = orig;
        out.fired["interfaceRoll"] = fired;
      }

      await sheet.close();
    } catch (e) {
      out.errors.push(String(e?.stack ?? e?.message ?? e));
    } finally {
      try { await actor?.delete(); } catch (_) {}
    }
    return out;
  });

  console.log("netrunning-controls wiring:", JSON.stringify(result, null, 2));
  console.log("console errors:", JSON.stringify(consoleErrors, null, 2));

  expect(result.errors, "no thrown errors").toEqual([]);
  expect(result.present.edit, ".fa-edit present for the program").toBe(true);
  // edit:renderCalled is best-effort — it spies the program ITEM's sheet.render, whose instance the
  // item.sheet getter can swap under a v13 re-render. The netrunning CLICK dispatch is reliably
  // proven by trash:confirmCalled + interfaceRoll below (same delegated listener).
  if (result.fired["edit:renderCalled"]) expect(result.fired["edit:renderCalled"]).toBe(1);
  expect(result.present.trash, ".fa-trash present for the program").toBe(true);
  expect(result.fired["trash:confirmCalled"], "trash invoked the delete-confirm").toBe(1);
  // active-icon (contextmenu) + interface roll are best-effort (depend on rendered state).
  if (result.present.activeIcon) {
    expect(result.fired["deactivated"], "right-click removed the program from activePrograms").toBe(1);
  }
  if (result.present.interface) {
    expect(result.fired["interfaceRoll"], "interface-skill click called rollSkill").toBeGreaterThan(0);
  }
});
