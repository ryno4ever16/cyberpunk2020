import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * DialogV2 smoke tests: verify that the three representative converted dialogs
 * (setup-notice, buy-ammo, ip-level-up) construct and render as
 * foundry.applications.api.DialogV2 instances with no thrown errors.
 *
 * Run against either rig:
 *   v13 (:30003)  npx playwright test --config playwright.v13.config.js  tests/v14/dialogv2-live.spec.js
 *   v14 (:30002)  npx playwright test --config playwright.v14.config.js  tests/v14/dialogv2-live.spec.js
 *
 * DO NOT run Playwright automatically — these require the rig world + FVTT_RIG_PASSWORD.
 */

// ── Setup-notice (damage-hooks.js showSetupNotice) ───────────────────────────
// Constructs the dialog directly rather than via the hook so no world-state is needed.

test("DialogV2 setup-notice: renders, is DialogV2 instance, no errors", async ({ page }) => {
  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [] };
    try {
      const DV2 = foundry.applications.api.DialogV2;
      const dlg = new DV2({
        window: { title: "Cyberpunk 2020 — Setup & What's New (test)" },
        content: `<div><p class="cp-feat-page" style="display:none;">Page 1</p><p class="cp-feat-page" style="display:none;">Page 2</p>
          <div><button type="button" class="cp-feat-back">‹ Back</button>
          <button type="button" class="cp-feat-next">Next ›</button></div></div>`,
        buttons: [
          { action: "openSettings", label: "Open Settings", default: true, callback: () => {} },
        ],
      });

      await dlg.render({ force: true });
      await new Promise((r) => setTimeout(r, 600));

      out.rendered   = dlg.rendered === true;
      out.hasElement = !!(dlg.element && dlg.element instanceof HTMLElement);
      out.isDialogV2 = dlg instanceof DV2;
      out.elementTag = dlg.element?.tagName?.toLowerCase() ?? null;

      await dlg.close();
    } catch (e) {
      out.errors.push(String(e?.message ?? e));
    }
    return out;
  });

  console.log("setup-notice DialogV2:", JSON.stringify(result, null, 2));
  expect(result.errors, "no thrown errors").toEqual([]);
  expect(result.rendered,   "dlg.rendered === true").toBe(true);
  expect(result.hasElement, "dlg.element is an HTMLElement").toBe(true);
  expect(result.isDialogV2, "instance of DialogV2").toBe(true);
});

// ── Buy-ammo dialog (dialog/buy-ammo.js openBuyAmmoDialog) ───────────────────
// Constructs the DialogV2 directly (mirrors buy-ammo shape) without actor side-effects.

test("DialogV2 buy-ammo shape: renders, is DialogV2 instance, no errors", async ({ page }) => {
  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [] };
    try {
      const DV2 = foundry.applications.api.DialogV2;
      const dlg = new DV2({
        window: { title: "Buy Ammo (test)" },
        content: `<form class="cyberpunk buy-ammo">
          <div class="form-group"><label>Caliber</label><select name="caliber"><option value="9mm">9mm</option></select></div>
          <div class="form-group"><label>Modifier</label><select name="modifier"><option value="standard">Standard</option></select></div>
          <div class="form-group"><label>Boxes</label><input type="number" name="boxes" value="1" min="1"/></div>
          <p class="cp-buy-ammo-preview"></p></form>`,
        buttons: [
          { action: "buy",    icon: '<i class="fas fa-cart-plus"></i>', label: "Buy",    default: true, callback: () => "bought" },
          { action: "cancel", icon: '<i class="fas fa-times"></i>',     label: "Cancel",               callback: () => "cancelled" },
        ],
        rejectClose: false,
      });

      await dlg.render({ force: true });
      await new Promise((r) => setTimeout(r, 600));

      out.rendered   = dlg.rendered === true;
      out.hasElement = !!(dlg.element && dlg.element instanceof HTMLElement);
      out.isDialogV2 = dlg instanceof DV2;
      // Verify button actions rendered in the DOM
      out.hasBuyBtn    = !!dlg.element?.querySelector('button[data-action="buy"]');
      out.hasCancelBtn = !!dlg.element?.querySelector('button[data-action="cancel"]');

      await dlg.close();
    } catch (e) {
      out.errors.push(String(e?.message ?? e));
    }
    return out;
  });

  console.log("buy-ammo DialogV2:", JSON.stringify(result, null, 2));
  expect(result.errors,     "no thrown errors").toEqual([]);
  expect(result.rendered,   "dlg.rendered === true").toBe(true);
  expect(result.hasElement, "dlg.element is an HTMLElement").toBe(true);
  expect(result.isDialogV2, "instance of DialogV2").toBe(true);
  expect(result.hasBuyBtn,    "buy button rendered with data-action=buy").toBe(true);
  expect(result.hasCancelBtn, "cancel button rendered with data-action=cancel").toBe(true);
});

// ── DialogV2.confirm (ip/ip.js levelUpSkill) ─────────────────────────────────
// Calls the static DialogV2.confirm() helper and checks it resolves a boolean.

test("DialogV2.confirm: resolves false when no-button is default-clicked, no errors", async ({ page }) => {
  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [] };
    try {
      const DV2 = foundry.applications.api.DialogV2;

      // Start the confirm (it returns a Promise). We'll close it programmatically
      // by finding the rendered dialog and clicking its "no" button.
      const confirmPromise = DV2.confirm({
        window: { title: "Level Up Skill? (test)" },
        content: "<p>Spend 10 IP to raise Handgun from 4 → 5?</p>",
        yes: { callback: () => true },
        no:  { default: true, callback: () => false },
      });

      // Wait a tick for the dialog to render, then close it via the no button.
      await new Promise((r) => setTimeout(r, 600));

      // Find the confirm dialog and click "no". V2 apps live in foundry.applications.instances
      // (a Map), NOT ui.windows — Object.values() of a Map is empty, which is why the old loop
      // never found it.
      const reg = foundry.applications?.instances;
      const apps = reg instanceof Map ? [...reg.values()] : Object.values(reg ?? {});
      let noClicked = false;
      for (const app of apps) {
        if (app instanceof DV2 && app.rendered) {
          const noBtn = app.element?.querySelector('button[data-action="no"]');
          if (noBtn) { noBtn.click(); noClicked = true; break; }
        }
      }
      if (!noClicked) {
        for (const app of apps) {
          if (app instanceof DV2 && app.rendered) { await app.close(); break; }
        }
      }

      const answer = await Promise.race([confirmPromise, new Promise((r) => setTimeout(() => r("timeout"), 3000))]);
      out.answer       = answer;
      out.answerIsBool = typeof answer === "boolean";
      out.noClicked    = noClicked;
    } catch (e) {
      out.errors.push(String(e?.message ?? e));
    }
    return out;
  });

  console.log("DialogV2.confirm:", JSON.stringify(result, null, 2));
  expect(result.errors,      "no thrown errors").toEqual([]);
  expect(result.noClicked,   "no button was found and clicked").toBe(true);
  expect(result.answerIsBool, "confirm resolved a boolean").toBe(true);
  expect(result.answer,       "confirm resolved false (no)").toBe(false);
});
