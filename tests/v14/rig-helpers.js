/** Shared helpers for the v13/v14 rig specs (both rigs use a GM password via env). */

/** Join the rig as the first Gamemaster; wait for game.ready. Password from FVTT_RIG_PASSWORD. */
export async function joinAsGM(page) {
  await page.goto("/join", { waitUntil: "domcontentloaded" });
  const sel = page.locator('select[name="userid"]');
  await sel.waitFor({ state: "visible", timeout: 30_000 });
  const users = await sel.locator("option").evaluateAll((o) =>
    o.map((x) => ({ v: x.value, l: (x.textContent || "").trim() })).filter((x) => x.v));
  const gm = users.find((u) => /gamemaster|game master/i.test(u.l)) || users[0];
  if (!gm) throw new Error("no joinable users on this rig");
  await sel.selectOption(gm.v);
  await page.locator('input[name="password"]').fill(process.env.FVTT_RIG_PASSWORD ?? "");
  await Promise.all([
    page.waitForNavigation({ url: /\/game/, timeout: 45_000 }).catch(() => {}),
    page.locator('button[name="join"]').click(),
  ]);
  await page.waitForFunction(() => window.game?.ready === true, undefined, { timeout: 60_000 });
}
