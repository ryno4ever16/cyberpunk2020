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

import { DamageDialog }                                       from "./DamageDialog.js";
import { applyAreaDamages, ablateLocationByAmount, ARMOR_MODES } from "./DamageApplicator.js";
import { postStunSavePrompt, postDeathSavePrompt, updateTaserState, applyAcidDotState } from "./save-rolls.js";
import { rollLocation }                                       from "../utils.js";

// Payload waiting to be attached to the next chat message created
let _pendingPayload = null;

// ---------------------------------------------------------------------------
// T5-A: Multi-action penalty helpers
// ---------------------------------------------------------------------------

function _isMultiActionEnabled() {
  try { return game.settings.get("cyberpunk2020", "multiActionPenaltyEnabled"); } catch { return true; }
}
function _isMultiActionAutoTrack() {
  try { return game.settings.get("cyberpunk2020", "multiActionAutoTrack"); } catch { return true; }
}
function _getActionCount(actor) {
  const round = game?.combat?.round ?? 0;
  const count = Number(actor.getFlag?.("cyberpunk2020", "actionCount") ?? 0);
  const countRound = actor.getFlag?.("cyberpunk2020", "actionCountRound") ?? -1;
  if (round > 0 && countRound !== round) return 0;
  return count;
}
async function _incrementActionCount(actor) {
  const round = game?.combat?.round ?? 0;
  const current = _getActionCount(actor);
  await actor.setFlag("cyberpunk2020", "actionCount", current + 1);
  await actor.setFlag("cyberpunk2020", "actionCountRound", round);
}
function _getMultiActionPenalty(actor) {
  if (!_isMultiActionEnabled()) return 0;
  const count = _getActionCount(actor);
  return count <= 1 ? 0 : -(count - 1) * 3;
}

// ---------------------------------------------------------------------------

