/**
 * vehicle-damage.js — Phase 4: the vehicle damage resolver.
 *
 * Two toggle-selectable systems (the `vehicleRuleSystem` setting), mirroring the control resolver:
 *
 *   CORE — "Vehicles in FNFF", CP2020 p.112.
 *     SP is subtracted from incoming damage; the remainder comes off SDP. At 0 SDP the vehicle is
 *     destroyed. Crash/ram: (speed÷20, round down) d6 × Weight Modifier; occupants take half.
 *
 *   MAXIMUM METAL — Combat Procedure, MM p.4-6.
 *     Penetration (base + Good Shot + multiple rounds, − range falloff) is compared to the facing's
 *     Armor Value (flank rules reduce armor). If Pen − AV ≥ 0:
 *        1d10 + (Pen − AV) − Body Value  →  Damage Table:  ≤0 Surface · 1-5 Minor · 6-9 Major · 10+ Catastrophic
 *     Otherwise only a Surface-damage chance. Damage then rolls a Hit Location (+ sub-location) and
 *     applies the severity's crit effects (system destroyed %, fuel fire, engine/ammo explosion,
 *     crew dice). A Damage Control system ignores a hit on a 1d10 of 6-10.
 *
 * As with the control resolver, the math is split into PURE functions that take the rolled die
 * faces as arguments, so the whole resolution is unit-testable without a UI. The dialog at the
 * bottom rolls the dice, calls these, applies the result to the actor, and posts a chat card.
 */

import { openSingletonDialog } from "../utils.js";
import { effectiveVehicleRuleSystem } from "../settings.js";
import { acpaBodyArea, externalSystemHit, acpaSystemHit, acpaRollAgain, acpaCriticalEffect, acpaCriticalUpdate, acpaAreaSOP } from "./vehicle-acpa.js";

const SCOPE = "cyberpunk2020";

/* --------------------------------- CORE (p.112) --------------------------------- */

/** Core damage: SP subtracted (AP halves SP), remainder off SDP. PURE. */
export function coreVehicleDamage({ rawDamage = 0, sp = 0, currentSDP = 0, ap = false } = {}) {
  const dmg = Math.max(0, Number(rawDamage) || 0);
  const spVal = Math.max(0, Number(sp) || 0);
  const effSP = ap ? Math.floor(spVal / 2) : spVal;
  const through = Math.max(0, dmg - effSP);
  const newSDP = (Number(currentSDP) || 0) - through;
  return { spUsed: effSP, through, newSDP: Math.max(0, newSDP), destroyed: newSDP <= 0 };
}

/** Weight Modifier table (Core p.112 / MM p.11): crash/ram damage multiplier by mass class. */
export const WEIGHT_MOD = { vlight: 0.5, light: 1, medium: 2, heavy: 3, vheavy: 4 };

/**
 * Core crash/ram (p.112): (speed÷20, round down) d6, × weight modifier; occupants take half the
 * dice. PURE shape — returns the dice plan; the caller rolls `numD6`d6 and multiplies. `rolled` is
 * an optional pre-rolled d6 total for deterministic resolution.
 */
export function coreCrashDamage({ speed = 0, weightClass = "light", rolled = null } = {}) {
  const numD6 = Math.floor((Number(speed) || 0) / 20);
  const mult = WEIGHT_MOD[weightClass] ?? 1;
  const out = { numD6, weightMult: mult };
  if (rolled != null) {
    out.vehicleDamage = Math.floor((Number(rolled) || 0) * mult);
    out.occupantDamage = Math.floor(out.vehicleDamage / 2);
  }
  return out;
}

/* ------------------------------ MAXIMUM METAL (p.4-6) ------------------------------ */

/**
 * Effective penetration (MM p.4 step 2). PURE.
 *   - Good Shot: +½ base Pen per full 10 the to-hit cleared the target number (per step).
 *   - Multiple rounds: +¼ base Pen per extra round hitting the same area (round off).
 *   - Range: −25% at Long, −50% at Extreme (applied last), unless HE penetrators.
 */
