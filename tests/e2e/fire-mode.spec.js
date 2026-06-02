import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * QA §21 — Fire-mode capability.
 *   Auto weapons offer FullAuto/Suppressive/Burst/Semi. Semi-only offers Semi.
 *   Per-weapon `fullAutoCapable` / `burstCapable` flags GRANT capability to a semi weapon.
 *   Verified by calling the weapon item's _isFullAutoCapable / _isBurstCapable / __getFireModes.
 */

test.describe.configure({ mode: "serial" });

let gmCtx, gmPage;

test.beforeAll(async ({ browser }) => {
  gmCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  gmPage = await gmCtx.newPage();
  await login(gmPage, ACCOUNTS.gm);
  await cleanupTestData(gmPage).catch(() => {});
});

test.afterAll(async () => {
  if (gmPage) await cleanupTestData(gmPage).catch(() => {});
  if (gmCtx) await gmCtx.close();
});

test("§21 fire modes derive from attackType + per-weapon capability flags", async () => {
  const R = await evalGameOrThrow(gmPage, async () => {
    const flags = { cyberpunk2020: { __pwtest: true } };
    const mk = (name, sys) => Item.create({ name, type: "weapon", flags, system: sys });
    const probe = (w) => ({
      modes: w.__getFireModes(),
      fullAuto: w._isFullAutoCapable(),
      burst: w._isBurstCapable(),
    });

    const autoW   = await mk("__PW__AutoSMG",  { attackType: "Auto" });
    const semiW   = await mk("__PW__Pistol",   { attackType: "SemiAuto" });
    const semiFA  = await mk("__PW__M16A4",    { attackType: "SemiAuto", fullAutoCapable: true });
    const semiBst = await mk("__PW__BurstGun", { attackType: "SemiAuto", burstCapable: true });

    const out = {
      auto: probe(autoW),
      semi: probe(semiW),
      semiFullAutoFlag: probe(semiFA),
      semiBurstFlag: probe(semiBst),
    };
    for (const w of [autoW, semiW, semiFA, semiBst]) await w.delete().catch(() => {});
    return out;
  });

  console.log("Fire modes:", JSON.stringify(R));

  // Auto weapon: all four modes.
  expect(R.auto.fullAuto).toBe(true);
  expect(R.auto.burst).toBe(true);
  expect(R.auto.modes).toEqual(expect.arrayContaining(["FullAuto", "Suppressive", "ThreeRoundBurst", "SemiAuto"]));

  // Plain semi: only semi.
  expect(R.semi.fullAuto).toBe(false);
  expect(R.semi.burst).toBe(false);
  expect(R.semi.modes).toEqual(["SemiAuto"]);

  // Semi + fullAutoCapable flag: gains full-auto (and burst, since auto implies burst).
  expect(R.semiFullAutoFlag.fullAuto).toBe(true);
  expect(R.semiFullAutoFlag.modes).toEqual(expect.arrayContaining(["FullAuto", "Suppressive", "ThreeRoundBurst", "SemiAuto"]));

  // Semi + burstCapable flag: gains burst only, NOT full-auto.
  expect(R.semiBurstFlag.fullAuto, "burst flag does not grant full-auto").toBe(false);
  expect(R.semiBurstFlag.burst).toBe(true);
  expect(R.semiBurstFlag.modes).toEqual(expect.arrayContaining(["ThreeRoundBurst", "SemiAuto"]));
  expect(R.semiBurstFlag.modes, "burst-only weapon must NOT offer full-auto").not.toContain("FullAuto");
});
