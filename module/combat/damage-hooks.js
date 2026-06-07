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
import { applyAreaDamages, ablateLocationOnce, ablateLocationByAmount, assessWoundSeverity, ARMOR_MODES } from "./DamageApplicator.js";
import { postStunSavePrompt, postDeathSavePrompt, updateTaserState, applyAcidDotState, applyDotFromPayload } from "./save-rolls.js";
import { rollLocation }                                       from "../utils.js";
import { dispatchAttack }                                     from "../vehicle/vehicle-targeting.js";

// Payload waiting to be attached to the next chat message created
let _pendingPayload = null;

function _isMultiActionEnabled() {
  try { return game.settings.get("cyberpunk2020", "multiActionPenaltyEnabled"); } catch { return false; }
}
function _isMultiActionAutoTrack() {
  try { return game.settings.get("cyberpunk2020", "multiActionAutoTrack"); } catch { return false; }
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
  _hookExplosion();
  _hookSpread();
  _hookMultiActionPenalty();
  _hookAutomationMigrationNotice();
  _hookSocketRelay();
  _hookLiveSheetUpdate();

  // Combat action button click handler
  document.addEventListener("click", async (ev) => {
    const evasionBtn    = ev.target.closest(".cp-suppression-evasion-roll");
    const confirmBtn    = ev.target.closest(".cp-confirm-fire-zone");
    const blastBtn      = ev.target.closest(".cp-confirm-explosion");
    const spreadBtn     = ev.target.closest(".cp-confirm-spread-zone");
    const takeAimBtn    = ev.target.closest(".cp-take-aim-btn");
    const waitBtn       = ev.target.closest(".cp-wait-for-turn-btn");
    const actNowBtn     = ev.target.closest(".cp-wait-act-btn");
    const dodgeBtn      = ev.target.closest(".cp-dodge-btn");
    const parryBtn      = ev.target.closest(".cp-parry-btn");
    const addActionBtn  = ev.target.closest(".cp-add-action-btn");

    const scatterBtn = ev.target.closest(".cp-confirm-explosion-scatter");
    if (scatterBtn && !scatterBtn.disabled) {
      ev.preventDefault();
      scatterBtn.disabled = true;
      await _scatterExplosion(scatterBtn.dataset.templateId);
    }

    if (blastBtn && !blastBtn.disabled) {
      ev.preventDefault();
      blastBtn.disabled = true;
      await _confirmExplosion(blastBtn.dataset.templateId);
    }

    if (spreadBtn && !spreadBtn.disabled) {
      ev.preventDefault();
      spreadBtn.disabled = true;
      await _confirmSpreadZone(spreadBtn.dataset.templateId);
    }

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
        if (_isMultiActionEnabled() && _isMultiActionAutoTrack()) await _incrementActionCount(actor);
      }
      ui.combat?.render();
    }

    if (waitBtn) {
      ev.preventDefault();
      const combat = game.combat;
      if (!combat) return;
      const combatant = combat.combatants.get(waitBtn.dataset.combatantId);
      if (!combatant) return;

      const remaining = combat.turns.slice((combat.turn ?? 0) + 1)
        .filter(c => c.id !== combatant.id && !c.getFlag?.("cyberpunk2020", "waitingForTurn") && c.actor);

      // Guard: if already last in order, there is no one to follow — don't advance the round
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
        if (_isMultiActionEnabled() && _isMultiActionAutoTrack()) await _incrementActionCount(actor);
        await ChatMessage.create({
          content: `<div class="cyberpunk save-prompt"><h3>🛡 ${actor.name} declares DODGE</h3><div class="save-info">All incoming melee attacks this round are at <b>−2</b> to the attacker's roll. Dodge clears at the start of ${actor.name}'s next turn. (CP2020 p.102)</div></div>`,
          speaker: ChatMessage.getSpeaker({ actor }),
        });
      }
      ui.combat?.render();
    }

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
        if (_isMultiActionEnabled() && _isMultiActionAutoTrack()) await _incrementActionCount(actor);
        await ChatMessage.create({
          content: `<div class="cyberpunk save-prompt"><h3>⛨ ${actor.name} declares PARRY</h3><div class="save-info">The next incoming melee attack is <b>automatically blocked</b>. Parry is consumed on first use. The parrying character takes −3 to all other actions this turn. (CP2020 p.102)</div></div>`,
          speaker: ChatMessage.getSpeaker({ actor }),
        });
      }
      ui.combat?.render();
    }

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

function _hookWeaponFired() {
  Hooks.on("cyberpunk2020.weaponFired", async (payload) => {
    // Area-effect ammo is owned by the dedicated explosion/spread hooks. Skip the single-target
    // apply path here so the primary target isn't damaged twice. The per-token blast/pattern
    // re-emits plain weaponFired payloads (no effectTypes/spreadMode), which fall through normally.
    if ((payload.effectTypes ?? []).includes("Explosive")) return;
    if (payload.spreadMode && payload.spreadMode !== "single") return;

    // item.js uses "attackerId"; support legacy "actorId" for any third-party callers.
    const attackerActorId = payload.attackerId ?? payload.actorId ?? null;
    const attackerActor = attackerActorId ? game.actors.get(attackerActorId) : null;
    // Player handles their own actor's shots; the GM handles everything else (NPCs, and PCs
    // whose owning player is currently offline). NOTE: actor.hasPlayerOwner is permission-based
    // and stays true even when the player is disconnected — so we must check for a *connected*
    // owner here, otherwise the GM never takes over an offline player's shots and the Apply
    // Damage button appears for nobody.
    const ownerOnline = !!attackerActor && game.users.players.some(
      u => u.active && attackerActor.testUserPermission(u, "OWNER")
    );
    const isMyShot  = !game.user.isGM && (attackerActor?.isOwner ?? false);
    // Only the PRIMARY (active) GM handles NPC / offline-owner shots. weaponFired fires on every
    // connected GM client; without the activeGM check, N GMs each open a DamageDialog (and, with
    // auto-apply on, each apply the damage → N× HP loss). It also guarantees exactly one client
    // reaches dispatchAttack per shot, which the vehicle-damage relay below relies on to avoid
    // double-applying to a vehicle. Single-GM tables are unaffected (the lone GM is the active GM).
    const gmHandles = game.user.isGM && !ownerOnline && game.users.activeGM?.id === game.user.id;
    if (!isMyShot && !gmHandles) return;
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

      // Unified dispatcher (4-way: source scale × target type). Vehicle targets → vehicle resolver
      // (SP→SDP / Penetration vs Armor Value); a Penetration weapon vs a person → MM p.8. Returns
      // true when handled; a normal personnel-vs-person hit falls through to the dialog below.
      if (await dispatchAttack(payload, target)) return;

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

function _hookCreateChatMessage() {
  Hooks.on("createChatMessage", async (message) => {
    if (!_pendingPayload) return;
    // Any user who owns the attacker can write the flag to their own message.
    // _pendingPayload is client-local, so only the client that queued it will proceed.

    const payload = _pendingPayload;
    _pendingPayload = null;

    try {
      await message.setFlag("cyberpunk2020", "damagePayload", payload);
    } catch (err) {
      console.warn("CP2020 | Could not set damagePayload flag on chat message", err);
    }
  });
}

function _hookRenderChatMessage() {
  Hooks.on("renderChatMessage", (message, html) => {
    const payload = message.getFlag?.("cyberpunk2020", "damagePayload");
    if (!payload?.areaDamages || Object.keys(payload.areaDamages).length === 0) return;

    // Show button to GM always; show to players only if they own the attacker actor.
    // Avoids any dependency on message.userId / message.author which can be undefined in v14.
    const attackerActorId = payload.attackerId ?? payload.actorId ?? null;
    const attackerActor = attackerActorId ? game.actors.get(attackerActorId) : null;
    const canApply = game.user.isGM || (attackerActor?.isOwner ?? false);
    if (!canApply) return;

    // renderChatMessage fires again after setFlag and on any later re-render
    // (edit, popout, scrollback). Without this guard each re-render stacks another button.
    const root = html[0] ?? html;
    if (root.querySelector?.(".cp2020-apply-damage-btn")) return;

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
        target = await _pickTargetDialog();
        if (!target) return;
      }

      // Dispatch by target type: a vehicle target (or a Penetration weapon vs a person) is handled
      // by the unified resolver; a normal personnel-vs-person hit falls through to the dialog.
      if (await dispatchAttack(payload, target)) return;

      if (game.settings.get("cyberpunk2020", "damageAutoApply")) {
        await _autoApply(payload, target);
      } else {
        new DamageDialog(payload, target).render(true);
      }
    });

    const container = html[0].querySelector(".cyberpunk-card") ?? html[0];
    container.appendChild(btn);
  });
}

