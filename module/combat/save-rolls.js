/**
 * save-rolls.js  —  module/combat/save-rolls.js
 *
 * STUN/SHOCK SAVE (CP2020 p.99):
 *   Roll 1d10 ≤ Stun Threshold to stay conscious.
 *   Stun Threshold = Body Type − wound state penalty, min 1.
 *   Penalties: Light 0, Serious -1, Critical -2, Mortal 0 -3, Mortal 1 -4, ...
 *   Table only defined through Mortal 6 (-9 penalty) — original code caps at 7 Mortal levels.
 *   Fail = unconscious. Recover by passing Stun Save on a later turn.
 *
 * DEATH SAVE (CP2020 p.99):
 *   Only required at Mortal wound state (woundState ≥ 4).
 *   Roll 1d10 ≤ Death Threshold to survive this turn. (RAW: "equal to or lower than")
 *   Death Threshold = BT − mortalLevel. No floor — threshold 0 = automatic death.
 *   At threshold 0 (or below): no roll possible, automatic death.
 *   At threshold 1: roll ≤ 1 on d10 → 10% survival chance.
 *   Must repeat every turn while Mortal and unstabilized.
 *
 * BOTH SAVES AT MORTAL (p.99):
 *   At a Mortal wound state, the character must make BOTH saves:
 *   Death Save first (more urgent), then Stun Save.
 *   Death save determines survivability; stun save determines consciousness if alive.
 *
 * MORTAL WOUND SCALE:
 *   Stun save table only defines through Mortal 6 (penalty -9). Original code
 *   (actor-sheet.js Array(7)) caps the wound track at Mortal 6. The rulebook's
 *   "rated from 0 to 8" contradicts both the stun table and character sheet — cap at 6.
 *
 * STUN STATUS — MOVEMENT RESTRICTION:
 *   Foundry's "unconscious" effect can carry movement restriction.
 *   We apply a movement speed override of 0 to stunned tokens.
 */

/**
 * Cumulative taser save penalty: each successive hit within a 3-turn window
 * reduces stun threshold by stunSaveMod. Returns the total penalty (always ≥ 0).
 */
function _getTaserPenalty(actor) {
  const enabled = (() => {
    try { return game.settings.get("cyberpunk2020", "taserCumPenaltyEnabled"); }
    catch { return true; }
  })();
  if (!enabled) return 0;
  const state = actor.getFlag?.("cyberpunk2020", "taserState");
  if (!state || state.count <= 1) return 0;
  const currentRound = game?.combat?.round ?? 0;
  // Penalty expires outside the 3-turn window. round=0 means outside combat — always active.
  if (state.round > 0 && currentRound > state.round + 2) return 0;
  return (state.count - 1) * Math.abs(state.mod ?? 2);
}

/**
 * Apply an acid DOT hit, respecting the acidDotStackMode setting.
 * Modes: "stack" extends turnsLeft at same location, "reset" overwrites, "separate" adds concurrent timer.
 * Legacy single-object dotState is transparently migrated to array format on read.
 */
export async function applyAcidDotState(target, location, turnsLeft, formula) {
  const mode = (() => { try { return game.settings.get("cyberpunk2020", "acidDotStackMode"); } catch { return "stack"; } })();
  const newEntry = { location, turnsLeft: Number(turnsLeft), formula: String(formula || "1d6") };

  if (mode === "reset") {
    await target.setFlag("cyberpunk2020", "dotState", [newEntry]);
    return;
  }

  const raw = target.getFlag?.("cyberpunk2020", "dotState");
  const states = Array.isArray(raw) ? [...raw] : (raw ? [raw] : []);

  if (mode === "stack") {
    const idx = states.findIndex(s => s.location === location);
    if (idx >= 0) {
      states[idx] = { location, turnsLeft: states[idx].turnsLeft + Number(turnsLeft), formula: String(formula || "1d6") };
    } else {
      states.push(newEntry);
    }
  } else {
    // "separate": push a new independent timer regardless of existing effects at the location
    states.push(newEntry);
  }
  await target.setFlag("cyberpunk2020", "dotState", states);
}

