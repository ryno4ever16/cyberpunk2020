import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Tear-off tabs: each character-sheet tab has a ⇗ button that opens it as its own window
 * (CyberpunkActorTabSheet). The popped-out tab is the SAME sheet machinery, so it is:
 *   - editable (form submit persists to the actor),
 *   - live (re-renders when the actor changes elsewhere),
 *   - singleton per (actor, tab), and several tabs coexist as separate windows.
 * Self-cleans (tagged actor).
 */

test.describe.configure({ mode: "serial" });

let gmCtx, gmPage, actorId;
const pageErrors = [];

test.beforeAll(async ({ browser }) => {
  gmCtx = await browser.newContext({ viewport: { width: 1680, height: 1000 }, ignoreHTTPSErrors: true });
  gmPage = await gmCtx.newPage();
  gmPage.on("pageerror", (e) => pageErrors.push(String(e)));
  await login(gmPage, ACCOUNTS.gm);
  await cleanupTestData(gmPage).catch(() => {});
  await evalGameOrThrow(gmPage, () => game.settings.set("cyberpunk2020", "shoppingEnabled", true));

  actorId = await evalGameOrThrow(gmPage, async () => {
    const actor = await Actor.create({
      name: "__PW__TabPop", type: "character",
      flags: { cyberpunk2020: { __pwtest: true } },
    });
    await actor.update({ "system.reputation": 3, "system.stats.cool.value": 5 });
    await actor.sheet.render(true);
    await new Promise((r) => setTimeout(r, 500));
    return actor.id;
  });
});

test.afterAll(async () => {
  if (gmPage) await cleanupTestData(gmPage).catch(() => {});
  if (gmCtx) await gmCtx.close();
});

test("the open() API positions the window and dedupes (drag drop point)", async () => {
  const res = await evalGameOrThrow(gmPage, async (arg) => {
    const mod = await import("/systems/cyberpunk2020/module/actor/actor-tab-popout.js");
    const actor = game.actors.get(arg);
    for (const app of Object.values(actor.apps)) if (app.constructor.name === "CyberpunkActorTabSheet") await app.close();
    const a = mod.CyberpunkActorTabSheet.open(actor, "combat", { left: 720, top: 300 });
    await new Promise((r) => setTimeout(r, 350));
    const opened = { left: a.position.left, top: a.position.top };
    // Re-open same tab at a new point → same window, repositioned (singleton).
    const b = mod.CyberpunkActorTabSheet.open(actor, "combat", { left: 200, top: 150 });
    await new Promise((r) => setTimeout(r, 200));
    const same = a === b;
    const moved = { left: b.position.left, top: b.position.top };
    const count = Object.values(actor.apps).filter((x) => x.constructor.name === "CyberpunkActorTabSheet" && x.tabKey === "combat").length;
    await a.close();
    return { opened, same, moved, count };
  }, actorId);
  expect(res.opened.left, "window opened at the requested drop x").toBe(720);
  expect(res.same, "re-open returns the same singleton window").toBe(true);
  expect(res.moved.left, "re-open repositioned the existing window").toBe(200);
  expect(res.count, "still a single Combat window").toBe(1);
});