export function registerDamageHooks() {
  _hookWeaponFired();
  _hookCreateChatMessage();
  _hookRenderChatMessage();
  _hookSuppressiveFire();
  _hookSuppressiveFirePerTurn();
  _hookSuppressiveTemplateOriginLock();
  _hookAimTracking();
  _hookWaitForTurn();
  _hookDodgeParry();
  _hookDotEffects();
  _hookGasCloud();
  _hookMultiActionPenalty();

  // Combat action button click handler
  document.addEventListener("click", async (ev) => {
    const evasionBtn    = ev.target.closest(".cp-suppression-evasion-roll");
    const confirmBtn    = ev.target.closest(".cp-confirm-fire-zone");
    const takeAimBtn    = ev.target.closest(".cp-take-aim-btn");
    const waitBtn       = ev.target.closest(".cp-wait-for-turn-btn");
    const actNowBtn     = ev.target.closest(".cp-wait-act-btn");
    const dodgeBtn      = ev.target.closest(".cp-dodge-btn");
    const parryBtn      = ev.target.closest(".cp-parry-btn");
    const addActionBtn  = ev.target.closest(".cp-add-action-btn");

    if (evasionBtn && !evasionBtn.disabled) {
      ev.preventDefault();
      evasionBtn.disabled = true;
      await _executeSuppressionEvasion({
        actorId:    evasionBtn.dataset.actorId,
        tokenId:    evasionBtn.dataset.tokenId,
        sceneId:    evasionBtn.dataset.sceneId,
        saveDC:     Number(evasionBtn.dataset.saveDc),
        dmgFormula: evasionBtn.dataset.dmgFormula,
        attackerId: evasionBtn.dataset.attackerId,
      });
    }

    // Confirm fire zone — detects tokens in zone and posts evasion prompts
    if (confirmBtn && !confirmBtn.disabled) {
      ev.preventDefault();
      confirmBtn.disabled = true;
      await _confirmFireZone({
        templateId: confirmBtn.dataset.templateId,
        saveDC:     Number(confirmBtn.dataset.saveDc),
        dmgFormula: confirmBtn.dataset.dmgFormula,
        attackerId: confirmBtn.dataset.attackerId,
        weaponName: confirmBtn.dataset.weaponName,
      });
    }

    // Take Aim — increment aim counter on actor flag (0→1→2→3→0)
    if (takeAimBtn) {
      ev.preventDefault();
      const actor = game.actors.get(takeAimBtn.dataset.actorId);
      if (!actor) return;
      const current = actor.getFlag("cyberpunk2020", "aimRounds") ?? 0;
      const next = current >= 3 ? 0 : current + 1;
      if (next === 0) {
        await actor.unsetFlag("cyberpunk2020", "aimRounds");
      } else {
        await actor.setFlag("cyberpunk2020", "aimRounds", next);
        // Each aim round spends an action (T5-A)
        if (_isMultiActionEnabled() && _isMultiActionAutoTrack()) await _incrementActionCount(actor);
      }
      ui.combat?.render();
    }

    // Wait for Turn — skip current slot without touching initiative; pick who to follow
    if (waitBtn) {
      ev.preventDefault();
      const combat = game.combat;
      if (!combat) return;
      const combatant = combat.combatants.get(waitBtn.dataset.combatantId);
      if (!combatant) return;

      // Remaining combatants this round (after current slot, excluding self and already-waiting)
      const remaining = combat.turns.slice((combat.turn ?? 0) + 1)
        .filter(c => c.id !== combatant.id && !c.getFlag?.("cyberpunk2020", "waitingForTurn") && c.actor);

      // Bug 1 fix: if already last, there is no one to wait after — block rather than advance the round
      if (remaining.length === 0) {
        ui.notifications.info(`${combatant.name} is already the last active combatant this round — there is no one to wait after.`);
        return;
      }

      const options = remaining.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
      const targetId = await new Promise(resolve => {
        new Dialog({
          title: "Wait for Turn",
          content: `<div style="padding:4px;"><p style="margin:0 0 6px;">Act after which combatant's turn?</p><select id="cp-wait-target" style="width:100%;">${options}</select></div>`,
          buttons: {
            confirm: { label: "Wait",   callback: html => resolve(html.find("#cp-wait-target").val()) },
            cancel:  { label: "Cancel", callback: () => resolve(null) },
          },
          default: "confirm",
          close: () => resolve(null),
        }).render(true);
      });
      if (!targetId) return; // cancelled
      const targetName = remaining.find(c => c.id === targetId)?.name ?? "chosen combatant";

      await combatant.setFlag("cyberpunk2020", "waitingForTurn", true);
      await combatant.setFlag("cyberpunk2020", "waitingAfterId", targetId);
      await combat.nextTurn();

      await ChatMessage.create({
        content: `<div class="cyberpunk save-prompt"><h3>⏸ ${combatant.name} is WAITING</h3><div class="save-info">Acting after <b>${targetName}</b>. A prompt will appear when their turn ends.</div></div>`,
        speaker: ChatMessage.getSpeaker({ actor: combatant.actor ?? undefined }),
      });
    }

    // Declare Dodge — toggle dodging flag on actor
    if (dodgeBtn) {
      ev.preventDefault();
      const actor = game.actors.get(dodgeBtn.dataset.actorId);
      if (!actor) return;
      const alreadyDodging = actor.getFlag("cyberpunk2020", "dodging") ?? false;
      if (alreadyDodging) {
        await actor.unsetFlag("cyberpunk2020", "dodging");
        ui.notifications.info(`${actor.name} cancelled Dodge declaration.`);
      } else {
        await actor.setFlag("cyberpunk2020", "dodging", true);
        // Dodge declaration spends an action (T5-A)
        if (_isMultiActionEnabled() && _isMultiActionAutoTrack()) await _incrementActionCount(actor);
        await ChatMessage.create({
          content: `<div class="cyberpunk save-prompt"><h3>🛡 ${actor.name} declares DODGE</h3><div class="save-info">All incoming melee attacks this round are at <b>−2</b> to the attacker's roll. Dodge clears at the start of ${actor.name}'s next turn. (CP2020 p.102)</div></div>`,
          speaker: ChatMessage.getSpeaker({ actor }),
        });
      }
      ui.combat?.render();
    }

    // Declare Parry — toggle parrying flag on actor
    if (parryBtn) {
      ev.preventDefault();
      const actor = game.actors.get(parryBtn.dataset.actorId);
      if (!actor) return;
      const alreadyParrying = actor.getFlag("cyberpunk2020", "parrying") ?? false;
      if (alreadyParrying) {
        await actor.unsetFlag("cyberpunk2020", "parrying");
        ui.notifications.info(`${actor.name} cancelled Parry declaration.`);
      } else {
        await actor.setFlag("cyberpunk2020", "parrying", true);
        // Parry declaration spends an action (T5-A)
        if (_isMultiActionEnabled() && _isMultiActionAutoTrack()) await _incrementActionCount(actor);
        await ChatMessage.create({
          content: `<div class="cyberpunk save-prompt"><h3>⛨ ${actor.name} declares PARRY</h3><div class="save-info">The next incoming melee attack is <b>automatically blocked</b>. Parry is consumed on first use. The parrying character takes −3 to all other actions this turn. (CP2020 p.102)</div></div>`,
          speaker: ChatMessage.getSpeaker({ actor }),
        });
      }
      ui.combat?.render();
    }

    // Take delayed action — announce and clear waiting flags
    if (actNowBtn) {
      ev.preventDefault();
      const combat = game.combat;
      if (!combat) return;
      const combatant = combat.combatants.get(actNowBtn.dataset.combatantId);
      if (!combatant) return;
      await combatant.unsetFlag("cyberpunk2020", "waitingForTurn");
      await combatant.unsetFlag("cyberpunk2020", "waitingAfterId").catch(() => {});
      await ChatMessage.create({
        content: `<div class="cyberpunk save-prompt"><h3>⚡ ${combatant.name} takes their delayed action</h3><div class="save-info">Use the character sheet to fire weapons or take actions.</div></div>`,
        speaker: ChatMessage.getSpeaker({ actor: combatant.actor ?? undefined }),
      });
      ui.combat?.render();
    }

    // Manual Action button — increment action count for untracked actions (T5-A)
    if (addActionBtn) {
      ev.preventDefault();
      if (!_isMultiActionEnabled()) return;
      const actor = game.actors.get(addActionBtn.dataset.actorId);
      if (!actor) return;
      await _incrementActionCount(actor);
      const count   = _getActionCount(actor);
      const penalty = count <= 1 ? 0 : -(count - 1) * 3;
      ui.notifications.info(`${actor.name}: action ${count} recorded.${penalty < 0 ? ` Penalty: ${penalty} to all rolls this round.` : ""}`);
      ui.combat?.render();
    }
  });
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
        // No target selected or resolved — open a token-picker dialog
        target = await _pickTargetDialog();
        if (!target) return;   // GM cancelled
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

// ---------------------------------------------------------------------------
// Suppressive fire evasion prompts (T3-B)
// ---------------------------------------------------------------------------

/**
 * Suppressive fire flow:
 *
 *  1. Creates a ray MeasuredTemplate (fire zone) on the canvas at the attacker's
 *     token position, facing the initial target direction (or East if none).
 *
 *  2. Posts a chat message with a "Confirm Fire Zone" button. The player/GM aims
 *     the template using Foundry's standard template controls (drag direction handle),
 *     then clicks Confirm to detect tokens and issue evasion prompts.
 *
 *  3. The template persists with the `isSuppressiveZone` flag so subsequent
 *     per-turn evasion checks (_hookSuppressiveFirePerTurn) can find it.
 *     It is automatically removed at the start of the next round (see that hook).
 *
 * Fire zone constraints enforced by _hookSuppressiveTemplateOriginLock:
 *   - Origin cannot be moved (only direction/angle changes are allowed).
 *   - Distance cannot exceed weaponRange.
 *   - Width cannot drop below the minimum zone width.
 *
 * Evasion check: Athletics + REF + 1d10 vs saveDC (CP2020 p.101).
 * Failure: 1d6 random hits with weapon damage formula via PATH A.
 */
function _hookSuppressiveFire() {
  Hooks.on("cyberpunk2020.suppressiveFire", async (payload) => {
    if (!game.user.isGM) return;

    const suppressiveSaves = (() => {
      try { return game.settings.get("cyberpunk2020", "suppressiveFireSaves"); }
      catch { return true; }
    })();
    if (!suppressiveSaves) return;

    const { saveDC, dmgFormula, weaponName, actorId, attackerTokenId, zoneWidth, weaponRange } = payload;
    const scene       = canvas?.scene;
    const attackerTok = attackerTokenId ? canvas?.tokens?.placeables?.find(t => t.id === attackerTokenId) : null;

    if (!attackerTok || !scene) {
      ui.notifications.warn("Suppressive fire: attacker token not found on canvas. Target tokens manually and use existing evasion prompts.");
      return;
    }

    // Initial direction: toward centroid of currently-targeted tokens, or East (0°)
    let angleDeg = 0;
    const targetedTokens = Array.from(game.user.targets ?? []);
    if (targetedTokens.length > 0) {
      const cx = targetedTokens.reduce((s, t) => s + (t.center?.x ?? t.x), 0) / targetedTokens.length;
      const cy = targetedTokens.reduce((s, t) => s + (t.center?.y ?? t.y), 0) / targetedTokens.length;
      const dx = cx - (attackerTok.center?.x ?? attackerTok.x);
      const dy = cy - (attackerTok.center?.y ?? attackerTok.y);
      angleDeg = Math.round((Math.atan2(dy, dx) * 180) / Math.PI);
    }

    // Place the fire zone template
    const templateData = {
      t:           "ray",
      x:           attackerTok.center?.x ?? attackerTok.x,
      y:           attackerTok.center?.y ?? attackerTok.y,
      direction:   angleDeg,
      distance:    Math.max(1, weaponRange ?? 50),
      width:       Math.max(2, zoneWidth ?? 2),
      fillColor:   "#ff4400",
      borderColor: "#ff4400",
      flags: {
        cyberpunk2020: {
          isSuppressiveZone: true,
          saveDC,
          dmgFormula,
          weaponName,
          actorId,
          maxDistance:   weaponRange ?? 50,
          minWidth:      zoneWidth ?? 2,
          originX:       attackerTok.center?.x ?? attackerTok.x,
          originY:       attackerTok.center?.y ?? attackerTok.y,
          createdRound:  game.combat?.round ?? 0,
        }
      },
    };

    let created;
    try {
      [created] = await scene.createEmbeddedDocuments("MeasuredTemplate", [templateData]);
    } catch (err) {
      console.warn("CP2020 | Suppressive fire template creation failed:", err);
      ui.notifications.warn("Could not place fire zone template.");
      return;
    }

    // Post the "aim then confirm" chat message
    const content = `
<div class="cyberpunk save-prompt">
  <h3>🔥 Suppressive Fire — ${weaponName}</h3>
  <div class="save-info">
    <span><b>Fire Zone DC:</b> ${saveDC}</span><br>
    <span>The fire zone template has been placed on the canvas.</span><br>
    <span style="opacity:0.75; font-size:0.85em;">Rotate the template to aim, then click <b>Confirm Fire Zone</b> to issue evasion prompts to tokens in the zone. The zone persists until the next round.</span>
  </div>
  <div class="save-buttons" style="margin-top:6px;">
    <button class="cp-confirm-fire-zone"
      data-template-id="${created.id}"
      data-save-dc="${saveDC}"
      data-dmg-formula="${dmgFormula}"
      data-attacker-id="${actorId}"
      data-weapon-name="${weaponName}">
      ✅ Confirm Fire Zone
    </button>
  </div>
</div>`;

    await ChatMessage.create({
      content,
      speaker: ChatMessage.getSpeaker({ actor: game.actors.get(actorId) ?? undefined }),
    });
  });
}

/**
 * After the player has aimed the fire zone template, detect all tokens inside it
 * and post evasion prompts for each (excluding the attacker).
 */
async function _confirmFireZone({ templateId, saveDC, dmgFormula, attackerId, weaponName }) {
  if (!canvas?.scene) return;

  const tmplDoc = canvas.scene.templates.get(templateId);
  if (!tmplDoc) {
    ui.notifications.warn("Fire zone template not found — it may have been removed.");
    return;
  }

  const tmplObj = tmplDoc.object ?? canvas.templates.placeables.find(t => t.document.id === templateId);
  if (!tmplObj?.shape) {
    ui.notifications.warn("Fire zone template shape not available. Try again in a moment.");
    return;
  }

  const tokensInZone = canvas.tokens.placeables.filter(tok => {
    if (tok.actor?.id === attackerId) return false;
    const lx = (tok.center?.x ?? tok.x) - tmplObj.x;
    const ly = (tok.center?.y ?? tok.y) - tmplObj.y;
    return tmplObj.shape.contains(lx, ly);
  });

  if (!tokensInZone.length) {
    ui.notifications.info("No tokens in fire zone.");
    return;
  }

  await _postEvasionPrompts(tokensInZone, { saveDC, dmgFormula, weaponName, attackerId });
}

/** Post evasion prompts for a set of tokens. Shared by initial confirm and per-turn hook. */
async function _postEvasionPrompts(tokens, { saveDC, dmgFormula, weaponName, attackerId }) {
  const sceneId = canvas?.scene?.id ?? "";
  for (const tok of tokens) {
    const actor = tok.actor;
    if (!actor) continue;
    const ref       = Number(actor.system?.stats?.ref?.total) || 0;
    const athletics = Number(actor.getSkillVal?.("Athletics") ?? 0);

    const content = `
<div class="cyberpunk save-prompt">
  <h3>🔥 Suppressive Fire Evasion — ${actor.name}</h3>
  <div class="save-info">
    <span><b>Fire Zone DC:</b> ${saveDC} (${weaponName})</span><br>
    <span>Roll <b>Athletics + REF + 1d10</b> to evade the fire zone.</span><br>
    <span style="opacity:0.75; font-size:0.85em;">REF ${ref}, Athletics ${athletics} — must beat DC ${saveDC} or take hits.</span>
  </div>
  <div class="save-buttons" style="margin-top:6px;">
    <button class="cp-suppression-evasion-roll"
      data-actor-id="${actor.id}"
      data-token-id="${tok.id}"
      data-scene-id="${sceneId}"
      data-save-dc="${saveDC}"
      data-dmg-formula="${dmgFormula}"
      data-attacker-id="${attackerId}">
      🎲 Roll Evasion (Athletics ${athletics} + REF ${ref} + 1d10 vs DC ${saveDC})
    </button>
  </div>
</div>`;

    await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ actor }) });
  }
}

