/**
 * vehicle-targeting.js — Phase 5c: the unified targeting spine.
 *
 * One dispatcher keyed on (source scale × target type) routes every attack to the right resolver:
 *   personnel-dmg → character  : the existing personnel DamageDialog pipeline (handled upstream)
 *   personnel-dmg → vehicle     : Penetration-Factor conversion → vehicle resolver (MM p.4)
 *   Penetration   → vehicle     : Penetration vs Armor Value → vehicle resolver (MM p.6)
 *   Penetration   → character   : Maximum Metal p.8 "Personnel vs Anti-Vehicle Weapons" (NEW)
 *
 * Facing is diegetic: derived from the tokens' geometry + elevation (MM flank rules, p.6), with a
 * manual dropdown override. The math is split into PURE, unit-testable functions; thin wrappers
 * read the tokens / roll the dice / apply to actors.
 */

import { applyAreaDamages, ablateLocationByAmount, personnelArmorValue, ARMOR_MODES } from "../combat/DamageApplicator.js";
import { rollLocation } from "../utils.js";

const SCOPE = "cyberpunk2020";

/* ----------------------------- Diegetic facing (MM p.6) ----------------------------- */

const DEG = 180 / Math.PI;

/**
 * Which facing of the target is struck, from the geometry of the shot. PURE.
 *   dx,dy = vector from the TARGET to the ATTACKER (screen coords; +y is down, as on the canvas).
 *   dz    = attacker elevation − target elevation.
 *   rotationDeg = the target token's rotation (Foundry convention: 0° faces "up"/north, clockwise).
 *
 * Elevation is checked first: a steep shot (|dz| greater than the horizontal distance, i.e. coming
 * from more than 45° above/below) hits the top or bottom. Otherwise the horizontal arc decides:
 * Front within ±45° of the target's facing, Rear beyond ±135°, Side in between.
 * @returns {"front"|"side"|"rear"|"top"|"bottom"}
 */
export function computeFacing({ dx = 0, dy = 0, dz = 0, rotationDeg = 0 } = {}) {
  const horiz = Math.hypot(dx, dy);
  if (Math.abs(dz) > horiz && Math.abs(dz) > 0) return dz > 0 ? "top" : "bottom";
  if (horiz === 0) return "front";
  // Target's facing unit vector (rotation 0 = up = (0,-1), clockwise).
  const r = rotationDeg / DEG;
  const fx = Math.sin(r), fy = -Math.cos(r);
  // Angle between the facing vector and the direction to the attacker.
  const dot = (fx * dx + fy * dy) / horiz;             // |facing| = 1
  const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * DEG;
  if (angle <= 45) return "front";
  if (angle >= 135) return "rear";
  return "side";
}

/** Read two tokens and return the struck facing of the target. Falls back to "front". */
export function detectFacingFromTokens(attackerToken, targetToken) {
  if (!attackerToken || !targetToken) return "front";
  const ac = attackerToken.center ?? { x: attackerToken.x, y: attackerToken.y };
  const tc = targetToken.center ?? { x: targetToken.x, y: targetToken.y };
  const aElev = Number(attackerToken.document?.elevation ?? attackerToken.elevation) || 0;
  const tElev = Number(targetToken.document?.elevation ?? targetToken.elevation) || 0;
  return computeFacing({
    dx: ac.x - tc.x, dy: ac.y - tc.y, dz: aElev - tElev,
    rotationDeg: Number(targetToken.document?.rotation ?? targetToken.rotation) || 0
  });
}

/** Resolve a facing for a payload: explicit override wins, else detect from the attacker's token. */
export function resolveFacing(payload, targetActor) {
  if (payload?.facing) return payload.facing;
  const attackerTok = payload?.attackerTokenId ? canvas?.tokens?.get(payload.attackerTokenId) : null;
  const targetTok = payload?.targetTokenId
    ? canvas?.tokens?.get(payload.targetTokenId)
    : (targetActor ? canvas?.tokens?.placeables?.find(t => t.actor?.id === targetActor.id) : null);
  if (attackerTok && targetTok) return detectFacingFromTokens(attackerTok, targetTok);
  return "front";
}

