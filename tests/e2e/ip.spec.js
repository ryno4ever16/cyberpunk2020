import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * IP (Improvement Points) tracker ([[ip-tracker-design]]). No new document subtype, so no relaunch:
 * additive fields + settings. Covers cost formula, the roll auto-queue (+ hook), award→pending→apply
 * (banked), self-service level-up (RAW + Simple pool), the throttle (hardcap/diminishing), and the
 * two-tier skill lock. Confirm dialogs bypassed with { confirm:false }.
 */

const DEFAULTS = { ipSystem: "disabled", ipAwardModel: "manual", ipThrottle: "off", ipSkillLockMode: "owner" };

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try {
    await login(p, ACCOUNTS.gm);
    await cleanupTestData(p);
    await evalGameOrThrow(p, async (d) => {
      for (const [k, v] of Object.entries(d)) { try { await game.settings.set("cyberpunk2020", k, v); } catch {} }
      try { await game.settings.set("cyberpunk2020", "ipQueue", []); } catch {}
      try { await game.settings.set("cyberpunk2020", "ipThrottleCounts", {}); } catch {}
    }, DEFAULTS);
  } catch {}
  await ctx.close();
});

test("IP cost, data fields, queue+hook, award→pending→apply, level-up (RAW+Simple), throttle, lock", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const out = {};
    const flags = { cyberpunk2020: { __pwtest: true } };
    const ip = await import("/systems/cyberpunk2020/module/ip/ip.js");

    const reset = async () => {
      await game.settings.set("cyberpunk2020", "ipQueue", []);
      await game.settings.set("cyberpunk2020", "ipThrottleCounts", {});
    };
    await game.settings.set("cyberpunk2020", "ipSystem", "raw");
    await game.settings.set("cyberpunk2020", "ipAwardModel", "manual");
    await game.settings.set("cyberpunk2020", "ipThrottle", "off");
    await reset();

    // ── cost formula ────────────────────────────────────────────────
    out.cost0 = ip.ipCost({ system: { level: 0, diffMod: 1 } });   // max(1,0)×10×1 = 10
    out.cost4x3 = ip.ipCost({ system: { level: 4, diffMod: 3 } }); // 4×10×3 = 120
    out.cost2x1 = ip.ipCost({ system: { level: 2, diffMod: 1 } }); // 20

    // ── actor + skills; data fields present ─────────────────────────
    const actor = await Actor.create({ name: "__PW__ipActor", type: "character", flags });
    out.poolField = actor.system.ipPool;                           // 0 (additive)
    const [skill] = await actor.createEmbeddedDocuments("Item", [{
      name: "__PW__Handgun", type: "skill", system: { level: 2, diffMod: 1, stat: "ref", ip: 0, ipPending: 0 } }]);
    out.pendingField = skill.system.ipPending;                     // 0 (additive)

    // ── auto-queue via the rollSkill hook (only enqueues locally if we're the active GM) ──
    out.isActiveGM = game.users.activeGM?.id === game.user.id;
    await reset();
    await actor.rollSkill(skill.id);
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) { if (ip.getQueue().some(r => r.skillId === skill.id)) break; await new Promise(r => setTimeout(r, 100)); }
    out.queueSkillMatch = ip.getQueue().some(r => r.skillId === skill.id);

    // ── award (manual) → pending, then apply → banked ───────────────
    // Seed a queue row directly so this is deterministic regardless of which client is the active GM.
    await reset();
    const rowId = foundry.utils.randomID();
    await game.settings.set("cyberpunk2020", "ipQueue", [{
      id: rowId, actorId: actor.id, skillId: skill.id, actorName: actor.name, skillName: skill.name,
      total: 7, ip: 0, success: false, ts: Date.now() }]);
    await ip.updateQueueRow(rowId, { ip: 5 });
    await ip.resolveQueueRow(rowId);
    out.pendingAfterAward = actor.items.get(skill.id).system.ipPending;   // 5
    out.queueAfterResolve = ip.getQueue().length;                        // 0
    await ip.applyPending(actor);
    out.bankedAfterApply = actor.items.get(skill.id).system.ip;          // 5
    out.pendingAfterApply = actor.items.get(skill.id).system.ipPending;  // 0

    // ── RAW level-up: cost 20, give 20 banked ───────────────────────
    await actor.items.get(skill.id).update({ "system.ip": 20, "system.IP": 20 });
    out.levelUpOk = await ip.levelUpSkill(actor, actor.items.get(skill.id), { confirm: false });
    out.levelAfter = actor.items.get(skill.id).system.level;            // 3
    out.bankedAfterLevel = actor.items.get(skill.id).system.ip;         // 0 (20 - 20)

    // ── insufficient blocks ─────────────────────────────────────────
    out.levelUpBlocked = await ip.levelUpSkill(actor, actor.items.get(skill.id), { confirm: false }); // cost 30, have 0
    out.levelStill3 = actor.items.get(skill.id).system.level;          // 3

    // ── Simple-mode pool level-up ───────────────────────────────────
    await game.settings.set("cyberpunk2020", "ipSystem", "simple");
    const a2 = await Actor.create({ name: "__PW__ipSimple", type: "character", flags, system: { ipPool: 30 } });
    const [s2] = await a2.createEmbeddedDocuments("Item", [{ name: "__PW__Brawl", type: "skill", system: { level: 2, diffMod: 1 } }]);
    out.simpleOk = await ip.levelUpSkill(a2, a2.items.get(s2.id), { confirm: false });   // cost 20
    out.simpleLevel = a2.items.get(s2.id).system.level;                // 3
    out.simplePool = a2.system.ipPool;                                 // 30 - 20 = 10
    await game.settings.set("cyberpunk2020", "ipSystem", "raw");

    // ── throttle: hard cap ──────────────────────────────────────────
    await game.settings.set("cyberpunk2020", "ipThrottle", "hardcap");
    await reset();
    const [s3] = await actor.createEmbeddedDocuments("Item", [{ name: "__PW__Throttle", type: "skill", system: { level: 1, diffMod: 1, ipPending: 0 } }]);
    await ip.awardPending(actor, actor.items.get(s3.id), 5);
    const cap1 = actor.items.get(s3.id).system.ipPending;              // 5
    const ok2 = await ip.awardPending(actor, actor.items.get(s3.id), 5); // capped → false
    out.hardcapPending = actor.items.get(s3.id).system.ipPending;      // still 5
    out.hardcapSecondReturn = ok2;                                     // false

    // ── throttle: diminishing (halving) ─────────────────────────────
    await game.settings.set("cyberpunk2020", "ipThrottle", "diminishing");
    await reset();
    const [s4] = await actor.createEmbeddedDocuments("Item", [{ name: "__PW__Dim", type: "skill", system: { level: 1, diffMod: 1, ipPending: 0 } }]);
    await ip.awardPending(actor, actor.items.get(s4.id), 8);          // +8
    await ip.awardPending(actor, actor.items.get(s4.id), 8);          // +4 (halved)
    out.diminishingPending = actor.items.get(s4.id).system.ipPending; // 12
    await game.settings.set("cyberpunk2020", "ipThrottle", "off");
    await reset();

    // ── two-tier skill lock ─────────────────────────────────────────
    await game.settings.set("cyberpunk2020", "ipSkillLockMode", "owner");
    await actor.setFlag("cyberpunk2020", "ipOwnerLock", true);
    out.ownerModeLocked = !ip.canEditSkillLevels(actor);             // true
    await game.settings.set("cyberpunk2020", "ipSkillLockMode", "gm");
    out.gmModeUnlocked = ip.canEditSkillLevels(actor);              // true (gmLock not set; ownerLock ignored)
    await actor.setFlag("cyberpunk2020", "ipGmLock", true);
    out.gmModeLocked = !ip.canEditSkillLevels(actor);              // true
    await game.settings.set("cyberpunk2020", "ipSkillLockMode", "mutual");
    out.mutualLocked = !ip.canEditSkillLevels(actor);              // true (either flag)
    await actor.unsetFlag("cyberpunk2020", "ipOwnerLock");
    await actor.unsetFlag("cyberpunk2020", "ipGmLock");

    await game.settings.set("cyberpunk2020", "ipSystem", "disabled");
    out.disabledNoLock = ip.canEditSkillLevels(actor);             // true (lock ignored when disabled)

    return out;
  });

  console.log("IP spec:", JSON.stringify(R, null, 2));

  expect(R.cost0).toBe(10);
  expect(R.cost4x3).toBe(120);
  expect(R.cost2x1).toBe(20);
  expect(R.poolField, "actor ipPool field present").toBe(0);
  expect(R.pendingField, "skill ipPending field present").toBe(0);

  // The rollSkill hook enqueues only on the active-GM client; assert only when this client is it.
  if (R.isActiveGM) expect(R.queueSkillMatch, "rollSkill hook enqueued a row").toBe(true);
  else console.log("IP: skipped hook-enqueue assertion (another GM is the active GM)");

  expect(R.pendingAfterAward, "manual award → pending 5").toBe(5);
  expect(R.queueAfterResolve, "row removed after resolve").toBe(0);
  expect(R.bankedAfterApply, "apply released pending → banked 5").toBe(5);
  expect(R.pendingAfterApply, "pending cleared after apply").toBe(0);

  expect(R.levelUpOk).toBe(true);
  expect(R.levelAfter).toBe(3);
  expect(R.bankedAfterLevel, "20 IP − 20 cost").toBe(0);
  expect(R.levelUpBlocked, "insufficient IP blocks").toBe(false);
  expect(R.levelStill3).toBe(3);

  expect(R.simpleOk).toBe(true);
  expect(R.simpleLevel).toBe(3);
  expect(R.simplePool, "pool 30 − 20").toBe(10);

  expect(R.hardcapPending, "hard cap: only first award counts").toBe(5);
  expect(R.hardcapSecondReturn).toBe(false);
  expect(R.diminishingPending, "diminishing: 8 + 4").toBe(12);

  expect(R.ownerModeLocked).toBe(true);
  expect(R.gmModeUnlocked).toBe(true);
  expect(R.gmModeLocked).toBe(true);
  expect(R.mutualLocked).toBe(true);
  expect(R.disabledNoLock, "lock ignored when IP system disabled").toBe(true);
});

