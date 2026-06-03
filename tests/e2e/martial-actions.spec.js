import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Martial-arts attack rework: the action is chosen by a combat-tab button (grouped under the same
 * Defensive / Attacks / Grapple subheaders the dialog used) instead of a dropdown in the dialog.
 *
 * Covered here (logic, not pixels):
 *   - martialActionGroups() returns the grouped action keys, and respects FNFF2 (extra all-out
 *     defenses + Punch/Ram/JumpKick/Cast),
 *   - martialOptions(actor) no longer carries an Action dropdown (only style + cyberlimb),
 *   - a martial weapon's __weaponRoll injects the button's action into __martialBonk: the chat
 *     card's title reflects the chosen action, and omitting the action defaults to Strike.
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("martial action groups, dialog drops the Action dropdown, button routes the action", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const LK = await import("/systems/cyberpunk2020/module/lookups.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const out = {};

    // 1) Action groups (Core set; FNFF2 off) — the subheaders + their actions.
    const wasFnff2 = game.settings.get("cyberpunk2020", "fnff2Enabled");
    await game.settings.set("cyberpunk2020", "fnff2Enabled", false);
    const groups = LK.martialActionGroups();
    out.groupNames = groups.map(g => g.groupName);
    out.attacks    = groups.find(g => g.groupName === "Attacks")?.choices ?? [];
    out.defensive  = groups.find(g => g.groupName === "Defensive")?.choices ?? [];
    out.grapple    = groups.find(g => g.groupName === "Grapple")?.choices ?? [];

    // FNFF2 adds the all-out defenses and extra strikes.
    await game.settings.set("cyberpunk2020", "fnff2Enabled", true);
    const g2 = LK.martialActionGroups();
    out.fnff2Attacks   = g2.find(g => g.groupName === "Attacks")?.choices ?? [];
    out.fnff2Defensive = g2.find(g => g.groupName === "Defensive")?.choices ?? [];
    await game.settings.set("cyberpunk2020", "fnff2Enabled", wasFnff2);

    // 2) martialOptions(actor) no longer contains an Action dropdown.
    const actor = await Actor.create({ name: "__PW__Brawler", type: "character", flags, system: { stats: { ref: { base: 6 } } } });
    const opts = LK.martialOptions(actor);
    const paths = opts.flat().map(g => g.dataPath);
    out.optionPaths      = paths;
    out.hasActionDropdown = paths.includes("action");

    // 3) Routing: a martial weapon, action injected as the button would → shows in the chat title.
    // attackType must be the enum value meleeAttackTypes.martial === "Martial" (capital M).
    const [wpn] = await actor.createEmbeddedDocuments("Item", [
      { name: "__PW__Fists", type: "weapon", flags, system: { attackType: "Martial", weaponType: "Melee" } },
    ]);
    const item = actor.items.get(wpn.id);

    const has = (msgs, kw) => msgs.some(m => (m.content || "").includes(kw) || (m.flavor || "").includes(kw));

    const before = new Set(game.messages.contents.map(m => m.id));
    await item.__weaponRoll({ action: "Kick", martialArt: "Brawling" }, []);
    const kickMsgs = game.messages.contents.filter(m => !before.has(m.id));
    out.kickInChat = has(kickMsgs, "Kick");

    const before2 = new Set(game.messages.contents.map(m => m.id));
    await item.__weaponRoll({ martialArt: "Brawling" }, []);   // no action → defaults to Strike
    const strikeMsgs = game.messages.contents.filter(m => !before2.has(m.id));
    out.defaultStrike = has(strikeMsgs, "Strike");

    // 4) Sheet rendering: the martial weapon shows grouped action buttons (validates the @root
    //    wiring of the inline partial), and a normal weapon still renders as a .fire-weapon row.
    await actor.createEmbeddedDocuments("Item", [
      { name: "__PW__Pistol", type: "weapon", flags, system: { weaponType: "Pistol", attackType: "" } },
    ]);
    await actor.sheet.render(true);
    const dl = Date.now() + 6000;
    let rootEl = null;
    while (Date.now() < dl && !rootEl) {
      const e = actor.sheet.element;
      const node = e && (e[0] || e);
      if (node && node.querySelector) rootEl = node;
      if (!rootEl) await new Promise(r => setTimeout(r, 150));
    }
    out.sheetRendered    = !!rootEl;
    // The world may auto-add default martial (unarmed) weapons, so count this actor's own martial
    // weapons and assert the rendered buttons match exactly N_martial × actions_per_group_set.
    out.martialWeaponCount = actor.items.filter(i => i.type === "weapon" && i.system.attackType === "Martial").length;
    out.actionsPerWeapon = (await import("/systems/cyberpunk2020/module/lookups.js"))
      .martialActionGroups().reduce((n, g) => n + g.choices.length, 0);
    out.martialBtnCount  = rootEl ? rootEl.querySelectorAll(".martial-action").length : -1;
    out.kickBtnPresent   = rootEl ? !!rootEl.querySelector('.martial-action[data-action="Kick"]') : false;
    out.fireWeaponCount  = rootEl ? rootEl.querySelectorAll(".fire-weapon").length : -1;
    await actor.sheet.close().catch(() => {});

    // cleanup the chat cards we created (they aren't __PW__-tagged in content)
    for (const m of [...kickMsgs, ...strikeMsgs]) await m.delete().catch(() => {});
    await actor.delete().catch(() => {});
    return out;
  });

  console.log("Martial actions:", JSON.stringify(R));

  // Grouped under the same subheaders as the old dialog
  expect(R.groupNames).toEqual(["Defensive", "Attacks", "Grapple"]);
  expect(R.attacks, "Attacks group includes Strike + Kick").toEqual(expect.arrayContaining(["Strike", "Kick", "Disarm", "SweepTrip"]));
  expect(R.defensive).toEqual(expect.arrayContaining(["Dodge", "BlockParry"]));
  expect(R.grapple).toEqual(expect.arrayContaining(["Grapple", "Hold", "Choke", "Throw", "Escape"]));

  // FNFF2 extras
  expect(R.fnff2Attacks, "FNFF2 adds Punch/Ram/JumpKick/Cast").toEqual(expect.arrayContaining(["Punch", "Ram", "JumpKick", "Cast"]));
  expect(R.fnff2Defensive, "FNFF2 adds all-out defenses").toEqual(expect.arrayContaining(["AllOutParry", "AllOutDodge"]));

  // Dialog no longer asks for the action
  expect(R.hasActionDropdown, "martialOptions has NO action dropdown").toBe(false);
  expect(R.optionPaths, "dialog keeps style + cyberlimb").toEqual(expect.arrayContaining(["martialArt", "cyberTerminus"]));

  // The button's action routes through to the attack
  expect(R.kickInChat, "injected action 'Kick' appears in the attack card").toBe(true);
  expect(R.defaultStrike, "omitting the action defaults to Strike").toBe(true);

  // The combat tab actually renders the grouped buttons (and normal weapons still render)
  expect(R.sheetRendered, "character sheet renders").toBe(true);
  expect(R.kickBtnPresent, "a Kick button is present on the combat tab").toBe(true);
  expect(R.fireWeaponCount, "a normal weapon still renders as a fire-weapon row").toBeGreaterThanOrEqual(1);
  // Exactly one button-group per martial weapon — no bleed into non-martial weapons, no duplication.
  expect(R.martialBtnCount, "martial buttons == (martial weapons) × (actions per group set)")
    .toBe(R.martialWeaponCount * R.actionsPerWeapon);
  expect(R.martialWeaponCount, "actor has at least the one martial weapon we added").toBeGreaterThanOrEqual(1);
});
