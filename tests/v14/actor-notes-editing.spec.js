import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * Life-tab notes view↔edit toggle (Stage B step 2 parity port). Notes render read-only by default
 * with an Edit button; clicking it swaps in the ProseMirror editor; leaving the life tab or closing
 * the sheet flushes and returns to the read-only view. This spec pins the deterministic plumbing:
 *
 *   - read-only view by default: .cp-notes-view present (renders system.notes), Edit button present,
 *     no <prose-mirror>, canvas is .is-viewing;
 *   - clicking the Edit button enters edit mode: re-renders with <prose-mirror>, Edit button gone,
 *     canvas .is-editing, _cpNotesEditing === true;
 *   - _cpExitNotesEditing flushes (force) + returns to the read-only view;
 *   - _preClose (sheet close) flushes notes, resets editing, and tears down the notes listeners.
 *
 * NOT covered here (interaction-heavy → MANUAL verify): typing in the ProseMirror editor and the
 * debounced input/change autosave actually persisting to system.notes. The flush *plumbing* is
 * asserted via a spy; the editor keystroke→serialize path is verified by hand.
 *
 *   v14 (:30002)  npx playwright test --config playwright.v14.config.js v14/actor-notes-editing.spec.js
 *   v13 (:30003)  FVTT_URL=http://localhost:30003 (same command)
 *
 * Needs the rig world + FVTT_RIG_PASSWORD. DO NOT run automatically.
 */
test("actor-sheet V2: life-tab notes view/edit toggle + close flush", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e?.message ?? e)));

  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [], view: {}, edit: {}, exit: {}, close: {} };
    const NOTE = "<p>ZZ probe note body</p>";

    const waitFor = async (cond, ms = 4000) => {
      const dl = Date.now() + ms;
      while (Date.now() < dl) { if (cond()) return true; await new Promise((r) => setTimeout(r, 100)); }
      return !!cond();
    };

    let actor;
    try {
      actor = await Actor.create({ name: "ZZ Notes Probe", type: "character", system: { notes: NOTE } });

      const sheet = actor.sheet;
      await sheet.render({ force: true });
      await waitFor(() => !!sheet.element?.querySelector?.(".cp-notes-editor"));
      let root = sheet.element;

      // ── default = read-only view ─────────────────────────────────────────
      out.view.notesEditingFlag = !!sheet._cpNotesEditing;
      out.view.hasViewDiv = !!root.querySelector(".cp-notes-view");
      out.view.hasEditButton = !!root.querySelector('[data-action="notes-edit"]');
      out.view.hasProseMirror = !!root.querySelector("prose-mirror.cp-notes-prosemirror");
      out.view.isViewing = !!root.querySelector(".cp-notes-canvas.is-viewing");
      out.view.viewRendersNote = (root.querySelector(".cp-notes-view")?.innerHTML ?? "").includes("ZZ probe note body");

      // ── click Edit → edit mode ───────────────────────────────────────────
      const editBtn = root.querySelector('[data-action="notes-edit"]');
      out.edit.clicked = !!editBtn;
      if (editBtn) editBtn.click();
      await waitFor(() => !!sheet._cpNotesEditing && !!sheet.element?.querySelector?.("prose-mirror.cp-notes-prosemirror"));
      root = sheet.element;
      out.edit.notesEditingFlag = !!sheet._cpNotesEditing;
      out.edit.hasProseMirror = !!root.querySelector("prose-mirror.cp-notes-prosemirror");
      out.edit.editButtonGone = !root.querySelector('[data-action="notes-edit"]');
      out.edit.isEditing = !!root.querySelector(".cp-notes-canvas.is-editing");

      // ── _cpExitNotesEditing → flush (force) + back to view ───────────────
      let exitFlushes = 0;
      const origFlush = sheet._cpFlushNotesAutosave;
      sheet._cpFlushNotesAutosave = function (...a) { exitFlushes++; return origFlush.apply(this, a); };
      await sheet._cpExitNotesEditing(sheet.element, { render: true });
      sheet._cpFlushNotesAutosave = origFlush;
      await waitFor(() => !sheet._cpNotesEditing && !!sheet.element?.querySelector?.(".cp-notes-view"));
      root = sheet.element;
      out.exit.flushed = exitFlushes > 0 ? 1 : 0;
      out.exit.notesEditingFlag = !!sheet._cpNotesEditing;
      out.exit.backToView = !!root.querySelector(".cp-notes-view") && !root.querySelector("prose-mirror.cp-notes-prosemirror");

      // ── _preClose (close) → flush + reset + listener teardown ────────────
      sheet._cpNotesEditing = true; // pretend mid-edit so _preClose has something to reset
      let closeFlushes = 0;
      const origFlush2 = sheet._cpFlushNotesAutosave;
      sheet._cpFlushNotesAutosave = function (...a) { closeFlushes++; return origFlush2.apply(this, a); };
      await sheet.close();
      out.close.flushed = closeFlushes > 0 ? 1 : 0;
      out.close.editingReset = sheet._cpNotesEditing === false;
      out.close.actionsHandlerCleared = sheet._cpNotesActionsHandler == null;
      out.close.autosaveHandlerCleared = sheet._cpNotesAutosaveHandler == null;
    } catch (e) {
      out.errors.push(String(e?.stack ?? e?.message ?? e));
    } finally {
      try { await actor?.sheet?.close?.(); } catch (_) {}
      try { await actor?.delete(); } catch (_) {}
    }
    return out;
  });

  console.log("notes-editing:", JSON.stringify(result, null, 2));
  console.log("console errors:", JSON.stringify(consoleErrors, null, 2));

  expect(result.errors, "no thrown errors").toEqual([]);

  // default read-only view
  expect(result.view.notesEditingFlag, "starts not-editing").toBe(false);
  expect(result.view.hasViewDiv, ".cp-notes-view present").toBe(true);
  expect(result.view.hasEditButton, "Edit button present").toBe(true);
  expect(result.view.hasProseMirror, "no editor in view mode").toBe(false);
  expect(result.view.isViewing, "canvas is .is-viewing").toBe(true);
  expect(result.view.viewRendersNote, "view renders the saved note HTML").toBe(true);

  // click Edit → edit mode
  expect(result.edit.clicked, "Edit button was clickable").toBe(true);
  expect(result.edit.notesEditingFlag, "editing flag set after click").toBe(true);
  expect(result.edit.hasProseMirror, "ProseMirror editor present in edit mode").toBe(true);
  expect(result.edit.editButtonGone, "Edit button hidden in edit mode").toBe(true);
  expect(result.edit.isEditing, "canvas is .is-editing").toBe(true);

  // exit editing
  expect(result.exit.flushed, "_cpExitNotesEditing flushed").toBe(1);
  expect(result.exit.notesEditingFlag, "editing flag cleared on exit").toBe(false);
  expect(result.exit.backToView, "returned to the read-only view").toBe(true);

  // close flush + teardown
  expect(result.close.flushed, "_preClose flushed notes on close").toBe(1);
  expect(result.close.editingReset, "_preClose reset the editing flag").toBe(true);
  expect(result.close.actionsHandlerCleared, "_preClose cleared the notes-actions handler").toBe(true);
  expect(result.close.autosaveHandlerCleared, "_preClose cleared the autosave handler").toBe(true);
});
