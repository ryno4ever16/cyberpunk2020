/**
 * save-rolls.js  —  module/combat/save-rolls.js
 *
 * STUN/SHOCK SAVE (CP2020 p.99):
 *   Roll 1d10 ≤ Stun Threshold to stay conscious.
 *   Stun Threshold = Body Type − wound state penalty, min 1.
 *   Penalties: Light 0, Serious -1, Critical -2, Mortal -3, Mortal1 -4, ...
 *   Fail = unconscious. Recover by passing Stun Save on a later turn.
 *
 * DEATH SAVE (CP2020 p.99):
 *   Only required at Mortal wound state (woundState ≥ 4).
 *   Roll 1d10 < Death Threshold to survive this turn.
 *   Death Threshold = BT − mortalLevel (min 1 per general floor rule p.xx).
 *   "lower than (BT - mortalLevel)": strictly less than.
 *   At threshold 1 → need to roll < 1 → automatic death (impossible roll).
 *   Must repeat every turn while Mortal and unstabilized.
 *
 * BOTH SAVES AT MORTAL (p.99):
 *   At a Mortal wound state, the character must make BOTH saves:
 *   Death Save first (more urgent), then Stun Save.
 *   "You can't be stunned if you are dead" — death save determines survivability,
 *   stun save determines consciousness for that turn if they survive.
 *
 * GENERAL FLOOR RULE (CP2020 p.xx, general stats rule):
 *   "if the modified value comes out equal to or below zero, it is automatically
 *    equal to 1 unless otherwise specified."
 *
 * STUN STATUS — MOVEMENT RESTRICTION:
 *   Foundry's "unconscious" effect can carry movement restriction.
 *   We apply a movement speed override of 0 to stunned tokens.
 */

// ── Threshold calculations ─────────────────────────────────────────────────

/**
 * Stun Threshold: roll ≤ this to succeed.
 * Floored at 1 per general CP2020 floor rule.
 */
export function getStunThreshold(actor) {
  if (actor.stunThreshold) {
    return Math.max(1, actor.stunThreshold());
  }
  const bt         = Number(actor.system?.stats?.bt?.total) || 0;
  const woundState = actor.woundState?.() ?? 0;
  return Math.max(1, bt - woundState + 1);
}

/**
 * Death Threshold: roll < this to survive.
 * BT - mortalLevel. Floored at 1 (threshold 1 = automatic death, see header).
 */
export function getDeathThreshold(actor) {
  const bt         = Number(actor.system?.stats?.bt?.total) || 0;
  const woundState = actor.woundState?.() ?? 4;
  const mortalLevel = Math.max(0, woundState - 4);
  return Math.max(1, bt - mortalLevel);
}

// ── Chat prompt helpers ────────────────────────────────────────────────────

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

/**
 * Post stun save prompt to chat.
 */