export function mmEffectivePenetration({ basePen = 0, goodShotSteps = 0, extraRounds = 0, range = "normal", hefPenetrator = false } = {}) {
  const base = Math.max(0, Number(basePen) || 0);
  let pen = base;
  pen += Math.round(base * 0.5) * Math.max(0, Number(goodShotSteps) || 0);
  pen += Math.round(base * 0.25) * Math.max(0, Number(extraRounds) || 0);
  if (!hefPenetrator) {
    if (range === "long") pen = Math.round(pen * 0.75);
    else if (range === "extreme") pen = Math.round(pen * 0.5);
  }
  return Math.max(0, pen);
}

/** Flank armor (MM p.4 step 2C): side = 75% (round up), top/rear/bottom = 50% (round up). PURE. */
export function mmEffectiveArmor(armorValue, facing = "front") {
  const av = Math.max(0, Number(armorValue) || 0);
  switch (facing) {
    case "side":   return Math.ceil(av * 0.75);
    case "top":
    case "rear":
    case "back":
    case "bottom": return Math.ceil(av * 0.5);
    default:       return av;   // front
  }
}

/**
 * Damage Table (MM p.4 steps 3-4). PURE: pass the rolled 1d10.
 * Pen − AV < 0 → no penetration (surface chance only). Else 1d10 + (Pen−AV) − Body → severity.
 */
export function mmDamageSeverity({ pen = 0, effectiveArmorValue = 0, bodyValue = 0, d10 = 0 } = {}) {
  const diff = (Number(pen) || 0) - (Number(effectiveArmorValue) || 0);
  if (diff < 0) return { penetrated: false, severity: "noPenetration", score: null, diff };
  const score = (Number(d10) || 0) + diff - (Number(bodyValue) || 0);
  let severity = "surface";
  if (score >= 10) severity = "catastrophic";
  else if (score >= 6) severity = "major";
  else if (score >= 1) severity = "minor";
  return { penetrated: true, severity, score, diff };
}

/** Surface damage (MM p.4 step 5). PURE: 1d10 of 7-10 damages an exposed item; basePen 3+ destroys it. */
export function mmSurfaceDamage(d10, basePen = 0) {
  const r = Number(d10) || 0;
  if (r < 7) return { itemDamaged: false };
  return { itemDamaged: true, destroyed: (Number(basePen) || 0) >= 3 };
}

/** Vehicle Hit Location (MM p.6). PURE: 1d10 with facing shift (+2 top, −1 side, −2 back/bottom). */
export function mmHitLocation(d10, facing = "front") {
  let r = Number(d10) || 0;
  if (facing === "top") r += 2;
  else if (facing === "side") r -= 1;
  else if (facing === "rear" || facing === "back" || facing === "bottom") r -= 2;
  if (r <= 0) return "Fuel";
  if (r <= 3) return "Motive Gear";
  if (r <= 7) return "Hull";
  return "Turret";
}

/** Hull/Turret sub-location (MM p.6). PURE: 1d10 with facing shift (+1 front, −1 back). */
export function mmSubLocation(d10, table = "Hull", facing = "front") {
  let r = Number(d10) || 0;
  if (facing === "front") r += 1;
  else if (facing === "rear" || facing === "back") r -= 1;
  if (table === "Turret") {
    if (r <= 2) return "Cargo/Ammo";
    if (r <= 7) return "Crew";
    if (r === 8) return "Equipment";
    return "Weapon";                       // 9-11 Weapon
  }
  if (r <= 2) return "Cargo/Ammo";
  if (r <= 4) return "Engine";
  if (r <= 7) return "Crew";
  if (r === 8) return "Equipment";
  if (r === 9) return "Weapon";
  return "Empty Space";
}

/** ACPA hit location (MM p.5). PURE: 1d10. */
export function acpaHitLocation(d10) {
  const r = Number(d10) || 0;
  if (r <= 0) return "Power Cell";
  if (r <= 3) return "Legs";
  if (r <= 6) return "Arms";
  return "Torso/Head";
}

/** Crit effects by severity (MM p.6). destroyPct: system; enginePct: engine/ammo explosion. */
export const MM_CRIT = {
  minor:        { destroyPct: 20,  enginePct: 0,  fuelFirePct: 25, crewDice: "4d6" },
  major:        { destroyPct: 90,  enginePct: 50, fuelFirePct: 50, crewDice: "6d6" },
  catastrophic: { destroyPct: 100, enginePct: 90, fuelFirePct: 50, crewDice: "10d6" },
};

/** Damage Control (MM p.4): a hit is ignored on a 1d10 of 6-10. PURE. */
export function damageControlIgnores(d10) {
  return (Number(d10) || 0) >= 6;
}