/** Update taser hit counter on target. Call only when the hit penetrates armor. */
export async function updateTaserState(actor, payload) {
  const mod   = Number(payload.stunSaveMod ?? -2);
  const round = game?.combat?.round ?? 0;
  const state = actor.getFlag?.("cyberpunk2020", "taserState");
  const withinWindow = state && (state.round === 0 || (round > 0 && round <= state.round + 2));
  const count = withinWindow ? (state.count ?? 0) + 1 : 1;
  await actor.setFlag("cyberpunk2020", "taserState", { count, round, mod });
}

/**
 * Stun Threshold: roll ≤ this to stay conscious.
 * Floored at 1. Reduced by cumulative taser penalty.
 */
export function getStunThreshold(actor) {
  const base = actor.stunThreshold
    ? Math.max(1, actor.stunThreshold())
    : Math.max(1, (Number(actor.system?.stats?.bt?.total) || 0) - (actor.woundState?.() ?? 0) + 1);
  return Math.max(1, base - _getTaserPenalty(actor));
}

/**
 * Death Threshold: roll ≤ this to survive (RAW: "equal to or lower than", p.99).
 * BT − mortalLevel, floored at 0. Threshold 0 = automatic death (roll ≤ 0 on d10 is impossible).
 * Threshold 1 = 10% survival chance. mortalLevel capped at 6 (stun table defines no further).
 */
export function getDeathThreshold(actor) {
  const bt          = Number(actor.system?.stats?.bt?.total) || 0;
  const woundState  = actor.woundState?.() ?? 4;
  const mortalLevel = Math.min(6, Math.max(0, woundState - 4));
  return Math.max(0, bt - mortalLevel);
}

function getWoundStateLabel(woundState) {
  const labels = [
    "Uninjured", "Light", "Serious", "Critical",
    "Mortal 0", "Mortal 1", "Mortal 2", "Mortal 3",
    "Mortal 4", "Mortal 5", "Mortal 6",
  ];
  return labels[Math.min(woundState, 10)] ?? `Mortal ${woundState - 4}`;
}

function getTokenId(actor) {
  return canvas?.tokens?.placeables?.find(t => t.actor?.id === actor.id)?.id ?? "";
}

export async function postStunSavePrompt(actor, token = null) {
  const woundState   = actor.woundState?.() ?? 1;
  const threshold    = getStunThreshold(actor);
  const bt           = Number(actor.system?.stats?.bt?.total) || 0;
  const penalty      = woundState > 1 ? woundState - 1 : 0;
  const taserPenalty = _getTaserPenalty(actor);
  const tokenId      = token?.id ?? getTokenId(actor);
  const sceneId      = token?.scene?.id ?? canvas?.scene?.id ?? "";

  const taserLine = taserPenalty > 0
    ? `<br><span style="color:#ff8800;"><b>⚡ Taser ×${actor.getFlag?.("cyberpunk2020", "taserState")?.count ?? 1} (−${taserPenalty} cumulative)</b></span>`
    : "";

  const content = `
<div class="cyberpunk save-prompt stun-save-prompt">
  <h3>⚡ Stun / Shock Save — ${actor.name}</h3>
  <div class="save-info">
    <span><b>Wound State:</b> ${getWoundStateLabel(woundState)}</span><br>
    <span><b>BT ${bt}${penalty > 0 ? ` − ${penalty} (wound penalty)` : ""}${taserPenalty > 0 ? ` − ${taserPenalty} (taser)` : ""} = ${threshold}</b>${threshold < 1 ? " → floored to 1" : ""}</span>${taserLine}<br>
    <span>Must roll <b>≤ ${threshold}</b> on 1d10 to stay conscious</span>
  </div>
  <div class="save-buttons" style="margin-top:6px;">
    <button class="cp-stun-save-roll"
      data-actor-id="${actor.id}"
      data-token-id="${tokenId}"
      data-scene-id="${sceneId}">
      🎲 Roll Stun Save (≤ ${threshold})
    </button>
  </div>
</div>`;

  await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ actor, token }),
  });
}

