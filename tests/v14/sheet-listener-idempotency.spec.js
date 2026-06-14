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
test("actor-sheet V2: native listeners are bound once (no accumulation across re-renders)", async ({ page }) => {
  // The actor sheet's listeners are now native bind-once `_cpActivate*` helpers (Stage A2) — no more
  // jQuery delegated-on-root handlers. This verifies the bind-once guards prevent accumulation:
  // after many re-renders, one click fires the action exactly once (a double-bound listener would
  // fire N times). Also asserts zero `.cpActor` jQuery delegated handlers remain.
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

    let actor;
    try {
      actor = await Actor.create({ name: "ZZ Idempotency Probe", type: "character" });
      const sheet = actor.sheet;
      await sheet.render({ force: true });
      await new Promise((r) => setTimeout(r, 600));

      const el0 = sheet.element;
      out.tag = el0?.tagName?.toLowerCase() ?? null;

      // Force several re-renders — a double-bound listener would fire N times on one click below.
      for (let i = 0; i < 5; i++) { await sheet.render(false); await new Promise((r) => setTimeout(r, 120)); }
      await new Promise((r) => setTimeout(r, 300));

      out.elementPersisted = sheet.element === el0;                       // premise: root persists
      out.boundFlag = el0.dataset?.cpBasicActorActionsBound ?? null;      // bind-once guard set
      out.cpActorHandlers = countNs(el0, "cpActor");                      // expect 0 — fully native

      // Behavioural idempotency: one click fires the action exactly once.
      let fired = 0;
      const orig = actor.rollStat;
      actor.rollStat = function () { fired++; };
      el0.querySelector(".stat-roll")?.click();
      actor.rollStat = orig;
      out.statRollFires = fired;

      await sheet.close();
    } catch (e) {
      out.errors.push(String(e?.stack ?? e?.message ?? e));
    } finally {
      try { await actor?.delete(); } catch (_) {}
    }
    return out;
  });

  console.log("native idempotency:", JSON.stringify(result, null, 2));
  console.log("console errors:", JSON.stringify(consoleErrors, null, 2));

  expect(result.errors, "no thrown errors").toEqual([]);
  expect(result.tag, "root is the V2 <form>").toBe("form");
  expect(result.elementPersisted, "this.element persists across re-renders (the premise)").toBe(true);
  expect(result.boundFlag, "basic-actions listener bound once (guard flag set)").toBe("1");
  expect(result.cpActorHandlers, "no jQuery delegated (.cpActor) handlers remain — fully native").toBe(0);
  expect(result.statRollFires, "one .stat-roll click fires rollStat exactly once after 6 renders").toBe(1);
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