/* ------------------------------------------------------------------ *
 *  UI wrapper — apply damage to a vehicle actor + chat card.          *
 * ------------------------------------------------------------------ */

const FACINGS = ["front", "side", "rear", "top", "bottom"];

/** Map a facing to the SP/AV key on the actor (rear/back→rear; bottom→bottom; etc.). */
function _facingKey(facing) {
  if (facing === "back") return "rear";
  return FACINGS.includes(facing) ? facing : "front";
}

/**
 * Open the vehicle-damage dialog, roll, resolve, apply to the actor, and post a chat card.
 * Honors `vehicleDamageEnabled` and branches on `vehicleRuleSystem`.
 * @returns {Promise<Dialog|null>}
 */
export async function openVehicleDamageDialog(actor) {
  if (!actor || actor.type !== "vehicle") return null;
  const enabled = (() => { try { return game.settings.get(SCOPE, "vehicleDamageEnabled"); } catch { return true; } })();
  if (!enabled) { ui.notifications?.warn?.("Vehicle damage automation is disabled in the system settings."); return null; }
  const ruleSystem = effectiveVehicleRuleSystem();
  const isMM = ruleSystem === "MaximumMetal";
  const sys = actor.system ?? {};

  const facingOpts = FACINGS.map(f => `<option value="${f}">${f}</option>`).join("");

  const coreBody = `
    <label>Incoming damage <input type="number" id="cp-vd-raw" value="0" style="width:64px;"></label>
    <label style="margin-left:8px;"><input type="checkbox" id="cp-vd-ap"> Armor-piercing (½ SP)</label>
    <label style="display:block;margin-top:4px;">Facing (which SP)
      <select id="cp-vd-facing" style="margin-left:6px;">${facingOpts}</select>
    </label>`;

  const mmBody = `
    <label>Base penetration <input type="number" id="cp-vd-pen" value="0" style="width:56px;"></label>
    <label style="margin-left:8px;">Facing
      <select id="cp-vd-facing" style="margin-left:4px;">${facingOpts}</select>
    </label>
    <div style="display:flex; gap:8px; margin-top:4px; flex-wrap:wrap;">
      <label>To-hit cleared target by <input type="number" id="cp-vd-overby" value="0" style="width:48px;"> <span style="opacity:0.6;font-size:0.8em;">(Good Shot: +½ pen / 10)</span></label>
    </div>
    <div style="display:flex; gap:8px; margin-top:4px; flex-wrap:wrap;">
      <label>Extra rounds same area <input type="number" id="cp-vd-rounds" value="0" style="width:48px;"></label>
      <label>Range
        <select id="cp-vd-range" style="margin-left:4px;">
          <option value="normal">Normal</option><option value="long">Long (−25%)</option><option value="extreme">Extreme (−50%)</option>
        </select>
      </label>
    </div>`;

  const content = `
<div class="cyberpunk vehicle-damage-dialog" style="display:flex;flex-direction:column;gap:4px;">
  <div style="opacity:0.7;font-size:0.85em;">${isMM ? "Maximum Metal" : "Core"} damage to <b>${actor.name}</b>.</div>
  ${isMM ? mmBody : coreBody}
</div>`;

  const dialog = new Dialog({
    title: `💥 Damage — ${actor.name}`,
    content,
    buttons: {
      apply: {
        label: "💥 Resolve",
        callback: async (html) => {
          const root = html instanceof jQuery ? html[0] : html;
          const num = (id) => Number(root.querySelector(id)?.value) || 0;
          const val = (id) => root.querySelector(id)?.value;
          const facing = val("#cp-vd-facing") || "front";
          if (isMM) {
            await applyVehicleDamageMM(actor, {
              basePen: num("#cp-vd-pen"), facing,
              goodShotSteps: Math.floor(Math.max(0, num("#cp-vd-overby")) / 10),
              extraRounds: num("#cp-vd-rounds"), range: val("#cp-vd-range") || "normal",
            });
          } else {
            await applyVehicleDamageCore(actor, { rawDamage: num("#cp-vd-raw"), ap: !!root.querySelector("#cp-vd-ap")?.checked, facing });
          }
        },
      },
      cancel: { label: "Cancel" },
    },
    default: "apply",
  });
  return openSingletonDialog(`vehicle-damage:${actor.id}`, () => dialog);
}

