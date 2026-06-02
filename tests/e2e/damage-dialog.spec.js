import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * QA §1 — Apply Damage dialog (UI-driven).
 *
 * First click-based test: opens the real DamageDialog, reads the live total,
 * types a Cover SP value (which re-renders with a lower total via the
 * proportional-armor table), clicks Apply, and confirms the HP written.
 *
 * Target: soft armor Torso SP 8, BTM 2.
 *   no cover : 20 − 8 = 12, − BTM 2 = 10
 *   cover 8  : combineSP(8,8)=13 → 20 − 13 = 7, − BTM 2 = 5
 */

test.describe.configure({ mode: "serial" });

test.afterAll(async ({ browser }) => {
  // best-effort cleanup via a throwaway context
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("§1 damage dialog: Cover SP lowers the total, Apply writes the HP", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const targetId = await evalGameOrThrow(page, async () => {
    const { DamageDialog } = await import("/systems/cyberpunk2020/module/combat/DamageDialog.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    await game.settings.set("cyberpunk2020", "headHitDoubling", false);
    await game.settings.set("cyberpunk2020", "damageArmorMode", "full");

    const target = await Actor.create({ name: "__PW__DlgTarget", type: "character", flags, system: { stats: { bt: { base: 5 } }, damage: 0 } });
    await target.createEmbeddedDocuments("Item", [{
      name: "__PW__DlgVest", type: "armor",
      system: { equipped: true, armorType: "soft", coverage: { Torso: { stoppingPower: 8 } } },
    }]);

    // Close any stale dialogs, then open a fresh one.
    Object.values(ui.windows).filter(w => w.constructor?.name === "DamageDialog").forEach(w => w.close());
    const payload = { weaponName: "__PW__DialogTest", areaDamages: { Torso: [{ damage: 20 }] }, ap: false };
    new DamageDialog(payload, target).render(true);
    return target.id;
  });

  const dialog = page.locator("form.damage-dialog");
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  // Initial total (no cover).
  await expect(dialog.locator(".damage-total-value")).toHaveText("10");

  // Enter Cover SP 8 -> proportional combine -> lower total.
  const coverInput = dialog.locator('input[name="coverSP"]');
  await coverInput.fill("8");
  await coverInput.dispatchEvent("change");
  // Dialog re-renders; total should drop to 5.
  await expect(page.locator("form.damage-dialog .damage-total-value")).toHaveText("5", { timeout: 10_000 });

  // Apply and confirm the HP written to the target.
  await page.locator('form.damage-dialog button[name="apply"]').click();

  // Dialog closes asynchronously after Apply — wait for it to leave the DOM.
  await expect(page.locator("form.damage-dialog")).toHaveCount(0, { timeout: 10_000 });

  const damage = await evalGameOrThrow(page, (id) => game.actors.get(id)?.system.damage, targetId);
  console.log("Damage dialog result: applied =", damage);
  expect(damage, "Apply wrote the post-cover total (5) to the target").toBe(5);
});