/**
 * Post death save prompt to chat.
 * @param {Actor}      actor
 * @param {Token|null} token
 * @param {number|null} forcedMortalLevel  Override the mortal level for this save (e.g. limb loss forces Mortal 0).
 */
export async function postDeathSavePrompt(actor, token = null, forcedMortalLevel = null) {
  const woundState  = actor.woundState?.() ?? 4;
  const bt          = Number(actor.system?.stats?.bt?.total) || 0;
  const mortalLevel = (forcedMortalLevel !== null)
    ? Math.min(6, Math.max(0, forcedMortalLevel))
    : Math.min(6, Math.max(0, woundState - 4));
  const threshold   = Math.max(0, bt - mortalLevel);   // floored at 0
  const tokenId     = token?.id ?? getTokenId(actor);
  const sceneId     = token?.scene?.id ?? canvas?.scene?.id ?? "";
  const isAutoDeath = threshold < 1;              // threshold 0 = no roll possible

  const content = `
<div class="cyberpunk save-prompt death-save-prompt">
  <h3>☠ Death Save — ${actor.name}</h3>
  <div class="save-info">
    <span><b>Wound State:</b> Mortal ${mortalLevel}</span><br>
    <span><b>BT ${bt} − Mortal ${mortalLevel} = ${threshold}</b>${isAutoDeath ? " → automatic death" : ""}</span><br>
    ${isAutoDeath
      ? `<span style="color:red;"><b>⚠ Automatic death</b> — threshold is 0, no roll can succeed.</span>`
      : `<span>Must roll <b>≤ ${threshold}</b> on 1d10 to survive this turn</span>`
    }
  </div>
  <div class="save-buttons" style="margin-top:6px;">
    ${isAutoDeath
      ? `<div style="margin-top:4px; font-size:0.85em; color:red;">Call Trauma Team immediately.</div>`
      : `<button class="cp-death-save-roll"
          data-actor-id="${actor.id}"
          data-token-id="${tokenId}"
          data-scene-id="${sceneId}"
          data-mortal-level="${mortalLevel}">
          🎲 Roll Death Save (≤ ${threshold})
        </button>`
    }
  </div>
</div>`;

  await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ actor, token }),
  });
}

/**
 * Post appropriate saves based on wound state.
 * At Mortal: Death Save first (unless stabilized), then Stun Save.
 * Below Mortal: Stun Save only.
 * Uninjured: nothing.
 *
 * @param {Actor}      actor
 * @param {Token|null} token
 */
export async function postSavePrompts(actor, token = null) {
  // Refresh the actor from the collection to get the latest damage value
  const liveActor = game.actors.get(actor.id) ?? actor;
  const woundState = liveActor.woundState?.() ?? 0;
  if (woundState === 0) return;

  const liveToken = token ?? canvas?.tokens?.placeables?.find(t => t.actor?.id === liveActor.id) ?? null;

  if (woundState >= 4) {
    // Death Save before Stun Save at Mortal (p.99: both required, death is more urgent)
    const isStabilized = liveActor.getFlag?.("cyberpunk2020", "stabilized");
    if (!isStabilized) {
      await postDeathSavePrompt(liveActor, liveToken);
    }
    await postStunSavePrompt(liveActor, liveToken);
  } else {
    await postStunSavePrompt(liveActor, liveToken);
  }
}

