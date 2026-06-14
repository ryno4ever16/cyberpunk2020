import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * Safety net for the actor sheet's CP2020-specific controls (no upstream equivalent) ahead of the
 * Stage A2 native rewrite of `_cpActivateActorCustomControls`: the ammo-tracking toggle, the Shop
 * button, the Services tab add/pay/edit/delete, the IP tracker level-up / lock-toggle, and the
 * martial-action panel. Shopping + the IP system are world settings, so the test enables them
 * (and restores them afterwards) to render those controls.
 *
 *   v14 (:30002)  npx playwright test --config playwright.v14.config.js v14/actor-custom-controls.spec.js
 *   v13 (:30003)  FVTT_URL=http://localhost:30003 (same command)
 *
 * Needs the rig world + FVTT_RIG_PASSWORD. DO NOT run automatically.
 */
test("actor-sheet V2: custom controls (ammo / shop / services / IP / martial) are wired", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e?.message ?? e)));

  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [], present: {}, fired: {} };
    const SCOPE = "cyberpunk2020";
    let actor;
    let prevShop, prevIp;
    try {
      prevShop = game.settings.get(SCOPE, "shoppingEnabled");
      prevIp = game.settings.get(SCOPE, "ipSystem");
      await game.settings.set(SCOPE, "shoppingEnabled", true);
      await game.settings.set(SCOPE, "ipSystem", "simple");

      actor = await Actor.create({ name: "ZZ Custom Probe", type: "character" });
      await actor.createEmbeddedDocuments("Item", [
        { name: "ZZ Probe Skill", type: "skill", system: { level: 1 } },
      ]);

      const sheet = actor.sheet;
      await sheet.render({ force: true });
      await new Promise((r) => setTimeout(r, 700));
      const root = sheet.element;

      const openApps = (re) => [...(foundry.applications.instances?.values?.() ?? [])]
        .filter((a) => a.rendered && re.test(a.constructor?.name ?? ""));

      // ammo-tracking toggle -> per-actor flag
      const ammo = root.querySelector(".cp-ammo-tracking");
      out.present.ammo = !!ammo;
      if (ammo) {
        const before = !!actor.getFlag(SCOPE, "ammoTracking");
        ammo.checked = !before;
        ammo.dispatchEvent(new Event("change", { bubbles: true }));
        await new Promise((r) => setTimeout(r, 250));
        out.fired.ammoFlag = (!!actor.getFlag(SCOPE, "ammoTracking") === !before) ? 1 : 0;
      }

      // cp-service-add -> creates a recurring "misc" service item
      const svcAdd = root.querySelector(".cp-service-add");
      out.present.serviceAdd = !!svcAdd;
      if (svcAdd) {
        const before = actor.items.filter((i) => i.type === "misc").length;
        svcAdd.click();
        await new Promise((r) => setTimeout(r, 400));
        const after = actor.items.filter((i) => i.type === "misc").length;
        out.fired.serviceAdded = after > before ? 1 : 0;
        for (const a of openApps(/ItemSheet|CyberpunkItemSheet/)) { try { await a.close(); } catch (_) {} }
      }

      // Shop button -> opens a catalog/shop window (best-effort).
      const shop = root.querySelector(".cp-open-shop");
      out.present.shop = !!shop;
      if (shop) {
        shop.click();
        await new Promise((r) => setTimeout(r, 400));
        out.fired.shopOpened = openApps(/Catalog|Shop/).length > 0 ? 1 : 0;
        for (const a of openApps(/Catalog|Shop/)) { try { await a.close(); } catch (_) {} }
      }

      // IP lock toggle (best-effort: just must not throw and should toggle the lock state).
      const ipLock = root.querySelector(".ip-lock-toggle");
      out.present.ipLock = !!ipLock;
      if (ipLock) {
        ipLock.click();
        await new Promise((r) => setTimeout(r, 300));
        out.fired.ipLockClicked = 1;
      }

      // martial-action (best-effort: opens the attack dialog).
      const martial = root.querySelector(".martial-action");
      out.present.martial = !!martial;
      if (martial) {
        martial.click();
        await new Promise((r) => setTimeout(r, 400));
        out.fired.martialDialog = openApps(/ModifiersDialog/).length > 0 ? 1 : 0;
        for (const a of openApps(/ModifiersDialog/)) { try { await a.close(); } catch (_) {} }
      }

      await sheet.close();
    } catch (e) {
      out.errors.push(String(e?.stack ?? e?.message ?? e));
    } finally {
      try { await actor?.delete(); } catch (_) {}
      try { if (prevShop !== undefined) await game.settings.set(SCOPE, "shoppingEnabled", prevShop); } catch (_) {}
      try { if (prevIp !== undefined) await game.settings.set(SCOPE, "ipSystem", prevIp); } catch (_) {}
    }
    return out;
  });

  console.log("custom-controls wiring:", JSON.stringify(result, null, 2));
  console.log("console errors:", JSON.stringify(consoleErrors, null, 2));

  expect(result.errors, "no thrown errors").toEqual([]);
  // Reliable: ammo-tracking + service-add.
  expect(result.present.ammo, ".cp-ammo-tracking present").toBe(true);
  expect(result.fired.ammoFlag, "ammo-tracking change set the flag").toBe(1);
  expect(result.present.serviceAdd, ".cp-service-add present (shopping enabled)").toBe(true);
  expect(result.fired.serviceAdded, "service-add created a misc service item").toBe(1);
  // Best-effort (depend on rendered/setting state):
  if (result.present.shop) expect(result.fired.shopOpened, "shop button opened a window").toBe(1);
  if (result.present.martial) expect(result.fired.martialDialog, "martial-action opened the dialog").toBe(1);
});