test("opening Combat pops out a single-tab window: live, editable, no nav", async () => {
  const pop = await evalGameOrThrow(gmPage, async (arg) => {
    const mod = await import("/systems/cyberpunk2020/module/actor/actor-tab-popout.js");
    const actor = game.actors.get(arg);
    const app = mod.CyberpunkActorTabSheet.open(actor, "combat");
    await new Promise((r) => setTimeout(r, 500));
    return { popId: app.id, tabKey: app.tabKey, inApps: Object.values(actor.apps).includes(app) };
  }, actorId);

  expect(pop.tabKey).toBe("combat");
  expect(pop.inApps, "registered in actor.apps → live updates").toBe(true);

  const win = gmPage.locator(`#${pop.popId}`);
  await expect(win, "popout window rendered").toBeVisible({ timeout: 8000 });
  // It is the combat tab, with the interactive controls present...
  await expect(win.locator(".combat-tab")).toBeVisible();
  await expect(win.locator(".facedown-roll")).toBeVisible();
  await expect(win.locator('input[name="system.reputation"]')).toHaveValue("3");
  // ...and it carries NO in-window tab switcher.
  await expect(win.locator("nav.sheet-tabs")).toHaveCount(0);

  // Editable: change Reputation in the popout → persists to the actor.
  const rep = win.locator('input[name="system.reputation"]');
  await rep.fill("9");
  await rep.blur();
  await gmPage.waitForTimeout(400);
  const persisted = await evalGameOrThrow(gmPage, (a) => game.actors.get(a).system.reputation, actorId);
  expect(persisted, "edit in popout saved to actor").toBe(9);

  // Live: update the actor elsewhere → the popout reflects it.
  await evalGameOrThrow(gmPage, async (a) => {
    await game.actors.get(a).update({ "system.reputation": 4 });
    await new Promise((r) => setTimeout(r, 400));
  }, actorId);
  await expect(rep, "popout re-rendered on actor update").toHaveValue("4");
});

test("a second tab opens as its own window; re-opening is a singleton", async () => {
  const ids = await evalGameOrThrow(gmPage, async (arg) => {
    const mod = await import("/systems/cyberpunk2020/module/actor/actor-tab-popout.js");
    const actor = game.actors.get(arg);
    const cyber = mod.CyberpunkActorTabSheet.open(actor, "cyber");
    await new Promise((r) => setTimeout(r, 400));
    // Re-trigger Combat: must reuse the existing window, not spawn a duplicate.
    const combatAgain = mod.CyberpunkActorTabSheet.open(actor, "combat");
    await new Promise((r) => setTimeout(r, 200));
    const tabSheets = Object.values(actor.apps).filter((a) => a.constructor.name === "CyberpunkActorTabSheet");
    return {
      cyberId: cyber.id,
      combatId: combatAgain.id,
      tabWindowCount: tabSheets.length,
      combatCount: tabSheets.filter((a) => a.tabKey === "combat").length,
    };
  }, actorId);

  await expect(gmPage.locator(`#${ids.cyberId}`), "cyber tab window").toBeVisible();
  await expect(gmPage.locator(`#${ids.combatId}`)).toBeVisible();
  expect(ids.tabWindowCount, "two distinct tab windows (combat + cyber)").toBe(2);
  expect(ids.combatCount, "Combat is a singleton — no duplicate").toBe(1);
  // Only one DOM node for the combat popout id.
  expect(await gmPage.locator(`#${ids.combatId}`).count()).toBe(1);
});

test("every tab renders cleanly when popped out (incl. the Life/ProseMirror tab)", async () => {
  pageErrors.length = 0; // watch for uncaught exceptions during the opens below
  const tabs = ["skills", "combat", "gear", "services", "cyber", "life", "netrun"];
  const ids = await evalGameOrThrow(gmPage, async (arg) => {
    const mod = await import("/systems/cyberpunk2020/module/actor/actor-tab-popout.js");
    const actor = game.actors.get(arg.id);
    const out = {};
    for (const t of arg.tabs) {
      const app = mod.CyberpunkActorTabSheet.open(actor, t);
      await new Promise((r) => setTimeout(r, 250));
      out[t] = app.id;
    }
    return out;
  }, { id: actorId, tabs });

  for (const t of tabs) {
    const body = gmPage.locator(`#${ids[t]} .cp-tab-popout-body .tab[data-tab="${t}"].active`);
    await expect(body, `${t} tab body rendered + active`).toBeVisible({ timeout: 6000 });
  }
  expect(pageErrors, `no uncaught exceptions while popping tabs:\n${pageErrors.join("\n")}`).toEqual([]);
});