export async function executeStunSave({ actorId, tokenId, sceneId }) {
  const actor = game.actors.get(actorId);
  if (!actor) return;

  const threshold = getStunThreshold(actor);
  const roll      = await new Roll("1d10").evaluate();
  const result    = roll.total;
  const success   = result <= threshold;
  const woundLabel = getWoundStateLabel(actor.woundState?.() ?? 1);

  const resultHtml = success
    ? `<span style="color:green;font-weight:bold;">✅ SUCCESS (rolled ${result} ≤ ${threshold})</span> — ${actor.name} stays in the fight.`
    : `<span style="color:red;font-weight:bold;">❌ FAILED (rolled ${result} > ${threshold})</span> — ${actor.name} is <b>stunned/unconscious</b>.`;

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor:  `Stun Save — ${woundLabel} — need ≤ ${threshold}`,
    content: `
<div class="cyberpunk save-result stun-save-result">
  <h3>⚡ Stun Save — ${actor.name}</h3>
  <div>${woundLabel} | Roll: <b>${result}</b> vs threshold <b>${threshold}</b></div>
  <div style="margin-top:4px;">${resultHtml}</div>
  ${!success ? `<div style="margin-top:4px; font-size:0.85em; color:var(--color-text-dark-inactive);">Can recover by rolling a successful Stun Save on a subsequent turn.</div>` : ""}
</div>`,
  });

  if (!success) {
    await _applyStatusEffect(actorId, tokenId, sceneId, "unconscious", true);
  }
}

export async function executeDeathSave({ actorId, tokenId, sceneId, mortalLevel }) {
  const actor = game.actors.get(actorId);
  if (!actor) return;

  const threshold = getDeathThreshold(actor);   // floored at 0
  mortalLevel     = Math.min(6, Math.max(0, (actor.woundState?.() ?? 4) - 4));

  // Threshold 0 = auto-death (roll ≤ 0 on d10 is impossible)
  if (threshold < 1) {
    await ChatMessage.create({
      content: `<div class="cyberpunk save-result death-save-result">
        <h3>☠ Death Save — ${actor.name}</h3>
        <div><span style="color:red;font-weight:bold;">☠ AUTOMATIC DEATH</span> — Death Save threshold is 0 (roll ≤ 0 on 1d10 is impossible). ${actor.name} dies.</div>
      </div>`,
      speaker: ChatMessage.getSpeaker({ actor }),
    });
    await _applyStatusEffect(actorId, tokenId, sceneId, "dead", false);
    return;
  }

  const roll    = await new Roll("1d10").evaluate();
  const result  = roll.total;
  // RAW: "equal to or lower than" — roll ≤ threshold to survive
  const success = result <= threshold;

  const resultHtml = success
    ? `<span style="color:green;font-weight:bold;">✅ SURVIVED (rolled ${result} ≤ ${threshold})</span> — ${actor.name} clings to life. Another save required next turn.`
    : `<span style="color:red;font-weight:bold;">☠ DIED (rolled ${result} > ${threshold})</span> — ${actor.name} dies at end of this turn. Call Trauma Team.`;

  const stabilizeHtml = success ? `
    <div style="margin-top:6px; border-top:1px solid var(--color-border-dark-tertiary); padding-top:4px; font-size:0.85em;">
      <span style="opacity:0.8;">Stabilize: TECH + Medical + 1d10 ≥ total damage (${Number(actor.system?.damage) || 0} pts)</span>
      <button class="cp-stabilize-roll" style="margin-top:4px;"
        data-actor-id="${actorId}"
        data-token-id="${tokenId}"
        data-scene-id="${sceneId}">
        💉 Attempt Stabilization
      </button>
    </div>` : "";

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor:  `Death Save — Mortal ${mortalLevel} — need ≤ ${threshold}`,
    content: `
<div class="cyberpunk save-result death-save-result">
  <h3>☠ Death Save — ${actor.name}</h3>
  <div>Mortal ${mortalLevel} | Roll: <b>${result}</b> vs threshold <b>${threshold}</b></div>
  <div style="margin-top:4px;">${resultHtml}</div>
  ${stabilizeHtml}
</div>`,
  });

  if (!success) {
    await _applyStatusEffect(actorId, tokenId, sceneId, "dead", false);
  }
}

