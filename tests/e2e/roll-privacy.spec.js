import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Bug-report check (predates current work): "skill/combat rolls from an NPC token sheet are always public
 * despite 'Private GM Roll' being active."
 *
 * Proves the CURRENT code honors the chat roll-mode dropdown (core.rollMode) for NPC rolls: with "gmroll"
 * the roll card is whispered to GMs only (not public); with "publicroll" it's public. Drives the real
 * `actor.rollSkill` path (the same call the token sheet's skill button makes) and inspects the resulting
 * ChatMessage's whisper/blind. Self-cleans (deletes the cards + actors, restores the prior roll mode).
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

test("NPC skill roll honors the active roll mode (gmroll → whispered, public → public)", async () => {
  const res = await evalGameOrThrow(gmPage, async () => {
    const origMode = game.settings.get("core", "rollMode");
    const out = {};
    try {
      const mkActor = async (type, name) => {
        const a = await Actor.create({ name, type, flags: { cyberpunk2020: { __pwtest: true } } });
        return a;
      };

      // Roll a skill at the given roll mode and report the resulting card's visibility.
      const rollAt = async (actor, mode) => {
        const skill = actor.items.find(i => i.type === "skill");
        if (!skill) return { error: `no skill on ${actor.type}` };
        await game.settings.set("core", "rollMode", mode);
        const before = new Set(game.messages.contents.map(m => m.id));
        await actor.rollSkill(skill.id);                       // same path the token sheet button uses
        const deadline = Date.now() + 6000;
        let card = null;
        while (Date.now() < deadline) {
          const fresh = game.messages.contents.filter(m => !before.has(m.id));
          card = fresh.find(m => (m.rolls?.length ?? 0) > 0) || fresh[0];
          if (card) break;
          await new Promise(r => setTimeout(r, 100));
        }
        const newIds = game.messages.contents.filter(m => !before.has(m.id)).map(m => m.id);
        const whisper = card?.whisper ?? [];
        const report = {
          skill: skill.name,
          found: !!card,
          hasRoll: (card?.rolls?.length ?? 0) > 0,
          whisperCount: whisper.length,
          whisperAllGM: whisper.length > 0 && whisper.every(uid => !!game.users.get(uid)?.isGM),
          blind: !!card?.blind,
          isPublic: whisper.length === 0,
        };
        if (newIds.length) await ChatMessage.deleteDocuments(newIds).catch(() => {});
        return report;
      };

      const npc = await mkActor("npc", "__PW__RollNPC");
      out.npc_gmroll = await rollAt(npc, "gmroll");
      out.npc_public = await rollAt(npc, "publicroll");

      const pc = await mkActor("character", "__PW__RollPC");
      out.pc_gmroll = await rollAt(pc, "gmroll");
    } finally {
      await game.settings.set("core", "rollMode", origMode);   // never leave the world's roll mode changed
    }
    return out;
  });

  console.log("ROLL-PRIVACY RESULT:", JSON.stringify(res, null, 2));

  // NPC + "Private GM Roll": the card exists, carries the roll, and is whispered to GMs only (NOT public).
  expect(res.npc_gmroll.found, "npc gmroll card created").toBe(true);
  expect(res.npc_gmroll.hasRoll, "npc gmroll card carries the dice roll").toBe(true);
  expect(res.npc_gmroll.isPublic, "npc gmroll card must NOT be public").toBe(false);
  expect(res.npc_gmroll.whisperCount, "npc gmroll card whispered to ≥1 user").toBeGreaterThan(0);
  expect(res.npc_gmroll.whisperAllGM, "npc gmroll whisper recipients are all GMs").toBe(true);

  // Control: with the dropdown on public, the SAME NPC roll IS public (proves the mode is actually read).
  expect(res.npc_public.found, "npc public card created").toBe(true);
  expect(res.npc_public.isPublic, "npc public card is public").toBe(true);

  // Parity: a character NPC… er, a player character also respects gmroll.
  expect(res.pc_gmroll.isPublic, "character gmroll card must NOT be public").toBe(false);
  expect(res.pc_gmroll.whisperAllGM, "character gmroll whisper recipients are all GMs").toBe(true);
});
