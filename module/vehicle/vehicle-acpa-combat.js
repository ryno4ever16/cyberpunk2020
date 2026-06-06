/**
 * vehicle-acpa-combat.js — Phase 6: stateful ACPA combat (melee dialog + per-turn ticks).
 *
 * ACPA hand-to-hand (MM p.58) strikes at VEHICLE scale: Punch/Crush/Kick roll Nd10, which we convert
 * to a vehicle Penetration (Penetration Factor = round(avgDamage/10)) and route through the unified
 * dispatcher — vehicle/ACPA target → Pen vs Armor Value, personnel target → MM p.8. Suit STR damaged
 * by criticals (strDamage) reduces the effective STR.
 */

import { acpaMeleeDamage, acpaTickStatus } from "./vehicle-acpa.js";
import { penetrationFactor } from "./vehicle-weapons.js";
import { openSingletonDialog } from "../utils.js";

const SCOPE = "cyberpunk2020";
const _enabled = (k, d = true) => { try { return game.settings.get(SCOPE, k); } catch { return d; } };

/** The acting suit's token: prefer the selected one, else any of its tokens. */
function _firerTokenOf(actor) {
  return (canvas?.tokens?.controlled ?? []).find(t => t.actor?.id === actor.id)
      ?? canvas?.tokens?.placeables?.find(t => t.actor?.id === actor.id) ?? null;
}

/** Average of an Nd10 = N × 5.5. ACPA melee Penetration = round(avg/10). */
function _meleePen(dice) {
  return penetrationFactor({ avgDamage: (Number(dice) || 0) * 5.5 });
}

/**
 * ACPA melee dialog (MM p.58). Strike a targeted token with Punch / Crush / Kick; on a hit, the
 * vehicle-scale Penetration routes through the dispatcher. To-hit = 1d10 + pilot REF + melee skill.
 */
export async function openAcpaMeleeDialog(actor) {
  if (!actor || actor.type !== "vehicle" || !actor.system?.isACPA) { ui.notifications?.warn?.("ACPA melee is for powered-armor actors (tick the ACPA box)."); return null; }
  if (!_enabled("vehicleDamageEnabled")) { ui.notifications?.warn?.("Vehicle damage automation is disabled in the settings."); return null; }

  const targets = [...(game.user?.targets ?? [])];
  const targetTok = targets.length === 1 ? targets[0] : null;
  if (!targetTok) { ui.notifications?.warn?.("Target the token you're striking first."); return null; }
  const targetActor = targetTok.actor;
  const firerTok = _firerTokenOf(actor);
  const strDmg = Number(actor.system?.strDamage) || 0;
  const effStr = Math.max(0, (Number(actor.system?.str) || 0) - strDmg);
  const effRef = Number(actor.system?.effectiveRef) || 0;   // pilot REF capped by the Reflex/Control system

  const content = `
<div class="cyberpunk vehicle-fire-dialog" style="display:flex;flex-direction:column;gap:4px;">
  <div style="opacity:0.7;font-size:0.85em;">${actor.name} (Suit STR <b>${effStr}</b>${strDmg ? ` after −${strDmg} damage` : ""}) strikes <b>${targetActor?.name ?? targetTok.name}</b>.</div>
  <label>Strike
    <select id="cp-am-kind">
      <option value="punch">Punch — round(STR/9) d10</option>
      <option value="crush">Crush — (X+1) d10</option>
      <option value="kick">Kick — round(1.5×X) d10</option>
    </select>
  </label>
  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    <label title="Pilot REF, capped by the suit's Reflex/Control system (derived effective REF). Override if a different pilot is driving.">Pilot REF <input type="number" id="cp-am-ref" value="${effRef}" style="width:48px;"></label>
    <label>Melee skill <input type="number" id="cp-am-skill" value="0" style="width:48px;"></label>
    <label>Target DV <input type="number" id="cp-am-dv" value="15" style="width:48px;"></label>
  </div>
</div>`;

  const dialog = new Dialog({
    title: `🤜 ACPA Melee — ${actor.name}`,
    content,
    default: "strike",
    buttons: {
      strike: { label: "🤜 Strike", callback: async (html) => {
        const root = html instanceof jQuery ? html[0] : html;
        const kind = root.querySelector("#cp-am-kind")?.value || "punch";
        const ref = Number(root.querySelector("#cp-am-ref")?.value) || 0;
        const skill = Number(root.querySelector("#cp-am-skill")?.value) || 0;
        const dv = Number(root.querySelector("#cp-am-dv")?.value) || 15;
        const dmg = acpaMeleeDamage(effStr, kind);
        const pen = _meleePen(dmg.dice);
        const d10 = (await new Roll("1d10").evaluate());
        const total = d10.total + ref + skill;
        const hit = total >= dv;
        const verdict = hit ? `<span style="color:#3ad13a;font-weight:bold;">HIT</span>` : `<span style="color:#ff6060;font-weight:bold;">MISS</span>`;
        const kindLabel = kind.charAt(0).toUpperCase() + kind.slice(1);
        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `${actor.name} — ACPA ${kind}`, rolls: [d10], content:
          `<div class="cyberpunk vehicle-fire-result"><h3>🤜 ACPA ${kindLabel}</h3>
             <div>To-hit: 1d10 ${d10.total} + REF ${ref} + skill ${skill} = <b>${total}</b> vs ${dv} — ${verdict}</div>
             <div style="margin-top:2px;">Damage <b>${dmg.formula}</b> → Penetration <b>${pen}</b> (vehicle scale).</div></div>` });
        if (hit && targetActor) {
          const { dispatchAttack, detectFacingFromTokens } = await import("./vehicle-targeting.js");
          const facing = (firerTok && targetTok) ? detectFacingFromTokens(firerTok, targetTok) : "front";
          await dispatchAttack({ scale: "penetration", penetration: pen, facing, targetTokenId: targetTok.id, weaponName: `ACPA ${kindLabel}` }, targetActor);
        }
      } },
      cancel: { label: "Cancel" },
    },
  });
  return openSingletonDialog(`acpa-melee:${actor.id}`, () => dialog);
}

