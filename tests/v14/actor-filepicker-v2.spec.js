import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * Validates the namespaced FilePicker on the V2 actor sheet: clicking the avatar (data-edit="img")
 * fires the cpAvatarCapture listener (wired in the ported _onRender/activateListeners) and opens a
 * FilePicker. Confirms both the FilePicker namespace swap and that the blind port's avatar handler
 * is actually bound.
 *
 *   v14:  npx playwright test --config playwright.v14.config.js v14/actor-filepicker-v2.spec.js
 */
test("actor-sheet V2: avatar click opens a FilePicker (namespaced, listener wired)", async ({ page }) => {
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e?.message ?? e)));
  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [], cleanupId: null };
    try {
      const FP = foundry.applications?.apps?.FilePicker?.implementation ?? foundry.applications?.apps?.FilePicker;
      const actor = await Actor.create({ name: "ZZ FP Probe", type: "character" });
      out.cleanupId = actor.id;
      const sheet = actor.sheet;
      await sheet.render({ force: true });
      await new Promise((r) => setTimeout(r, 600));

      const img = sheet.element?.querySelector('.profile-img[data-edit="img"], [data-edit="img"]');
      out.foundAvatar = !!img;
      // The handler is a capture-phase pointerdown/click listener on the sheet root.
      img?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      img?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 600));

      const reg = foundry.applications?.instances;
      const apps = reg instanceof Map ? [...reg.values()] : Object.values(reg ?? {});
      const picker = apps.find((a) => FP && a instanceof FP);
      out.filePickerOpened = !!picker;
      out.pickerIsV2 = !!(picker && picker instanceof foundry.applications.api.ApplicationV2);

      try { await picker?.close(); } catch (_) {}
      await sheet.close();
    } catch (e) {
      out.errors.push(String(e?.stack ?? e));
    } finally {
      try { if (out.cleanupId) await game.actors.get(out.cleanupId)?.delete(); } catch (_) {}
    }
    return out;
  });

  console.log("actor avatar FilePicker:", JSON.stringify(result, null, 2));
  console.log("page errors:", JSON.stringify(consoleErrors, null, 2));
  expect(result.errors, "no thrown errors").toEqual([]);
  expect(result.foundAvatar, "avatar element present").toBe(true);
  expect(result.filePickerOpened, "clicking avatar opened a FilePicker (namespace + listener OK)").toBe(true);
});
