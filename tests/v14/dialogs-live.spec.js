import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * ApplicationV2 smoke tests for the 3 migrated dialog classes.
 *
 * For each class: construct it with representative options, call render(true),
 * then assert app.rendered === true and app.element exists with no thrown errors.
 *
 * Run against BOTH rigs:
 *   v13 (:30003)  npx playwright test --config playwright.v13.config.js  tests/v14/dialogs-live.spec.js
 *   v14 (:30002)  npx playwright test --config playwright.v14.config.js  tests/v14/dialogs-live.spec.js
 *
 * DO NOT run Playwright automatically — these require the rig world + FVTT_RIG_PASSWORD.
 */

// ── IpTracker ────────────────────────────────────────────────────────────────

test("IpTracker: renders as ApplicationV2, app.rendered === true", async ({ page }) => {
  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [] };
    try {
      const { IpTracker } = await import("/systems/cyberpunk2020/module/ip/tracker.js");

      const app = new IpTracker();
      await app.render(true);
      // Give the async render pipeline a moment to settle.
      await new Promise((r) => setTimeout(r, 800));

      out.rendered  = app.rendered === true;
      out.hasElement = !!(app.element && app.element instanceof HTMLElement);
      out.elementTag = app.element?.tagName?.toLowerCase() ?? null;
      out.isV2       = app instanceof foundry.applications.api.ApplicationV2;

      await app.close();
    } catch (e) {
      out.errors.push(String(e?.message ?? e));
    }
    return out;
  });

  console.log("IpTracker:", JSON.stringify(result, null, 2));
  expect(result.errors, "no thrown errors").toEqual([]);
  expect(result.rendered,   "app.rendered === true").toBe(true);
  expect(result.hasElement, "app.element is an HTMLElement").toBe(true);
  expect(result.isV2,       "instance of ApplicationV2").toBe(true);
});

// ── DamageDialog ─────────────────────────────────────────────────────────────

test("DamageDialog: renders as ApplicationV2, app.rendered === true", async ({ page }) => {
  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [] };
    try {
      const { DamageDialog } = await import("/systems/cyberpunk2020/module/combat/DamageDialog.js");
      const flags = { cyberpunk2020: { __pwtest: true } };

      // Create a minimal target actor with soft torso armor so resolveAreaDamagesSync has something to work with.
      const target = await Actor.create({
        name: "__PW__V2DlgTarget", type: "character", flags,
        system: { stats: { bt: { base: 4 } }, damage: 0 }
      });
      await target.createEmbeddedDocuments("Item", [{
        name: "__PW__V2DlgVest", type: "armor",
        system: { equipped: true, armorType: "soft", coverage: { Torso: { stoppingPower: 6 } } },
      }]);

      const payload = {
        weaponName: "__PW__V2DialogTest",
        areaDamages: { Torso: [{ damage: 15 }] },
        ap: false
      };

      const app = new DamageDialog(payload, target);
      await app.render(true);
      await new Promise((r) => setTimeout(r, 800));

      out.rendered   = app.rendered === true;
      out.hasElement = !!(app.element && app.element instanceof HTMLElement);
      out.elementTag = app.element?.tagName?.toLowerCase() ?? null;
      out.isV2       = app instanceof foundry.applications.api.ApplicationV2;

      await app.close();
      await target.delete();
    } catch (e) {
      out.errors.push(String(e?.message ?? e));
    }
    return out;
  });

  console.log("DamageDialog:", JSON.stringify(result, null, 2));
  expect(result.errors, "no thrown errors").toEqual([]);
  expect(result.rendered,   "app.rendered === true").toBe(true);
  expect(result.hasElement, "app.element is an HTMLElement").toBe(true);
  expect(result.isV2,       "instance of ApplicationV2").toBe(true);
});

// ── ModifiersDialog ───────────────────────────────────────────────────────────

test("ModifiersDialog: renders as ApplicationV2, app.rendered === true", async ({ page }) => {
  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [] };
    try {
      const { ModifiersDialog } = await import("/systems/cyberpunk2020/module/dialog/modifiers.js");
      const flags = { cyberpunk2020: { __pwtest: true } };

      // Create a minimal actor — ModifiersDialog's first argument is the owning actor.
      const actor = await Actor.create({ name: "__PW__V2ModActor", type: "character", flags });

      // Minimal options: no weapon, one modifier group, a no-op onConfirm.
      let confirmCalled = false;
      const app = new ModifiersDialog(actor, {
        title: "__PW__ Modifiers Test",
        modifierGroups: [[
          { localKey: "ExtraModifiers", dataPath: "extraMod", defaultValue: 0 }
        ]],
        extraMod: false,
        onConfirm: (data) => { confirmCalled = true; return false; /* prevent close */ }
      });

      await app.render(true);
      await new Promise((r) => setTimeout(r, 800));

      out.rendered   = app.rendered === true;
      out.hasElement = !!(app.element && app.element instanceof HTMLElement);
      out.elementTag = app.element?.tagName?.toLowerCase() ?? null;
      out.isV2       = app instanceof foundry.applications.api.ApplicationV2;
      out.weaponOnPrivateField = app._weapon === null; // per-instance data lives on private fields (options is frozen in V2)

      await app.close();
      await actor.delete();
    } catch (e) {
      out.errors.push(String(e?.message ?? e));
    }
    return out;
  });

  console.log("ModifiersDialog:", JSON.stringify(result, null, 2));
  expect(result.errors, "no thrown errors").toEqual([]);
  expect(result.rendered,        "app.rendered === true").toBe(true);
  expect(result.hasElement,      "app.element is an HTMLElement").toBe(true);
  expect(result.isV2,            "instance of ApplicationV2").toBe(true);
  expect(result.weaponOnPrivateField, "per-instance data on private field").toBe(true);
});