/** Field repair: restore an ACPA suit to full — frame SOP, SDP, power, and clear all damage/status. */
export async function repairAcpa(actor) {
  if (!actor || actor.type !== "vehicle" || !actor.system?.isACPA) { ui.notifications?.warn?.("Repair is for ACPA (powered armor) only."); return; }
  const sys = actor.system;
  const sdpMax = Number(sys.sdp?.max) || 0;
  await actor.update({
    "system.frameSOP": { ...(sys.frameSOPMax ?? {}) },
    "system.sdp": { value: sdpMax, max: sdpMax },
    "system.strDamage": 0, "system.refDamage": 0, "system.powerHours": 24,
    "system.coolingTimer": 0, "system.heatstrokeLevel": 0, "system.interfaceOut": 0, "system.seizeUp": 0,
    "system.destroyed": false, "system.immobilized": false, "system.onFire": false,
  });
  ui.notifications?.info?.(`${actor.name} fully repaired (frame SOP & systems restored).`);
}

/**
 * Per-round ACPA status ticks (MM p.55-56): seize-up and interface-out timers count down each combat
 * round for every ACPA combatant; seize-up ending restores mobility. Active GM only (so N GMs don't
 * multiply the decrement). Cooling (minutes) is shown on the sheet and left for the GM to adjudicate.
 */
export function registerAcpaCombatHooks() {
  Hooks.on("updateCombat", async (combat, changed) => {
    if (!game.user?.isGM || game.users?.activeGM?.id !== game.user.id) return;
    if (changed.round === undefined) return;   // once per round
    for (const c of combat.combatants ?? []) {
      const a = c.actor;
      if (!a || a.type !== "vehicle" || !a.system?.isACPA) continue;
      const { updates, lines } = acpaTickStatus(a.system);
      if (Object.keys(updates).length) await a.update(updates);
      if (lines.length) await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor: a }),
        content: `<div class="cyberpunk save-prompt"><h3>⚙ ${a.name}</h3><div class="save-info">${lines.join("; ")}.</div></div>`,
      });
    }
  });
}
