import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * Validation for the BLIND ApplicationV2 port of the big sheets (actor-sheet + item-sheet),
 * committed without rig access (tag pre-blind-sheets-rewrite is the recovery point).
 *
 * RUN THIS FIRST when the rig login is restored — it targets the exact residual risks recorded
 * in PROGRESS.md: render (no thrown errors / _prepareContext shape), the single-root part, the
 * manual Tabs binding, activateListeners firing, and the item-sheet _prepareSubmitData submit path.
 *
 *   v14 (:30002)  npx playwright test --config playwright.v14.config.js v14/big-sheets-v2.spec.js
 *   v13 (:30003)  npx playwright test --config playwright.v13.config.js v14/big-sheets-v2.spec.js
 *
 * Needs the rig world + FVTT_RIG_PASSWORD. DO NOT run automatically.
 */

// ── Actor sheet (character) ──────────────────────────────────────────────────
test("actor-sheet V2: renders, single-root, tabs switch, listeners fire, no console errors", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e?.message ?? e)));

  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [], cleanupId: null };
    try {
      const actor = await Actor.create({ name: "ZZ V2 Sheet Probe", type: "character" });
      out.cleanupId = actor.id;
      const sheet = actor.sheet;
      await sheet.render({ force: true });
      await new Promise((r) => setTimeout(r, 700));

      out.rendered    = sheet.rendered === true;
      out.elementTag  = sheet.element?.tagName?.toLowerCase() ?? null;        // expect "form" (tag:"form")
      out.isV2        = sheet instanceof foundry.applications.sheets.ActorSheetV2;
      // Single-root part: the form should contain our wrapper div.
      out.hasRoot     = !!sheet.element?.querySelector(".cp-actor-sheet-root");
      // Tabs present + manual binding produced an active tab.
      const nav       = sheet.element?.querySelector(".sheet-tabs");
      out.hasNav      = !!nav;
      const tabLinks  = nav ? [...nav.querySelectorAll("[data-tab]")] : [];
      out.tabCount    = tabLinks.length;
      out.initialActive = nav?.querySelector(".item.active, [data-tab].active")?.dataset?.tab ?? null;

      // Click a different tab and confirm the content panel toggles active.
      const target = tabLinks.find((a) => a.dataset.tab === "gear") ?? tabLinks[1];
      if (target) {
        target.click();
        await new Promise((r) => setTimeout(r, 200));
        const body = sheet.element.querySelector(".sheet-body");
        out.clickedTab = target.dataset.tab;
        out.contentActivated = !!body?.querySelector(`.tab[data-tab="${target.dataset.tab}"].active`);
        out.navActivated = target.classList.contains("active");
      }

      await sheet.close();
    } catch (e) {
      out.errors.push(String(e?.stack ?? e?.message ?? e));
    } finally {
      try { if (out.cleanupId) await game.actors.get(out.cleanupId)?.delete(); } catch (_) {}
    }
    return out;
  });

  console.log("actor-sheet V2:", JSON.stringify(result, null, 2));
  console.log("console errors:", JSON.stringify(consoleErrors, null, 2));
  expect(result.errors, "no thrown errors").toEqual([]);
  expect(result.rendered, "sheet.rendered").toBe(true);
  expect(result.elementTag, "root element is the V2 <form>").toBe("form");
  expect(result.isV2, "instanceof ActorSheetV2").toBe(true);
  expect(result.hasRoot, "single-root wrapper div present").toBe(true);
  expect(result.hasNav, "tab nav present").toBe(true);
  expect(result.tabCount, "has tabs").toBeGreaterThan(0);
  expect(result.navActivated, "clicked nav tab became active (Tabs bound)").toBe(true);
  expect(result.contentActivated, "matching content panel became active (Tabs bound)").toBe(true);
  expect(consoleErrors, "no console errors during render+tab").toEqual([]);
});

// ── Item sheet (skill: exercises _prepareSubmitData number normalization) ────
test("item-sheet V2: renders, single-root, field submit normalizes + persists, no console errors", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e?.message ?? e)));

  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [], cleanupId: null };
    try {
      const item = await Item.create({ name: "ZZ V2 Item Probe", type: "skill" });
      out.cleanupId = item.id;
      const sheet = item.sheet;
      await sheet.render({ force: true });
      await new Promise((r) => setTimeout(r, 700));

      out.rendered   = sheet.rendered === true;
      out.elementTag = sheet.element?.tagName?.toLowerCase() ?? null;   // "form"
      out.isV2       = sheet instanceof foundry.applications.sheets.ItemSheetV2;
      out.hasRoot    = !!sheet.element?.querySelector(".cp-item-sheet-root");

      // Drive a field change to exercise the V2 submit path (_prepareSubmitData) with submitOnChange.
      const input = sheet.element?.querySelector('input[name="system.level"]');
      out.foundLevelInput = !!input;
      if (input) {
        input.value = "5";
        input.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 500));
        out.persistedLevel = item.system?.level;   // expect 5 (number, via fixNum in _prepareSubmitData)
      }

      await sheet.close();
    } catch (e) {
      out.errors.push(String(e?.stack ?? e?.message ?? e));
    } finally {
      try { if (out.cleanupId) await game.items.get(out.cleanupId)?.delete(); } catch (_) {}
    }
    return out;
  });

  console.log("item-sheet V2:", JSON.stringify(result, null, 2));
  console.log("console errors:", JSON.stringify(consoleErrors, null, 2));
  expect(result.errors, "no thrown errors").toEqual([]);
  expect(result.rendered, "sheet.rendered").toBe(true);
  expect(result.elementTag, "root element is the V2 <form>").toBe("form");
  expect(result.isV2, "instanceof ItemSheetV2").toBe(true);
  expect(result.hasRoot, "single-root wrapper div present").toBe(true);
  if (result.foundLevelInput) {
    expect(result.persistedLevel, "field change persisted via _prepareSubmitData").toBe(5);
  }
  expect(consoleErrors, "no console errors during render+submit").toEqual([]);
});