/** Apply Core damage: subtract facing SP, reduce SDP, set destroyed; post a card. */
export async function applyVehicleDamageCore(actor, { rawDamage = 0, ap = false, facing = "front" } = {}) {
  const sys = actor.system ?? {};
  const spKey = _facingKey(facing);
  const sp = Number(sys.sp?.[spKey]) || 0;
  const currentSDP = Number(sys.sdp?.value) || 0;
  const res = coreVehicleDamage({ rawDamage, sp, currentSDP, ap });

  // Write the WHOLE sdp object — a dot-path update ("system.sdp.value") on this ObjectField wipes
  // sdp.max (and thus Body Value). Preserve max.
  await actor.update({ "system.sdp": { value: res.newSDP, max: Number(sys.sdp?.max) || 0 } });

  const content = `
<div class="cyberpunk vehicle-damage-result">
  <h3>💥 ${actor.name} — Core Damage</h3>
  <div>${rawDamage} damage − SP ${res.spUsed}${ap ? " (AP ½)" : ""} (${spKey}) = <b>${res.through}</b> to SDP</div>
  <div style="margin-top:2px;">SDP ${currentSDP} → <b>${res.newSDP}</b> / ${Number(sys.sdp?.max) || 0}</div>
  ${res.destroyed ? `<div style="margin-top:4px;color:#ff3030;font-weight:bold;">⚠ DESTROYED / inoperable (0 SDP).</div>` : ""}
</div>`;
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content });
  return res;
}

const _ACPA_AREA_KEY = { "Head": "head", "Right Arm": "rArm", "Left Arm": "lArm", "Right Leg": "rLeg", "Left Leg": "lLeg", "Torso": "torso" };

/**
 * Faithful ACPA (powered-armor) damage (Maximum Metal p.54-56): SOP damage = incoming damage − armor
 * SP − Toughness Mod. If it gets through, roll a body area → 50% external system → System Hit Table
 * → (Critical Hit Chart on a critical), then consume the struck area's FRAME SOP; overflow past the
 * frame spills to the pilot. A destroyed area knocks out its systems; a destroyed Torso shuts the
 * suit down. (Per-system SOP arrives with the systems catalog in D-4 — for now all hits hit the frame.)
 *
 * `rawDamage` is the actual rolled weapon damage when the payload carries it; otherwise the incoming
 * damage is estimated from the Penetration Factor (Pen ≈ avgDamage/10). Rolls its own dice (pushed to
 * `rolls`) and returns the chat header/lines + the actor updates.
 */