/**
 * Suppressive fire flow:
 *   1. Places a ray MeasuredTemplate (fire zone) at the attacker's token, aimed toward
 *      any currently targeted tokens (or East if none). Posts a "Confirm Fire Zone" button.
 *   2. GM aims the template, then clicks Confirm. All tokens inside receive evasion prompts.
 *   3. Template persists with `isSuppressiveZone` flag for per-turn re-checks, then
 *      auto-expires at the start of the next round (_hookSuppressiveFirePerTurn).
 *
 * Evasion: Athletics + REF + 1d10 vs saveDC (CP2020 p.101).
 * Failure: 1d6 random hits with weapon damage formula, routed through PATH A.
 */
function _hookSuppressiveFire() {
  Hooks.on("cyberpunk2020.suppressiveFire", async (payload) => {
    const suppressiveSaves = (() => {
      try { return game.settings.get("cyberpunk2020", "suppressiveFireSaves"); }
      catch { return false; }
    })();
    if (!suppressiveSaves) return;

    // Hooks.callAll is LOCAL to the firing client. Placing the fire-zone template requires the GM,
    // so if we're the active GM place it directly; otherwise relay to the GM over the socket
    // (mirrors the damage relay). Without this, a player firing suppressive produced no template.
    if (game.users.activeGM?.id === game.user.id) {
      await _placeSuppressiveZone(payload);
    } else {
      game.socket.emit("system.cyberpunk2020", { type: "suppressiveFire", payload });
    }
  });
}

/** Place the suppressive-fire ray template + post the Confirm prompt. Runs on the GM's client. */
async function _placeSuppressiveZone(payload) {
  if (!payload) return;
  const { saveDC, dmgFormula, weaponName, actorId, attackerTokenId, zoneWidth, weaponRange } = payload;
  const scene       = canvas?.scene;
  const attackerTok = attackerTokenId ? canvas?.tokens?.placeables?.find(t => t.id === attackerTokenId) : null;

  if (!attackerTok || !scene) {
    ui.notifications.warn("Suppressive fire: the attacker's token isn't on the active scene, so the fire zone can't be placed. Drop the attacker's token on the canvas (or target tokens manually and use the evasion prompts).");
    return;
  }

  {
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
  }
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
    // Active GM only — otherwise every connected GM posts a duplicate per-turn
    // evasion prompt and races on template deletion.
    if (game.users.activeGM?.id !== game.user.id) return;
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

/**
 * Aim accumulation tracking (CP2020 p.99 — +1 per consecutive aim round, max +3).
 * Persists aimRounds on the actor flag across turns; pre-fills the attack dialog on open;
 * clears the flag when the actor fires.
 */
function _hookAimTracking() {
  const isEnabled = () => {
    try { return game.settings.get("cyberpunk2020", "aimTrackingEnabled"); }
    catch { return true; }
  };

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

  Hooks.on("cyberpunk2020.weaponFired", (payload) => {
    const actorId = payload.attackerId ?? payload.actorId;
    if (!isEnabled() || !actorId) return;
    const actor = game.actors.get(actorId);
    if (!actor) return;
    if ((actor.getFlag("cyberpunk2020", "aimRounds") ?? 0) > 0) {
      actor.unsetFlag("cyberpunk2020", "aimRounds").catch(() => {});
    }
  });
}

/**
 * Wait for Turn system (CP2020 p.98). Initiative order is never modified.
 * A combatant flag tracks waiting state instead.
 *
 * ⏸ = active, not waiting → opens dialog to pick who to follow, then skips current slot
 * ⚡ = currently waiting  → announces delayed action, clears flag
 * "Your moment" alert fires when the followed combatant ends their turn.
 * All waiting flags clear on round end.
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

  Hooks.on("updateCombat", async (combat, updateData) => {
    if (!game.user.isGM) return;
    // Active GM only — otherwise each connected GM posts a duplicate "your moment" alert.
    if (game.users.activeGM?.id !== game.user.id) return;

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

    // The combatant at turn-1 just completed their action
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

/**
 * Active defense buttons (CP2020 p.102).
 *
 * Dodge (active combatant): sets "dodging" flag → +2 to defender's contested roll until next turn.
 * Parry (any combatant): sets "parrying" flag → next incoming melee attack blocked; consumed on use.
 *   Parry also costs an action (−3 to other rolls this turn); chat reminds the GM to enforce it.
 *
 * The mechanical effects are applied in item.js __meleeBonk / __martialBonk, which
 * read these flags on the defending actor.
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

  Hooks.on("updateCombat", async (combat, updateData) => {
    if (!game.user.isGM) return;
    // Active GM only — keeps multi-GM tables from double-clearing dodge/parry flags
    // (idempotent, but consistent with the other per-turn handlers).
    if (game.users.activeGM?.id !== game.user.id) return;
    if (updateData.turn === undefined && updateData.round === undefined) return;

    const combatant = combat.combatant;
    if (!combatant?.actor) return;

    const actor = combatant.actor;
    if (actor.getFlag("cyberpunk2020", "dodging")) {
      await actor.unsetFlag("cyberpunk2020", "dodging").catch(() => {});
    }
    // Parry is consumed in item.js on hit; clear it here on round end as a safety net
    // in case it was declared but no melee attack ever came
    if (updateData.round !== undefined && actor.getFlag("cyberpunk2020", "parrying")) {
      await actor.unsetFlag("cyberpunk2020", "parrying").catch(() => {});
    }
  });
}

function _hookDotEffects() {
  Hooks.on("updateCombat", async (combat, updateData) => {
    if (!game.user.isGM) return;
    // Only the primary GM applies DOT damage/ablation. updateCombat fires on EVERY
    // connected GM client; without this guard, N connected GMs each apply the tick,
    // multiplying HP loss / armor degradation by N (matches the gas-cloud guard below).
    if (game.users.activeGM?.id !== game.user.id) return;
    if (updateData.turn === undefined && updateData.round === undefined) return;

    const combatant = combat.combatant;
    if (!combatant?.actor) return;
    const actor = combatant.actor;
    const token = canvas?.tokens?.placeables?.find(t => t.id === combatant.tokenId) ?? null;

    // ── Acid armor DOT ────────────────────────────────────────────────────────
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

    // ── Fire / Incendiary DOT (burns HP at the hit location, not armor) ───────
    const fireEnabled = (() => {
      try { return game.settings.get("cyberpunk2020", "fireDotEnabled"); }
      catch { return true; }
    })();
    if (fireEnabled && !actor.statuses?.has("dead")) {
      const rawFire = actor.getFlag?.("cyberpunk2020", "fireDotState");
      const fireStates = Array.isArray(rawFire) ? rawFire : (rawFire ? [rawFire] : []);
      if (fireStates.length > 0) {
        const surviving = [];
        // BTM reduces ALL damage that reaches the target — fire bypasses armor SP, not body toughness.
        const fireBtm = Number(actor.system?.stats?.bt?.modifier) || 0;
        // Fire also chars worn armor: one ablation per turn at the location (optional-rule gated).
        const fireAblate = (() => { try { return game.settings.get("cyberpunk2020", "damageAblation"); } catch { return false; } })();
        for (const fs of fireStates) {
          const { location, turnsLeft, formula } = fs;
          const mult = Number(fs.mult ?? 1);   // halves each turn (burn diminishes: 1d6, then 1d6/2…)
          if (!location || turnsLeft <= 0) continue;
          let rolled = 0;
          let roll = null;
          try {
            roll = await new Roll(formula || "1d6").evaluate();
            rolled = Math.floor((Number(roll.total) || 0) * mult);
          } catch {
            rolled = Math.max(1, Math.floor(mult));
          }
          // Floored at 1 like a penetrating hit (applyBTM semantics): a burn still stings.
          const dmg = Math.max(1, rolled - fireBtm);
          if (roll) {
            await roll.toMessage({
              speaker: ChatMessage.getSpeaker({ actor }),
              flavor: `🔥 Fire DOT — ${actor.name} burns at ${location}: ${dmg} dmg (after BTM ${fireBtm}; ${turnsLeft} turn${turnsLeft !== 1 ? "s" : ""} left)`,
            });
          }
          const current = Number(actor.system?.damage) || 0;
          await actor.update({ "system.damage": current + dmg }, { render: false, fromCyberpunkDamageSystem: true });
          if (fireAblate) {
            try { await ablateLocationOnce(actor, location); } catch (e) { /* no ablatable armor here */ }
          }
          actor.sheet?.render(false);
          await postStunSavePrompt(actor, token);

          const newTurnsLeft = turnsLeft - 1;
          if (newTurnsLeft <= 0) {
            await ChatMessage.create({
              content: `<div class="cyberpunk save-prompt">🔥 <b>${actor.name}</b> — the fire at <b>${location}</b> burns out.</div>`,
              speaker: ChatMessage.getSpeaker({ actor }),
            });
          } else {
            surviving.push({ location, turnsLeft: newTurnsLeft, formula, mult: mult / 2 });
          }
        }
        if (surviving.length > 0) {
          await actor.setFlag("cyberpunk2020", "fireDotState", surviving);
        } else {
          await actor.unsetFlag("cyberpunk2020", "fireDotState");
        }
      }
    }

    // ── Choke DOT ────────────────────────────────────────────────────────────
    const meleeEnabled = (() => {
      try { return game.settings.get("cyberpunk2020", "specialMeleeEffectsEnabled"); }
      catch { return true; }
    })();
    if (meleeEnabled) {
      const isDead = actor.statuses?.has("dead");

      const chokeState = actor.getFlag?.("cyberpunk2020", "chokeState");
      if (chokeState) {
        if (isDead) {
          // Dead actor: clear the flag; don't apply damage they can't receive
          await actor.unsetFlag("cyberpunk2020", "chokeState").catch(() => {});
        } else {
          const formula = chokeState.formula || "1d6";
          const roll = await new Roll(formula).evaluate();
          // BTM reduces ALL damage that reaches the target (CP2020 p.99) — choke included.
          const chokeBtm = Number(actor.system?.stats?.bt?.modifier) || 0;
          const damage = Math.max(1, (Number(roll.total) || 0) - chokeBtm);
          const current = Number(actor.system?.damage) || 0;
          await actor.update({ "system.damage": current + damage }, { render: false, fromCyberpunkDamageSystem: true });
          await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `Choke — ${actor.name} takes ${damage} damage (after BTM ${chokeBtm}). Must make Stun Save.`,
          });
          actor.sheet?.render(false);
          await postStunSavePrompt(actor, token);
        }
      }

      // ── Hold/Grapple turn reminders ──────────────────────────────────────
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