/* --------------------- MM p.8: Penetration weapon vs a PERSON --------------------- */

/**
 * Resolve a Penetration-rated hit against a personnel target (MM p.8). PURE — pass the rolled
 * LUCK total and the victim's Armor Value.
 *   1. LUCK save 1d10+LUCK ≥ 15  → "grazed": 5D6 to a random location, armor at HALF SP.
 *   2. Fail → Pen − AV:  ≤0 → "stopped": 2D6 impact + strip 10×Pen SP of armor;
 *                        ≥1 → "penetrated": (Pen−AV)×10 damage, armor destroyed.
 */
export function resolvePenVsPerson({ pen = 0, av = 0, luckTotal = 0, luckDC = 15 } = {}) {
  const P = Math.max(0, Number(pen) || 0);
  if ((Number(luckTotal) || 0) >= luckDC) {
    return { outcome: "grazed", damageFormula: "5d6", armorMult: 0.5 };
  }
  const diff = P - (Number(av) || 0);
  if (diff <= 0) {
    return { outcome: "stopped", diff, damageFormula: "2d6", spStripped: 10 * P };
  }
  return { outcome: "penetrated", diff, damage: diff * 10, armorDestroyed: true };
}

/** Post the LUCK-save prompt for a Penetration weapon striking a person (MM p.8 step 2). */
export async function postLuckSavePrompt(targetActor, payload = {}) {
  if (!targetActor) return;
  const pen = Number(payload.penetration ?? payload.pen) || 0;
  const luck = Number(targetActor.system?.stats?.luck?.total) || 0;
  const tok = payload.targetTokenId ? canvas?.tokens?.get(payload.targetTokenId) : null;
  const weaponName = payload.weaponName || "anti-vehicle weapon";

  const content = `
<div class="cyberpunk save-prompt">
  <h3>🎯 ${targetActor.name} — Anti-Vehicle Hit (${weaponName})</h3>
  <div class="save-info">
    <span>Struck by a Penetration <b>${pen}</b> weapon. Roll <b>LUCK + 1d10 vs 15</b> (MM p.8).</span><br>
    <span style="opacity:0.75;font-size:0.85em;">Success = grazed (5D6, half armor). Failure = Penetration vs your Armor Value. LUCK ${luck}.</span>
  </div>
  <div class="save-buttons" style="margin-top:6px;">
    <button class="cp-luck-save-roll"
      data-actor-id="${targetActor.id}"
      data-token-id="${tok?.id ?? payload.targetTokenId ?? ""}"
      data-pen="${pen}"
      data-weapon="${weaponName}">
      🎲 Roll LUCK Save (LUCK ${luck} + 1d10 vs 15)
    </button>
  </div>
</div>`;
  await ChatMessage.create({ content, speaker: ChatMessage.getSpeaker({ actor: targetActor }) });
}

