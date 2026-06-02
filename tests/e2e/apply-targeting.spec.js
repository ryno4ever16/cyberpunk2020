import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, setupSceneWithToken, waitForCanvasScene, cleanupTestData } from "../helpers/foundry.js";

/**
 * QA §1 — the chat-card "Apply Damage" button + target resolution (UI-driven).
 *
 * The button is injected by renderChatMessage on any message carrying a
 * cyberpunk2020.damagePayload flag (GM, or the attacker's owner). Clicking it
 * resolves a target in priority order:
 *   1. a currently-targeted token  (game.user.targets)
 *   2. the payload's targetTokenId / targetActorId
 *   3. the _pickTargetDialog token picker ("Use Canvas Target" / "Use List")
 * then applies (auto-apply mode here, so no DamageDialog — that's covered by
 * damage-dialog.spec.js).
 *
 * Targets are unarmored with BT 2 (BTM 0) so a 7-damage Torso hit lands as a
 * clean net 7 with no armor/BTM arithmetic to reason about.
 */

test.describe.configure({ mode: "serial" });

let gmCtx, gmPage;

test.beforeAll(async ({ browser }) => {
  gmCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  gmPage = await gmCtx.newPage();
  await login(gmPage, ACCOUNTS.gm, { canvas: true });
  await cleanupTestData(gmPage).catch(() => {});
  // Keep the chat log on-screen so the injected button is visible/clickable.
  await evalGameOrThrow(gmPage, async () => {
    await game.settings.set("cyberpunk2020", "damageAutoApply", true);
    try { ui.sidebar?.expand?.(); } catch {}
    try { ui.sidebar?.activateTab?.("chat"); } catch {}
  });
});

test.afterAll(async () => {
  if (gmPage) {
    await evalGameOrThrow(gmPage, async () => { await game.settings.set("cyberpunk2020", "damageAutoApply", false); }).catch(() => {});
    await cleanupTestData(gmPage).catch(() => {});
  }
  if (gmCtx) await gmCtx.close();
});

/** Build a damage chat card flagged with a payload, render it, return its id. */
async function postDamageCard(page, { attackerId, target = {} }) {
  return evalGameOrThrow(page, async (arg) => {
    const payload = {
      attackerId: arg.attackerId,
      areaDamages: { Torso: [{ damage: 7 }] },
      weaponName: "__PW__ApplyTest",
      ...arg.target, // optionally targetTokenId / targetActorId
    };
    const msg = await ChatMessage.create({
      content: `<div class="cyberpunk-card">__PW__ damage card</div>`,
      flags: { cyberpunk2020: { __pwtest: true, damagePayload: payload } },
    });
    await ui.chat?.render(true);
    return msg.id;
  }, { attackerId, target });
}

test("§1 chat-card Apply button resolves a currently-targeted token (one button, no dupes)", async () => {
  const attacker = await setupSceneWithToken(gmPage, { activate: true, actorName: "__PW__Shooter" });
  await waitForCanvasScene(gmPage, attacker.sceneId);
  const tgt = await evalGameOrThrow(gmPage, async (arg) => {
    const flags = { cyberpunk2020: { __pwtest: true } };
    const scene = game.scenes.get(arg.sceneId);
    const a = await Actor.create({ name: "__PW__CanvasTarget", type: "character", flags, system: { stats: { bt: { base: 2 } }, damage: 0 } });
    const [t] = await scene.createEmbeddedDocuments("Token", [
      { name: a.name, x: 1300, y: 1000, actorId: a.id, actorLink: true, width: 1, height: 1, flags },
    ]);
    // Target the token so the Apply button's first resolution branch picks it.
    // (v13 has no User#updateTokenTargets — target via the placeable.)
    let tok = null; const dl = Date.now() + 5000;
    while (Date.now() < dl && !(tok = canvas.tokens.get(t.id))) await new Promise(r => setTimeout(r, 100));
    tok?.setTarget(true, { releaseOthers: true });
    return { actorId: a.id, tokenId: t.id, targeted: game.user.targets.size };
  }, { sceneId: attacker.sceneId });
  expect(tgt.targeted, "token is targeted before clicking Apply").toBe(1);

  const msgId = await postDamageCard(gmPage, { attackerId: attacker.actorId });

  const btn = gmPage.locator(`[data-message-id="${msgId}"] .cp2020-apply-damage-btn`);
  await expect(btn, "Apply Damage button is injected on the card").toBeVisible({ timeout: 15_000 });
  await expect(btn, "exactly one button — render guard prevents dupes").toHaveCount(1);

  // Re-render the whole log; the idempotency guard must keep it at one button.
  await evalGameOrThrow(gmPage, async () => { await ui.chat?.render(true); });
  await expect(gmPage.locator(`[data-message-id="${msgId}"] .cp2020-apply-damage-btn`), "still one button after re-render").toHaveCount(1);

  await btn.first().click();

  const readDmg = () => evalGameOrThrow(gmPage, (id) => game.actors.get(id)?.system.damage ?? null, tgt.actorId);
  const dl = Date.now() + 10_000;
  let dmg = await readDmg();
  while (Date.now() < dl && dmg !== 7) { await gmPage.waitForTimeout(200); dmg = await readDmg(); }
  expect(dmg, "auto-apply dealt the clean net 7 to the targeted token's actor").toBe(7);
});