/**
 * Enforce fire zone template constraints:
 *   - Origin cannot be moved (only direction/angle can change).
 *   - Distance cannot exceed maxDistance.
 *   - Width cannot drop below minWidth.
 */
function _hookSuppressiveTemplateOriginLock() {
  Hooks.on("preUpdateMeasuredTemplate", (doc, change) => {
    const flags = doc.flags?.cyberpunk2020;
    if (!flags?.isSuppressiveZone) return;

    // Lock origin position
    if (change.x !== undefined) change.x = flags.originX ?? doc.x;
    if (change.y !== undefined) change.y = flags.originY ?? doc.y;

    // Cap distance at weapon range
    if (change.distance !== undefined && flags.maxDistance) {
      change.distance = Math.min(change.distance, flags.maxDistance);
    }

    // Floor width at minimum zone width
    if (change.width !== undefined && flags.minWidth) {
      change.width = Math.max(change.width, flags.minWidth);
    }
  });
}

/**
 * Per-turn evasion: when a combatant's turn starts, check if their token is
 * inside any active suppressive fire zone template and prompt them to evade.
 * Also removes zones that were created in a previous round (auto-expiry).
 */
function _hookSuppressiveFirePerTurn() {
  Hooks.on("updateCombat", async (combat, updateData) => {
    if (!game.user.isGM) return;
    if (updateData.turn === undefined && updateData.round === undefined) return;
    if (!canvas?.scene) return;

    const currentRound = combat.round ?? 0;

    // Collect all suppressive zone templates on this scene
    const zoneTemplates = canvas.templates.placeables.filter(t =>
      t.document?.flags?.cyberpunk2020?.isSuppressiveZone
    );

    // Remove zones from previous rounds (fire zones expire after 1 round)
    for (const tmpl of zoneTemplates) {
      const createdRound = tmpl.document.flags.cyberpunk2020?.createdRound ?? 0;
      if (currentRound > createdRound) {
        await tmpl.document.delete().catch(() => {});
      }
    }

    // Re-check after deletion
    const activeZones = canvas.templates.placeables.filter(t =>
      t.document?.flags?.cyberpunk2020?.isSuppressiveZone
    );
    if (!activeZones.length) return;

    const combatant = combat.combatant;
    if (!combatant) return;
    const tok = canvas.tokens.placeables.find(t => t.id === combatant.tokenId);
    if (!tok?.actor) return;

    for (const zone of activeZones) {
      const zoneFlags = zone.document.flags.cyberpunk2020;
      if (tok.actor.id === zoneFlags?.actorId) continue;   // skip attacker

      if (!zone.shape) continue;
      const lx = (tok.center?.x ?? tok.x) - zone.x;
      const ly = (tok.center?.y ?? tok.y) - zone.y;
      if (!zone.shape.contains(lx, ly)) continue;

      // Token starts turn inside fire zone — prompt evasion
      await _postEvasionPrompts([tok], {
        saveDC:     zoneFlags.saveDC,
        dmgFormula: zoneFlags.dmgFormula,
        weaponName: zoneFlags.weaponName + " (per-turn)",
        attackerId: zoneFlags.actorId,
      });
    }
  });
}

