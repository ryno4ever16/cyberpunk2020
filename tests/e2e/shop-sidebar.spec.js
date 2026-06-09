import { test, expect } from "@playwright/test";
import { login, evalGameOrThrow } from "../helpers/foundry.js";
import { ACCOUNTS } from "../helpers/accounts.js";

/**
 * The Shop entry point lives in the SIDEBAR tab strip (not the character sheet). This verifies the
 * launcher button is injected next to the native tabs and opens the catalog window.
 */
test("sidebar Shop button: present when shopping enabled, opens the catalog", async ({ page }) => {
  await login(page, ACCOUNTS.gm);

  const R = await evalGameOrThrow(page, async () => {
    const out = {};
    // Remember + force shopping ON so the launcher renders.
    out.was = game.settings.get("cyberpunk2020", "shoppingEnabled");
    await game.settings.set("cyberpunk2020", "shoppingEnabled", true);
    await ui.sidebar.render(true);
    await new Promise(r => setTimeout(r, 300));

    const btn = document.querySelector("#sidebar nav.tabs .cp-shop-tab")
             ?? document.querySelector("#sidebar .tabs .cp-shop-tab");
    out.buttonPresent = !!btn;
    out.isCart = !!btn?.classList.contains("fa-cart-shopping");
    // It must NOT be a Foundry tab (no data-action="tab" / data-tab) — pure launcher.
    out.notATab = !btn?.dataset?.tab && btn?.dataset?.action !== "tab";
    // Sits directly under the Actors tab.
    const menu = btn?.closest("menu");
    const items = menu ? [...menu.querySelectorAll("li")] : [];
    const myLi = btn?.closest("li");
    const actorsLi = menu?.querySelector('[data-tab="actors"]')?.closest("li");
    out.underActors = !!myLi && !!actorsLi && items.indexOf(myLi) === items.indexOf(actorsLi) + 1;

    // Click → catalog window opens.
    btn?.click();
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !document.querySelector(".cp-catalog")) {
      await new Promise(r => setTimeout(r, 150));
    }
    out.catalogOpened = !!document.querySelector(".cp-catalog");

    // Close any opened catalog window + restore the setting.
    for (const w of Object.values(ui.windows)) {
      if (w?.options?.classes?.includes?.("cp-catalog")) await w.close();
    }
    await game.settings.set("cyberpunk2020", "shoppingEnabled", out.was);
    await ui.sidebar.render(true);
    return out;
  });

  console.log("Sidebar Shop button:", JSON.stringify(R));
  expect(R.buttonPresent, "Shop launcher injected into the sidebar").toBe(true);
  expect(R.isCart, "uses the cart icon").toBe(true);
  expect(R.notATab, "launcher, not a Foundry tab").toBe(true);
  expect(R.underActors, "sits directly under the Actors tab").toBe(true);
  expect(R.catalogOpened, "clicking opens the catalog window").toBe(true);
});
