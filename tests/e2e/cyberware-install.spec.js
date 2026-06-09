import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Cyberware buy-and-install (Shopping #14). Surgery code → cost/damage; installCyberware on owned
 * chrome (charge surgery, roll humanity, apply surgical damage, equip); buyAndInstallCyberware
 * (part + surgery in one step); humanity loss flows into the derived EMP; insufficient funds blocks.
 *
 * Confirm dialogs are bypassed with { confirm:false } so the flow runs headless.
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("surgery table, installCyberware, buyAndInstallCyberware, EMP loss, funds gate", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const out = {};
    const flags = { cyberpunk2020: { __pwtest: true } };
    const mod = await import("/systems/cyberpunk2020/module/cyberware/install.js");

    // ── Surgery table ───────────────────────────────────────────────
    out.surgN  = mod.getSurgery("N").cost;     // 0
    out.surgM  = mod.getSurgery("M").cost;     // 500
    out.surgMA = mod.getSurgery("MA").cost;    // 1500
    out.surgCR = mod.getSurgery("CR").cost;    // 2500
    out.surgCRx2 = mod.getSurgery("CRx2").cost; // 5000
    out.surgEmpty = mod.getSurgery("").cost;   // 0 (→ Negligible)

    // ── installCyberware on owned chrome ────────────────────────────
    const a1 = await Actor.create({ name: "__PW__cybActor", type: "character", flags, system: { eurobucks: 1000 } });
    const [cw] = await a1.createEmbeddedDocuments("Item", [{
      name: "__PW__cyberM", type: "cyberware",
      system: { cost: 0, surgCode: "M", humanityCost: "3", equipped: false, humanityLoss: 0 } }]);
    out.installOk = await mod.installCyberware(a1, cw, { confirm: false });
    out.a1Funds = a1.system.eurobucks;                       // 1000 - 500 (M) = 500
    const cw1 = a1.items.get(cw.id);
    out.cwEquipped = cw1.system.equipped;                    // true
    out.cwLoss = cw1.system.humanityLoss;                    // 3 (numeric HC)
    out.a1Damage = a1.system.damage;                         // 1d6+1 → 2..7
    out.a1EmpLoss = a1.system.stats?.emp?.humanity?.loss;    // derived = 3

    // ── buyAndInstallCyberware (part + surgery) ─────────────────────
    const a2 = await Actor.create({ name: "__PW__cybBuyer", type: "character", flags, system: { eurobucks: 5000 } });
    out.buyOk = await mod.buyAndInstallCyberware(a2, {
      name: "__PW__cyberMA", type: "cyberware", system: { cost: 500, surgCode: "MA", humanityCost: "0" }
    }, { partPrice: 500, confirm: false });
    out.a2Funds = a2.system.eurobucks;                       // 5000 - (500 + 1500) = 3000
    const bought = a2.items.find(i => i.name === "__PW__cyberMA");
    out.boughtExists = !!bought;
    out.boughtEquipped = bought?.system?.equipped;           // true
    out.a2Damage = a2.system.damage;                         // 2d6+1 → 3..13

    // ── insufficient funds blocks ───────────────────────────────────
    const a3 = await Actor.create({ name: "__PW__cybPoor", type: "character", flags, system: { eurobucks: 100 } });
    out.poorOk = await mod.buyAndInstallCyberware(a3, {
      name: "__PW__cyberCR", type: "cyberware", system: { cost: 100, surgCode: "CR", humanityCost: "0" }
    }, { partPrice: 100, confirm: false });                  // total 2600 > 100
    out.a3Funds = a3.system.eurobucks;                       // unchanged 100
    out.a3HasItem = !!a3.items.find(i => i.name === "__PW__cyberCR");

    return out;
  });

  console.log("Cyberware install:", JSON.stringify(R, null, 2));

  expect(R.surgN).toBe(0);
  expect(R.surgM).toBe(500);
  expect(R.surgMA).toBe(1500);
  expect(R.surgCR).toBe(2500);
  expect(R.surgCRx2).toBe(5000);
  expect(R.surgEmpty, "blank surgCode → Negligible (free)").toBe(0);

  expect(R.installOk).toBe(true);
  expect(R.a1Funds, "1000 - 500 surgery").toBe(500);
  expect(R.cwEquipped, "installed = equipped").toBe(true);
  expect(R.cwLoss, "humanity loss set on item").toBe(3);
  expect(R.a1Damage, "surgical damage 1d6+1").toBeGreaterThanOrEqual(2);
  expect(R.a1Damage).toBeLessThanOrEqual(7);
  expect(R.a1EmpLoss, "EMP humanity loss derives from the item").toBe(3);

  expect(R.buyOk).toBe(true);
  expect(R.a2Funds, "5000 - (500 part + 1500 surgery)").toBe(3000);
  expect(R.boughtExists).toBe(true);
  expect(R.boughtEquipped).toBe(true);
  expect(R.a2Damage, "surgical damage 2d6+1").toBeGreaterThanOrEqual(3);
  expect(R.a2Damage).toBeLessThanOrEqual(13);

  expect(R.poorOk, "insufficient funds blocks").toBe(false);
  expect(R.a3Funds, "no charge on block").toBe(100);
  expect(R.a3HasItem, "no item on block").toBe(false);
});

