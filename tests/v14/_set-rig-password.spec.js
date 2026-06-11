import { test } from "@playwright/test";

/**
 * Utility: set the Gamemaster password on a rig so random clients can't join.
 * Value comes from env (FVTT_RIG_PASSWORD) — NEVER hard-coded here. Join uses the
 * old password (FVTT_RIG_PASSWORD_OLD, default empty) so this is re-runnable.
 * Run per rig:  $env:FVTT_URL=...; $env:FVTT_RIG_PASSWORD=...; npx playwright test --config playwright.v14.config.js _set-rig-password
 */
test("set rig GM password", async ({ page }) => {
  // Utility, not a validation test — skip in normal suite runs. Opt in explicitly:
  //   $env:FVTT_SET_RIG_PW=1; $env:FVTT_RIG_PASSWORD_OLD=<current>; $env:FVTT_RIG_PASSWORD=<new>
  test.skip(!process.env.FVTT_SET_RIG_PW, "utility — set FVTT_SET_RIG_PW=1 (+ old/new pw env) to run");
  const oldPw = process.env.FVTT_RIG_PASSWORD_OLD ?? "";
  const newPw = process.env.FVTT_RIG_PASSWORD;
  if (!newPw) throw new Error("FVTT_RIG_PASSWORD env not set");

  await page.goto("/join", { waitUntil: "domcontentloaded" });
  const sel = page.locator('select[name="userid"]');
  await sel.waitFor({ state: "visible", timeout: 30_000 });
  const users = await sel.locator("option").evaluateAll((o) =>
    o.map((x) => ({ v: x.value, l: (x.textContent || "").trim() })).filter((x) => x.v));
  const gm = users.find((u) => /gamemaster/i.test(u.l)) || users[0];
  if (!gm) throw new Error("no users to join");

  await sel.selectOption(gm.v);
  await page.locator('input[name="password"]').fill(oldPw);
  await Promise.all([
    page.waitForNavigation({ url: /\/game/, timeout: 45_000 }).catch(() => {}),
    page.locator('button[name="join"]').click(),
  ]);
  await page.waitForFunction(() => window.game?.ready === true, undefined, { timeout: 60_000 });

  const res = await page.evaluate(async (pw) => {
    try { await game.user.update({ password: pw }); return { ok: true, user: game.user.name }; }
    catch (e) { return { ok: false, err: e?.message ?? String(e) }; }
  }, newPw);
  console.log("SET PW RESULT:", JSON.stringify(res));
  if (!res.ok) throw new Error("password set failed: " + res.err);
});