async function _resolveAcpaSopDamage(actor, sys, { pen, rawDamage, str }, rolls) {
  const roll = async (f) => { const r = await new Roll(f).evaluate(); rolls.push(r); return r; };
  const d10 = async () => (await roll("1d10")).total;
  const updates = {};

  const incoming = (rawDamage != null) ? Math.max(0, Number(rawDamage) || 0) : Math.max(0, pen * 10);
  const armorSP = Number(sys.sp?.front) || 0;
  const toughness = Math.abs(Number(sys.toughness) || 0);
  const sop = incoming - armorSP - toughness;
  const dmgSrc = (rawDamage != null) ? `${incoming} dmg` : `Pen ${pen} ≈ ${incoming} dmg`;
  const body = `${dmgSrc} − Armor SP ${armorSP} − Toughness ${toughness} = <b>${sop}</b> SOP`;

  if (sop <= 0) return { body, lines: `Armor + frame absorbed it — no penetration.`, updates };

  const areaName = acpaBodyArea(await d10());
  const areaKey = _ACPA_AREA_KEY[areaName] ?? "torso";
  let lines = `<b>${sop}</b> SOP to the <b>${areaName}</b>`;

  // 50% (5-in-10): an external (unarmored) system takes it instead of the suit proper (MM p.55).
  if (externalSystemHit(await d10())) {
    return { body, lines: lines + `<br>An <b>external system</b> on the ${areaName} took it (GM checks its integrity).`, updates };
  }

  // System Hit Table; a 10 re-rolls into a Critical or another System Hit.
  let cat = acpaSystemHit(await d10());
  if (cat === "rollAgain") cat = (acpaRollAgain(await d10()) === "critical") ? "critical" : acpaSystemHit(await d10());
  if (cat === "critical") {
    const eff = acpaCriticalEffect(await d10());
    const amt = eff.formula ? (await roll(eff.formula)).total : 0;
    const { updates: cu, note } = acpaCriticalUpdate(sys, eff, amt);
    Object.assign(updates, cu);
    lines += `<br><span style="color:#ff3030;font-weight:bold;">CRITICAL</span> — ${eff.label}: ${note}.`;
  } else {
    const label = cat === "chassis" ? "frame (chassis)" : (cat === "enclosed" ? "an enclosed system" : "an internal weapon");
    lines += `<br>System Hit: <b>${label}</b> in the ${areaName}.`;
    if (cat !== "chassis") {
      const damaged = Array.isArray(sys.damagedSystems) ? [...sys.damagedSystems] : [];
      const dname = `${areaName} ${cat === "enclosed" ? "system" : "weapon"}`;
      if (!damaged.includes(dname)) { damaged.push(dname); updates["system.damagedSystems"] = damaged; }
    }
  }

  // Consume the area's FRAME SOP; overflow spills to the pilot. Initialize current SOP to full on the
  // first hit (a freshly built/repaired suit has frameSOP = frameSOPMax).
  const max = sys.frameSOPMax ?? acpaAreaSOP(str);
  let cur = { ...(sys.frameSOP ?? {}) };
  if (Object.values(cur).every(v => !Number(v))) cur = { ...max };
  const before = Number(cur[areaKey]) || 0;
  const remaining = before - sop;
  cur[areaKey] = Math.max(0, remaining);
  updates["system.frameSOP"] = cur;
  lines += (remaining < 0)
    ? `<br>${areaName} frame SOP ${before} → 0; <b>${-remaining}</b> overflows to the <b>pilot</b>.`
    : `<br>${areaName} frame SOP ${before} → ${cur[areaKey]}.`;

  if (cur[areaKey] === 0) {
    lines += `<br><span style="color:#e07b00;">${areaName} frame destroyed — its systems are inoperable.</span>`;
    if (areaKey === "torso") {
      updates["system.destroyed"] = true;
      updates["system.immobilized"] = true;
      updates["system.sdp"] = { value: 0, max: Number(sys.sdp?.max) || 0 };
      lines += ` <span style="color:#ff3030;font-weight:bold;">TORSO DESTROYED — the suit SHUTS DOWN.</span>`;
    } else if (areaKey === "rLeg" || areaKey === "lLeg") {
      updates["system.immobilized"] = true;
    }
  }
  return { body, lines, updates };
}

/**
 * Apply Maximum Metal damage and post a card. Vehicles use the Penetration → severity → hit-location
 * flow; powered armor (isACPA) uses the faithful SOP-damage flow (MM p.54-56). `rawDamage` is the
 * actual rolled weapon damage when the caller has it (used for ACPA); else ACPA estimates it from Pen.
 */