function _hookGasCloud() {
  const gasEnabled = () => {
    try { return game.settings.get("cyberpunk2020", "gasGrenadeCloudEnabled"); }
    catch { return true; }
  };

  Hooks.on("cyberpunk2020.weaponFired", async (payload) => {
    if (!game.user.isGM) return;
    // Only the primary GM places the cloud, else each connected GM creates a duplicate.
    if (game.users.activeGM?.id !== game.user.id) return;
    if (!gasEnabled()) return;
    const types = payload.effectTypes ?? [];
    if (!types.includes("Gas")) return;

    const scene = canvas?.scene;
    if (!scene) return;

    // item.js emits the attacker as "attackerId"; accept legacy aliases too.
    const attackerId = payload.attackerId ?? payload.attackerActorId ?? payload.actorId ?? null;

    // Determine cloud center: target token position, or attacker position if none
    let cloudX = null, cloudY = null;
    if (payload.targetTokenId) {
      const tok = canvas?.tokens?.placeables?.find(t => t.id === payload.targetTokenId);
      if (tok) { cloudX = tok.center?.x ?? tok.x; cloudY = tok.center?.y ?? tok.y; }
    }
    if (cloudX === null) {
      // No target token — fall back to the attacker's token, resolved by actor id.
      // weaponFired payloads carry no attacker token id, so we look it up on the canvas.
      const atk = attackerId
        ? canvas?.tokens?.placeables?.find(t => t.actor?.id === attackerId)
        : null;
      if (atk) { cloudX = atk.center?.x ?? atk.x; cloudY = atk.center?.y ?? atk.y; }
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
      speaker: ChatMessage.getSpeaker({ actor: attackerId ? game.actors.get(attackerId) : undefined }),
    });
  });

  // Per-turn: prompt saves for tokens in gas cloud; decrement turns; delete when expired
  Hooks.on("updateCombat", async (combat, updateData) => {
    if (!game.user.isGM) return;
    // Only the primary GM runs the per-turn cloud logic, else duplicate prompts/updates.
    if (game.users.activeGM?.id !== game.user.id) return;
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

/** Apply one area-effect hit to a token's actor through the normal pipeline (GM-side, direct). */
async function _applyAreaHitToToken(tok, dmg, { ap, edged, armorMultSoft, armorMultHard, penDamageMult, weaponName }) {
  if (!tok?.actor || dmg <= 0) return 0;
  const loc = (await rollLocation(tok.actor, null)).areaHit;
  const hits = await applyAreaDamages({
    target:        tok.actor,
    areaDamages:   { [loc]: [{ damage: dmg }] },
    ap:            Boolean(ap),
    edged:         Boolean(edged),
    armorMultSoft: Number(armorMultSoft ?? 1),
    armorMultHard: Number(armorMultHard ?? 1),
    penDamageMult: Number(penDamageMult ?? 1),
    armorMode:     game.settings.get("cyberpunk2020", "damageArmorMode"),
    ablate:        game.settings.get("cyberpunk2020", "damageAblation"),
    dryRun:        false,
  });
  const total = hits.reduce((s, h) => s + h.netDamage, 0);
  if (total > 0) {
    const ws = tok.actor.woundState?.() ?? 0;
    if (ws >= 4) await postDeathSavePrompt(tok.actor, tok);
    else if (ws > 0) await postStunSavePrompt(tok.actor, tok);
  }
  return total;
}

/**
 * Is `tok` shielded from an area effect originating at (ox,oy) by a wall? (CP2020 p.108 — cover
 * between the source and a target exempts it.) Gated by areaEffectOcclusion. Graceful: if the
 * collision backend is unavailable, nothing is treated as occluded.
 */
function _isOccluded(ox, oy, tok) {
  try { if (!game.settings.get("cyberpunk2020", "areaEffectOcclusion")) return false; } catch (e) { /* default on */ }
  try {
    const origin = { x: ox, y: oy };
    const dest   = { x: tok.center?.x ?? tok.x, y: tok.center?.y ?? tok.y };
    const backend = CONFIG?.Canvas?.polygonBackends?.move;
    if (backend?.testCollision) return !!backend.testCollision(origin, dest, { type: "move", mode: "any" });
  } catch (e) { /* no collision support → not occluded */ }
  return false;
}

/**
 * HEP concussion (Listen Up p.105): SP ignored, BTM applies, half of what gets through is
 * permanent HP and half is stun (a Stun Save is always prompted). Soft armor at the torso loses
 * 2 SP. Used by the explosion blast when Detailed Explosives is enabled.
 */
async function _applyConcussionToToken(tok, falloffDmg, { weaponName = "Explosion" } = {}) {
  if (!tok?.actor || falloffDmg <= 0) return 0;
  const actor = tok.actor;
  const btm = Number(actor.system.stats?.bt?.modifier) || 0;
  const gotThrough = Math.max(1, falloffDmg - btm);          // SP ignored; BTM applies
  const permanent  = Math.max(1, Math.floor(gotThrough / 2)); // half permanent, half stun

  const current = Number(actor.system.damage) || 0;
  await actor.update({ "system.damage": current + permanent }, { render: false, fromCyberpunkDamageSystem: true });
  if (actor.getFlag?.("cyberpunk2020", "stabilized")) {
    await actor.unsetFlag("cyberpunk2020", "stabilized");
    await ChatMessage.create({
      content: `<div class="cyberpunk save-prompt">⚠ <b>${actor.name}</b> was stabilized but has taken new damage — Death Saves are required again.</div>`,
      speaker: ChatMessage.getSpeaker({ actor }),
    });
  }
  await ablateLocationByAmount(actor, "Torso", 2).catch(() => {}); // concussion wears soft armor −2 SP
  await assessWoundSeverity(actor, "Torso", permanent, { token: tok });
  await ChatMessage.create({
    content: `<div class="cyberpunk save-prompt">💥 <b>${actor.name}</b> — concussion (${weaponName}): <b>${permanent}</b> permanent HP (half of ${gotThrough} after BTM); the other half is stun. Soft armor −2 SP. Stun Save required.</div>`,
    speaker: ChatMessage.getSpeaker({ actor }),
  });
  const ws = actor.woundState?.() ?? 0;  // half is stun/blunt → always a consciousness check
  if (ws >= 4) await postDeathSavePrompt(actor, tok);
  else await postStunSavePrompt(actor, tok);
  return permanent;
}

/**
 * Explosions & grenades (CP2020 p.108). Ammo whose effectTypes include "Explosive" detonates as an
 * area-effect blast: a circle of radius blastRadius centered on the target (or attacker), with
 * range-banded damage falloff outward (blastMultipliers). The GM repositions/confirms, then every
 * token in the blast takes damage through the normal pipeline. Mirrors gas-cloud + suppressive-confirm.
 */
function _hookExplosion() {
  const enabled = () => { try { return game.settings.get("cyberpunk2020", "explosivesEnabled"); } catch { return true; } };

  Hooks.on("cyberpunk2020.weaponFired", async (payload) => {
    if (!game.user.isGM) return;
    if (game.users.activeGM?.id !== game.user.id) return;   // only the primary GM places it
    if (!enabled()) return;
    if (!(payload.effectTypes ?? []).includes("Explosive")) return;

    const scene = canvas?.scene;
    if (!scene) return;

    const attackerId = payload.attackerId ?? payload.attackerActorId ?? payload.actorId ?? null;

    // Blast center: target token position, else attacker token.
    let cx = null, cy = null;
    if (payload.targetTokenId) {
      const tok = canvas?.tokens?.placeables?.find(t => t.id === payload.targetTokenId);
      if (tok) { cx = tok.center?.x ?? tok.x; cy = tok.center?.y ?? tok.y; }
    }
    if (cx === null && attackerId) {
      const atk = canvas?.tokens?.placeables?.find(t => t.actor?.id === attackerId);
      if (atk) { cx = atk.center?.x ?? atk.x; cy = atk.center?.y ?? atk.y; }
    }
    if (cx === null) return;

    // Base blast damage = the rolled weapon damage carried in areaDamages.
    let baseDamage = 0;
    for (const hits of Object.values(payload.areaDamages ?? {})) {
      for (const h of (hits ?? [])) baseDamage += Number(h.damage ?? h.dmg) || 0;
    }
    const radius = Number(payload.blastRadius) || 0;
    if (baseDamage <= 0 || radius <= 0) return;

    const weaponName = payload.weaponName ?? "Explosion";
    const fullWithin = Number(payload.blastFullDamageWithin ?? 1);
    const templateData = {
      t: "circle", x: cx, y: cy, direction: 0, distance: radius,
      fillColor: "#ff8800", borderColor: "#cc4400",
      flags: { cyberpunk2020: {
        isExplosion: true, baseDamage, blastRadius: radius, blastFullDamageWithin: fullWithin,
        blastMultipliers: Array.isArray(payload.blastMultipliers) ? payload.blastMultipliers : [0.5, 0.25, 0.125, 0.0625],
        attackerId, ap: Boolean(payload.ap), edged: Boolean(payload.edged),
        armorMultSoft: Number(payload.armorMultSoft ?? 1), armorMultHard: Number(payload.armorMultHard ?? 1),
        penDamageMult: Number(payload.penDamageMult ?? 1), blastShrapnel: Boolean(payload.blastShrapnel),
        weaponName, createdRound: game.combat?.round ?? 0,
      } },
    };

    let created;
    try { [created] = await scene.createEmbeddedDocuments("MeasuredTemplate", [templateData]); }
    catch (err) { console.warn("CP2020 | Explosion template creation failed:", err); return; }

    await ChatMessage.create({
      content: `<div class="cyberpunk save-prompt">
  <h3>💥 Explosion — ${weaponName}</h3>
  <div class="save-info"><span>Blast radius <b>${radius}m</b>, base damage <b>${baseDamage}</b>, full damage within <b>${fullWithin}m</b>.</span><br>
  <span style="opacity:0.75; font-size:0.85em;">If the throw missed, click Scatter to roll where it really lands; otherwise reposition for cover and click Confirm. Damage falls off by distance.</span></div>
  <div class="save-buttons" style="margin-top:6px;">
    <button class="cp-confirm-explosion-scatter" data-template-id="${created.id}">🎲 Scatter (miss)</button>
    <button class="cp-confirm-explosion" data-template-id="${created.id}">💥 Confirm Blast</button>
  </div>
</div>`,
      speaker: ChatMessage.getSpeaker({ actor: attackerId ? (game.actors.get(attackerId) ?? undefined) : undefined }),
    });
  });
}

/** Detonate a confirmed blast: damage every token in the template with range-banded falloff. */
async function _confirmExplosion(templateId) {
  if (!canvas?.scene || !templateId) return;
  const tmplDoc = canvas.scene.templates.get(templateId);
  if (!tmplDoc) { ui.notifications.warn("Explosion template not found — it may have been removed."); return; }
  const f = tmplDoc.flags?.cyberpunk2020;
  if (!f?.isExplosion) return;

  const tmplObj = tmplDoc.object ?? canvas.templates.placeables.find(t => t.document.id === templateId);
  if (!tmplObj?.shape) { ui.notifications.warn("Blast shape not ready — try again in a moment."); return; }

  const scene    = canvas.scene;
  const gridSize = scene.grid?.size ?? canvas?.grid?.size ?? 100;
  const gridDist = scene.grid?.distance ?? 1;
  const fullR    = Number(f.blastFullDamageWithin) || 1;
  const radius   = Number(f.blastRadius) || 1;
  const mults    = Array.isArray(f.blastMultipliers) && f.blastMultipliers.length ? f.blastMultipliers : [0.5, 0.25, 0.125, 0.0625];
  const base     = Number(f.baseDamage) || 0;

  const detailed = (() => { try { return game.settings.get("cyberpunk2020", "explosivesDetailed"); } catch { return false; } })();

  const tokens = canvas.tokens.placeables.filter(tok => {
    if (!tok.actor) return false;
    const lx = (tok.center?.x ?? tok.x) - tmplObj.x;
    const ly = (tok.center?.y ?? tok.y) - tmplObj.y;
    if (!tmplObj.shape.contains(lx, ly)) return false;
    return !_isOccluded(tmplObj.x, tmplObj.y, tok);   // cover between center and target exempts it
  });
  if (!tokens.length) { ui.notifications.info("No tokens in the blast (or all behind cover)."); return; }

  for (const tok of tokens) {
    const dxPx = (tok.center?.x ?? tok.x) - tmplObj.x;
    const dyPx = (tok.center?.y ?? tok.y) - tmplObj.y;
    const distM = (Math.hypot(dxPx, dyPx) / gridSize) * gridDist;

    let mult = 1;
    if (distM > fullR) {
      const span = Math.max(0.0001, radius - fullR);
      const band = Math.min(mults.length - 1, Math.max(0, Math.floor(((distM - fullR) / span) * mults.length)));
      mult = Number(mults[band]) || 0;
    }
    const dmg = Math.max(0, Math.floor(base * mult));
    if (dmg <= 0) continue;

    if (detailed) {
      // HEP concussion (SP ignored, ½ permanent + ½ stun, soft armor −2). Optional shrapnel on top.
      await _applyConcussionToToken(tok, dmg, { weaponName: (f.weaponName ?? "Explosion") + " (concussion)" });
      if (f.blastShrapnel) {
        const shrap = await new Roll("1d10").evaluate();
        await _applyAreaHitToToken(tok, Math.max(0, Math.floor(shrap.total)),
          { ap: false, edged: false, armorMultSoft: 1, armorMultHard: 1, penDamageMult: 1, weaponName: (f.weaponName ?? "Explosion") + " (shrapnel)" });
      }
    } else {
      // Core blast: range-banded damage through normal armor.
      await _applyAreaHitToToken(tok, dmg, { ...f, weaponName: (f.weaponName ?? "Explosion") + " (blast)" });
    }
  }
}

/** Scatter a missed grenade: Grenade Table (CP2020 p.108) — 1d10 direction + 1d10 metres. */
async function _scatterExplosion(templateId) {
  if (!canvas?.scene || !templateId) return;
  const tmplDoc = canvas.scene.templates.get(templateId);
  if (!tmplDoc?.flags?.cyberpunk2020?.isExplosion) { ui.notifications.warn("Blast template not found."); return; }

  const scene = canvas.scene;
  const gridSize = scene.grid?.size ?? canvas?.grid?.size ?? 100;
  const gridDist = scene.grid?.distance ?? 1;

  const dirRoll  = await new Roll("1d10").evaluate();
  const distRoll = await new Roll("1d10").evaluate();
  // Numpad layout around the target (5/10 = on-target). Screen coords: +y is down.
  const DIRS    = { 1: [-1, 1], 2: [0, 1], 3: [1, 1], 4: [-1, 0], 5: [0, 0], 6: [1, 0], 7: [-1, -1], 8: [0, -1], 9: [1, -1], 10: [0, 0] };
  const DIRNAME = { 1: "SW", 2: "S", 3: "SE", 4: "W", 5: "on-target", 6: "E", 7: "NW", 8: "N", 9: "NE", 10: "direct hit" };
  const [vx, vy] = DIRS[dirRoll.total] ?? [0, 0];
  const distM  = distRoll.total;
  const distPx = (distM / gridDist) * gridSize;
  const mag = Math.hypot(vx, vy) || 1;
  const nx = tmplDoc.x + (vx / mag) * distPx;
  const ny = tmplDoc.y + (vy / mag) * distPx;

  await tmplDoc.update({ x: nx, y: ny });
  await ChatMessage.create({
    content: `<div class="cyberpunk save-prompt">🎲 <b>Scatter</b> — ${DIRNAME[dirRoll.total]}${(vx || vy) ? ` ${distM}m` : " (no drift)"}. Reposition if needed, then Confirm Blast.</div>`,
  });
}

/**
 * Shotgun / flechette spread (CP2020 p.108). Ammo whose spreadMode is not "single" fires a widening
 * pattern: a ray from the attacker toward the target, width by range band (Close/Med/Long), with
 * range-banded damage (ammo override, else Core 4d6/3d6/2d6). Everyone in the straight path is hit
 * (no evasion). The GM aims and confirms, mirroring suppressive fire.
 */
function _hookSpread() {
  const enabled = () => { try { return game.settings.get("cyberpunk2020", "shotgunSpreadEnabled"); } catch { return true; } };

  Hooks.on("cyberpunk2020.weaponFired", async (payload) => {
    if (!game.user.isGM) return;
    if (game.users.activeGM?.id !== game.user.id) return;
    if (!enabled()) return;
    const mode = payload.spreadMode;
    if (!mode || mode === "single") return;

    const scene = canvas?.scene;
    if (!scene) return;

    const attackerId = payload.attackerId ?? payload.attackerActorId ?? payload.actorId ?? null;
    const atk = attackerId ? canvas?.tokens?.placeables?.find(t => t.actor?.id === attackerId) : null;
    if (!atk) {
      ui.notifications.warn("Spread fire: the attacker's token isn't on the active scene, so the pattern can't be placed.");
      return;
    }
    const ox = atk.center?.x ?? atk.x, oy = atk.center?.y ?? atk.y;
    const gridSize = scene.grid?.size ?? canvas?.grid?.size ?? 100;
    const gridDist = scene.grid?.distance ?? 1;

    // Direction + range band toward the target (East + Medium if no target).
    let angleDeg = 0, band = "Medium", lengthM = 10;
    const tgt = payload.targetTokenId ? canvas?.tokens?.placeables?.find(t => t.id === payload.targetTokenId) : null;
    if (tgt) {
      const tx = tgt.center?.x ?? tgt.x, ty = tgt.center?.y ?? tgt.y;
      angleDeg = Math.round(Math.atan2(ty - oy, tx - ox) * 180 / Math.PI);
      const distM = (Math.hypot(tx - ox, ty - oy) / gridSize) * gridDist;
      band = distM <= 6 ? "Short" : (distM <= 25 ? "Medium" : "Long");   // CP2020 close / medium / long
      lengthM = Math.max(2, distM);
    }

    const widthM = band === "Short" ? Number(payload.spreadWidthShort ?? 1)
                 : band === "Long"  ? Number(payload.spreadWidthLong  ?? 3)
                 :                     Number(payload.spreadWidthMedium ?? 2);
    const dmgFormula =
      (band === "Short" ? payload.spreadDamageShort : band === "Long" ? payload.spreadDamageLong : payload.spreadDamageMedium)
      || (band === "Short" ? "4d6" : band === "Long" ? "2d6" : "3d6");   // Core defaults

    const weaponName = payload.weaponName ?? "Shotgun";
    const templateData = {
      t: "ray", x: ox, y: oy, direction: angleDeg, distance: lengthM, width: widthM,
      fillColor: "#ffaa00", borderColor: "#cc6600",
      flags: { cyberpunk2020: {
        isSpreadZone: true, dmgFormula, band, attackerId,
        ap: Boolean(payload.ap), edged: Boolean(payload.edged),
        armorMultSoft: Number(payload.armorMultSoft ?? 1), armorMultHard: Number(payload.armorMultHard ?? 1),
        penDamageMult: Number(payload.penDamageMult ?? 1), weaponName, createdRound: game.combat?.round ?? 0,
      } },
    };

    let created;
    try { [created] = await scene.createEmbeddedDocuments("MeasuredTemplate", [templateData]); }
    catch (err) { console.warn("CP2020 | Spread template creation failed:", err); return; }

    await ChatMessage.create({
      content: `<div class="cyberpunk save-prompt">
  <h3>🔫 Spread Pattern — ${weaponName}</h3>
  <div class="save-info"><span>Range band <b>${band}</b>: width <b>${widthM}m</b>, damage <b>${dmgFormula}</b>.</span><br>
  <span style="opacity:0.75; font-size:0.85em;">Aim the pattern, then click Confirm. Everyone in the straight path is hit (CP2020 p.108).</span></div>
  <div class="save-buttons" style="margin-top:6px;">
    <button class="cp-confirm-spread-zone" data-template-id="${created.id}">🔫 Confirm Spread Pattern</button>
  </div>
</div>`,
      speaker: ChatMessage.getSpeaker({ actor: attackerId ? (game.actors.get(attackerId) ?? undefined) : undefined }),
    });
  });
}

/** Apply spread damage to every token in the confirmed pattern (no evasion — buckshot just hits). */
async function _confirmSpreadZone(templateId) {
  if (!canvas?.scene || !templateId) return;
  const tmplDoc = canvas.scene.templates.get(templateId);
  if (!tmplDoc) { ui.notifications.warn("Spread template not found — it may have been removed."); return; }
  const f = tmplDoc.flags?.cyberpunk2020;
  if (!f?.isSpreadZone) return;

  const tmplObj = tmplDoc.object ?? canvas.templates.placeables.find(t => t.document.id === templateId);
  if (!tmplObj?.shape) { ui.notifications.warn("Spread shape not ready — try again in a moment."); return; }

  const tokens = canvas.tokens.placeables.filter(tok => {
    if (!tok.actor) return false;
    if (tok.actor.id === f.attackerId) return false;   // never the shooter
    const lx = (tok.center?.x ?? tok.x) - tmplObj.x;
    const ly = (tok.center?.y ?? tok.y) - tmplObj.y;
    if (!tmplObj.shape.contains(lx, ly)) return false;
    return !_isOccluded(tmplObj.x, tmplObj.y, tok);    // intervening cover exempts spaces behind it
  });
  if (!tokens.length) { ui.notifications.info("No tokens in the spread pattern (or all behind cover)."); return; }

  for (const tok of tokens) {
    const dmgRoll = await new Roll(f.dmgFormula || "3d6").evaluate();
    const dmg = Math.max(0, Math.floor(dmgRoll.total));
    await _applyAreaHitToToken(tok, dmg, { ...f, weaponName: (f.weaponName ?? "Shotgun") + " (spread)" });
  }
}

/**
 * Multi-action penalty tracker (CP2020 p.105 — −3 per additional action).
 * Auto-tracks weapon fire, Aim, Dodge, and Parry; ➕ button for untracked actions.
 * Pre-fills extraMod in the attack dialog. Resets all counts on round end.
 */
function _hookMultiActionPenalty() {
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

      if (count > 0) {
        const badge = document.createElement("span");
        badge.classList.add("cp-action-count-badge");
        badge.style.cssText = "font-size:0.74em; padding:1px 4px; border-radius:3px; background:rgba(80,80,80,0.7); color:var(--color-text-light-primary,#ccc); margin-right:2px; line-height:1.6; pointer-events:none;";
        badge.title = `${count} action${count !== 1 ? "s" : ""} this round. Multi-action penalty: ${penalty || "none"}.`;
        badge.textContent = penalty < 0 ? `×${count} (${penalty})` : `×${count}`;
        controls.prepend(badge);
      }

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

  Hooks.on("cyberpunk2020.weaponFired", (payload) => {
    if (!_isMultiActionEnabled() || !_isMultiActionAutoTrack()) return;
    const actorId = payload.attackerId ?? payload.actorId;
    const actor = actorId ? game.actors.get(actorId) : null;
    if (!actor) return;
    _incrementActionCount(actor).catch(() => {});
  });

  Hooks.on("updateCombat", async (combat, updateData) => {
    if (!game.user.isGM || updateData.round === undefined) return;
    // Active GM only — consistent with the other per-turn handlers (idempotent flag clears).
    if (game.users.activeGM?.id !== game.user.id) return;
    for (const combatant of combat.combatants) {
      if (!combatant.actor) continue;
      if ((combatant.actor.getFlag?.("cyberpunk2020", "actionCount") ?? 0) > 0) {
        await combatant.actor.unsetFlag("cyberpunk2020", "actionCount").catch(() => {});
        await combatant.actor.unsetFlag("cyberpunk2020", "actionCountRound").catch(() => {});
      }
    }
  });
}

/**
 * Show a one-time first-run notice to the GM explaining new automation features
 * and which settings are active by default. Sets a world flag so it only fires once.
 */
function _hookAutomationMigrationNotice() {
  // Invoked from registerDamageHooks(), which already runs INSIDE the "ready" hook — so run the body
  // directly. Registering another Hooks.on("ready") here was too late to ever fire (Foundry does not
  // re-fire "ready" for listeners added during the ready emission); that is why this notice never appeared.
    if (!game.user.isGM) return;
    let shown = false;
    try { shown = game.settings.get("cyberpunk2020", "automationMigrationShown"); } catch { return; }
    if (shown) return;

    game.settings.set("cyberpunk2020", "automationMigrationShown", true).catch(() => {});

    const content = `
<div style="padding:8px 4px; font-size:0.9em; line-height:1.5;">
  <p style="margin:0 0 10px;">
    This world now has the <b>Cyberpunk 2020 combat automation system</b> available.
    To protect existing characters, all combat automation is <b>OFF by default</b> — enable only what
    your table wants in <b>Game Settings → Configure Settings → System</b>.
  </p>

  <div style="background:rgba(30,100,180,0.10); border:1px solid rgba(30,100,180,0.3); border-radius:4px; padding:8px 10px; margin-bottom:8px;">
    <p style="font-weight:bold; margin:0 0 6px;">⚙ Opt-in automation — all OFF by default; enable what you want</p>
    <table style="width:100%; border-collapse:collapse; font-size:0.87em;">
      <tr>
        <td style="padding:2px 10px 2px 0; white-space:nowrap; font-weight:bold;">Armor Ablation</td>
        <td style="padding:2px 0;">Armor SP decreases by 1 per penetrating hit. <em>Permanently modifies armor items.</em></td>
      </tr>
      <tr>
        <td style="padding:2px 10px 2px 0; white-space:nowrap; font-weight:bold;">Head Hit Doubling</td>
        <td style="padding:2px 0;">Net HP damage to the head is doubled after armor and BTM resolve.</td>
      </tr>
      <tr>
        <td style="padding:2px 10px 2px 0; white-space:nowrap; font-weight:bold;">Limb Loss</td>
        <td style="padding:2px 0;">More than 8 net damage to a limb triggers an immediate Death Save.</td>
      </tr>
      <tr>
        <td style="padding:2px 10px 2px 0; white-space:nowrap; font-weight:bold;">Death Save Each Turn</td>
        <td style="padding:2px 0;">Mortal characters are prompted automatically on their turn.</td>
      </tr>
      <tr>
        <td style="padding:2px 10px 2px 0; white-space:nowrap; font-weight:bold;">Stun Recovery</td>
        <td style="padding:2px 0;">Unconscious characters are prompted to recover each turn.</td>
      </tr>
      <tr>
        <td style="padding:2px 10px 2px 0; white-space:nowrap; font-weight:bold;">Multi-Action Penalty</td>
        <td style="padding:2px 0;">Each action beyond the first pre-fills &minus;3 in the attack modifier dialog.</td>
      </tr>
      <tr>
        <td style="padding:2px 10px 2px 0; white-space:nowrap; font-weight:bold;">Armor Layer EV</td>
        <td style="padding:2px 0;">Wearing 2+ armor pieces at the same location reduces REF.</td>
      </tr>
    </table>
  </div>

  <div style="background:rgba(30,100,180,0.10); border:1px solid rgba(30,100,180,0.3); border-radius:4px; padding:8px 10px;">
    <p style="font-weight:bold; margin:0 0 6px;">✦ New in this version</p>
    <div style="font-size:0.87em; columns:2; column-gap:16px;">
      <div style="margin-bottom:2px;">• Damage dialog with per-hit breakdown</div>
      <div style="margin-bottom:2px;">• Cover SP field in damage dialog</div>
      <div style="margin-bottom:2px;">• 🎯 Aim, ⏸ Wait, 🛡 Dodge, ⛨ Parry, ➕ Action buttons</div>
      <div style="margin-bottom:2px;">• Stun and death save prompts after damage</div>
      <div style="margin-bottom:2px;">• Melee Hold / Grapple / Choke tracking</div>
      <div style="margin-bottom:2px;">• Suppressive fire zone on canvas</div>
      <div style="margin-bottom:2px;">• Acid armor degradation (DOT)</div>
      <div style="margin-bottom:2px;">• Gas grenade cloud effects</div>
      <div style="margin-bottom:2px;">• Stabilization system</div>
      <div style="margin-bottom:2px;">• Canvas or list target selection</div>
    </div>
  </div>

  <p style="margin:8px 0 0; font-size:0.82em; color:var(--color-text-dark-inactive);">
    All settings: <b>Game Settings → Configure Settings → System</b>
  </p>
</div>`;

    new Dialog({
      title: "Combat Automation — First-Time Setup",
      content,
      buttons: {
        openSettings: {
          icon: '<i class="fas fa-cog"></i>',
          label: "Open System Settings",
          callback: () => {
            try {
              if (typeof SettingsConfig !== "undefined") {
                new SettingsConfig().render(true);
              } else {
                game.settings.sheet?.render(true);
              }
            } catch {
              ui.notifications.info("Open Game Settings → Configure Settings → System to review combat options.");
            }
          },
        },
        dismiss: {
          icon: '<i class="fas fa-check"></i>',
          label: "Got It",
          callback: () => {},
        },
      },
      default: "dismiss",
      render: (html) => {
        // Make the dialog wide enough for the two-column layout
        html.closest(".dialog").css("min-width", "480px");
      },
    }).render(true);
}

/**
 * Socket relay for player-initiated damage application.
 *
 * Players cannot call actor.update() on unowned NPCs. Instead they emit a
 * socket message; the GM's handler applies the damage with GM permissions,
 * then emits a result notification back to the requesting player.
 *
 * Two modes:
 *   "auto"     — player sends the raw payload; GM re-runs the full damage
 *                pipeline (applyAreaDamages + side effects).
 *   "resolved" — player pre-computed per-hit values in the damage dialog
 *                (armorMode override, cover SP, manual afterSP edits); GM
 *                applies the pre-resolved values directly.
 */
/**
 * Live sheet refresh across all clients.
 *
 * Damage and ablation writes pass { render: false } so applying several hits in a row
 * doesn't flicker the sheet, and the applying client re-renders once at the end. But the
 * { render: false } option propagates with the update to every client and suppresses their
 * automatic re-render too — so a player viewing the target's sheet (or the GM, when a player
 * applied damage through the socket relay) would not see the change until reopening the sheet.
 *
 * These hooks fire on every client regardless of the render option. They re-render the open
 * sheet wherever our damage system touched the actor. render(false) is a no-op on clients
 * where the sheet isn't open, so there's no cost or unexpected pop-ups.
 */
function _hookLiveSheetUpdate() {
  Hooks.on("updateActor", (actor, _changed, options) => {
    if (!options?.fromCyberpunkDamageSystem) return;
    actor.sheet?.render(false);
  });
  // Armor ablation edits embedded Item SP; refresh the owning actor's sheet too.
  Hooks.on("updateItem", (item, _changed, options) => {
    if (!options?.fromCyberpunkDamageSystem) return;
    item.actor?.sheet?.render(false);
  });
}

function _hookSocketRelay() {
  game.socket.on("system.cyberpunk2020", async (data) => {
    if (!game.user.isGM) {
      if (data.type === "damageApplied" && data.requesterId === game.user.id) {
        ui.notifications.info(`Applied ${data.totalApplied} damage to ${data.targetName}.`);
      } else if (data.type === "damageError" && data.requesterId === game.user.id) {
        ui.notifications.error(`Damage application failed: ${data.message ?? "Unknown error"}`);
      }
      return;
    }

    // Suppressive fire relayed from a player: only the active GM places the fire-zone template.
    if (data.type === "suppressiveFire") {
      if (game.users.activeGM?.id !== game.user.id) return;
      await _placeSuppressiveZone(data.payload);
      return;
    }

    if (data.type !== "applyDamage") return;

    // The socket fires on every connected GM client. Only the primary (active) GM
    // applies the damage, otherwise N connected GMs would each apply it N times.
    if (game.users.activeGM?.id !== game.user.id) return;

    const target = game.actors.get(data.targetActorId);
    if (!target) {
      console.warn("CP2020 | Socket applyDamage: target actor not found:", data.targetActorId);
      return;
    }

    let totalApplied = 0;

    try {
      if (data.mode === "auto") {
        const hits = await applyAreaDamages({
          target,
          areaDamages:   data.areaDamages,
          ap:            Boolean(data.ap),
          edged:         Boolean(data.edged),
          armorMultSoft: Number(data.armorMultSoft ?? 1.0),
          armorMultHard: Number(data.armorMultHard ?? 1.0),
          penDamageMult: Number(data.penDamageMult ?? 1.0),
          armorMode:     game.settings.get("cyberpunk2020", "damageArmorMode"),
          ablate:        game.settings.get("cyberpunk2020", "damageAblation"),
          dryRun:        false,
        });
        totalApplied = hits.reduce((s, h) => s + h.netDamage, 0);

        const taserEnabled = (() => { try { return game.settings.get("cyberpunk2020", "taserCumPenaltyEnabled"); } catch { return true; } })();
        if (taserEnabled && data.stunSaveOnHit && hits.some(h => h.penetrates)) {
          await updateTaserState(target, data);
        }

        // DOT routes by dotType (fire -> HP burn, acid -> armor degradation); see save-rolls.js.
        await applyDotFromPayload(target, hits[0]?.location ?? null, data, hits.some(h => h.penetrates));

        if (totalApplied > 0) {
          const liveTarget = game.actors.get(target.id) ?? target;
          const token = canvas?.tokens?.placeables?.find(t => t.actor?.id === liveTarget.id) ?? null;
          const woundState = liveTarget.woundState?.() ?? 0;
          if (woundState >= 4) await postDeathSavePrompt(liveTarget, token);
          else if (woundState > 0) await postStunSavePrompt(liveTarget, token);
        }

      } else if (data.mode === "resolved") {
        // Apply pre-computed per-hit values from the player's damage dialog
        let currentDamage = Number(target.system.damage) || 0;

        for (const hit of data.resolvedHits) {
          if (hit.netDamage > 0) {
            currentDamage += hit.netDamage;
            totalApplied  += hit.netDamage;
            await target.update(
              { "system.damage": currentDamage },
              { render: false, fromCyberpunkDamageSystem: true }
            );
            // New damage clears stabilization — death saves restart (CP2020 p.105)
            if (target.getFlag?.("cyberpunk2020", "stabilized")) {
              await target.unsetFlag("cyberpunk2020", "stabilized");
              await ChatMessage.create({
                content: `<div class="cyberpunk save-prompt">⚠ <b>${target.name}</b> was stabilized but has taken new damage — Death Saves are required again.</div>`,
                speaker: ChatMessage.getSpeaker({ actor: target }),
              });
            }
          }

          // Ablation gates on the bullet penetrating, not on the doubled HP value
          if (data.ablate && data.armorMode === ARMOR_MODES.FULL && hit.btmResult > 0) {
            await ablateLocationOnce(target, hit.location);
          }

          // Limb / head wound severity (CP2020 p.103 + optional Listen Up crippling) — centralized.
          if (hit.netDamage > 0) {
            const liveToken = canvas?.tokens?.placeables?.find(t => t.actor?.id === target.id) ?? null;
            await assessWoundSeverity(target, hit.location, hit.netDamage, { token: liveToken });
          }
        }

        await target.sheet?.render(false);

        const taserEnabled = (() => { try { return game.settings.get("cyberpunk2020", "taserCumPenaltyEnabled"); } catch { return true; } })();
        if (taserEnabled && data.stunSaveOnHit && data.resolvedHits.some(h => h.penetrates)) {
          await updateTaserState(target, data);
        }

        // DOT routes by dotType (fire -> HP burn, acid -> armor degradation); see save-rolls.js.
        await applyDotFromPayload(target, data.firstHitLocation ?? null, data, (data.resolvedHits ?? []).some(h => h.penetrates));

        if (totalApplied > 0) {
          const liveTarget = game.actors.get(target.id) ?? target;
          const token = canvas?.tokens?.placeables?.find(t => t.actor?.id === liveTarget.id) ?? null;
          const woundState = liveTarget.woundState?.() ?? 0;
          if (woundState >= 4) await postDeathSavePrompt(liveTarget, token);
          else if (woundState > 0) await postStunSavePrompt(liveTarget, token);
        }
      }

    } catch (err) {
      console.error("CP2020 | Socket applyDamage handler failed:", err);
      game.socket.emit("system.cyberpunk2020", {
        type:        "damageError",
        requesterId: data.requesterId,
        message:     err.message ?? "Unknown error",
      });
      return;
    }

    game.socket.emit("system.cyberpunk2020", {
      type:        "damageApplied",
      requesterId: data.requesterId,
      targetName:  target.name,
      totalApplied,
    });
  });
}

async function _autoApply(payload, target) {
  if (!game.user.isGM) {
    // Route through GM socket relay — player cannot write to unowned actor documents
    game.socket.emit("system.cyberpunk2020", {
      type:             "applyDamage",
      mode:             "auto",
      requesterId:      game.user.id,
      targetActorId:    target.id,
      targetTokenId:    payload.targetTokenId ?? null,
      areaDamages:      payload.areaDamages,
      ap:               Boolean(payload.ap),
      edged:            Boolean(payload.edged),
      armorMultSoft:    Number(payload.armorMultSoft   ?? 1.0),
      armorMultHard:    Number(payload.armorMultHard   ?? 1.0),
      penDamageMult:    Number(payload.penDamageMult   ?? 1.0),
      stunSaveOnHit:    Boolean(payload.stunSaveOnHit),
      stunSaveMod:      Number(payload.stunSaveMod     ?? 0),
      dotEnabled:       Boolean(payload.dotEnabled),
      dotTurns:         Number(payload.dotTurns        ?? 0),
      dotDamageFormula: String(payload.dotDamageFormula || "1d6"),
      dotType:          String(payload.dotType         || "acid"),
      weaponName:       String(payload.weaponName      || ""),
    });
    ui.notifications.info("Damage sent — waiting for GM to apply.");
    return;
  }

  const armorMode = game.settings.get("cyberpunk2020", "damageArmorMode");
  const ablate    = game.settings.get("cyberpunk2020", "damageAblation");

  const hits = await applyAreaDamages({
    target,
    areaDamages: payload.areaDamages,
    ap:            Boolean(payload.ap),
    edged:         Boolean(payload.edged),
    armorMultSoft: Number(payload.armorMultSoft ?? 1.0),
    armorMultHard: Number(payload.armorMultHard ?? 1.0),
    penDamageMult: Number(payload.penDamageMult ?? 1.0),
    armorMode,
    ablate,
    dryRun: false,
  });

  const total = hits.reduce((s, h) => s + h.netDamage, 0);
  ui.notifications.info(`Applied ${total} damage to ${target.name}.`);

  // Taser flag must be set BEFORE the save prompt — threshold reads it
  if (payload.stunSaveOnHit && hits.some(h => h.penetrates)) {
    const taserEnabled = (() => { try { return game.settings.get("cyberpunk2020", "taserCumPenaltyEnabled"); } catch { return true; } })();
    if (taserEnabled) await updateTaserState(target, payload);
  }

  // DOT routes by dotType (fire -> HP burn, acid -> armor degradation); see save-rolls.js.
  await applyDotFromPayload(target, hits[0]?.location ?? null, payload, hits.some(h => h.penetrates));

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