test("IP tracker app + skill-sheet IP UI render without throwing", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const out = {};
    const flags = { cyberpunk2020: { __pwtest: true } };
    await game.settings.set("cyberpunk2020", "ipSystem", "raw");

    const actor = await Actor.create({ name: "__PW__ipRender", type: "character", flags });
    const [skill] = await actor.createEmbeddedDocuments("Item", [{
      name: "__PW__Rifle", type: "skill", system: { level: 2, diffMod: 1, ip: 20, stat: "ref" } }]);
    await game.settings.set("cyberpunk2020", "ipQueue", [{
      id: foundry.utils.randomID(), actorId: actor.id, skillId: skill.id,
      actorName: actor.name, skillName: skill.name, total: 8, ip: 3, success: false, ts: Date.now() }]);

    // Tracker app.
    const tracker = await import("/systems/cyberpunk2020/module/ip/tracker.js");
    tracker.openIpTracker();
    let win = null, dl = Date.now() + 8000;
    while (Date.now() < dl) { win = document.querySelector(".cp-ip-tracker-window"); if (win && win.querySelector(".cp-ip-apply")) break; await new Promise(r => setTimeout(r, 150)); }
    out.trackerRendered = !!win;
    out.trackerHasApply = !!win?.querySelector(".cp-ip-apply");
    out.trackerHasRow = !!win?.querySelector(".cp-ip-row");
    for (const app of Object.values(ui.windows)) { if (app?.options?.classes?.includes?.("cp-ip-tracker")) app.close(); }

    // Skill-sheet IP UI (skills is the initial tab; the row should show the level-up arrow + lock toggle).
    actor.sheet.render(true);
    dl = Date.now() + 8000;
    while (Date.now() < dl) { if (actor.sheet.rendered && actor.sheet.element?.[0]?.querySelector(".ip-lock-toggle")) break; await new Promise(r => setTimeout(r, 150)); }
    const el = actor.sheet.element?.[0] ?? actor.sheet.element;
    out.sheetHasLockToggle = !!el?.querySelector(".ip-lock-toggle");
    out.sheetHasLevelUp = !!el?.querySelector(".ip-level-up");   // ip 20 ≥ cost 20 → levelable
    out.sheetHasBanked = !!el?.querySelector(".ip-banked");
    await actor.sheet.close();

    await game.settings.set("cyberpunk2020", "ipSystem", "disabled");
    await game.settings.set("cyberpunk2020", "ipQueue", []);
    return out;
  });

  console.log("IP render:", JSON.stringify(R));
  expect(R.trackerRendered, "tracker window rendered").toBe(true);
  expect(R.trackerHasApply, "tracker Apply button present").toBe(true);
  expect(R.trackerHasRow, "queued row rendered").toBe(true);
  expect(R.sheetHasLockToggle, "skill-tab lock toggle present").toBe(true);
  expect(R.sheetHasLevelUp, "level-up arrow present when affordable").toBe(true);
  expect(R.sheetHasBanked, "banked IP shown").toBe(true);
});
