import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * Regression guard for the ApplicationV2 "double-bind" footgun.
 *
 * V2 keeps `this.element` (the window) across re-renders and only swaps the inner content
 * (core `application.mjs`: `#element` is created once under `if (!this.#element)`, then every
 * render runs `_replaceHTML(result, this.#content, …)`). A jQuery *delegated* handler bound to
 * that persistent root in `_onRender`/`activateListeners` therefore stacks one duplicate copy
 * per render unless it is cleared first — so after N renders a single skill-level edit would
 * fire N updates.
 *
 * The actor sheet tags every delegated-on-root handler `.cpActor` and runs `$(html).off('.cpActor')`
 * before (re)binding, so the bound-handler count must stay constant no matter how many times the
 * sheet re-renders. This spec measures that directly via jQuery's internal event store.
 *
 *   v14 (:30002)  npx playwright test --config playwright.v14.config.js v14/sheet-listener-idempotency.spec.js
 *   v13 (:30003)  npx playwright test --config playwright.v13.config.js v14/sheet-listener-idempotency.spec.js
 *
 * Needs the rig world + FVTT_RIG_PASSWORD. DO NOT run automatically.
 */
test("actor-sheet V2: delegated listeners do not accumulate across re-renders", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e?.message ?? e)));

  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [] };
    const $ = window.jQuery ?? window.$;
    // Count handlers in a given jQuery namespace bound to a specific element.
    const countNs = (el, ns) => {
      if (!el || !$?._data) return -1;
      const ev = $._data(el, "events") || {};
      let n = 0;
      for (const type of Object.keys(ev))
        for (const h of ev[type])
          if ((h.namespace || "").split(".").includes(ns)) n++;
      return n;
    };

    let actor;
    try {
      actor = await Actor.create({ name: "ZZ DoubleBind Probe", type: "character" });
      const sheet = actor.sheet;
      await sheet.render({ force: true });
      await new Promise((r) => setTimeout(r, 600));

      const el0 = sheet.element;
      out.tag = el0?.tagName?.toLowerCase() ?? null;        // "form" (tag:"form")
      out.jqueryAvailable = !!$?._data;
      out.afterFirstRender = countNs(el0, "cpActor");

      // Force several re-renders — the bug would multiply the handler count here.
      for (let i = 0; i < 5; i++) { await sheet.render(false); await new Promise((r) => setTimeout(r, 120)); }
      await new Promise((r) => setTimeout(r, 300));

      out.elementPersisted = sheet.element === el0;          // confirms the premise (root persists)
      out.afterSixRenders = countNs(sheet.element, "cpActor");

      await sheet.close();
    } catch (e) {
      out.errors.push(String(e?.stack ?? e?.message ?? e));
    } finally {
      try { await actor?.delete(); } catch (_) {}
    }
    return out;
  });

  console.log("listener idempotency:", JSON.stringify(result, null, 2));
  console.log("console errors:", JSON.stringify(consoleErrors, null, 2));

  expect(result.errors, "no thrown errors").toEqual([]);
  expect(result.jqueryAvailable, "jQuery internal event store reachable").toBe(true);
  expect(result.tag, "root is the V2 <form>").toBe("form");
  expect(result.elementPersisted, "this.element persists across re-renders (the premise)").toBe(true);
  expect(result.afterFirstRender, "some .cpActor delegated handlers bound").toBeGreaterThan(0);
  expect(result.afterSixRenders, "no accumulation after 6 renders").toBe(result.afterFirstRender);
});

test("item-sheet V2: delegated listeners do not accumulate across re-renders", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e?.message ?? e)));

  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [] };
    const $ = window.jQuery ?? window.$;
    const countNs = (el, ns) => {
      if (!el || !$?._data) return -1;
      const ev = $._data(el, "events") || {};
      let n = 0;
      for (const type of Object.keys(ev))
        for (const h of ev[type])
          if ((h.namespace || "").split(".").includes(ns)) n++;
      return n;
    };

    let item;
    try {
      // cyberware exercises the widest handler set (incl. the multi-select menu's
      // 2-arg outside-click closers bound directly to the root).
      item = await Item.create({ name: "ZZ DoubleBind Item Probe", type: "cyberware" });
      const sheet = item.sheet;
      await sheet.render({ force: true });
      await new Promise((r) => setTimeout(r, 600));

      const el0 = sheet.element;
      out.tag = el0?.tagName?.toLowerCase() ?? null;
      out.jqueryAvailable = !!$?._data;
      out.afterFirstRender = countNs(el0, "cpItem");

      for (let i = 0; i < 5; i++) { await sheet.render(false); await new Promise((r) => setTimeout(r, 120)); }
      await new Promise((r) => setTimeout(r, 300));

      out.elementPersisted = sheet.element === el0;
      out.afterSixRenders = countNs(sheet.element, "cpItem");

      await sheet.close();
    } catch (e) {
      out.errors.push(String(e?.stack ?? e?.message ?? e));
    } finally {
      try { await item?.delete(); } catch (_) {}
    }
    return out;
  });

  console.log("item listener idempotency:", JSON.stringify(result, null, 2));
  console.log("console errors:", JSON.stringify(consoleErrors, null, 2));

  expect(result.errors, "no thrown errors").toEqual([]);
  expect(result.jqueryAvailable, "jQuery internal event store reachable").toBe(true);
  expect(result.tag, "root is the V2 <form>").toBe("form");
  expect(result.elementPersisted, "this.element persists across re-renders (the premise)").toBe(true);
  expect(result.afterFirstRender, "some .cpItem delegated handlers bound").toBeGreaterThan(0);
  expect(result.afterSixRenders, "no accumulation after 6 renders").toBe(result.afterFirstRender);
});
