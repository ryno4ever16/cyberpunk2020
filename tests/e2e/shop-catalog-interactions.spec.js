import { test, expect } from "@playwright/test";
import { login, evalGameOrThrow, setupSceneWithToken, waitForCanvasScene, cleanupTestData } from "../helpers/foundry.js";
import { ACCOUNTS } from "../helpers/accounts.js";

/**
 * Catalog interactions: the supplement/source filter is functional (the GM sees hidden-source items,
 * players don't until the source is enabled — round-7 replaced inline dimming with source filtering);
 * and selecting a token live-updates an OPEN catalog's buyer (no reopen needed).
 */
test("source visibility: non-core hidden from players by default, GM always, revealed when enabled", async ({ page }) => {
  await login(page, ACCOUNTS.gm);

  const R = await evalGameOrThrow(page, async () => {
    const out = {};
    await game.settings.set("cyberpunk2020", "shoppingEnabled", true);
    const mod = await import("/systems/cyberpunk2020/module/shop/catalog.js");
    const sup = await import("/systems/cyberpunk2020/module/shop/supplements.js");

    // The GM catalog renders rows (the world has buyable items).
    const browser = new mod.CatalogBrowser(null, { view: "catalog" });
    const data = await browser._prepareContext({});
    out.gmRowCount = data.rowCount;

    // Round-7 replaced inline dimming with SOURCE FILTERING. The gate is isVisibleTo: a non-core
    // ("official") source is hidden from players by default, revealed once the GM enables that source,
    // and always visible to the GM. The rule keys off canon + enabledSources — content-independent —
    // so a representative source key exercises it on any world.
    const src = "Chromebook";
    out.playerOff = sup.isVisibleTo(src, "official", { allowHomebrew: false, enabledSources: {} }, false);
    out.playerOn  = sup.isVisibleTo(src, "official", { allowHomebrew: false, enabledSources: { [src]: true } }, false);
    out.gmAlways  = sup.isVisibleTo(src, "official", { allowHomebrew: false, enabledSources: {} }, true);

    // Integration check (only when this world actually has non-core content — the isolated rig may
    // carry only core): the GM's rows must include a real non-core item.
    const index = await mod.getCatalogIndex();
    const official = index.find(i => i.canon === "official");
    out.haveOfficial = !!official;
    out.gmSeesOfficial = official ? data.rows.some(r => r.name === official.name) : null;
    return out;
  });

  console.log("Source visibility:", JSON.stringify(R));
  expect(R.gmRowCount, "GM catalog has rows").toBeGreaterThan(0);
  expect(R.playerOff, "non-core hidden from players by default").toBe(false);
  expect(R.playerOn, "enabling the source reveals it to players").toBe(true);
  expect(R.gmAlways, "GM always sees non-core").toBe(true);
  if (R.haveOfficial) expect(R.gmSeesOfficial, "GM's rows include the non-core item").toBe(true);
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
    out.domFunds = browser.element?.querySelector(".cp-catalog-buyer")?.textContent?.includes("1234");

    await browser.close();
    return out;
  }, { tokenId, actorId });

  console.log("Live token update:", JSON.stringify(R));
  await cleanupTestData(page);

  expect(R.buyerBefore, "no buyer before selecting").toBeNull();
  expect(R.buyerAfter, "buyer set to the selected token's actor").toBe(R.expectedActor);
  expect(R.domFunds, "buyer funds shown in the toolbar").toBe(true);
});
