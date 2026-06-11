import { test, expect } from "@playwright/test";
import { joinAsGM } from "./rig-helpers.js";

/**
 * Dual-core PATH-B chat button spec.
 *
 * Verifies that firing `cyberpunk2020.weaponFired` WITHOUT a targetTokenId
 * (PATH B) causes the "Apply Damage" button to be injected into the rendered
 * chat message that follows.
 *
 * This exercises the `renderChatMessageHTML` hook handler that replaced the
 * deprecated `renderChatMessage` hook for Foundry v15 compatibility. The hook
 * has existed since v13.331 and works on both the v13 rig (port 30000) and
 * the v14 rig (port 30002).
 *
 * Run on BOTH rigs via their respective Playwright configs:
 *   npx playwright test --config playwright.config.js    v14/chat-button-live.spec.js
 *   npx playwright test --config playwright.v14.config.js v14/chat-button-live.spec.js
 */
test("PATH-B chat button: weaponFired (no target) injects Apply Damage button", async ({ page }) => {
  await joinAsGM(page);

  const r = await page.evaluate(async () => {
    const out = {};
    const flags = { cyberpunk2020: { __pwtest: true } };

    // Create a GM-only actor (no player ownership → ownerOnline=false → gmHandles=true).
    const atkActor = await Actor.create({
      name: "__PW__pathb_atk",
      type: "character",
      flags,
    });

    // Emit PATH-B weaponFired: areaDamages present, no targetTokenId/targetActorId.
    // _hookWeaponFired will set _pendingPayload; _hookCreateChatMessage will attach
    // it as a flag to the very next chat message created.
    Hooks.callAll("cyberpunk2020.weaponFired", {
      attackerId: atkActor.id,
      weaponName: "__PW__pathb_pistol",
      areaDamages: { torso: [{ damage: 10 }] },
      ap: false,
      // No targetTokenId — this is the PATH-B trigger.
    });

    // Create the chat message immediately after (the createChatMessage hook consumes
    // _pendingPayload and calls setFlag asynchronously).
    const msg = await ChatMessage.create({
      content: `<div class="cyberpunk-card">PATH-B test shot — __PW__pathb</div>`,
      speaker: ChatMessage.getSpeaker({ actor: atkActor }),
    });
    out.messageCreated = !!msg?.id;
    out.messageId = msg?.id ?? null;

    // Wait for setFlag (async) + re-render + renderChatMessageHTML injection.
    // setFlag triggers an updateChatMessage document update which causes Foundry
    // to re-render the message and re-fire renderChatMessageHTML — give it time.
    await new Promise((r) => setTimeout(r, 1200));

    // Verify the flag was attached.
    const reloaded = game.messages.get(msg.id);
    const payload = reloaded?.getFlag?.("cyberpunk2020", "damagePayload");
    out.flagAttached = !!(payload?.areaDamages);

    // Verify the button was injected into the live chat log DOM.
    // Foundry renders chat messages into #chat-log .message[data-message-id="..."]
    const msgEl = document.querySelector(`#chat-log [data-message-id="${msg.id}"]`)
                ?? document.querySelector(`li[data-message-id="${msg.id}"]`);
    out.messageInDom = !!msgEl;
    out.buttonInjected = !!(msgEl?.querySelector(".cp2020-apply-damage-btn"));

    // Cleanup.
    const testMsgIds = game.messages.contents
      .filter((m) => (m.content || "").includes("__PW__pathb"))
      .map((m) => m.id);
    if (testMsgIds.length) await ChatMessage.deleteDocuments(testMsgIds).catch(() => {});
    await atkActor.delete();

    return out;
  });

  console.log("PATH-B CHAT BUTTON:", JSON.stringify(r, null, 2));

  expect(r.messageCreated, "chat message was created").toBe(true);
  expect(r.flagAttached, "damagePayload flag attached to message").toBe(true);
  expect(r.messageInDom, "message element found in #chat-log").toBe(true);
  expect(r.buttonInjected, 'Apply Damage button (.cp2020-apply-damage-btn) injected into chat message').toBe(true);
});