/**
 * Execute a suppressive fire evasion roll. Called by the button click handler.
 * On failure: roll 1d6 hits with the weapon's dmgFormula, apply via PATH B.
 */
async function _executeSuppressionEvasion({ actorId, tokenId, sceneId, saveDC, dmgFormula, attackerId }) {
  const actor = game.actors.get(actorId);
  if (!actor) return;

  const ref       = Number(actor.system?.stats?.ref?.total) || 0;
  const athletics = Number(actor.getSkillVal?.("Athletics") ?? 0);

  const roll   = await new Roll("1d10 + @ref + @athletics", { ref, athletics }).evaluate();
  const total  = roll.total;
  const dc     = Number(saveDC) || 0;
  const evaded = total > dc;

  let resultHtml;
  if (evaded) {
    resultHtml = `<span style="color:green;font-weight:bold;">✅ EVADED (${total} > ${dc})</span> — ${actor.name} clears the fire zone.`;
  } else {
    resultHtml = `<span style="color:red;font-weight:bold;">❌ CAUGHT (${total} ≤ ${dc})</span> — ${actor.name} takes hits! Rolling damage...`;
  }

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor:  `Suppressive Fire Evasion — need > ${dc}`,
    content: `
<div class="cyberpunk save-result">
  <h3>🔥 Suppressive Fire Evasion — ${actor.name}</h3>
  <div>Athletics ${athletics} + REF ${ref} + Roll ${roll.dice[0].total} = <b>${total}</b> vs DC <b>${dc}</b></div>
  <div style="margin-top:4px;">${resultHtml}</div>
</div>`,
  });

  if (!evaded) {
    // Roll 1d6 random hits with the weapon's damage formula
    const hitsRoll = await new Roll("1d6").evaluate();
    const hits = hitsRoll.total;
    const rollData = {};
    const areaDamages = {};

    for (let i = 0; i < hits; i++) {
      const locResult = await rollLocation(actor, null);
      const loc = locResult.areaHit;
      const dmgRoll = await new Roll(dmgFormula || "1d6", rollData).evaluate();
      const dmg = Math.floor(dmgRoll.total);
      if (!areaDamages[loc]) areaDamages[loc] = [];
      areaDamages[loc].push({ damage: dmg });
    }

    if (Object.keys(areaDamages).length > 0) {
      Hooks.callAll("cyberpunk2020.weaponFired", {
        areaDamages,
        ap:           false,
        targetTokenId: tokenId,
        targetActorId: actorId,
        weaponName:   "Suppressive Fire Hit",
      });
    }
  }
}

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

/**
 * Show a token-picker dialog when no target is pre-selected.
 * Lists all tokens on the current canvas scene. Returns the chosen Actor or null.
 */
function _pickTargetDialog() {
  return new Promise((resolve) => {
    const tokens = canvas?.tokens?.placeables ?? [];
    const validTokens = tokens.filter(t => t.actor);

    if (!validTokens.length) {
      ui.notifications.warn("No tokens on the current scene.");
      return resolve(null);
    }

    // Read targeting state at dialog-open time (informs the default button and status hint).
    // "Use Canvas Target" re-reads game.user.targets at click time, so the GM can target
    // a token while the dialog is open and still use that button.
    const openTimeTarget = game.user.targets?.first() ?? null;
    const targetedName   = openTimeTarget?.name ?? null;

    const targetHint = targetedName
      ? `<div style="margin:4px 0 0; padding:4px 6px; background:rgba(0,80,0,0.2); border-radius:3px; font-size:0.85em;">
           ✔ Currently targeted: <strong>${targetedName}</strong>
         </div>`
      : `<div style="margin:4px 0 0; padding:4px 6px; background:rgba(50,50,50,0.3); border-radius:3px; font-size:0.85em; color:#aaa;">
           No token targeted yet. Right-click a token → <strong>Target</strong>, or hover and press <strong>T</strong>, then click <em>Use Canvas Target</em>.
         </div>`;

    const listOptions = validTokens
      .map((t, i) => `<option value="${i}">${t.name}</option>`)
      .join("");

    const content = `
<div style="padding:2px 0 4px;">
  <p style="margin:0 0 6px; font-weight:bold;">🎯 Target a token on the canvas:</p>
  ${targetHint}
  <hr style="margin:10px 0; border-color:#555;">
  <p style="margin:0 0 4px; font-size:0.85em;">Or pick from the list:</p>
  <select id="cp-target-pick" style="width:100%;">${listOptions}</select>
</div>`;

    new Dialog({
      title: "Apply Damage — Select Target",
      content,
      buttons: {
        useCanvas: {
          icon: '<i class="fas fa-crosshairs"></i>',
          label: "Use Canvas Target",
          callback: () => {
            // Re-read targets at click time — GM may have targeted while dialog was open
            const tok = game.user.targets?.first() ?? null;
            if (!tok?.actor) {
              ui.notifications.warn("No token is targeted. Right-click a token → Target (or hover + T), then click Apply Damage again.");
              resolve(null);
            } else {
              resolve(tok.actor);
            }
          },
        },
        useList: {
          icon: '<i class="fas fa-list"></i>',
          label: "Use List",
          callback: (html) => {
            const idx = Number(html.find("#cp-target-pick").val()) || 0;
            resolve(validTokens[idx]?.actor ?? null);
          },
        },
        cancel: {
          label: "Cancel",
          callback: () => resolve(null),
        },
      },
      default: openTimeTarget ? "useCanvas" : "useList",
      close: () => resolve(null),
    }).render(true);
  });
}

// ---------------------------------------------------------------------------
// T4-G: Aiming accumulation tracking (CP2020 p.99 — +1/round aiming, max +3)
// ---------------------------------------------------------------------------

/**
 * Tracks consecutive "Take Aim" actions across combat turns.
 *
 * A 🎯 button is injected into the combat tracker row of the active combatant.
 * Each click increments the aimRounds actor flag (cycles 0→1→2→3→0).
 * When the attack modifier dialog opens the aimRounds select is pre-filled from
 * the saved flag so the player doesn't have to re-enter it each turn.
 * The flag is cleared automatically when the actor fires (weaponFired hook).
 * Gated by the "aimTrackingEnabled" setting.
 */