test("press-and-hold then drag a tab pops it out at the drop point (a quick click does not)", async () => {
  // Close any open tab windows and re-show the main sheet on a clean slate.
  const mainId = await evalGameOrThrow(gmPage, async (a) => {
    const actor = game.actors.get(a);
    for (const app of Object.values(actor.apps)) {
      if (app.constructor.name === "CyberpunkActorTabSheet") await app.close();
    }
    await actor.sheet.render(true);
    await new Promise((r) => setTimeout(r, 400));
    return actor.sheet.element[0].id;
  }, actorId);

  const tab = gmPage.locator(`#${mainId} nav.sheet-tabs .item[data-tab="gear"]`);
  const box = await tab.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const gearId = await evalGameOrThrow(gmPage, (a) => `cp-tab-${a}-gear`, actorId);

  // 1) A quick click (down→up well under the hold threshold) must only switch tabs — NOT pop out.
  await gmPage.mouse.move(cx, cy);
  await gmPage.mouse.down();
  await gmPage.mouse.up();
  await gmPage.waitForTimeout(350);
  expect(await gmPage.locator(`#${gearId}`).count(), "quick click must not tear off a window").toBe(0);

  // 2) Press-and-hold past the threshold, then drag and release → tears the tab off at the drop point.
  await gmPage.mouse.move(cx, cy);
  await gmPage.mouse.down();
  await gmPage.waitForTimeout(650);                    // exceed HOLD_MS (450) → "pick up"
  await gmPage.mouse.move(980, 620, { steps: 10 });    // drag the ghost across the screen
  await gmPage.mouse.up();

  await expect(
    gmPage.locator(`#${gearId} .tab[data-tab="gear"]`),
    "hold + drag tore off the Gear tab into its own window"
  ).toBeVisible({ timeout: 6000 });

  const pos = await evalGameOrThrow(gmPage, (a) => {
    const app = Object.values(game.actors.get(a).apps)
      .find((x) => x.constructor.name === "CyberpunkActorTabSheet" && x.tabKey === "gear");
    return { left: app?.position?.left, top: app?.position?.top };
  }, actorId);
  expect(pos.left, "the torn-off window opened near where it was dropped").toBeGreaterThan(700);
});

test("a popped-out tab is greyed/detached on the main sheet and un-greyed on close", async () => {
  const mainId = await evalGameOrThrow(gmPage, async (a) => {
    const actor = game.actors.get(a);
    for (const app of Object.values(actor.apps)) {
      if (app.constructor.name === "CyberpunkActorTabSheet") await app.close();
    }
    await actor.sheet.render(true);
    await new Promise((r) => setTimeout(r, 400));
    return actor.sheet.element[0].id;
  }, actorId);

  const combatTab = gmPage.locator(`#${mainId} nav.sheet-tabs .item[data-tab="combat"]`);
  await expect(combatTab, "not detached initially").not.toHaveClass(/cp-tab-detached/);
  expect(await combatTab.evaluate((el) => getComputedStyle(el).cursor), "normal pointer on hover (grab only appears on press)").toBe("pointer");

  // Open the Combat popout → its tab on the main sheet becomes detached/greyed.
  await evalGameOrThrow(gmPage, async (a) => {
    const mod = await import("/systems/cyberpunk2020/module/actor/actor-tab-popout.js");
    mod.CyberpunkActorTabSheet.open(game.actors.get(a), "combat");
    await new Promise((r) => setTimeout(r, 400));
  }, actorId);
  await expect(combatTab, "tab greyed while its content is popped out").toHaveClass(/cp-tab-detached/);
  expect(await combatTab.evaluate((el) => getComputedStyle(el).cursor), "detached tab is click-to-focus").toBe("pointer");

  // Close the popout → the tab un-greys.
  await evalGameOrThrow(gmPage, async (a) => {
    const app = Object.values(game.actors.get(a).apps)
      .find((x) => x.constructor.name === "CyberpunkActorTabSheet" && x.tabKey === "combat");
    await app.close();
    await new Promise((r) => setTimeout(r, 300));
  }, actorId);
  await expect(combatTab, "un-greyed once the window closes").not.toHaveClass(/cp-tab-detached/);
});
