import { test, expect } from "@playwright/test";
import { login, evalGameOrThrow, setupSceneWithToken, waitForCanvasScene, cleanupTestData } from "../helpers/foundry.js";
import { ACCOUNTS } from "../helpers/accounts.js";

/**
 * Catalog interactions: dimmed (disabled-for-players) items sink to the bottom; supplement filters
 * are functional (enabling a source makes its items visible to players); and selecting a token live-
 * updates an OPEN catalog's buyer (no reopen needed).
 */
test("dimmed-to-bottom ordering + functional supplement filter", async ({ page }) => {
  await login(page, ACCOUNTS.gm);

  const R = await evalGameOrThrow(page, async () => {
    const out = {};
    await game.settings.set("cyberpunk2020", "shoppingEnabled", true);
    const mod = await import("/systems/cyberpunk2020/module/shop/catalog.js");
    const sup = await import("/systems/cyberpunk2020/module/shop/supplements.js");

    // GM view: every enabled row precedes every dimmed row; the divider sits on the first dimmed.
    const browser = new mod.CatalogBrowser(null, { view: "catalog" });
    const data = await browser.getData();
    const firstDim = data.rows.findIndex(r => r.dimmed);
    const lastEnabled = data.rows.map(r => !r.dimmed).lastIndexOf(true);
    out.hasDimmed = firstDim !== -1;
    out.dimmedAllBelow = firstDim === -1 || firstDim > lastEnabled;
    out.dividerOnFirstDimmed = firstDim === -1 || data.rows[firstDim]._hiddenDivider === true;

    // Functional filter: a real Chromebook item is hidden from players until the source is enabled.
    const index = await mod.getCatalogIndex();
    const cb = index.find(i => i.supplement === "Chromebook");
    out.haveChromebook = !!cb;
    if (cb) {
      out.cbPlayerOff = sup.isVisibleTo(cb.supplement, cb.canon, { allowHomebrew: false, enabledSources: {} }, false);
      out.cbPlayerOn  = sup.isVisibleTo(cb.supplement, cb.canon, { allowHomebrew: false, enabledSources: { Chromebook: true } }, false);
      out.cbGmAlways  = sup.isVisibleTo(cb.supplement, cb.canon, { allowHomebrew: false, enabledSources: {} }, true);
    }
    return out;
  });

  console.log("Catalog interactions:", JSON.stringify(R));
  expect(R.hasDimmed, "GM has some disabled-for-players items to dim").toBe(true);
  expect(R.dimmedAllBelow, "all dimmed rows sit below enabled rows").toBe(true);
  expect(R.dividerOnFirstDimmed, "hidden divider marks the first dimmed row").toBe(true);
  expect(R.haveChromebook).toBe(true);
  expect(R.cbPlayerOff, "Chromebook hidden from players by default").toBe(false);
  expect(R.cbPlayerOn, "enabling Chromebook reveals it to players").toBe(true);
  expect(R.cbGmAlways, "GM always sees Chromebook").toBe(true);
});

test("selecting a token live-updates an open catalog's buyer", async ({ page }) => {
  await login(page, ACCOUNTS.gm, { canvas: true });
  const { sceneId, tokenId, actorId } = await setupSceneWithToken(page, {
    activate: true, actorType: "character", actorName: "__PW__shopper",
    actorUpdate: { "system.eurobucks": 1234 },
  });
  await waitForCanvasScene(page, sceneId);

  const R = await evalGameOrThrow(page, async (ids) => {
    const out = {};
    await game.settings.set("cyberpunk2020", "shoppingEnabled", true);
    const mod = await import("/systems/cyberpunk2020/module/shop/catalog.js");

    // Open with NOTHING selected → no buyer.
    for (const t of canvas.tokens.controlled) t.release();
    const browser = new mod.CatalogBrowser(null, { view: "catalog" });
    await browser.render(true);
    await new Promise(r => setTimeout(r, 200));
    out.buyerBefore = browser.buyer?.id ?? null;

    // Select the token AFTER the window is open → it should live-update.
    canvas.tokens.get(ids.tokenId)?.control({ releaseOthers: true });
    await new Promise(r => setTimeout(r, 300));
    out.buyerAfter = browser.buyer?.id ?? null;
    out.expectedActor = ids.actorId;
    out.domFunds = browser.element?.[0]?.querySelector(".cp-catalog-buyer")?.textContent?.includes("1234");

    await browser.close();
    return out;
  }, { tokenId, actorId });

  console.log("Live token update:", JSON.stringify(R));
  await cleanupTestData(page);

  expect(R.buyerBefore, "no buyer before selecting").toBeNull();
  expect(R.buyerAfter, "buyer set to the selected token's actor").toBe(R.expectedActor);
  expect(R.domFunds, "buyer funds shown in the toolbar").toBe(true);
});