function _hookAimTracking() {
  const isEnabled = () => {
    try { return game.settings.get("cyberpunk2020", "aimTrackingEnabled"); }
    catch { return true; }
  };

  // Inject 🎯 button into combat tracker for the active combatant
  Hooks.on("renderCombatTracker", (tracker, html) => {
    if (!isEnabled()) return;
    const combat = game.combat;
    if (!combat) return;
    const combatant = combat.combatants.get(combat.current?.combatantId);
    if (!combatant?.actor) return;
    const actor = combatant.actor;
    if (!game.user.isGM && !actor.isOwner) return;

    const aimCount = actor.getFlag("cyberpunk2020", "aimRounds") ?? 0;
    const root = html instanceof jQuery ? html[0] : (Array.isArray(html) ? html[0] : html);
    const li   = root?.querySelector?.(`[data-combatant-id="${combatant.id}"]`);
    if (!li) return;

    const controls = li.querySelector(".combatant-controls") ?? li.querySelector("menu") ?? li;
    const btn = document.createElement("a");
    btn.classList.add("cp-take-aim-btn", "combatant-control");
    btn.dataset.actorId = actor.id;
    btn.title = aimCount > 0
      ? `Aiming (${aimCount}/3 rounds). Click to increment. Click at 3 to reset.`
      : "Take Aim (+1 to hit per consecutive round, max +3)";
    btn.style.cssText = `cursor:pointer; color:${aimCount > 0 ? "#ffcc00" : "#888"};`;
    btn.innerHTML = `🎯${aimCount > 0 ? aimCount : ""}`;
    controls.prepend(btn);
  });

  // Pre-fill aimRounds select in attack modifier dialog from saved flag
  Hooks.on("renderModifiersDialog", (app, html) => {
    if (!isEnabled()) return;
    const actor = app.options.weapon?.actor;
    if (!actor) return;
    const savedAim = actor.getFlag("cyberpunk2020", "aimRounds") ?? 0;
    if (savedAim <= 0) return;
    const root   = html instanceof jQuery ? html[0] : (Array.isArray(html) ? html[0] : html);
    const select = root?.querySelector?.("select[name='aimRounds']");
    if (select) select.value = String(Math.min(3, savedAim));
  });

  // Clear aim flag when the actor fires
  Hooks.on("cyberpunk2020.weaponFired", ({ actorId }) => {
    if (!isEnabled() || !actorId) return;
    const actor = game.actors.get(actorId);
    if (!actor) return;
    if ((actor.getFlag("cyberpunk2020", "aimRounds") ?? 0) > 0) {
      actor.unsetFlag("cyberpunk2020", "aimRounds").catch(() => {});
    }
  });
}

// ---------------------------------------------------------------------------
// T4-H: Wait for Turn (CP2020 p.98 — delay action to after a specific combatant's turn)
// ---------------------------------------------------------------------------

/**
 * Initiative is NEVER modified. A combatant flag tracks "waiting" state.
 *
 * UI flow:
 *   1. Active combatant (not waiting): ⏸ button. Clicking opens a dialog to
 *      pick which combatant to follow, then skips their current turn slot.
 *   2. Waiting combatant: ⚡ button. Clicking announces the delayed action.
 *   3. When the chosen "wait-after" combatant's turn ends, a chat alert fires.
 *   4. New round: all waiting flags cleared automatically.
 */
function _hookWaitForTurn() {
  const isEnabled = () => {
    try { return game.settings.get("cyberpunk2020", "waitForTurnEnabled"); }
    catch { return true; }
  };

  Hooks.on("renderCombatTracker", (tracker, html) => {
    if (!isEnabled()) return;
    const combat = game.combat;
    if (!combat) return;
    const root = html instanceof jQuery ? html[0] : (Array.isArray(html) ? html[0] : html);
    if (!root) return;

    for (const combatant of combat.combatants) {
      const canControl = game.user.isGM || combatant.actor?.isOwner;
      if (!canControl) continue;

      const li = root.querySelector?.(`[data-combatant-id="${combatant.id}"]`);
      if (!li) continue;

      const controls = li.querySelector(".combatant-controls") ?? li.querySelector("menu") ?? li;
      const isWaiting = combatant.getFlag("cyberpunk2020", "waitingForTurn");
      const isActive  = combatant.id === combat.current?.combatantId;

      if (isWaiting) {
        const actBtn = document.createElement("a");
        actBtn.classList.add("cp-wait-act-btn", "combatant-control");
        actBtn.dataset.combatantId = combatant.id;
        actBtn.title = "Take delayed action — announce you are acting now";
        actBtn.style.cssText = "cursor:pointer; color:#ffcc44;";
        actBtn.innerHTML = "⚡";
        controls.prepend(actBtn);
      } else if (isActive) {
        const waitBtn = document.createElement("a");
        waitBtn.classList.add("cp-wait-for-turn-btn", "combatant-control");
        waitBtn.dataset.combatantId = combatant.id;
        waitBtn.title = "Wait for Turn — skip this slot and act after a chosen combatant";
        waitBtn.style.cssText = "cursor:pointer; color:#888;";
        waitBtn.innerHTML = "⏸";
        controls.prepend(waitBtn);
      }
    }
  });

  // Fire "your moment" alert and clear waiting flags on round change
  Hooks.on("updateCombat", async (combat, updateData) => {
    if (!game.user.isGM) return;

    // New round — clear all waiting flags
    if (updateData.round !== undefined) {
      for (const combatant of combat.combatants) {
        if (combatant.getFlag("cyberpunk2020", "waitingForTurn")) {
          await combatant.unsetFlag("cyberpunk2020", "waitingForTurn").catch(() => {});
          await combatant.unsetFlag("cyberpunk2020", "waitingAfterId").catch(() => {});
        }
      }
      return;
    }

    if (updateData.turn === undefined) return;

    // Find the combatant that JUST completed their turn (previous turn index)
    const prevIdx = (combat.turn ?? 0) - 1;
    if (prevIdx < 0) return;
    const justActed = combat.turns[prevIdx];
    if (!justActed) return;

    // Alert any waiting combatants that were following this one
    for (const combatant of combat.combatants) {
      if (!combatant.getFlag("cyberpunk2020", "waitingForTurn")) continue;
      if (combatant.getFlag("cyberpunk2020", "waitingAfterId") !== justActed.id) continue;

      await ChatMessage.create({
        content: `<div class="cyberpunk save-prompt"><h3>⏸→⚡ ${combatant.name} — YOUR MOMENT!</h3><div class="save-info"><b>${justActed.name}</b> just acted. Click ⚡ in the tracker to announce your delayed action, then fire from your character sheet.</div></div>`,
        speaker: ChatMessage.getSpeaker({ actor: combatant.actor ?? undefined }),
      });
    }
  });
}

// ---------------------------------------------------------------------------
// T4-C: Dodge / Parry active defense (CP2020 p.102)
// ---------------------------------------------------------------------------

/**
 * Declare Dodge / Parry buttons in the combat tracker.
 *
 * Dodge (active combatant or any combatant during their turn):
 *   - Sets actor flag "dodging: true".
 *   - Incoming melee attacks this round are at +2 to the defender's effective total (−2 to attacker).
 *   - Flag clears at the start of the declaring character's next turn.
 *
 * Parry (any combatant — reactive defense):
 *   - Sets actor flag "parrying: true".
 *   - Next incoming melee attack is blocked entirely; flag consumed on use.
 *   - Parrying character takes −3 to other actions (reminder in chat, GM enforces manually).
 *
 * The mechanical effects are applied in item.js __meleeBonk / __martialBonk.
 */
