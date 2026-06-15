import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * Saved attack options (Stage B parity port). When a weapon's attack dialog is confirmed, the
 * chosen fire mode (ranged) / martial art + cyberlimb terminus (melee) are persisted to the item's
 * flags so the next attack pre-fills them. This spec exercises the actor-sheet plumbing:
 *
 *   - _cpSave/_cpGet round-trip the lastRangedAttackOptions / lastMeleeAttackOptions flags;
 *   - saving an unchanged value is a no-op (no document update / re-render);
 *   - melee save drops the martial `action` (our flow picks it via the combat-tab button panel,
 *     not the dialog — upstream's saved `action` is intentionally not ported; re-seat earmark);
 *   - _cpOpenWeaponAttackDialog feeds the saved fire mode into the dialog as its default.
 *
 *   v14 (:30002)  npx playwright test --config playwright.v14.config.js v14/actor-saved-attack-options.spec.js
 *   v13 (:30003)  FVTT_URL=http://localhost:30003 (same command)
 *
 * Needs the rig world + FVTT_RIG_PASSWORD. DO NOT run automatically.
 */
test("actor-sheet V2: saved attack options round-trip + pre-fill the attack dialog", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push(String(e?.message ?? e)));

  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [], ranged: {}, melee: {}, dialog: {} };

    let actor, dialog;
    try {
      actor = await Actor.create({ name: "ZZ SavedAttackOpts Probe", type: "character" });
      // A default weapon (system:{}) is a Pistol → reliably ranged with fire mode [SemiAuto]. We
      // only need SemiAuto (always a valid choice) for the pre-fill check, and the round-trip/no-op
      // tests store arbitrary flag strings, so we avoid passing explicit weaponType/attackType — the
      // DataModel doesn't always apply those on a freshly-created doc under rig load. The "melee"
      // item is just a flag container for the melee round-trip (those methods don't read the type).
      //
      // Create each item in its own call: createEmbeddedDocuments does NOT guarantee its return
      // array matches input order (it can come back DB-ordered), so a single two-item create would
      // occasionally bind `ranged` to the blade.
      const [ranged] = await actor.createEmbeddedDocuments("Item", [
        { name: "ZZ Probe Pistol", type: "weapon", system: {} },
      ]);
      const [melee] = await actor.createEmbeddedDocuments("Item", [
        { name: "ZZ Probe Blade", type: "weapon", system: { weaponType: "Melee" } },
      ]);

      const sheet = actor.sheet;

      // ── ranged: round-trip ───────────────────────────────────────────────
      out.ranged.getEmpty = JSON.stringify(sheet._cpGetSavedRangedAttackOptions(ranged)); // "{}"
      await sheet._cpSaveRangedAttackOptions(ranged, { fireMode: "FullAuto" });
      out.ranged.flag = ranged.getFlag("cyberpunk2020", "lastRangedAttackOptions")?.fireMode ?? null;
      out.ranged.get = sheet._cpGetSavedRangedAttackOptions(ranged)?.fireMode ?? null;

      // ── ranged: saving the same value is a no-op (no item.update) ─────────
      let updates = 0;
      const origUpdate = ranged.update.bind(ranged);
      ranged.update = function (...args) { updates++; return origUpdate(...args); };
      await sheet._cpSaveRangedAttackOptions(ranged, { fireMode: "FullAuto" }); // unchanged
      out.ranged.noopUpdates = updates;
      await sheet._cpSaveRangedAttackOptions(ranged, { fireMode: "SemiAuto" }); // changed
      out.ranged.changeUpdates = updates;
      ranged.update = origUpdate;
      out.ranged.afterChange = sheet._cpGetSavedRangedAttackOptions(ranged)?.fireMode ?? null;

      // ── melee: round-trip + the dropped `action` earmark ─────────────────
      await sheet._cpSaveMeleeAttackOptions(melee, {
        martialArt: "Martial Arts: Karate",
        cyberTerminus: "CyberTerminusX2",
        action: "Kick", // must NOT be persisted (our martial flow owns the action)
      });
      const savedMelee = sheet._cpGetSavedMeleeAttackOptions(melee);
      out.melee.martialArt = savedMelee?.martialArt ?? null;
      out.melee.cyberTerminus = savedMelee?.cyberTerminus ?? null;
      out.melee.hasAction = Object.prototype.hasOwnProperty.call(savedMelee, "action");

      // ── pre-fill: opening the dialog seeds the saved fire mode as default ─
      // _cpOpenWeaponAttackDialog returns the dialog it builds — read it directly rather than
      // hunting foundry.applications.instances (ModifiersDialog has a fixed id, so a stale instance
      // from another spec can collide there).
      dialog = sheet._cpOpenWeaponAttackDialog(ranged); // ranged now has saved fireMode "SemiAuto"
      out.dialog.opened = !!dialog;
      if (dialog) {
        const fireModeField = (dialog._modifierGroups ?? [])
          .flat()
          .find((f) => f?.dataPath === "fireMode");
        out.dialog.fireModeDefault = fireModeField?.defaultValue ?? null;
        await dialog.close();
      }
    } catch (e) {
      out.errors.push(String(e?.stack ?? e?.message ?? e));
    } finally {
      try { await dialog?.close?.(); } catch (_) {}
      try { await actor?.delete(); } catch (_) {}
    }
    return out;
  });

  console.log("saved-attack-options:", JSON.stringify(result, null, 2));
  console.log("console errors:", JSON.stringify(consoleErrors, null, 2));

  expect(result.errors, "no thrown errors").toEqual([]);

  // ranged round-trip + no-op optimisation
  expect(result.ranged.getEmpty, "no saved options initially").toBe("{}");
  expect(result.ranged.flag, "save wrote the flag").toBe("FullAuto");
  expect(result.ranged.get, "get reads the flag back").toBe("FullAuto");
  expect(result.ranged.noopUpdates, "re-saving the same fire mode is a no-op").toBe(0);
  expect(result.ranged.changeUpdates, "changing the fire mode triggers one update").toBe(1);
  expect(result.ranged.afterChange, "changed value persisted").toBe("SemiAuto");

  // melee round-trip + dropped action
  expect(result.melee.martialArt, "martial art saved").toBe("Martial Arts: Karate");
  expect(result.melee.cyberTerminus, "cyberlimb terminus saved").toBe("CyberTerminusX2");
  expect(result.melee.hasAction, "martial action is NOT persisted (earmark)").toBe(false);

  // dialog pre-fill
  expect(result.dialog.opened, "attack dialog opened").toBe(true);
  expect(result.dialog.fireModeDefault, "dialog defaulted to the saved fire mode").toBe("SemiAuto");
});
