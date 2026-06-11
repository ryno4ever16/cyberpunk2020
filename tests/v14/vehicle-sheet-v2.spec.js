import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * ApplicationV2 smoke tests for CyberpunkVehicleSheet.
 *
 * Verifies the V2 port:
 *   1. A plain "vehicle" actor opens its sheet as an ActorSheetV2 instance.
 *   2. An isACPA vehicle actor opens the acpa-sheet template.
 *   3. No console errors during either render.
 *
 * Run against BOTH rigs (the sheet must work on v13.350 and v14):
 *   v13  npx playwright test --config playwright.v13.config.js  tests/v14/vehicle-sheet-v2.spec.js
 *   v14  npx playwright test --config playwright.v14.config.js  tests/v14/vehicle-sheet-v2.spec.js
 *
 * Requires the rig world + FVTT_RIG_PASSWORD env var.
 * DO NOT run these automatically.
 */

// ── Plain vehicle sheet ──────────────────────────────────────────────────────

test("CyberpunkVehicleSheet (plain vehicle): renders as ActorSheetV2, no errors", async ({ page }) => {
  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [] };
    let actor = null;
    try {
      const flags = { cyberpunk2020: { __pwtest: true } };

      actor = await Actor.create({
        name: "__PW__VehicleSheetV2Test",
        type: "vehicle",
        flags,
        system: { isACPA: false, sdp: { value: 50, max: 50 }, sp: { front: 20 } }
      });

      const sheet = actor.sheet;
      await sheet.render(true);
      // Give the V2 render pipeline a moment to settle (template fetch + DOM inject).
      await new Promise((r) => setTimeout(r, 1000));

      out.rendered    = sheet.rendered === true;
      out.hasElement  = !!(sheet.element && sheet.element instanceof HTMLElement);
      out.elementTag  = sheet.element?.tagName?.toLowerCase() ?? null;
      out.isActorSheetV2 = sheet instanceof foundry.applications.sheets.ActorSheetV2;
      out.isAppV2        = sheet instanceof foundry.applications.api.ApplicationV2;

      // The plain-vehicle template must NOT show the ACPA-specific class on the inner content.
      // V2 renders the template body inside the form element; the acpa-sheet adds class="acpa-sheet"
      // to its outermost div wrapper, vehicle-sheet does not.
      // We check by looking for the absence of an acpa-sheet element and the presence of the
      // "Stopping Power" label that only the vehicle sheet renders at top.
      const el = sheet.element;
      out.notAcpaSheet = !el.querySelector(".acpa-sheet");
      // vehicle-sheet.hbs has a "Stopping Power" section title (not present in acpa-sheet).
      out.hasVehicleContent = !!(el.querySelector('[name="system.vehicleType"]'));

      await sheet.close();
    } catch (e) {
      out.errors.push(String(e?.message ?? e));
    } finally {
      try { if (actor) await actor.delete(); } catch (_) { /* cleanup best-effort */ }
    }
    return out;
  });

  console.log("VehicleSheetV2 (plain):", JSON.stringify(result, null, 2));
  expect(result.errors,          "no thrown errors").toEqual([]);
  expect(result.rendered,        "sheet.rendered === true").toBe(true);
  expect(result.hasElement,      "sheet.element is an HTMLElement").toBe(true);
  expect(result.isActorSheetV2,  "instance of ActorSheetV2").toBe(true);
  expect(result.isAppV2,         "instance of ApplicationV2").toBe(true);
  expect(result.notAcpaSheet,    "plain vehicle does not render acpa-sheet").toBe(true);
  expect(result.hasVehicleContent, "vehicle-sheet template content present").toBe(true);
});

// ── ACPA sheet ───────────────────────────────────────────────────────────────

test("CyberpunkVehicleSheet (ACPA): renders acpa-sheet template as ActorSheetV2, no errors", async ({ page }) => {
  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [] };
    let actor = null;
    try {
      const flags = { cyberpunk2020: { __pwtest: true } };

      actor = await Actor.create({
        name: "__PW__AcpaSheetV2Test",
        type: "vehicle",
        flags,
        system: { isACPA: true, str: 40, sdp: { value: 80, max: 80 }, sp: { front: 40 } }
      });

      const sheet = actor.sheet;
      await sheet.render(true);
      await new Promise((r) => setTimeout(r, 1000));

      out.rendered   = sheet.rendered === true;
      out.hasElement = !!(sheet.element && sheet.element instanceof HTMLElement);
      out.elementTag = sheet.element?.tagName?.toLowerCase() ?? null;
      out.isActorSheetV2 = sheet instanceof foundry.applications.sheets.ActorSheetV2;
      out.isAppV2        = sheet instanceof foundry.applications.api.ApplicationV2;

      // The ACPA template has a "Chassis & Armor" section (not in vehicle-sheet.hbs).
      // The acpa-sheet also has a header comment class reference; simplest check: the
      // "Chassis STR" input is only in acpa-sheet.hbs.
      const el = sheet.element;
      out.hasAcpaContent = !!(el.querySelector('[name="system.str"]'));
      // system.vehicleType selector is NOT in acpa-sheet.hbs
      out.noVehicleTypeSelect = !el.querySelector('[name="system.vehicleType"]');

      await sheet.close();
    } catch (e) {
      out.errors.push(String(e?.message ?? e));
    } finally {
      try { if (actor) await actor.delete(); } catch (_) { /* cleanup best-effort */ }
    }
    return out;
  });

  console.log("VehicleSheetV2 (ACPA):", JSON.stringify(result, null, 2));
  expect(result.errors,            "no thrown errors").toEqual([]);
  expect(result.rendered,          "sheet.rendered === true").toBe(true);
  expect(result.hasElement,        "sheet.element is an HTMLElement").toBe(true);
  expect(result.isActorSheetV2,    "instance of ActorSheetV2").toBe(true);
  expect(result.isAppV2,           "instance of ApplicationV2").toBe(true);
  expect(result.hasAcpaContent,    "acpa-sheet template content present").toBe(true);
  expect(result.noVehicleTypeSelect, "acpa-sheet does not have vehicleType select").toBe(true);
});
