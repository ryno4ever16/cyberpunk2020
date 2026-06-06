import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * ACPA design system — step 1: a dedicated ACPA sheet. An isACPA vehicle renders acpa-sheet.hbs
 * (its own powered-armor layout) while a plain vehicle keeps vehicle-sheet.hbs — same actor type,
 * data model and combat code, only the template differs (get template() override).
 */
test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("dedicated ACPA sheet renders for isACPA; vehicle sheet for plain vehicles", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const flags = { cyberpunk2020: { __pwtest: true } };
    const origMM = game.settings.get("cyberpunk2020", "mmEnabled");
    const out = {};
    let acpa, plain, a1, a2;
    try {
      await game.settings.set("cyberpunk2020", "mmEnabled", true);

      acpa = await Actor.create({ name: "__PW__ACPADS", type: "vehicle", flags, system: { isACPA: true, str: 40 } });
      // Mount a weapon so the Weapons list renders a row — used to verify the CSS layout fix below.
      try { await acpa.createEmbeddedDocuments("Item", [{ name: "__PW__ACPAGun", type: "vehicleWeapon", system: { penetration: 5, rof: 2, arc: "turret", weaponClass: "directFire" } }]); } catch {}
      a1 = acpa.sheet;
      out.tmplACPA = a1.template.includes("acpa-sheet.hbs");
      await a1.render(true); await new Promise(r => setTimeout(r, 300));
      let root = a1.element[0] ?? a1.element;
      out.acpaForm = !!root.querySelector("form.acpa-sheet");
      out.acpaChassis = !!root.querySelector('[name="system.str"]');
      out.acpaMelee = !!root.querySelector(".cp-acpa-melee");
      out.acpaStatus = !!root.querySelector('[name="system.powerHours"]');
      out.acpaWeaponsAdd = !!root.querySelector(".cp-weapon-add");
      // CSS layout fix: the weapon row carries .field-list (a 2-col grid) but must render as a single
      // flex row, and its action buttons must be uniform width (not resize per glyph). Verify computed style.
      const wrow = root.querySelector(".cp-weapon-row");
      if (wrow) {
        out.weaponRowDisplay = getComputedStyle(wrow).display;        // expect "flex", not "grid"
        const widths = [...root.querySelectorAll(".cp-weapon-row > button")].map(b => Math.round(b.getBoundingClientRect().width));
        out.actionBtnWidths = widths;
        out.actionBtnsEqual = widths.length >= 2 && widths.every(w => w === widths[0] && w > 0);
      }
      await a1.close();

      plain = await Actor.create({ name: "__PW__PLAINDS", type: "vehicle", flags, system: { isACPA: false } });
      a2 = plain.sheet;
      out.tmplPlain = a2.template.includes("vehicle-sheet.hbs");
      await a2.render(true); await new Promise(r => setTimeout(r, 300));
      root = a2.element[0] ?? a2.element;
      out.plainForm = !!root.querySelector("form.acpa-sheet");   // should be false
      await a2.close();
    } finally {
      await game.settings.set("cyberpunk2020", "mmEnabled", origMM);
      if (a1?.rendered) await a1.close().catch(() => {});
      if (a2?.rendered) await a2.close().catch(() => {});
      if (acpa) await acpa.delete().catch(() => {});
      if (plain) await plain.delete().catch(() => {});
    }
    return out;
  });

  console.log("ACPA sheet:", JSON.stringify(R));
  expect(R.tmplACPA).toBe(true);
  expect(R.acpaForm).toBe(true);
  expect(R.acpaChassis).toBe(true);
  expect(R.acpaMelee).toBe(true);
  expect(R.acpaStatus).toBe(true);
  expect(R.acpaWeaponsAdd).toBe(true);
  expect(R.tmplPlain).toBe(true);
  expect(R.plainForm).toBe(false);   // plain vehicle did NOT get the ACPA template
  // CSS layout fix (only assert when a weapon row actually rendered).
  if (R.weaponRowDisplay !== undefined) {
    expect(R.weaponRowDisplay, "weapon row must be a flex row, not the inherited .field-list grid").toBe("flex");
    expect(R.actionBtnsEqual, `row action buttons must be uniform width (got ${JSON.stringify(R.actionBtnWidths)})`).toBe(true);
  }
});
