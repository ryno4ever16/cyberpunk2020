import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * End-to-end combat/sheet specs that create their own content (rig-portable, not :30000-bound).
 * Closes the gap unit + render tests can't: that the V2-ported actor sheet's drop pipeline and the
 * core damage automation actually work against the live data model on both cores.
 *
 *   v14:  npx playwright test --config playwright.v14.config.js v14/combat-sheet-e2e.spec.js
 *   v13:  FVTT_URL=http://localhost:30003 npx playwright test --config playwright.v14.config.js v14/combat-sheet-e2e.spec.js
 */

// #3 — dropping a world item onto the V2 actor sheet creates an embedded item (the _onDrop chain).
test("actor-sheet V2: dropping a world item creates an embedded item", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));
  await joinAsGM(page);

  const r = await page.evaluate(async () => {
    const out = { errors: [], cleanup: [] };
    try {
      const src = await Item.create({ name: "ZZ E2E Drop Weapon", type: "weapon" });
      out.cleanup.push(["Item", src.id]);
      const actor = await Actor.create({ name: "ZZ E2E Drop Target", type: "character" });
      out.cleanup.push(["Actor", actor.id]);
      const sheet = actor.sheet;
      await sheet.render({ force: true });
      await new Promise((r) => setTimeout(r, 500));

      out.before = actor.items.filter((i) => i.type === "weapon").length;
      // Synthetic DragEvents don't reliably carry a target or dataTransfer in headless Chromium, and
      // _onDropItem reads event.target.closest(...). Build a controllable event with a real target
      // (the sheet root) + the drag payload so the actual drop pipeline runs end-to-end.
      const payload = JSON.stringify({ type: "Item", uuid: src.uuid });
      const fakeEvent = {
        type: "drop", target: sheet.element, currentTarget: sheet.element,
        preventDefault() {}, stopPropagation() {}, stopImmediatePropagation() {},
        dataTransfer: { getData: () => payload, types: ["text/plain"], dropEffect: "copy" },
      };
      await sheet._onDrop(fakeEvent);
      await new Promise((r) => setTimeout(r, 500));

      out.after = actor.items.filter((i) => i.type === "weapon").length;
      out.created = out.after === out.before + 1;
      await sheet.close();
    } catch (e) {
      out.errors.push(String(e?.stack ?? e));
    } finally {
      for (const [t, id] of out.cleanup) { try { (t === "Item" ? game.items : game.actors).get(id)?.delete(); } catch (_) {} }
    }
    return out;
  });

  console.log("item-drop e2e:", JSON.stringify(r, null, 2));
  console.log("page errors:", JSON.stringify(pageErrors));
  expect(r.errors, "no thrown errors").toEqual([]);
  expect(r.created, `embedded weapon count ${r.before} -> ${r.after}`).toBe(true);
});

// #1 — core damage automation against the live data model: applyAreaDamages writes the computed
// netDamage to the actor and ablates the struck location's armor.
test("combat e2e: applyAreaDamages writes netDamage to the actor + ablates armor", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));
  await joinAsGM(page);

  const r = await page.evaluate(async () => {
    const out = { errors: [], cleanup: null };
    try {
      const DA = await import("/systems/cyberpunk2020/module/combat/DamageApplicator.js");
      const actor = await Actor.create({ name: "ZZ E2E Dmg Target", type: "character" });
      out.cleanup = actor.id;
      await actor.update({ "system.hitLocations.Torso.stoppingPower": 10, "system.damage": 0 });

      const sp0  = Number(actor.system.hitLocations?.Torso?.stoppingPower) || 0;
      const dmg0 = Number(actor.system.damage) || 0;
      const raw  = 25;

      const results = await DA.applyAreaDamages({
        target: actor, areaDamages: { Torso: [{ damage: raw }] },
        ap: false, armorMode: DA.ARMOR_MODES.FULL, ablate: true,
      });

      const net  = Number(results?.[0]?.netDamage);
      const dmg1 = Number(actor.system.damage) || 0;
      const sp1  = Number(actor.system.hitLocations?.Torso?.stoppingPower) || 0;

      out.sp0 = sp0; out.dmg0 = dmg0; out.raw = raw; out.net = net; out.dmg1 = dmg1; out.sp1 = sp1;
      out.penetrated   = net > 0;                                 // raw 25 vs SP 10 should penetrate
      out.damageWritten = (dmg1 - dmg0) === net;                  // the e2e: computed netDamage -> actor
      out.ablated      = (sp0 > 0 && net > 0) ? (sp1 < sp0) : true; // armor wore down on a penetrating hit
      await actor.sheet?.close?.();
    } catch (e) {
      out.errors.push(String(e?.stack ?? e));
    } finally {
      try { if (out.cleanup) game.actors.get(out.cleanup)?.delete(); } catch (_) {}
    }
    return out;
  });

  console.log("damage e2e:", JSON.stringify(r, null, 2));
  console.log("page errors:", JSON.stringify(pageErrors));
  expect(r.errors, "no thrown errors").toEqual([]);
  expect(r.penetrated, `netDamage ${r.net} (raw ${r.raw} vs SP ${r.sp0}) should be > 0`).toBe(true);
  expect(r.damageWritten, `actor.system.damage ${r.dmg0} -> ${r.dmg1} (expected +${r.net})`).toBe(true);
  expect(r.ablated, `Torso SP ${r.sp0} -> ${r.sp1} (should drop on a penetrating hit)`).toBe(true);
});