function _hookDodgeParry() {
  const isEnabled = () => {
    try { return game.settings.get("cyberpunk2020", "activeDodgeParryEnabled"); }
    catch { return true; }
  };

  Hooks.on("renderCombatTracker", (tracker, html) => {
    if (!isEnabled()) return;
    const combat = game.combat;
    if (!combat) return;
    const root = html instanceof jQuery ? html[0] : (Array.isArray(html) ? html[0] : html);
    if (!root) return;

    for (const combatant of combat.combatants) {
      const actor = combatant.actor;
      if (!actor) continue;
      const canControl = game.user.isGM || actor.isOwner;
      if (!canControl) continue;

      const li = root.querySelector?.(`[data-combatant-id="${combatant.id}"]`);
      if (!li) continue;

      const controls = li.querySelector(".combatant-controls") ?? li.querySelector("menu") ?? li;
      const isDodging  = actor.getFlag("cyberpunk2020", "dodging")  ?? false;
      const isParrying = actor.getFlag("cyberpunk2020", "parrying") ?? false;
      const isActive   = combatant.id === combat.current?.combatantId;

      // Dodge: shown for the active combatant (declared on their turn)
      if (isActive) {
        const dodgeBtn = document.createElement("a");
        dodgeBtn.classList.add("cp-dodge-btn", "combatant-control");
        dodgeBtn.dataset.actorId = actor.id;
        dodgeBtn.title = isDodging
          ? "Dodging (−2 to attacker's melee roll this round) — click to cancel"
          : "Declare Dodge (−2 to attacker's melee roll, costs your action)";
        dodgeBtn.style.cssText = `cursor:pointer; color:${isDodging ? "#44cc88" : "#888"};`;
        dodgeBtn.innerHTML = isDodging ? "🛡✓" : "🛡";
        controls.prepend(dodgeBtn);
      }

      // Parry: shown for any combatant reactively (also active combatant)
      const parryBtn = document.createElement("a");
      parryBtn.classList.add("cp-parry-btn", "combatant-control");
      parryBtn.dataset.actorId = actor.id;
      parryBtn.title = isParrying
        ? "Parrying (next melee attack blocked) — click to cancel"
        : "Declare Parry (block next melee attack, −3 to own other actions)";
      parryBtn.style.cssText = `cursor:pointer; color:${isParrying ? "#44aaff" : "#888"};`;
      parryBtn.innerHTML = isParrying ? "⛨✓" : "⛨";
      controls.prepend(parryBtn);
    }
  });

  // Clear Dodge flag at the start of the declaring character's next turn
  Hooks.on("updateCombat", async (combat, updateData) => {
    if (!game.user.isGM) return;
    if (updateData.turn === undefined && updateData.round === undefined) return;

    const combatant = combat.combatant;
    if (!combatant?.actor) return;

    const actor = combatant.actor;
    if (actor.getFlag("cyberpunk2020", "dodging")) {
      await actor.unsetFlag("cyberpunk2020", "dodging").catch(() => {});
    }
    // Parry is consumed on use (cleared in item.js), but also clear it here as a safety net
    // in case it was never triggered during the round
    if (updateData.round !== undefined && actor.getFlag("cyberpunk2020", "parrying")) {
      await actor.unsetFlag("cyberpunk2020", "parrying").catch(() => {});
    }
  });
}

// ---------------------------------------------------------------------------
// T4-E: Acid DOT + T4-B: Choke DOT + Hold/Grapple status reminders
// ---------------------------------------------------------------------------

function _hookDotEffects() {
  Hooks.on("updateCombat", async (combat, updateData) => {
    if (!game.user.isGM) return;
    if (updateData.turn === undefined && updateData.round === undefined) return;

    const combatant = combat.combatant;
    if (!combatant?.actor) return;
    const actor = combatant.actor;
    const token = canvas?.tokens?.placeables?.find(t => t.id === combatant.tokenId) ?? null;

    // ── T4-E: Acid armor SP degradation (array format; handles stack/reset/separate modes) ──
    const acidEnabled = (() => {
      try { return game.settings.get("cyberpunk2020", "acidArmorDotEnabled"); }
      catch { return true; }
    })();
    if (acidEnabled && !actor.statuses?.has("dead")) {
      const rawDot = actor.getFlag?.("cyberpunk2020", "dotState");
      // Migrate legacy single-object format to array
      const dotStates = Array.isArray(rawDot) ? rawDot : (rawDot ? [rawDot] : []);
      if (dotStates.length > 0) {
        const surviving = [];
        for (const ds of dotStates) {
          const { location, turnsLeft, formula } = ds;
          if (!location || turnsLeft <= 0) continue;
          let spReduction = 0;
          try {
            const roll = await new Roll(formula || "1d6").evaluate();
            spReduction = roll.total;
            await roll.toMessage({
              speaker: ChatMessage.getSpeaker({ actor }),
              flavor: `Acid DOT — SP degradation at ${location} (${turnsLeft} turn${turnsLeft !== 1 ? "s" : ""} remaining)`,
            });
          } catch {
            spReduction = 3;
          }
          if (spReduction > 0) {
            await ablateLocationByAmount(actor, location, spReduction);
            actor.sheet?.render(false);
          }
          const newTurnsLeft = turnsLeft - 1;
          if (newTurnsLeft <= 0) {
            await ChatMessage.create({
              content: `<div class="cyberpunk save-prompt">⚗ <b>${actor.name}</b> — Acid effect at <b>${location}</b> expired. Armor SP degradation complete.</div>`,
              speaker: ChatMessage.getSpeaker({ actor }),
            });
          } else {
            surviving.push({ location, turnsLeft: newTurnsLeft, formula });
          }
        }
        if (surviving.length > 0) {
          await actor.setFlag("cyberpunk2020", "dotState", surviving);
        } else {
          await actor.unsetFlag("cyberpunk2020", "dotState");
        }
      }
    }

    // ── T4-B: Choke per-turn HP damage ───────────────────────────────────────
    const meleeEnabled = (() => {
      try { return game.settings.get("cyberpunk2020", "specialMeleeEffectsEnabled"); }
      catch { return true; }
    })();
    if (meleeEnabled) {
      const isDead = actor.statuses?.has("dead");

      const chokeState = actor.getFlag?.("cyberpunk2020", "chokeState");
      if (chokeState) {
        if (isDead) {
          // Bug 2 fix: clear choke flag on dead actors rather than dealing phantom damage
          await actor.unsetFlag("cyberpunk2020", "chokeState").catch(() => {});
        } else {
          const formula = chokeState.formula || "1d6";
          const roll = await new Roll(formula).evaluate();
          const damage = roll.total;
          const current = Number(actor.system?.damage) || 0;
          await actor.update({ "system.damage": current + damage }, { render: false, fromCyberpunkDamageSystem: true });
          await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `Choke — ${actor.name} takes ${damage} damage. Must make Stun Save.`,
          });
          actor.sheet?.render(false);
          await postStunSavePrompt(actor, token);
        }
      }

      // ── Hold/Grapple reminder ─────────────────────────────────────────────
      if (!isDead) {
        const heldBy      = actor.getFlag?.("cyberpunk2020", "heldBy");
        const grappledBy  = actor.getFlag?.("cyberpunk2020", "grappledBy");
        if (heldBy) {
          const holder = game.actors.get(heldBy);
          await ChatMessage.create({
            content: `<div class="cyberpunk save-prompt">🤜 <b>${actor.name}</b> is still held by <b>${holder?.name ?? "attacker"}</b>. Can only attempt Escape this turn.</div>`,
            speaker: ChatMessage.getSpeaker({ actor }),
          });
        } else if (grappledBy) {
          const grappler = game.actors.get(grappledBy);
          await ChatMessage.create({
            content: `<div class="cyberpunk save-prompt">🤜 <b>${actor.name}</b> is grappled by <b>${grappler?.name ?? "attacker"}</b>. Must escape or the grappler may Hold/Choke/Throw freely.</div>`,
            speaker: ChatMessage.getSpeaker({ actor }),
          });
        }
      }
    }
  });
}