test("cyberware buy-only: part cost only, uninstalled, no humanity / surgical damage", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const out = {};
    const flags = { cyberpunk2020: { __pwtest: true } };
    const mod = await import("/systems/cyberpunk2020/module/cyberware/install.js");

    // Buy-only via { install:false }: charge PART only, leave uninstalled, roll nothing.
    const a = await Actor.create({ name: "__PW__cybBuyOnly", type: "character", flags, system: { eurobucks: 1000 } });
    out.ok = await mod.buyAndInstallCyberware(a, {
      name: "__PW__cwBuyOnly", type: "cyberware", system: { cost: 300, surgCode: "MA", humanityCost: "2d6" }
    }, { partPrice: 300, confirm: false, install: false });
    out.funds = a.system.eurobucks;                       // 1000 - 300 (no 1500 surgery) = 700
    const it = a.items.find(i => i.name === "__PW__cwBuyOnly");
    out.exists = !!it;
    out.equipped = it?.system?.equipped;                  // false
    out.loss = Number(it?.system?.humanityLoss) || 0;     // 0 (no humanity rolled)
    out.damage = Number(a.system.damage) || 0;            // 0 (no surgical damage)
    out.empLoss = a.system.stats?.emp?.humanity?.loss;    // 0 (uninstalled → not derived)

    // Buy-only stays reachable even when the install SURGERY is unaffordable (only part is checked).
    const a2 = await Actor.create({ name: "__PW__cybPartOnly", type: "character", flags, system: { eurobucks: 400 } });
    out.ok2 = await mod.buyAndInstallCyberware(a2, {
      name: "__PW__cwPart2", type: "cyberware", system: { cost: 300, surgCode: "CR", humanityCost: "0" }
    }, { partPrice: 300, confirm: false, install: false }); // part 300 ≤ 400; CR surgery 2500 NOT charged
    out.funds2 = a2.system.eurobucks;                     // 400 - 300 = 100

    return out;
  });

  console.log("Cyberware buy-only:", JSON.stringify(R, null, 2));
  expect(R.ok).toBe(true);
  expect(R.funds, "charged part only, no surgery").toBe(700);
  expect(R.exists).toBe(true);
  expect(R.equipped, "buy-only leaves it uninstalled").toBe(false);
  expect(R.loss, "no humanity rolled on buy-only").toBe(0);
  expect(R.damage, "no surgical damage on buy-only").toBe(0);
  expect(R.empLoss, "uninstalled chrome → no derived EMP loss").toBe(0);
  expect(R.ok2, "buy-only succeeds when only surgery (not part) is unaffordable").toBe(true);
  expect(R.funds2, "part charged, surgery not").toBe(100);
});