/** Execute the LUCK save + apply the p.8 result. Called by the chat-button handler. */
async function _executeLuckSave({ actorId, tokenId, pen, weaponName }) {
  const actor = game.actors.get(actorId);
  if (!actor) return;
  const luck = Number(actor.system?.stats?.luck?.total) || 0;
  const roll = await new Roll("1d10 + @luck", { luck }).evaluate();
  const av = personnelArmorValue(actor);
  const res = resolvePenVsPerson({ pen, av, luckTotal: roll.total });

  const loc = (await rollLocation(actor, null))?.areaHit ?? "Torso";
  let detail = "";

  if (res.outcome === "grazed") {
    const dmg = await new Roll(res.damageFormula).evaluate();
    await applyAreaDamages({
      target: actor, areaDamages: { [loc]: [{ damage: dmg.total }] },
      armorMultSoft: res.armorMult, armorMultHard: res.armorMult
    });
    detail = `<span style="color:#3ad13a;font-weight:bold;">GRAZED</span> — ${dmg.total} (5D6) to ${loc}, armor at half SP.`;
  } else if (res.outcome === "stopped") {
    const dmg = await new Roll(res.damageFormula).evaluate();
    await applyAreaDamages({
      target: actor, areaDamages: { [loc]: [{ damage: dmg.total }] }, armorMode: ARMOR_MODES.NONE
    });
    await ablateLocationByAmount(actor, loc, res.spStripped).catch(() => {});
    detail = `Armor stopped it (Pen ${pen} ≤ AV ${av}) — <b>${dmg.total}</b> (2D6) impact to ${loc}; armor loses <b>${res.spStripped}</b> SP.`;
  } else {
    await applyAreaDamages({
      target: actor, areaDamages: { [loc]: [{ damage: res.damage }] }, armorMode: ARMOR_MODES.NONE
    });
    await ablateLocationByAmount(actor, loc, 999).catch(() => {});   // armor destroyed at the location
    detail = `<span style="color:#ff3030;font-weight:bold;">PENETRATED</span> (Pen ${pen} − AV ${av} = ${res.diff}) — <b>${res.damage}</b> damage to ${loc}; armor destroyed.`;
  }

  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `LUCK Save vs Anti-Vehicle ${weaponName} — need ≥ 15`,
    content: `
<div class="cyberpunk save-result">
  <h3>🎯 ${actor.name} — Personnel vs Anti-Vehicle (MM p.8)</h3>
  <div>LUCK ${luck} + 1d10 ${roll.dice[0].total} = <b>${roll.total}</b> vs 15 · AV <b>${av}</b></div>
  <div style="margin-top:4px;">${detail}</div>
</div>`
  });
}

/** Register the LUCK-save chat-button handler (all users; the owner/GM who clicks resolves it). */
export function registerVehicleTargetingHandlers() {
  document.addEventListener("click", async (ev) => {
    const btn = ev.target.closest?.(".cp-luck-save-roll");
    if (!btn || btn.disabled) return;
    ev.preventDefault();
    btn.disabled = true;
    await _executeLuckSave({
      actorId: btn.dataset.actorId, tokenId: btn.dataset.tokenId,
      pen: Number(btn.dataset.pen) || 0, weaponName: btn.dataset.weapon || "anti-vehicle weapon"
    });
  });
}

/* ------------------------------- The 4-way dispatcher ------------------------------- */

/**
 * Route an attack to the correct resolver by (source scale × target type). Returns true if it
 * handled the attack; false means "this is a normal personnel→personnel hit — let the existing
 * DamageDialog pipeline handle it." `payload.scale` = "penetration" for vehicle/AV weapons.
 */
export async function dispatchAttack(payload, target) {
  if (!target) return false;
  const isPen = payload?.scale === "penetration";

  if (target.type === "vehicle") {
    if (isPen) {
      const VD = await import("./vehicle-damage.js");
      const ruleSystem = (() => { try { return game.settings.get(SCOPE, "vehicleRuleSystem"); } catch { return "Core"; } })();
      const facing = resolveFacing(payload, target);
      if (ruleSystem === "MaximumMetal") {
        await VD.applyVehicleDamageMM(target, {
          basePen: Number(payload.penetration) || 0, facing,
          goodShotSteps: Number(payload.goodShotSteps) || 0,
          extraRounds: Number(payload.extraRounds) || 0,
          range: payload.range || "normal"
        });
      } else {
        await VD.applyVehicleDamageCore(target, { rawDamage: Number(payload.penetration) || 0, ap: !!payload.ap, facing });
      }
    } else {
      const VW = await import("./vehicle-weapons.js");
      await VW.routeWeaponFiredToVehicle(payload, target);
    }
    return true;
  }

  // Character / NPC target.
  if (isPen) {
    await postLuckSavePrompt(target, payload);   // MM p.8
    return true;
  }
  return false;   // personnel damage vs a person → existing pipeline
}