test("§1 chat-card Apply button falls back to the picker dialog → Use List", async () => {
  // No targeted token and no payload IDs → the click handler must open _pickTargetDialog.
  const listTarget = await evalGameOrThrow(gmPage, async () => {
    for (const tk of [...game.user.targets]) tk.setTarget(false, { releaseOthers: false }); // clear from previous test
    const flags = { cyberpunk2020: { __pwtest: true } };
    const scene = canvas.scene;
    const a = await Actor.create({ name: "__PW__ListTarget", type: "character", flags, system: { stats: { bt: { base: 2 } }, damage: 0 } });
    const [t] = await scene.createEmbeddedDocuments("Token", [
      { name: a.name, x: 1500, y: 1200, actorId: a.id, actorLink: true, width: 1, height: 1, flags },
    ]);
    return { actorId: a.id, tokenId: t.id, targets: game.user.targets.size };
  });
  expect(listTarget.targets, "no token targeted for the dialog path").toBe(0);

  const msgId = await postDamageCard(gmPage, { attackerId: null }); // GM can apply regardless of attacker

  const btn = gmPage.locator(`[data-message-id="${msgId}"] .cp2020-apply-damage-btn`);
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.first().click();

  // The token picker (core Dialog) opens; pick our token by name and Use List.
  const pick = gmPage.locator("#cp-target-pick");
  await expect(pick, "picker dialog opened (no target/ids)").toBeVisible({ timeout: 15_000 });
  await pick.selectOption({ label: "__PW__ListTarget" });
  const useList = gmPage.locator('button[data-button="useList"]').first();
  await expect(useList).toBeVisible({ timeout: 10_000 });
  await useList.click();

  const readDmg = () => evalGameOrThrow(gmPage, (id) => game.actors.get(id)?.system.damage ?? null, listTarget.actorId);
  const dl = Date.now() + 10_000;
  let dmg = await readDmg();
  while (Date.now() < dl && dmg !== 7) { await gmPage.waitForTimeout(200); dmg = await readDmg(); }
  expect(dmg, "list-picked token's actor took the net 7").toBe(7);
});

test("§1 picker dialog: target a token while it's open → Use Canvas Target applies", async () => {
  // The dialog opens with no target; "Use Canvas Target" re-reads game.user.targets at
  // click time, so targeting a token AFTER the dialog is open still resolves it.
  const t = await evalGameOrThrow(gmPage, async () => {
    for (const tk of [...game.user.targets]) tk.setTarget(false, { releaseOthers: false });
    const flags = { cyberpunk2020: { __pwtest: true } };
    const a = await Actor.create({ name: "__PW__LateTarget", type: "character", flags, system: { stats: { bt: { base: 2 } }, damage: 0 } });
    const [tok] = await canvas.scene.createEmbeddedDocuments("Token", [
      { name: a.name, x: 1100, y: 1400, actorId: a.id, actorLink: true, width: 1, height: 1, flags },
    ]);
    return { actorId: a.id, tokenId: tok.id, targets: game.user.targets.size };
  });
  expect(t.targets, "no target when the dialog opens").toBe(0);

  const msgId = await postDamageCard(gmPage, { attackerId: null });
  const btn = gmPage.locator(`[data-message-id="${msgId}"] .cp2020-apply-damage-btn`);
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.first().click();

  await expect(gmPage.locator("#cp-target-pick"), "picker opened").toBeVisible({ timeout: 15_000 });

  // Now (dialog still open) target the token on the canvas, then Use Canvas Target.
  await evalGameOrThrow(gmPage, async (arg) => {
    let tok = null; const dl = Date.now() + 5000;
    while (Date.now() < dl && !(tok = canvas.tokens.get(arg.tokenId))) await new Promise(r => setTimeout(r, 100));
    tok?.setTarget(true, { releaseOthers: true });
  }, { tokenId: t.tokenId });

  const useCanvas = gmPage.locator('button[data-button="useCanvas"]').first();
  await expect(useCanvas).toBeVisible({ timeout: 10_000 });
  await useCanvas.click();

  const readDmg = () => evalGameOrThrow(gmPage, (id) => game.actors.get(id)?.system.damage ?? null, t.actorId);
  const dl = Date.now() + 10_000;
  let dmg = await readDmg();
  while (Date.now() < dl && dmg !== 7) { await gmPage.waitForTimeout(200); dmg = await readDmg(); }
  expect(dmg, "Use Canvas Target applied to the just-targeted token").toBe(7);
});

test("§1 picker dialog: Cancel applies nothing", async () => {
  const t = await evalGameOrThrow(gmPage, async () => {
    for (const tk of [...game.user.targets]) tk.setTarget(false, { releaseOthers: false });
    const flags = { cyberpunk2020: { __pwtest: true } };
    const a = await Actor.create({ name: "__PW__CancelTarget", type: "character", flags, system: { stats: { bt: { base: 2 } }, damage: 0 } });
    await canvas.scene.createEmbeddedDocuments("Token", [
      { name: a.name, x: 900, y: 1400, actorId: a.id, actorLink: true, width: 1, height: 1, flags },
    ]);
    return { actorId: a.id, targets: game.user.targets.size };
  });
  expect(t.targets, "no target → dialog path").toBe(0);

  const msgId = await postDamageCard(gmPage, { attackerId: null });
  const btn = gmPage.locator(`[data-message-id="${msgId}"] .cp2020-apply-damage-btn`);
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.first().click();

  const cancel = gmPage.locator('button[data-button="cancel"]').first();
  await expect(cancel, "picker opened with a Cancel button").toBeVisible({ timeout: 15_000 });
  await cancel.click();

  // Picker closed and nothing was applied (no token was targeted, none picked).
  await expect(gmPage.locator("#cp-target-pick"), "picker closed after Cancel").toHaveCount(0);
  await gmPage.waitForTimeout(1_000);
  const dmg = await evalGameOrThrow(gmPage, (id) => game.actors.get(id)?.system.damage ?? null, t.actorId);
  expect(dmg, "Cancel applies no damage").toBe(0);
});
