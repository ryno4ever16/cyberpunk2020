import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Polish: per-shell-variant warhead editing on the vehicleWeapon item sheet. Verifies the array
 * round-trips through the data model, the editor UI renders, and the Add/Remove handlers mutate it.
 */
test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("vehicleWeapon shell-variant editor persists + add/remove work", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const flags = { cyberpunk2020: { __pwtest: true } };
    const out = {};
    let item, app;
    try {
      item = await Item.create({ name: "__PW__VW", type: "vehicleWeapon", flags, system: { weaponClass: "artillery", penetration: 6, burst: 6 } });

      // (a) Round-trip an array of warhead objects through the data model.
      await item.update({ "system.shellVariants": [
        { name: "WP", pen: 0, burst: 6, warhead: "wp", ap: false },
        { name: "AP", pen: 12, burst: 0, warhead: "", ap: true },
      ] });
      out.count = (item.system.shellVariants || []).length;
      out.wpWarhead = item.system.shellVariants?.[0]?.warhead;
      out.apFlag = item.system.shellVariants?.[1]?.ap;

      // (b) The editor UI renders rows + the Add control.
      app = item.sheet;
      await app.render(true);
      await new Promise(r => setTimeout(r, 300));
      let root = app.element[0] ?? app.element;
      out.hasAdd = !!root.querySelector(".cp-sv-add");
      out.rowCount = root.querySelectorAll(".cp-shellvar").length;
      out.warheadSelects = root.querySelectorAll('.cp-sv[data-field="warhead"]').length;

      // (c) The Add handler appends a variant; Remove drops one (real delegated handlers).
      root.querySelector(".cp-sv-add").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 400));
      out.afterAdd = (item.system.shellVariants || []).length;

      root = app.element[0] ?? app.element;
      const rm = root.querySelector(".cp-sv-remove");
      if (rm) rm.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      await new Promise(r => setTimeout(r, 400));
      out.afterRemove = (item.system.shellVariants || []).length;
    } finally {
      if (app?.rendered) await app.close().catch(() => {});
      if (item) await item.delete().catch(() => {});
    }
    return out;
  });

  console.log("variants:", JSON.stringify(R));
  expect(R.count).toBe(2);
  expect(R.wpWarhead).toBe("wp");
  expect(R.apFlag).toBe(true);
  expect(R.hasAdd).toBe(true);
  expect(R.rowCount).toBe(2);
  expect(R.warheadSelects).toBe(2);
  expect(R.afterAdd).toBe(3);     // Add appended a third
  expect(R.afterRemove).toBe(2);  // Remove dropped one
});