export async function applyVehicleDamageMM(actor, { basePen = 0, facing = "front", goodShotSteps = 0, extraRounds = 0, range = "normal", hefPenetrator = false, heat = false, rawDamage = null } = {}) {
  const sys = actor.system ?? {};
  const isACPA = !!sys.isACPA;
  const avKey = _facingKey(facing);
  const av = isACPA ? (Number(sys.armorValue?.front) || 0) : (Number(sys.armorValue?.[avKey]) || 0);
  const bodyValue = Number(sys.bodyValue) || 0;

  const penRaw = mmEffectivePenetration({ basePen, goodShotSteps, extraRounds, range, hefPenetrator });
  // Composite Armor halves the Penetration of shaped-charge (HEAT) weapons (MM p.23).
  const composite = !isACPA && !!sys.compositeArmor && !!heat;
  const pen = composite ? Math.ceil(penRaw / 2) : penRaw;
  const effAV = isACPA ? av : mmEffectiveArmor(av, facing);

  const rolls = [];
  const d10 = async () => { const r = await new Roll("1d10").evaluate(); rolls.push(r); return r.total; };

  let body = "", lines = "", sev = null;
  const updates = {};
  const damaged = Array.isArray(sys.damagedSystems) ? [...sys.damagedSystems] : [];

  if (isACPA) {
    // Powered armor uses the faithful SOP-damage flow (MM p.54-56), not the vehicle severity table.
    const r = await _resolveAcpaSopDamage(actor, sys, { pen, rawDamage, str: Number(sys.str) || 0 }, rolls);
    body = r.body;
    lines = r.lines;
    Object.assign(updates, r.updates);
  } else {
    sev = mmDamageSeverity({ pen, effectiveArmorValue: effAV, bodyValue, d10: await d10() });
    body = `Pen <b>${pen}</b> (base ${basePen}${composite ? ", ½ vs Composite" : ""}) vs AV <b>${effAV}</b>${facing !== "front" ? ` (${facing} flank)` : ""} − Body ${bodyValue}`;

    if (!sev.penetrated) {
      const surf = mmSurfaceDamage(await d10(), basePen);
      lines = surf.itemDamaged
        ? `No penetration — <b>surface</b>: an exposed item is ${surf.destroyed ? "destroyed" : "damaged (50% repairable)"}.`
        : `No penetration — no surface effect.`;
    } else if (sev.severity === "surface") {
      const surf = mmSurfaceDamage(await d10(), basePen);
      lines = `Roll ${sev.score} → <b>Surface</b>: ${surf.itemDamaged ? (surf.destroyed ? "an exposed item destroyed" : "an exposed item damaged") : "no item hit"}.`;
    } else {
      // Penetrating Minor/Major/Catastrophic → hit location + crit effects.
      const loc = mmHitLocation(await d10(), facing);
      const crit = MM_CRIT[sev.severity];
      let locLine = loc;
      let subLoc = null;
      if (loc === "Hull" || loc === "Turret") {
        subLoc = mmSubLocation(await d10(), loc, facing);
        locLine = `${loc} → ${subLoc}`;
      }

      let ignored = false;
      if (sys.damageControl) ignored = damageControlIgnores(await d10());

      lines = `Roll ${sev.score} → <b>${sev.severity.toUpperCase()}</b> · location: <b>${locLine}</b>`;
      if (ignored) {
        lines += `<br><span style="color:#3ad13a;">Damage Control absorbed the hit (rolled 6-10) — system stays functional.</span>`;
      } else {
        if (loc === "Motive Gear") updates["system.immobilized"] = true;
        if (loc === "Fuel") {
          const fire = (await new Roll("1d100").evaluate());
          rolls.push(fire);
          if (fire.total <= crit.fuelFirePct) { updates["system.onFire"] = true; lines += `<br><span style="color:#e07b00;">Fuel ignites (rolled ${fire.total} ≤ ${crit.fuelFirePct}%) — on fire: 3d6/crew/turn, 25%/turn to explode.</span>`; }
          else lines += `<br>Fuel hit but did not ignite (rolled ${fire.total} > ${crit.fuelFirePct}%).`;
        }
        const zeroSDP = { value: 0, max: Number(sys.sdp?.max) || 0 };
        const isExplosive = (subLoc === "Engine" || subLoc === "Cargo/Ammo");
        if (isExplosive && crit.enginePct > 0) {
          const ex = await new Roll("1d100").evaluate(); rolls.push(ex);
          if (ex.total <= crit.enginePct) { updates["system.destroyed"] = true; updates["system.sdp"] = zeroSDP; lines += `<br><span style="color:#ff3030;font-weight:bold;">Engine/ammo cooks off (rolled ${ex.total} ≤ ${crit.enginePct}%) — vehicle DEMOLISHED.</span>`; }
          else lines += `<br>Engine/ammo hit but held (rolled ${ex.total} > ${crit.enginePct}%).`;
        }
        if (sev.severity === "catastrophic") { updates["system.destroyed"] = true; updates["system.sdp"] = zeroSDP; }
        const sysName = subLoc ?? loc;
        if (!damaged.includes(sysName)) { damaged.push(sysName); updates["system.damagedSystems"] = damaged; }
        lines += `<br>Crew in that area take <b>${crit.crewDice}</b>; ${crit.destroyPct}% the system is destroyed (else damaged until repaired).`;
      }
    }
  }

  if (Object.keys(updates).length) await actor.update(updates);

  const content = `
<div class="cyberpunk vehicle-damage-result">
  <h3>💥 ${actor.name} — ${isACPA ? "Powered-Armor" : "Maximum Metal"} Damage</h3>
  <div>${body}</div>
  <div style="margin-top:4px;">${lines}</div>
</div>`;
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content, rolls });
  return { pen, effAV, isACPA, severity: sev?.severity, score: sev?.score, updates };
}