/**
 * Stabilization dialog and roll (CP2020 p.105).
 * TECH + Medical Skill + 1d10 ≥ total damage taken.
 * Bonuses: Hospital +5, Trauma Team +3, Life Suspension Tank +3.
 * Success: no more Death Saves until new damage is received.
 * Anyone except the patient may attempt — not enforced by the system.
 */
export async function executeStabilize({ actorId }) {
  const actor = game.actors.get(actorId);
  if (!actor) return;

  const totalDamage = Number(actor.system?.damage) || 0;
  const techVal     = Number(actor.system?.stats?.tech?.total) || 0;
  const medSkill    = actor.getSkillVal?.("MedicalTech") ?? 0;

  const dialogContent = `
<div style="padding:4px;">
  <p style="margin:0 0 8px;">TECH + Medical Skill + 1d10 must equal or exceed <b>${totalDamage}</b> total damage.</p>
  <div style="display:flex; flex-direction:column; gap:6px;">
    <label>TECH stat
      <input type="number" id="cp-stab-tech" value="${techVal}" style="width:60px; margin-left:8px;">
    </label>
    <label>Medical Skill (Medical Tech or First Aid)
      <input type="number" id="cp-stab-med" value="${medSkill}" style="width:60px; margin-left:8px;">
    </label>
    <label>Facility Bonus
      <select id="cp-stab-facility" style="margin-left:8px;">
        <option value="0">None</option>
        <option value="3">Trauma Team (+3)</option>
        <option value="5">Full Hospital &amp; Surgery (+5)</option>
        <option value="3" id="life-tank">Life Suspension Tank (+3)</option>
      </select>
    </label>
  </div>
</div>`;

  new Dialog({
    title: `Stabilize — ${actor.name}`,
    content: dialogContent,
    buttons: {
      roll: {
        label: "💉 Roll Stabilization",
        callback: async (html) => {
          const tech     = Number(html.find("#cp-stab-tech").val())     || 0;
          const med      = Number(html.find("#cp-stab-med").val())      || 0;
          const facility = Number(html.find("#cp-stab-facility").val()) || 0;

          const roll   = await new Roll("1d10").evaluate();
          const result = roll.total;
          const total  = tech + med + facility + result;
          const success = total >= totalDamage;

          const resultMsg = success
            ? `<span style="color:green;font-weight:bold;">✅ STABILIZED</span> — Roll total: <b>${tech}+${med}${facility > 0 ? `+${facility}` : ""}+${result} = ${total}</b> ≥ ${totalDamage}. No further Death Saves required.`
            : `<span style="color:red;font-weight:bold;">❌ FAILED</span> — Roll total: <b>${tech}+${med}${facility > 0 ? `+${facility}` : ""}+${result} = ${total}</b> < ${totalDamage}. Death Saves continue next turn.`;

          await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor:  `Stabilization — ${actor.name}`,
            content: `
<div class="cyberpunk save-result">
  <h3>💉 Stabilization — ${actor.name}</h3>
  <div>Target: ≥ ${totalDamage} | TECH ${tech} + Medical ${med}${facility > 0 ? ` + Facility ${facility}` : ""} + Roll ${result} = <b>${total}</b></div>
  <div style="margin-top:4px;">${resultMsg}</div>
  ${success ? `<div style="margin-top:4px; font-size:0.85em; opacity:0.7;">If new damage is taken, stabilization is lost and Death Saves restart.</div>` : ""}
</div>`,
          });

          if (success) {
            await actor.setFlag("cyberpunk2020", "stabilized", true);
          }
        },
      },
      cancel: { label: "Cancel" },
    },
    default: "roll",
  }).render(true);
}

