import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Gear tab drag gestures:
 *   - gearTabItems is ordered by the `sort` field (name tiebreak) so manual order persists;
 *   - dragging a row within the list reorders it (performIntegerSort → item.sort);
 *   - dragging a row OFF the window raises the delete confirm.
 * HTML5 DnD can't be driven by real mouse moves in headless Chromium, so we dispatch DragEvents on the
 * real rows — the reorder/delete handlers run off closure state + event coords, so this exercises the
 * actual code paths. Self-cleans (tagged actor).
 */

test.describe.configure({ mode: "serial" });

let ctx, page, actorId;

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
  page = await ctx.newPage();
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});
  actorId = await evalGameOrThrow(page, async () => {
    const actor = await Actor.create({ name: "__PW__GearDrag", type: "character", flags: { cyberpunk2020: { __pwtest: true } } });
    await actor.createEmbeddedDocuments("Item", [
      { name: "__PW__GearA", type: "weapon", sort: 100 },
      { name: "__PW__GearB", type: "weapon", sort: 200 },
      { name: "__PW__GearC", type: "weapon", sort: 300 },
    ]);
    await actor.sheet.render(true);
    await new Promise((r) => setTimeout(r, 500));
    return actor.id;
  });
});

test.afterAll(async () => {
  if (page) await cleanupTestData(page).catch(() => {});
  if (ctx) await ctx.close();
});

const domOrder = (a) => {
  const sheet = game.actors.get(a).sheet;
  return [...sheet.element[0].querySelectorAll(".gear-sortable .gear[data-item-id]")]
    .map((r) => r.querySelector("label")?.textContent?.trim());
};

test("gear rows are draggable and ordered by the sort field", async () => {
  const res = await evalGameOrThrow(page, (a) => {
    const sheet = game.actors.get(a).sheet;
    const rows = [...sheet.element[0].querySelectorAll(".gear-sortable .gear[data-item-id]")];
    return {
      order: rows.map((r) => r.querySelector("label")?.textContent?.trim()),
      allDraggable: rows.length > 0 && rows.every((r) => r.getAttribute("draggable") === "true"),
    };
  }, actorId);
  expect(res.allDraggable, "every gear row is draggable").toBe(true);
  expect(res.order, "ordered by sort 100/200/300").toEqual(["__PW__GearA", "__PW__GearB", "__PW__GearC"]);
});

test("dropping a row onto another reorders it, matching the drop indicator (persists via sort)", async () => {
  const res = await evalGameOrThrow(page, async (a) => {
    const actor = game.actors.get(a);
    const list = actor.sheet.element[0].querySelector(".gear-sortable");
    const rows = [...list.querySelectorAll(".gear[data-item-id]")];
    const byName = (n) => rows.find((r) => r.querySelector("label")?.textContent?.trim() === n);
    const src = byName("__PW__GearC");      // drag C ...
    const tgt = byName("__PW__GearA");      // ... onto A
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
    const r = tgt.getBoundingClientRect();
    const init = { bubbles: true, dataTransfer: dt, clientX: r.left + 5, clientY: r.top + 2 };
    tgt.dispatchEvent(new DragEvent("dragover", init));
    const before = tgt.classList.contains("cp-gear-drop-before"); // the indicator the user sees
    tgt.dispatchEvent(new DragEvent("drop", init));
    src.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt }));
    await new Promise((res) => setTimeout(res, 600)); // sort update + re-render
    return {
      before,
      order: [...actor.sheet.element[0].querySelectorAll(".gear-sortable .gear[data-item-id]")]
        .map((x) => x.querySelector("label")?.textContent?.trim()),
    };
  }, actorId);
  // The reorder must land where the indicator showed, and C must have moved (no longer last).
  const expected = res.before
    ? ["__PW__GearC", "__PW__GearA", "__PW__GearB"]
    : ["__PW__GearA", "__PW__GearC", "__PW__GearB"];
  expect(res.order, "drop result matches the shown insertion indicator").toEqual(expected);
  expect(res.order, "C moved out of last place").not.toEqual(["__PW__GearA", "__PW__GearB", "__PW__GearC"]);
});

test("drag-off detects empty space (not the sheet) and the confirm deletes", async () => {
  // The void-detection used by the drag-off gesture, exercised with REAL coordinates (synthetic
  // DragEvents don't carry clientX/Y, so we test the decision directly rather than via dragend).
  const res = await evalGameOrThrow(page, (a) => {
    const sheet = game.actors.get(a).sheet;
    const el = sheet.element[0];
    const rect = el.getBoundingClientRect();
    const doc = el.ownerDocument;
    return {
      onSheet: sheet._isGearDropToVoid(Math.round(rect.left + 60), Math.round(rect.top + 12), doc),
      offScreen: sheet._isGearDropToVoid(99999, 99999, doc),
    };
  }, actorId);
  expect(res.onSheet, "a point over the sheet is NOT the delete zone").toBe(false);
  expect(res.offScreen, "empty space IS the delete zone").toBe(true);

  // The confirm the drag-off raises actually deletes on Yes (fresh item so retries stay clean).
  await evalGameOrThrow(page, async (a) => {
    const actor = game.actors.get(a);
    const [made] = await actor.createEmbeddedDocuments("Item", [{ name: "__PW__GearDel", type: "weapon", sort: 500 }]);
    actor.sheet._confirmDeleteItem(actor.items.get(made.id));
    await new Promise((r) => setTimeout(r, 200));
  }, actorId);
  const dialog = page.locator(".window-content, .dialog-content").filter({ hasText: "__PW__GearDel" }).last();
  await expect(dialog, "delete confirm names the item").toBeVisible({ timeout: 6000 });
  await page.locator('button[data-button="yes"]').last().click();
  await page.waitForTimeout(400);
  const gone = await evalGameOrThrow(page, (a) => !game.actors.get(a).items.find((i) => i.name === "__PW__GearDel"), actorId);
  expect(gone, "confirming deletes the item").toBe(true);
});