// ---------------------------------------------------------------------------
// T4-D: Gas grenade — persisting circle cloud, per-turn save prompts
// ---------------------------------------------------------------------------

function _hookGasCloud() {
  const gasEnabled = () => {
    try { return game.settings.get("cyberpunk2020", "gasGrenadeCloudEnabled"); }
    catch { return true; }
  };

  // Create gas cloud when a gas grenade fires
  Hooks.on("cyberpunk2020.weaponFired", async (payload) => {
    if (!game.user.isGM) return;
    if (!gasEnabled()) return;
    const types = payload.effectTypes ?? [];
    if (!types.includes("Gas")) return;

    const scene = canvas?.scene;
    if (!scene) return;

    // Determine cloud center: target token position, or attacker position if none
    let cloudX = null, cloudY = null;
    if (payload.targetTokenId) {
      const tok = canvas?.tokens?.placeables?.find(t => t.id === payload.targetTokenId);
      if (tok) { cloudX = tok.center?.x ?? tok.x; cloudY = tok.center?.y ?? tok.y; }
    }
    if (cloudX === null) {
      if (payload.attackerTokenId) {
        const atk = canvas?.tokens?.placeables?.find(t => t.id === payload.attackerTokenId);
        if (atk) { cloudX = atk.center?.x ?? atk.x; cloudY = atk.center?.y ?? atk.y; }
      }
    }
    if (cloudX === null) return; // can't place without a position

    const radius      = Number(payload.blastRadius) || 3;
    const duration    = Number(payload.dotTurns)    || 3;
    const stunSaveMod = Number(payload.stunSaveMod) || 0;

    // Convert radius from meters to pixels using the scene grid
    const gridSize  = scene.grid?.size  ?? canvas?.grid?.size ?? 100;
    const gridDist  = scene.grid?.distance ?? scene.gridDistance ?? 1;
    const radiusPx  = Math.max(gridSize, (radius / gridDist) * gridSize);

    const templateData = {
      t:           "circle",
      x:           cloudX,
      y:           cloudY,
      direction:   0,
      distance:    radius,
      fillColor:   "#88ff44",
      borderColor: "#44aa22",
      flags: {
        cyberpunk2020: {
          isGasCloud:   true,
          turnsLeft:    duration,
          stunSaveMod,
          createdRound: game.combat?.round ?? 0,
          weaponName:   payload.weaponName ?? "Gas Grenade",
        }
      },
    };

    let created;
    try {
      [created] = await scene.createEmbeddedDocuments("MeasuredTemplate", [templateData]);
    } catch (err) {
      console.warn("CP2020 | Gas cloud template creation failed:", err);
      return;
    }

    await ChatMessage.create({
      content: `<div class="cyberpunk save-prompt">
        <h3>☠ Gas Cloud — ${payload.weaponName ?? "Gas Grenade"}</h3>
        <div>Gas cloud placed on canvas (radius ${radius}m). All tokens within the cloud must make Stun Saves each turn (penalty ${stunSaveMod}).</div>
        <div style="opacity:0.75; font-size:0.85em;">Cloud persists for ${duration} turns, then disperses automatically. GM may reposition the template to represent wind drift.</div>
      </div>`,
      speaker: ChatMessage.getSpeaker({ actor: game.actors.get(payload.attackerActorId ?? "") }),
    });
  });

  // Per-turn: prompt saves for tokens in gas cloud; decrement turns; delete when expired
  Hooks.on("updateCombat", async (combat, updateData) => {
    if (!game.user.isGM) return;
    if (updateData.turn === undefined && updateData.round === undefined) return;
    if (!gasEnabled()) return;

    const scene = canvas?.scene;
    if (!scene) return;

    const cloudTemplates = canvas.templates?.placeables?.filter(t =>
      t.document?.flags?.cyberpunk2020?.isGasCloud
    ) ?? [];

    for (const tmpl of cloudTemplates) {
      const flags = tmpl.document.flags.cyberpunk2020;
      const turnsLeft    = Number(flags.turnsLeft   ?? 0);
      const stunSaveMod  = Number(flags.stunSaveMod ?? 0);
      const weaponName   = flags.weaponName ?? "Gas Grenade";

      if (turnsLeft <= 0) {
        await tmpl.document.delete().catch(() => {});
        continue;
      }

      // Find tokens whose center falls within the cloud
      const shape    = tmpl.shape;
      const tmplPos  = { x: tmpl.document.x, y: tmpl.document.y };
      const tokensInCloud = canvas.tokens?.placeables?.filter(tok => {
        if (!shape) return false;
        const localX = (tok.center?.x ?? tok.x) - tmplPos.x;
        const localY = (tok.center?.y ?? tok.y) - tmplPos.y;
        return shape.contains(localX, localY);
      }) ?? [];

      if (tokensInCloud.length > 0) {
        await ChatMessage.create({
          content: `<div class="cyberpunk save-prompt"><h3>☠ Gas Cloud — ${weaponName} (${turnsLeft} turn${turnsLeft !== 1 ? "s" : ""} left)</h3>
            <div>${tokensInCloud.map(t => `<b>${t.name}</b>`).join(", ")} ${tokensInCloud.length === 1 ? "is" : "are"} in the gas cloud. Each must make a Stun Save${stunSaveMod < 0 ? ` (${stunSaveMod} penalty)` : ""}.</div></div>`,
        });
        for (const tok of tokensInCloud) {
          if (!tok.actor) continue;
          const liveActor = game.actors.get(tok.actor.id) ?? tok.actor;
          // Temporarily apply stunSaveMod via taserState-like mechanism (re-use the additive threshold path)
          if (stunSaveMod < 0) {
            const existingState = liveActor.getFlag?.("cyberpunk2020", "taserState");
            const round = game?.combat?.round ?? 0;
            const count = existingState && (existingState.round === 0 || round <= existingState.round + 2)
              ? (existingState.count ?? 0) + 1 : 1;
            await liveActor.setFlag("cyberpunk2020", "taserState", { count, round, mod: stunSaveMod });
          }
          await postStunSavePrompt(liveActor, tok);
        }
      }

      // Decrement turns; auto-drift if setting is on
      const autoMove = (() => { try { return game.settings.get("cyberpunk2020", "gasCloudAutoMove"); } catch { return false; } })();
      const updates = { [`flags.cyberpunk2020.turnsLeft`]: turnsLeft - 1 };

      if (autoMove) {
        // Move 2m in a random direction
        const gridDist = scene.grid?.distance ?? 1;
        const gridSize = scene.grid?.size ?? canvas?.grid?.size ?? 100;
        const movePx   = (2 / gridDist) * gridSize;
        const angle    = Math.random() * 2 * Math.PI;
        updates.x = tmpl.document.x + Math.cos(angle) * movePx;
        updates.y = tmpl.document.y + Math.sin(angle) * movePx;
      }

      await tmpl.document.update(updates).catch(() => {});

      if (turnsLeft - 1 <= 0) {
        await tmpl.document.delete().catch(() => {});
        await ChatMessage.create({
          content: `<div class="cyberpunk save-prompt">💨 <b>${weaponName}</b> — Gas cloud dispersed.</div>`,
        });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// T5-A: Multi-action penalty tracker
// ---------------------------------------------------------------------------

/**
 * Tracks how many actions each combatant has taken this round and applies
 * a cumulative −3 penalty per additional action (CP2020 p.105 RAW).
 *
 * - Action count badge shown in combat tracker row.
 * - ➕ button for manual actions (reload, etc.) not auto-detected.
 * - Auto-tracks: weapon fire, Aim, Dodge, Parry declarations.
 * - Pre-fills extraMod in the attack modifier dialog with current penalty.
 * - Resets all counts at round change.
 */
function _hookMultiActionPenalty() {
  // Inject badge + ➕ button into combat tracker
  Hooks.on("renderCombatTracker", (tracker, html) => {
    if (!_isMultiActionEnabled()) return;
    const combat = game.combat;
    if (!combat) return;
    const root = html instanceof jQuery ? html[0] : (Array.isArray(html) ? html[0] : html);
    if (!root) return;

    for (const combatant of combat.combatants) {
      const canControl = game.user.isGM || combatant.actor?.isOwner;
      if (!canControl || !combatant.actor) continue;

      const li = root.querySelector?.(`[data-combatant-id="${combatant.id}"]`);
      if (!li) continue;

      const actor   = combatant.actor;
      const count   = _getActionCount(actor);
      const penalty = count <= 1 ? 0 : -(count - 1) * 3;
      const controls = li.querySelector(".combatant-controls") ?? li.querySelector("menu") ?? li;

      // Badge: show action count and live penalty when at least one action taken
      if (count > 0) {
        const badge = document.createElement("span");
        badge.classList.add("cp-action-count-badge");
        badge.style.cssText = "font-size:0.74em; padding:1px 4px; border-radius:3px; background:rgba(80,80,80,0.7); color:var(--color-text-light-primary,#ccc); margin-right:2px; line-height:1.6; pointer-events:none;";
        badge.title = `${count} action${count !== 1 ? "s" : ""} this round. Multi-action penalty: ${penalty || "none"}.`;
        badge.textContent = penalty < 0 ? `×${count} (${penalty})` : `×${count}`;
        controls.prepend(badge);
      }

      // ➕ button: available for active combatant to mark untracked actions
      if (combatant.id === combat.current?.combatantId) {
        const addBtn = document.createElement("a");
        addBtn.classList.add("cp-add-action-btn", "combatant-control");
        addBtn.dataset.actorId = actor.id;
        addBtn.title = "Manual Action — mark an action not tracked automatically (e.g., reload, mount/dismount)";
        addBtn.style.cssText = "cursor:pointer; color:#888;";
        addBtn.innerHTML = "➕";
        controls.prepend(addBtn);
      }
    }
  });

  // Pre-fill extraMod in attack modifier dialog with current penalty
  Hooks.on("renderModifiersDialog", (app, html) => {
    if (!_isMultiActionEnabled()) return;
    const actor = app.options.weapon?.actor;
    if (!actor) return;
    const penalty = _getMultiActionPenalty(actor);
    if (penalty === 0) return;
    const root  = html instanceof jQuery ? html[0] : (Array.isArray(html) ? html[0] : html);
    const input = root?.querySelector?.("input[name='extraMod']");
    if (!input) return;
    const existing = Number(input.value) || 0;
    input.value = String(existing + penalty);
  });

  // Auto-increment count when a weapon fires (after the shot)
  Hooks.on("cyberpunk2020.weaponFired", (payload) => {
    if (!_isMultiActionEnabled() || !_isMultiActionAutoTrack()) return;
    const actor = payload.actorId ? game.actors.get(payload.actorId) : null;
    if (!actor) return;
    _incrementActionCount(actor).catch(() => {});
  });

  // Clear all action counts at round change
  Hooks.on("updateCombat", async (combat, updateData) => {
    if (!game.user.isGM || updateData.round === undefined) return;
    for (const combatant of combat.combatants) {
      if (!combatant.actor) continue;
      if ((combatant.actor.getFlag?.("cyberpunk2020", "actionCount") ?? 0) > 0) {
        await combatant.actor.unsetFlag("cyberpunk2020", "actionCount").catch(() => {});
        await combatant.actor.unsetFlag("cyberpunk2020", "actionCountRound").catch(() => {});
      }
    }
  });
}

// ---------------------------------------------------------------------------

async function _autoApply(payload, target) {
  const armorMode = game.settings.get("cyberpunk2020", "damageArmorMode");
  const ablate    = game.settings.get("cyberpunk2020", "damageAblation");

  const hits = await applyAreaDamages({
    target,
    areaDamages: payload.areaDamages,
    ap:            Boolean(payload.ap),
    edged:         Boolean(payload.edged),
    armorMultSoft: Number(payload.armorMultSoft ?? 1.0),
    armorMultHard: Number(payload.armorMultHard ?? 1.0),
    armorMode,
    ablate,
    dryRun: false,
  });

  const total = hits.reduce((s, h) => s + h.netDamage, 0);
  ui.notifications.info(`Applied ${total} damage to ${target.name}.`);

  // Taser cumulative penalty (T4-F): update flag BEFORE stun save prompt
  if (payload.stunSaveOnHit && hits.some(h => h.penetrates)) {
    const taserEnabled = (() => { try { return game.settings.get("cyberpunk2020", "taserCumPenaltyEnabled"); } catch { return true; } })();
    if (taserEnabled) await updateTaserState(target, payload);
  }

  // Acid armor DOT (T4-E): apply with stacking mode (stack/reset/separate)
  const acidEnabled = (() => { try { return game.settings.get("cyberpunk2020", "acidArmorDotEnabled"); } catch { return true; } })();
  if (acidEnabled && payload.dotEnabled && Number(payload.dotTurns) > 0 && hits.length > 0) {
    await applyAcidDotState(target, hits[0].location, Number(payload.dotTurns), String(payload.dotDamageFormula || "1d6"));
  }

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
