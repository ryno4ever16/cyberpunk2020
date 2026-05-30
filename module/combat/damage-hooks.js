/**
 * damage-hooks.js  —  module/combat/damage-hooks.js
 *
 * Wires the damage automation system into Foundry's hooks.
 *
 * PATH A — Targeted full-auto:
 *   item.js emits "cyberpunk2020.weaponFired" with a targetTokenId.
 *   Opens DamageDialog immediately (or auto-applies if setting is on).
 *
 * PATH B — Everything else (semi-auto, burst, untargeted full-auto):
 *   We listen for "cyberpunk2020.weaponFired" with no targetTokenId and
 *   write the payload as a flag onto the chat message that Foundry creates
 *   immediately afterward. renderChatMessage then injects the Apply Damage
 *   button onto any message carrying that flag.
 *
 *   The flag-writing uses a short-lived pending payload that is consumed
 *   by the next createChatMessage hook call, which fires synchronously
 *   right after roll.execute().
 */

import { DamageDialog }                               from "./DamageDialog.js";
import { applyAreaDamages, ARMOR_MODES }              from "./DamageApplicator.js";
import { postStunSavePrompt, postDeathSavePrompt }    from "./save-rolls.js";

// Payload waiting to be attached to the next chat message created
let _pendingPayload = null;

export function registerDamageHooks() {
  _hookWeaponFired();
  _hookCreateChatMessage();
  _hookRenderChatMessage();
}

// ---------------------------------------------------------------------------
// PATH A + B source: weapon fired hook
// ---------------------------------------------------------------------------

function _hookWeaponFired() {
  Hooks.on("cyberpunk2020.weaponFired", async (payload) => {
    if (!game.user.isGM) return;
    if (!payload.areaDamages || Object.keys(payload.areaDamages).length === 0) return;

    // PATH A: we have a target — open dialog (or auto-apply) immediately
    if (payload.targetTokenId || payload.targetActorId) {
      const target = _resolveTarget(payload);
      if (!target) {
        console.warn("CP2020 | weaponFired: could not resolve target", payload);
        // Still queue for PATH B so GM can use the chat button
        _pendingPayload = payload;
        return;
      }

      if (game.settings.get("cyberpunk2020", "damageAutoApply")) {
        await _autoApply(payload, target);
      } else {
        new DamageDialog(payload, target).render(true);
      }
      return;
    }

    // PATH B: no target — queue payload for the next createChatMessage hook
    _pendingPayload = payload;
  });
}

// ---------------------------------------------------------------------------
// PATH B step 1: attach payload flag to the chat message
// ---------------------------------------------------------------------------

function _hookCreateChatMessage() {
  Hooks.on("createChatMessage", async (message) => {
    if (!_pendingPayload) return;
    if (!game.user.isGM) return;

    const payload = _pendingPayload;
    _pendingPayload = null;

    try {
      await message.setFlag("cyberpunk2020", "damagePayload", payload);
    } catch (err) {
      console.warn("CP2020 | Could not set damagePayload flag on chat message", err);
    }
  });
}

// ---------------------------------------------------------------------------
// PATH B step 2: inject "Apply Damage" button on flagged chat messages
// ---------------------------------------------------------------------------

function _hookRenderChatMessage() {
  Hooks.on("renderChatMessage", (message, html) => {
    if (!game.user.isGM) return;

    const payload = message.getFlag?.("cyberpunk2020", "damagePayload");
    if (!payload?.areaDamages || Object.keys(payload.areaDamages).length === 0) return;

    const btn = document.createElement("button");
    btn.classList.add("cp2020-apply-damage-btn");
    btn.textContent = "Apply Damage";
    btn.style.cssText = "margin-top:4px; width:100%;";

    btn.addEventListener("click", async () => {
      // Prefer a currently-targeted token; fall back to payload IDs
      let target = null;

      const currentTargets = game.user.targets;
      if (currentTargets.size > 0) {
        const tok = currentTargets.first();
        target = tok.actor;
        payload.targetTokenId = tok.id;
        payload.targetActorId = target?.id ?? null;
      } else {
        target = _resolveTarget(payload);
      }

      if (!target) {
        ui.notifications.warn(
          game.i18n.localize("CYBERPUNK.NoTargetSelected") ||
          "Target a token on the canvas before applying damage."
        );
        return;
      }

      if (game.settings.get("cyberpunk2020", "damageAutoApply")) {
        await _autoApply(payload, target);
      } else {
        new DamageDialog(payload, target).render(true);
      }
    });

    // Inject into the chat card
    const container = html[0].querySelector(".cyberpunk-card") ?? html[0];
    container.appendChild(btn);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _resolveTarget(payload) {
  if (payload.targetTokenId) {
    const token = canvas.tokens?.get(payload.targetTokenId);
    if (token?.actor) return token.actor;
  }
  if (payload.targetActorId) {
    return game.actors.get(payload.targetActorId) ?? null;
  }
  return null;
}

async function _autoApply(payload, target) {
  const armorMode = game.settings.get("cyberpunk2020", "damageArmorMode");
  const ablate    = game.settings.get("cyberpunk2020", "damageAblation");

  const hits = await applyAreaDamages({
    target,
    areaDamages: payload.areaDamages,
    ap:          Boolean(payload.ap),
    armorMode,
    ablate,
    dryRun:      false,
  });

  const total = hits.reduce((s, h) => s + h.netDamage, 0);
  ui.notifications.info(`Applied ${total} damage to ${target.name}.`);

  if (total > 0) {
    const token = canvas?.tokens?.placeables?.find(t => t.actor?.id === target.id) ?? null;
    const woundState = target.woundState?.() ?? 0;
    if (woundState >= 4) {
      await postDeathSavePrompt(target, token);
    } else if (woundState > 0) {
      await postStunSavePrompt(target, token);
    }
  }
}