export async function postStunSavePrompt(actor, token = null) {
  const woundState = actor.woundState?.() ?? 1;
  const threshold  = getStunThreshold(actor);
  const bt         = Number(actor.system?.stats?.bt?.total) || 0;
  const penalty    = woundState > 1 ? woundState - 1 : 0;
  const tokenId    = token?.id ?? getTokenId(actor);
  const sceneId    = token?.scene?.id ?? canvas?.scene?.id ?? "";

  const content = `
<div class="cyberpunk save-prompt stun-save-prompt">
  <h3>⚡ Stun / Shock Save — ${actor.name}</h3>
  <div class="save-info">
    <span><b>Wound State:</b> ${getWoundStateLabel(woundState)}</span><br>
    <span><b>BT ${bt}${penalty > 0 ? ` − ${penalty} (wound penalty)` : ""} = ${bt - woundState + 1}</b>${bt - woundState + 1 < 1 ? " → floored to 1" : ""}</span><br>
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
 */
export async function postDeathSavePrompt(actor, token = null) {
  const woundState  = actor.woundState?.() ?? 4;
  const threshold   = getDeathThreshold(actor);
  const bt          = Number(actor.system?.stats?.bt?.total) || 0;
  const mortalLevel = Math.max(0, woundState - 4);
  const tokenId     = token?.id ?? getTokenId(actor);
  const sceneId     = token?.scene?.id ?? canvas?.scene?.id ?? "";

  const autoDeathNote = threshold <= 1
    ? `<br><span style="color:red;"><b>⚠ Automatic death</b> — threshold ≤ 1, no roll can succeed.</span>`
    : "";

  const content = `
<div class="cyberpunk save-prompt death-save-prompt">
  <h3>☠ Death Save — ${actor.name}</h3>
  <div class="save-info">
    <span><b>Wound State:</b> Mortal ${mortalLevel}</span><br>
    <span><b>BT ${bt} − Mortal ${mortalLevel} = ${bt - mortalLevel}</b>${bt - mortalLevel < 1 ? " → floored to 1" : ""}</span><br>
    <span>Must roll <b>&lt; ${threshold}</b> on 1d10 to survive this turn</span>
    ${autoDeathNote}
  </div>
  <div class="save-buttons" style="margin-top:6px;">
    <button class="cp-death-save-roll"
      data-actor-id="${actor.id}"
      data-token-id="${tokenId}"
      data-scene-id="${sceneId}"
      data-mortal-level="${mortalLevel}"
      ${threshold <= 1 ? "disabled" : ""}>
      🎲 Roll Death Save (&lt; ${threshold})
    </button>
    ${threshold <= 1 ? `<div style="margin-top:4px; font-size:0.85em;">Call Trauma Team immediately.</div>` : ""}
  </div>
</div>`;

  await ChatMessage.create({
    content,
    speaker: ChatMessage.getSpeaker({ actor, token }),
  });
}

/**
 * Post appropriate saves based on wound state.
 * At Mortal: Death Save first, then Stun Save.
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
    // Mortal: Death Save first (most urgent), then Stun Save
    await postDeathSavePrompt(liveActor, liveToken);
    await postStunSavePrompt(liveActor, liveToken);
  } else {
    // Light / Serious / Critical: Stun Save only
    await postStunSavePrompt(liveActor, liveToken);
  }
}

// ── Roll execution ─────────────────────────────────────────────────────────

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

  const threshold = getDeathThreshold(actor);
  mortalLevel     = Math.max(0, (actor.woundState?.() ?? 4) - 4);

  // Threshold ≤ 1 means auto-death (must roll < 1, impossible on d10)
  if (threshold <= 1) {
    await ChatMessage.create({
      content: `<div class="cyberpunk save-result death-save-result">
        <h3>☠ Death Save — ${actor.name}</h3>
        <div><span style="color:red;font-weight:bold;">☠ AUTOMATIC DEATH</span> — Death Save threshold is ${threshold} (must roll &lt; ${threshold} on 1d10, which is impossible). ${actor.name} dies.</div>
      </div>`,
      speaker: ChatMessage.getSpeaker({ actor }),
    });
    await _applyStatusEffect(actorId, tokenId, sceneId, "dead", false);
    return;
  }

  const roll    = await new Roll("1d10").evaluate();
  const result  = roll.total;
  // Strictly less than: must roll BELOW threshold
  const success = result < threshold;

  const resultHtml = success
    ? `<span style="color:green;font-weight:bold;">✅ SURVIVED (rolled ${result} &lt; ${threshold})</span> — ${actor.name} clings to life. Another save required next turn.`
    : `<span style="color:red;font-weight:bold;">☠ DIED (rolled ${result} ≥ ${threshold})</span> — ${actor.name} dies at end of this turn. Call Trauma Team.`;

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor:  `Death Save — Mortal ${mortalLevel} — need < ${threshold}`,
    content: `
<div class="cyberpunk save-result death-save-result">
  <h3>☠ Death Save — ${actor.name}</h3>
  <div>Mortal ${mortalLevel} | Roll: <b>${result}</b> vs threshold <b>${threshold}</b></div>
  <div style="margin-top:4px;">${resultHtml}</div>
  ${success ? `<div style="margin-top:4px; font-size:0.85em; color:var(--color-text-dark-inactive);">Stabilize with TECH + Medical + 1d10 ≥ total damage taken.</div>` : ""}
</div>`,
  });

  if (!success) {
    await _applyStatusEffect(actorId, tokenId, sceneId, "dead", false);
  }
}

// ── Status effect application ──────────────────────────────────────────────

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

    // Restrict movement for stunned/unconscious characters
    if (restrictMovement && statusId === "unconscious") {
      // Store the previous movement speed and set to 0
      const currentSpeed = tokenDoc.actor?.system?.movement?.walk
        ?? tokenDoc.actor?.system?.ma?.total
        ?? null;
      if (currentSpeed !== null) {
        await tokenDoc.actor?.setFlag("cyberpunk2020", "preStunMovement", currentSpeed);
      }
      // Override token movement to 0 via active effect or direct update
      // Foundry v13: use ATL or direct token document update
      await tokenDoc.update({ "movement.walk": 0 }).catch(() => {
        // Fallback: some versions don't support movement on TokenDocument directly
        // The unconscious status effect overlay is still applied
      });
    }
  } catch (err) {
    console.warn("cyberpunk2020 | Could not apply status effect:", statusId, err);
  }
}

// ── Event registration ─────────────────────────────────────────────────────

export function registerSaveRollHandlers() {
  document.addEventListener("click", async (ev) => {
    const stunBtn  = ev.target.closest(".cp-stun-save-roll");
    const deathBtn = ev.target.closest(".cp-death-save-roll");

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
  });
}
