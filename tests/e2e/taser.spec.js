import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * QA §7 — Taser cumulative Stun-Save penalty.
 *
 * Each successive taser hit (within the window) lowers the Stun Save threshold by
 * |mod| per extra hit: first hit none, second −2, third −4. Gated by the
 * `taserCumPenaltyEnabled` setting. Verified via the exported updateTaserState +
 * getStunThreshold (round 0 / no combat = always within window).
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

test("§7 taser cumulative penalty: 1st none, 2nd −2, 3rd −4, disabled = none", async () => {
  const R = await evalGameOrThrow(gmPage, async () => {
    const SR = await import("/systems/cyberpunk2020/module/combat/save-rolls.js");
    const flags = { cyberpunk2020: { __pwtest: true } };

    const orig = game.settings.get("cyberpunk2020", "taserCumPenaltyEnabled");
    await game.settings.set("cyberpunk2020", "taserCumPenaltyEnabled", true);

    const a = await Actor.create({ name: "__PW__Tased", type: "character", flags, system: { stats: { bt: { base: 9 } } } });
    const tase = () => SR.updateTaserState(a, { stunSaveMod: -2 });

    const base = SR.getStunThreshold(a);   // no taser yet
    await tase();  const t1 = SR.getStunThreshold(a); // count 1 -> no penalty
    await tase();  const t2 = SR.getStunThreshold(a); // count 2 -> -2
    await tase();  const t3 = SR.getStunThreshold(a); // count 3 -> -4

    await game.settings.set("cyberpunk2020", "taserCumPenaltyEnabled", false);
    const tDisabled = SR.getStunThreshold(a);          // setting off -> no penalty

    await game.settings.set("cyberpunk2020", "taserCumPenaltyEnabled", orig);
    await a.delete().catch(() => {});
    return { base, t1, t2, t3, tDisabled };
  });

  console.log("Taser:", JSON.stringify(R));

  expect(R.base, "BT 9, uninjured -> stun threshold 10").toBe(10);
  expect(R.t1, "first taser hit: no penalty").toBe(10);
  expect(R.t2, "second hit within window: −2").toBe(8);
  expect(R.t3, "third hit: −4").toBe(6);
  expect(R.tDisabled, "setting OFF: no penalty regardless of count").toBe(10);
});
