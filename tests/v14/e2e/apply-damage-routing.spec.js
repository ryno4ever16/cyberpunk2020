import { test, expect } from "@playwright/test";
import { loginRig, loginRigAs, ensureRigUsers, evalGameOrThrow, cleanupTestData } from "./rig-e2e-helpers.js";

/**
 * Rig-portable port of tests/e2e/apply-damage-routing.spec.js (QA §16 — GM/player apply-damage
 * routing). Identical body; the GM login swaps to loginRig + ensureRigUsers (creates "Test User 1"),
 * and the player login swaps to loginRigAs("Test User 1"). Proves the player→GM socket relay
 * round-trip: permission boundary, own-character contrast, ack, single application.
 */

test.describe.configure({ mode: "serial" });

let gmCtx, gmPage;

test.beforeAll(async ({ browser }) => {
  gmCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  gmPage = await gmCtx.newPage();
  await loginRig(gmPage);
  await ensureRigUsers(gmPage);
  await cleanupTestData(gmPage).catch(() => {});
});

test.afterAll(async () => {
  if (gmPage) await cleanupTestData(gmPage).catch(() => {});
  if (gmCtx) await gmCtx.close();
});

test("§16 player apply-damage routes through the GM socket relay", async ({ browser }) => {
  // GM sets up: an NPC visible-but-not-owned by players (OBSERVER), and a
  // player-owned character (OWNER for Test User 1).
  const setup = await evalGameOrThrow(gmPage, async () => {
    const OWNER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;       // 3
    const OBSERVER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER; // 2
    const player1 = game.users.find(u => u.name === "Test User 1");
    const flags = { cyberpunk2020: { __pwtest: true } };

    const npc = await Actor.create({
      name: "__PW__EnemyNPC", type: "character", flags,
      ownership: { default: OBSERVER },
      system: { stats: { bt: { base: 5 } }, damage: 0 },
    });
    const pc = await Actor.create({
      name: "__PW__PlayerChar", type: "character", flags,
      ownership: { default: 0, [player1.id]: OWNER },
      system: { stats: { bt: { base: 5 } }, damage: 0 },
    });
    return { npcId: npc.id, pcId: pc.id, player1Id: player1.id };
  });

  const playerCtx = await browser.newContext({ viewport: { width: 1400, height: 800 }, ignoreHTTPSErrors: true });
  const playerPage = await playerCtx.newPage();
  try {
    await loginRigAs(playerPage, "Test User 1");

    const NET = 7; // single Torso hit, net HP after armor+BTM

    const playerResult = await evalGameOrThrow(playerPage, async (arg) => {
      const out = {};

      // (1) Player cannot modify the unowned NPC.
      const npc = game.actors.get(arg.npcId);
      out.npcVisible = !!npc;
      out.canModifyNpc = npc ? npc.canUserModify(game.user, "update") : null;
      out.npcUpdateThrew = false;
      try { await npc.update({ "system.damage": 99 }); } catch { out.npcUpdateThrew = true; }
      out.npcDamageAfterDirectAttempt = game.actors.get(arg.npcId)?.system.damage ?? null;

      // (2) Player CAN modify their own character (contrast).
      const pc = game.actors.get(arg.pcId);
      out.ownsPc = pc ? pc.canUserModify(game.user, "update") : null;
      out.ownWriteOk = false;
      try {
        await pc.update({ "system.damage": 2 });
        out.ownWriteOk = pc.system.damage === 2;
        await pc.update({ "system.damage": 0 });
      } catch { out.ownWriteOk = false; }

      // (3) Player emits the same resolved-mode request the damage dialog sends,
      //     and waits for the GM's ack.
      let ack = null;
      const handler = (d) => { if (d.type === "damageApplied" && d.requesterId === game.user.id) ack = d; };
      game.socket.on("system.cyberpunk2020", handler);

      game.socket.emit("system.cyberpunk2020", {
        type: "applyDamage",
        mode: "resolved",
        requesterId: game.user.id,
        targetActorId: arg.npcId,
        resolvedHits: [
          { location: "Torso", afterSP: 10, penetrates: true, btmResult: arg.net, netDamage: arg.net },
        ],
        totalApplied: arg.net,
        ablate: false,
        armorMode: "full",
        stunSaveOnHit: false,
        stunSaveMod: 0,
        dotEnabled: false,
        dotTurns: 0,
        dotDamageFormula: "1d6",
        dotType: "acid",
        weaponName: "__PW__RoutingTest",
        firstHitLocation: "Torso",
      });

      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline && !ack) await new Promise(r => setTimeout(r, 150));
      game.socket.off("system.cyberpunk2020", handler);
      out.ack = ack;
      return out;
    }, { npcId: setup.npcId, pcId: setup.pcId, net: NET });

    console.log("Player routing result:", JSON.stringify(playerResult, null, 2));

    // (1) permission boundary
    expect(playerResult.npcVisible, "NPC is visible to the player (OBSERVER)").toBe(true);
    expect(playerResult.canModifyNpc, "player must NOT have update permission on the NPC").toBe(false);
    expect(playerResult.npcDamageAfterDirectAttempt, "direct write must not change NPC HP").toBe(0);

    // (2) own-character contrast
    expect(playerResult.ownsPc, "player owns their own character").toBe(true);
    expect(playerResult.ownWriteOk, "player can write their own character directly").toBe(true);

    // (3) round-trip ack
    expect(playerResult.ack, "player should receive a damageApplied ack from the GM").not.toBeNull();
    expect(playerResult.ack.targetName).toBe("__PW__EnemyNPC");
    expect(playerResult.ack.totalApplied).toBe(NET);

    // (4) GM-side state: NPC took exactly the requested damage, applied once.
    const npcDamage = await evalGameOrThrow(gmPage, (id) => game.actors.get(id)?.system.damage, setup.npcId);
    console.log("NPC damage after relay:", npcDamage);
    expect(npcDamage, "GM applied exactly the requested damage, once").toBe(NET);
  } finally {
    await playerCtx.close();
  }
});
