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

test("actor-sheet V2: item controls (edit / roll / delete) are wired", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e?.message ?? e)));

  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [], present: {}, fired: {} };
    let actor, weaponId;
    try {
      actor = await Actor.create({ name: "ZZ ItemCtl Probe", type: "character" });
      const [weapon] = await actor.createEmbeddedDocuments("Item", [
        { name: "ZZ Probe Pistol", type: "weapon", system: {} },
      ]);
      weaponId = weapon.id;

      const sheet = actor.sheet;
      await sheet.render({ force: true });
      await new Promise((r) => setTimeout(r, 700));
      const root = sheet.element;

      // The control may carry data-item-id itself, or sit inside a [data-item-id] row.
      const findCtl = (cls) =>
        root.querySelector(`.${cls}[data-item-id="${weaponId}"]`) ||
        root.querySelector(`[data-item-id="${weaponId}"] .${cls}`);

      // item-edit -> opens the weapon's own sheet
      const editEl = findCtl("item-edit");
      out.present["item-edit"] = !!editEl;
      if (editEl) {
        editEl.click();
        await new Promise((r) => setTimeout(r, 350));
        out.fired["item-edit:sheetRendered"] = actor.items.get(weaponId)?.sheet?.rendered ? 1 : 0;
        try { await actor.items.get(weaponId)?.sheet?.close(); } catch (_) {}
      }

      // item-roll -> item.roll() (spy the resolved instance; record + no-op)
      const w = actor.items.get(weaponId);
      out.fired["item-roll"] = 0;
      const origRoll = w.roll;
      w.roll = function () { out.fired["item-roll"]++; };
      const rollEl = findCtl("item-roll");
      out.present["item-roll"] = !!rollEl;
      if (rollEl) { rollEl.click(); await new Promise((r) => setTimeout(r, 150)); }
      w.roll = origRoll;

      // item-delete -> opens a confirm dialog (detect, then dismiss without confirming)
      const delEl = findCtl("item-delete");
      out.present["item-delete"] = !!delEl;
      if (delEl) {
        delEl.click();
        await new Promise((r) => setTimeout(r, 350));
        const dlg = Array.from(foundry.applications.instances?.values?.() ?? [])
          .find((a) => a.rendered && /Dialog/.test(a.constructor?.name ?? ""));
        out.fired["item-delete:dialogOpened"] = dlg ? 1 : 0;
        try { await dlg?.close(); } catch (_) {}
      }

      await sheet.close();
    } catch (e) {
      out.errors.push(String(e?.stack ?? e?.message ?? e));
    } finally {
      try { await actor?.delete(); } catch (_) {}
    }
    return out;
  });

  console.log("item-controls wiring:", JSON.stringify(result, null, 2));
  console.log("console errors:", JSON.stringify(consoleErrors, null, 2));

  expect(result.errors, "no thrown errors").toEqual([]);
  // item-edit is the reliable coverage (a weapon row renders it): it exercises item resolution
  // (_cpGetItemFromTarget) + the click dispatch + the open-sheet outcome — the mechanism every item
  // control shares.
  expect(result.present["item-edit"], ".item-edit present for the weapon").toBe(true);
  expect(result.fired["item-edit:sheetRendered"], "item-edit opened the item sheet").toBe(1);
  // item-delete / item-roll are best-effort: a weapon row may use .fire-weapon and right-click
  // delete rather than rendering those controls. Assert only when present.
  if (result.present["item-delete"]) {
    expect(result.fired["item-delete:dialogOpened"], "item-delete opened a confirm dialog").toBe(1);
  }
  if (result.present["item-roll"]) {
    expect(result.fired["item-roll"], "item-roll called item.roll()").toBeGreaterThan(0);
  }
});

test("actor-sheet V2: fire control opens attack dialog; nested item image opens sheet (dispatch order)", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e?.message ?? e)));

  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [], present: {}, fired: {} };
    let actor, weaponId;
    const openDialogs = () => [...(foundry.applications.instances?.values?.() ?? [])]
      .filter((a) => a.rendered && /ModifiersDialog/.test(a.constructor?.name ?? ""));
    try {
      actor = await Actor.create({ name: "ZZ Fire Probe", type: "character" });
      const [weapon] = await actor.createEmbeddedDocuments("Item", [
        { name: "ZZ Probe Rifle", type: "weapon", system: {} },
      ]);
      weaponId = weapon.id;

      const sheet = actor.sheet;
      await sheet.render({ force: true });
      await new Promise((r) => setTimeout(r, 700));
      const root = sheet.element;

      const fireEl = root.querySelector(`.fire-weapon[data-item-id="${weaponId}"]`)
        || root.querySelector(`[data-item-id="${weaponId}"] .fire-weapon`)
        || root.querySelector(".fire-weapon");

      // (a) Clicking the fire area opens the attack (Modifiers) dialog.
      out.present["fire-weapon"] = !!fireEl;
      if (fireEl) {
        fireEl.click();
        await new Promise((r) => setTimeout(r, 350));
        out.fired["fire:dialogOpened"] = openDialogs().length > 0 ? 1 : 0;
        for (const d of openDialogs()) { try { await d.close(); } catch (_) {} }
        await new Promise((r) => setTimeout(r, 100));
      }

      // (b) Clicking the item image NESTED INSIDE the fire area opens the item sheet, NOT the dialog.
      const imageEl = fireEl?.querySelector(".item-edit");
      out.present["fire>item-edit"] = !!imageEl;
      if (imageEl) {
        imageEl.click();
        await new Promise((r) => setTimeout(r, 350));
        out.fired["image:sheetRendered"] = actor.items.get(weaponId)?.sheet?.rendered ? 1 : 0;
        out.fired["image:noDialog"] = openDialogs().length === 0 ? 1 : 0;
        try { await actor.items.get(weaponId)?.sheet?.close(); } catch (_) {}
        for (const d of openDialogs()) { try { await d.close(); } catch (_) {} }
      }

      await sheet.close();
    } catch (e) {
      out.errors.push(String(e?.stack ?? e?.message ?? e));
    } finally {
      try { await actor?.delete(); } catch (_) {}
    }
    return out;
  });

  console.log("fire-dispatch wiring:", JSON.stringify(result, null, 2));
  console.log("console errors:", JSON.stringify(consoleErrors, null, 2));

  expect(result.errors, "no thrown errors").toEqual([]);
  expect(result.present["fire-weapon"], ".fire-weapon present").toBe(true);
  expect(result.fired["fire:dialogOpened"], "clicking the fire area opened the attack dialog").toBe(1);
  // The nested image must open the item sheet and NOT the attack dialog (proves item-edit is
  // dispatched before fire-weapon).
  if (result.present["fire>item-edit"]) {
    expect(result.fired["image:sheetRendered"], "image opened the item sheet").toBe(1);
    expect(result.fired["image:noDialog"], "image did NOT open the attack dialog").toBe(1);
  }
});
