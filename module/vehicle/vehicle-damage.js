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
  const ruleSystem = (() => { try { return game.settings.get(SCOPE, "vehicleRuleSystem"); } catch { return "Core"; } })();
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

/** Apply Maximum Metal damage: penetration → severity → hit location → crit effects; post a card. */
export async function applyVehicleDamageMM(actor, { basePen = 0, facing = "front", goodShotSteps = 0, extraRounds = 0, range = "normal", hefPenetrator = false, heat = false } = {}) {
  const sys = actor.system ?? {};
  const isACPA = !!sys.isACPA;
  const avKey = _facingKey(facing);
  const av = isACPA ? (Number(sys.armorValue?.front) || 0) : (Number(sys.armorValue?.[avKey]) || 0);
  const bodyValue = Number(sys.bodyValue) || 0;

  const penRaw = mmEffectivePenetration({ basePen, goodShotSteps, extraRounds, range, hefPenetrator });
  // Composite Armor halves the Penetration of shaped-charge (HEAT) weapons (MM p.23).
  const composite = !isACPA && !!sys.compositeArmor && !!heat;
  const pen = composite ? Math.ceil(penRaw / 2) : penRaw;
  // ACPA armor is equal on all sides — no flank reduction.
  const effAV = isACPA ? av : mmEffectiveArmor(av, facing);

  const rolls = [];
  const d10 = async () => { const r = await new Roll("1d10").evaluate(); rolls.push(r); return r.total; };

  const sev = mmDamageSeverity({ pen, effectiveArmorValue: effAV, bodyValue, d10: await d10() });

  let body = `Pen <b>${pen}</b> (base ${basePen}${composite ? ", ½ vs Composite" : ""}) vs AV <b>${effAV}</b>${facing !== "front" && !isACPA ? ` (${facing} flank)` : ""} − Body ${bodyValue}`;
  let lines = "";
  const updates = {};
  const damaged = Array.isArray(sys.damagedSystems) ? [...sys.damagedSystems] : [];

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
    const loc = isACPA ? acpaHitLocation(await d10()) : mmHitLocation(await d10(), facing);
    const crit = MM_CRIT[sev.severity];
    let locLine = loc;
    let subLoc = null;
    if (!isACPA && (loc === "Hull" || loc === "Turret")) {
      subLoc = mmSubLocation(await d10(), loc, facing);
      locLine = `${loc} → ${subLoc}`;
    }

    // Damage Control may shrug off the hit (6-10).
    let ignored = false;
    if (sys.damageControl) ignored = damageControlIgnores(await d10());

    lines = `Roll ${sev.score} → <b>${sev.severity.toUpperCase()}</b> · location: <b>${locLine}</b>`;
    if (ignored) {
      lines += `<br><span style="color:#3ad13a;">Damage Control absorbed the hit (rolled 6-10) — system stays functional.</span>`;
    } else {
      // Status flags from the location.
      if (loc === "Motive Gear" || (isACPA && (loc === "Legs" || loc === "Power Cell"))) updates["system.immobilized"] = true;
      if (loc === "Fuel") {
        const fire = (await new Roll("1d100").evaluate());
        rolls.push(fire);
        if (fire.total <= crit.fuelFirePct) { updates["system.onFire"] = true; lines += `<br><span style="color:#e07b00;">Fuel ignites (rolled ${fire.total} ≤ ${crit.fuelFirePct}%) — on fire: 3d6/crew/turn, 25%/turn to explode.</span>`; }
        else lines += `<br>Fuel hit but did not ignite (rolled ${fire.total} > ${crit.fuelFirePct}%).`;
      }
      // Destroying a vehicle zeroes current SDP. Write the WHOLE sdp object (a dot-path update wipes
      // sdp.max → Body Value); preserve max.
      const zeroSDP = { value: 0, max: Number(sys.sdp?.max) || 0 };
      const isExplosive = (subLoc === "Engine" || subLoc === "Cargo/Ammo");
      if (isExplosive && crit.enginePct > 0) {
        const ex = await new Roll("1d100").evaluate(); rolls.push(ex);
        if (ex.total <= crit.enginePct) { updates["system.destroyed"] = true; updates["system.sdp"] = zeroSDP; lines += `<br><span style="color:#ff3030;font-weight:bold;">Engine/ammo cooks off (rolled ${ex.total} ≤ ${crit.enginePct}%) — vehicle DEMOLISHED.</span>`; }
        else lines += `<br>Engine/ammo hit but held (rolled ${ex.total} > ${crit.enginePct}%).`;
      }
      if (sev.severity === "catastrophic") { updates["system.destroyed"] = true; updates["system.sdp"] = zeroSDP; }
      // Record the damaged system.
      const sysName = subLoc ?? loc;
      if (!damaged.includes(sysName)) { damaged.push(sysName); updates["system.damagedSystems"] = damaged; }
      lines += `<br>Crew in that area take <b>${crit.crewDice}</b>; ${crit.destroyPct}% the system is destroyed (else damaged until repaired).`;
    }
  }

  if (Object.keys(updates).length) await actor.update(updates);

  const content = `
<div class="cyberpunk vehicle-damage-result">
  <h3>💥 ${actor.name} — Maximum Metal Damage</h3>
  <div>${body}</div>
  <div style="margin-top:4px;">${lines}</div>
</div>`;
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content, rolls });
  return { pen, effAV, severity: sev.severity, score: sev.score, updates };
}
