import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * Validates the tear-off-tab window (CyberpunkActorTabSheet) after its V1->V2 port. Opening a tab
 * popout must construct an ActorSheetV2, render its single-tab template (single root), show the
 * right tab body, and produce no errors — confirming the V2 constructor signature, _prepareContext,
 * _onRender, and the PARTS-template override.
 *
 *   v14:  npx playwright test --config playwright.v14.config.js v14/tab-popout-v2.spec.js
 *   v13:  FVTT_URL=http://localhost:30003 npx playwright test --config playwright.v14.config.js v14/tab-popout-v2.spec.js
 */
test("tab-popout V2: opens a single tab as an ActorSheetV2, correct body, no errors", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e?.message ?? e)));
  await joinAsGM(page);

  const result = await page.evaluate(async () => {
    const out = { errors: [], cleanupId: null };
    try {
      const mod = await import("/systems/cyberpunk2020/module/actor/actor-tab-popout.js");
      const actor = await Actor.create({ name: "ZZ TabPopout Probe", type: "character" });
      out.cleanupId = actor.id;

      const sheet = await mod.CyberpunkActorTabSheet.open(actor, "combat");
      await new Promise((r) => setTimeout(r, 700));

      out.rendered   = sheet?.rendered === true;
      out.isV2       = sheet instanceof foundry.applications.sheets.ActorSheetV2;
      out.elementTag = sheet?.element?.tagName?.toLowerCase() ?? null;     // "form"
      out.tabKey     = sheet?.tabKey;
      out.idHasTab   = String(sheet?.id ?? "").includes("combat");
      // single-root wrapper + the COMBAT body present, others absent (single-tab window)
      out.hasRoot    = !!sheet?.element?.querySelector(".cp-tab-popout-form");
      out.hasCombat  = !!sheet?.element?.querySelector('.tab[data-tab="combat"]');
      out.noSkills   = !sheet?.element?.querySelector('.tab[data-tab="skills"]');
      // registered on the actor so it live-updates
      out.inActorApps = Object.values(actor.apps ?? {}).some((a) => a === sheet);

      await sheet?.close();
      await actor.delete();
    } catch (e) {
      out.errors.push(String(e?.stack ?? e));
    } finally {
      try { if (out.cleanupId) await game.actors.get(out.cleanupId)?.delete(); } catch (_) {}
    }
    return out;
  });

  console.log("tab-popout V2:", JSON.stringify(result, null, 2));
  console.log("page errors:", JSON.stringify(pageErrors, null, 2));
  expect(result.errors, "no thrown errors").toEqual([]);
  expect(result.rendered, "popout rendered").toBe(true);
  expect(result.isV2, "instanceof ActorSheetV2").toBe(true);
  expect(result.elementTag, "root is the V2 <form>").toBe("form");
  expect(result.tabKey, "tabKey option preserved").toBe("combat");
  expect(result.hasRoot, "single-root wrapper present").toBe(true);
  expect(result.hasCombat, "combat tab body rendered").toBe(true);
  expect(result.noSkills, "only the requested tab is rendered").toBe(true);
  expect(result.inActorApps, "registered in actor.apps (live-updates)").toBe(true);
  expect(pageErrors, "no page errors").toEqual([]);
});