async function _applyStatusEffect(actorId, tokenId, sceneId, statusId, restrictMovement) {
  try {
    let tokenDoc = null;
    if (tokenId && sceneId) {
      tokenDoc = game.scenes.get(sceneId)?.tokens?.get(tokenId) ?? null;
    }
    if (!tokenDoc) {
      tokenDoc = canvas?.tokens?.placeables
        ?.find(t => t.actor?.id === actorId)?.document ?? null;
    }
    if (!tokenDoc) return;

    const effect = CONFIG.statusEffects.find(e => e.id === statusId);
    if (effect) {
      await tokenDoc.toggleActiveEffect(effect, { active: true });
    }

    if (restrictMovement && statusId === "unconscious") {
      const currentSpeed = tokenDoc.actor?.system?.movement?.walk
        ?? tokenDoc.actor?.system?.ma?.total
        ?? null;
      if (currentSpeed !== null) {
        await tokenDoc.actor?.setFlag("cyberpunk2020", "preStunMovement", currentSpeed);
      }
      // Foundry v13+: direct TokenDocument movement update
      await tokenDoc.update({ "movement.walk": 0 }).catch(() => {
        // Older versions may not support this; status overlay still applies
      });
    }
  } catch (err) {
    console.warn("cyberpunk2020 | Could not apply status effect:", statusId, err);
  }
}

export function registerSaveRollHandlers() {
  document.addEventListener("click", async (ev) => {
    const stunBtn      = ev.target.closest(".cp-stun-save-roll");
    const deathBtn     = ev.target.closest(".cp-death-save-roll");
    const stabilizeBtn = ev.target.closest(".cp-stabilize-roll");

    if (stunBtn && !stunBtn.disabled) {
      ev.preventDefault();
      await executeStunSave({
        actorId: stunBtn.dataset.actorId,
        tokenId: stunBtn.dataset.tokenId,
        sceneId: stunBtn.dataset.sceneId,
      });
    }

    if (deathBtn && !deathBtn.disabled) {
      ev.preventDefault();
      await executeDeathSave({
        actorId:     deathBtn.dataset.actorId,
        tokenId:     deathBtn.dataset.tokenId,
        sceneId:     deathBtn.dataset.sceneId,
        mortalLevel: Number(deathBtn.dataset.mortalLevel),
      });
    }

    if (stabilizeBtn && !stabilizeBtn.disabled) {
      ev.preventDefault();
      await executeStabilize({
        actorId: stabilizeBtn.dataset.actorId,
      });
    }
  });

  // Only GM processes this — avoids duplicate prompts on each connected client
  Hooks.on("updateCombat", async (combat, updateData) => {
    if (!game.user.isGM) return;
    // Only fire on turn/round change, not on other combat updates
    if (updateData.turn === undefined && updateData.round === undefined) return;

    // combat.combatant is the NEW active combatant after the turn/round update
    const combatant = combat.combatant;
    if (!combatant) return;

    const actor = combatant.actor;
    if (!actor) return;

    const woundState = actor.woundState?.() ?? 0;
    if (woundState === 0) return;

    const token = canvas?.tokens?.placeables?.find(t => t.id === combatant.tokenId) ?? null;

    // Death Save each turn (CP2020 p.105): Mortal + unstabilized
    const deathPerTurn = (() => {
      try { return game.settings.get("cyberpunk2020", "autoDeathSavePerTurn"); }
      catch { return true; }
    })();
    if (deathPerTurn && woundState >= 4) {
      const isStabilized = actor.getFlag?.("cyberpunk2020", "stabilized");
      if (!isStabilized) {
        await postDeathSavePrompt(actor, token);
      }
    }

    // Stun Save recovery (CP2020 p.104): unconscious characters re-roll each turn
    const stunRecovery = (() => {
      try { return game.settings.get("cyberpunk2020", "autoSaveRePrompt"); }
      catch { return true; }
    })();
    if (stunRecovery) {
      const isUnconscious = actor.statuses?.has("unconscious") ?? false;  // Set<string> in Foundry v11+
      if (isUnconscious) {
        await postStunSavePrompt(actor, token);
      }
    }
  });
}
