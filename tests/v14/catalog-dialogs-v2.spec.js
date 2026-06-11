import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * Validates the DialogV2.wait form-read + return-value mechanism that the converted
 * shop dialogs use (module/shop/catalog.js confirmPurchaseDialog + promptText):
 *  - a button callback's RETURN VALUE resolves DialogV2.wait
 *  - the callback can read a form input via dlg.element.querySelector
 *  - rejectClose:false resolves to null on X-close (matching the old `close: () => resolve(null)`)
 *
 *   v14:  npx playwright test --config playwright.v14.config.js v14/catalog-dialogs-v2.spec.js
 *   v13:  FVTT_URL=http://localhost:30003 npx playwright test --config playwright.v14.config.js v14/catalog-dialogs-v2.spec.js
 */

async function clickDialogButton(page, action, beforeClick = () => {}) {
  // Drive the most-recently-opened DialogV2 instance.
  return page.evaluate(async ({ action, fnStr }) => {
    const DV2 = foundry.applications.api.DialogV2;
    const reg = foundry.applications?.instances;
    const apps = reg instanceof Map ? [...reg.values()] : Object.values(reg ?? {});
    const dlg = apps.reverse().find((a) => a instanceof DV2 && a.rendered);
    if (!dlg) return { found: false };
    // eslint-disable-next-line no-eval
    (eval(`(${fnStr})`))(dlg.element);
    const btn = dlg.element.querySelector(`button[data-action="${action}"]`);
    btn?.click();
    return { found: true };
  }, { action, fnStr: beforeClick.toString() });
}

test("DialogV2.wait: qty form-read returns parsed number (confirmPurchaseDialog shape)", async ({ page }) => {
  await joinAsGM(page);
  const start = page.evaluate(async () => {
    const DV2 = foundry.applications.api.DialogV2;
    window.__waitResult = DV2.wait({
      window: { title: "Buy (test)" },
      content: `<p>Buy it?</p><div class="form-group"><label>Qty</label><input type="number" name="qty" value="1" min="1"/></div>`,
      buttons: [
        { action: "buy", label: "Buy", default: true, callback: (ev, btn, dlg) => Math.max(1, parseInt(dlg.element.querySelector('[name="qty"]')?.value, 10) || 1) },
        { action: "cancel", label: "Cancel", callback: () => null },
      ],
      rejectClose: false,
    });
    return true;
  });
  await start;
  await page.waitForTimeout(500);
  await clickDialogButton(page, "buy", (root) => { root.querySelector('[name="qty"]').value = "3"; });
  const result = await page.evaluate(async () => await window.__waitResult);
  console.log("qty wait result:", result);
  expect(result, "buy callback return value resolves wait()").toBe(3);
});

test("DialogV2.wait: text form-read returns trimmed string (promptText shape)", async ({ page }) => {
  await joinAsGM(page);
  await page.evaluate(async () => {
    const DV2 = foundry.applications.api.DialogV2;
    window.__waitResult2 = DV2.wait({
      window: { title: "Name (test)" },
      content: `<div class="form-group"><input type="text" name="t" value=""/></div>`,
      buttons: [
        { action: "ok", label: "Create", default: true, callback: (ev, btn, dlg) => (dlg.element.querySelector('[name="t"]')?.value ?? "").trim() },
        { action: "cancel", label: "Cancel", callback: () => null },
      ],
      rejectClose: false,
    });
  });
  await page.waitForTimeout(500);
  await clickDialogButton(page, "ok", (root) => { root.querySelector('[name="t"]').value = "  My Shop  "; });
  const result = await page.evaluate(async () => await window.__waitResult2);
  console.log("text wait result:", JSON.stringify(result));
  expect(result, "ok callback returns trimmed text").toBe("My Shop");
});

test("DialogV2.wait: a null-returning button callback falls back to the action id", async ({ page }) => {
  await joinAsGM(page);
  await page.evaluate(async () => {
    const DV2 = foundry.applications.api.DialogV2;
    window.__waitResult3 = DV2.wait({
      window: { title: "Cancelme (test)" },
      content: `<p>x</p>`,
      buttons: [
        { action: "ok", label: "OK", default: true, callback: () => "ok" },
        { action: "cancel", label: "Cancel", callback: () => null },
      ],
      rejectClose: false,
    });
  });
  await page.waitForTimeout(500);
  await clickDialogButton(page, "cancel");
  const result = await page.evaluate(async () => await window.__waitResult3);
  console.log("cancel wait result:", JSON.stringify(result));
  // DISCOVERED: a button callback returning null/undefined makes DialogV2.wait resolve to the
  // button's ACTION id ("cancel"), NOT null. That's why the real shop dialogs (catalog.js) map
  // by success type/shape — confirmPurchaseDialog keeps only a numeric result; promptText keeps
  // only an {ok:true} object — so Cancel (action id) and X-close (null) both become "no result".
  expect(result, "null-returning callback falls back to the action id").toBe("cancel");
});
