/**
 * vehicle-weapons.js — Phase 5 (foundation): vehicle weapons & the PC↔vehicle firing bridge.
 *
 * Maximum Metal puts personnel weapons and vehicle weapons on the same scale via conversion
 * factors (MM p.4):
 *   Penetration Factor = round(Average Damage ÷ 10) · ×2 for any AP · ×½ for small arms (d6 damage)
 *   Armor Value = SP ÷ 20 · Body Value = SDP ÷ 20
 * and a common to-hit modifier table (MM p.4, "COMMON VEHICLE TO-HIT MODIFIERS").
 *
 * This module supplies the PURE, testable core that the mount-firing UI and the live
 * weapon-fired→vehicle routing (later in Phase 5) build on:
 *   - averageDamageFromFormula / isSmallArms  — read a weapon's damage dice
 *   - penetrationFactor / weaponToPenetration — convert a PC weapon to a vehicle Penetration
 *   - vehicleToHitModifier                    — total the MM to-hit modifiers for a shot
 *
 * The actual damage application reuses the Phase 4 resolver (applyVehicleDamageMM / ...Core).
 */

import { openSingletonDialog } from "../utils.js";

/** Average of a CP2020 damage formula ("2d6+1", "5d6", "1d10", "3d6+2"). PURE. */
export function averageDamageFromFormula(formula) {
  const s = String(formula ?? "").replace(/\s+/g, "");
  if (!s) return 0;
  const terms = s.match(/[+-]?[^+-]+/g) ?? [];
  let total = 0;
  for (const t of terms) {
    const m = t.match(/^([+-]?)(\d*)d(\d+)$/i);
    if (m) {
      const sign = m[1] === "-" ? -1 : 1;
      const count = m[2] === "" ? 1 : Number(m[2]);
      const faces = Number(m[3]);
      total += sign * count * (faces + 1) / 2;
    } else if (/^[+-]?\d+$/.test(t)) {
      total += Number(t);
    }
  }
  return total;
}

/** Small arms = anything using D6 for damage (MM p.4). PURE. */
export function isSmallArms(formula) {
  return /d6/i.test(String(formula ?? ""));
}

/**
 * Penetration Factor (MM p.4). PURE.
 *   round(avgDamage ÷ 10), then ×2 if AP, then ×½ if small arms (round). Floored at 0.
 */
export function penetrationFactor({ avgDamage = 0, ap = false, smallArms = false } = {}) {
  let pf = Math.round((Number(avgDamage) || 0) / 10);
  if (ap) pf *= 2;
  if (smallArms) pf = Math.round(pf * 0.5);
  return Math.max(0, pf);
}

/**
 * Convert a personnel weapon Item to a vehicle Penetration (the PC → vehicle bridge). PURE-ish:
 * reads the weapon's damage formula + AP. `apOverride` lets a caller fold in loaded-ammo AP.
 */
export function weaponToPenetration(weaponItem, { apOverride = null } = {}) {
  const sys = weaponItem?._getWeaponSystem ? weaponItem._getWeaponSystem() : (weaponItem?.system ?? {});
  const formula = sys?.damage ?? "";
  const ap = apOverride != null ? !!apOverride : !!sys?.ap;
  return penetrationFactor({ avgDamage: averageDamageFromFormula(formula), ap, smallArms: isSmallArms(formula) });
}

/**
 * Total the Maximum Metal vehicle to-hit modifiers for one shot (MM p.4). PURE.
 * A vehicle target is Large (+4); ACPA takes no size modifier. Target movement subtracts −1 per
 * full 20 mph (per full 40 mph if moving directly toward the firer).
 */
export function vehicleToHitModifier({
  targetLarge = true, targetSmall = false, isACPATarget = false,
  stationary = false, targetSpeedMph = 0, movingStraightAt = false,
  turret = false, targetingComputer = 0,
  firerMoving = false, turningToFace = false, vehicleLink = false,
  darkObscured = false, heatSeekerVsAV = false, rocketSalvo = false,
} = {}) {
  let mod = 0;
  if (!isACPATarget) {
    if (targetLarge) mod += 4;
    if (targetSmall) mod -= 4;
  }
  if (stationary) mod += 4;
  const speed = Number(targetSpeedMph) || 0;
  if (speed > 0) mod -= Math.floor(speed / (movingStraightAt ? 40 : 20));
  if (turret) mod += 2;
  mod += Number(targetingComputer) || 0;
  if (firerMoving) mod -= 3;        // non-stabilized weapon
  if (turningToFace) mod -= 2;
  if (vehicleLink) mod += 2;
  if (darkObscured) mod -= 3;
  if (heatSeekerVsAV) mod += 4;
  if (rocketSalvo) mod -= 2;
  return mod;
}

/**
 * Good Shot steps (MM p.5): +1 step per full 10 the to-hit roll cleared the target number.
 * Each step adds ½ the weapon's base penetration (handled by the Phase 4 resolver). PURE.
 */
export function goodShotSteps(toHitTotal, targetNumber) {
  const over = (Number(toHitTotal) || 0) - (Number(targetNumber) || 0);
  return over >= 0 ? Math.floor(over / 10) : 0;
}

/**
 * Multiple-rounds count (MM p.5): a high-ROF burst hits with several rounds per shot that hits.
 * ROF 30 → 5 rounds/hit, ROF 100 → 10 rounds/hit; otherwise 1. PURE.
 */
export function roundsPerHit(rof) {
  const r = Number(rof) || 0;
  if (r >= 100) return 10;
  if (r >= 30) return 5;
  return 1;
}

/**
 * Resolve a vehicle weapon's to-hit and the resulting Good Shot steps. PURE — pass the rolled d10.
 * total = 1d10 + REF + skill + the totalled to-hit modifiers; a hit needs total ≥ the target number,
 * and clears Good Shot at +1 step per full 10 over it.
 */
export function resolveVehicleToHit({ d10 = 0, ref = 0, skill = 0, mods = 0, targetNumber = 0 } = {}) {
  const total = (Number(d10) || 0) + (Number(ref) || 0) + (Number(skill) || 0) + (Number(mods) || 0);
  const tn = Number(targetNumber) || 0;
  const hit = total >= tn;
  return { total, hit, goodShotSteps: hit ? Math.max(0, Math.floor((total - tn) / 10)) : 0 };
}

/* ------------------------------------------------------------------ *
 *  Live bridge — a personnel weapon fired at a vehicle token routes   *
 *  to the Phase 4 vehicle resolver instead of the personnel pipeline. *
 * ------------------------------------------------------------------ */

const SCOPE = "cyberpunk2020";

/**
 * Resolve the firing weapon's vehicle Penetration for a weaponFired payload (Maximum Metal).
 * Ranged shots carry `weaponName`, so we resolve the actual weapon Item and use its exact
 * (average-based, small-arms-aware) Penetration. If the weapon can't be found (e.g. a melee/martial
 * payload with no weaponName), fall back to treating the rolled total as the damage sample.
 */
function _payloadPenetration(payload, totalRolled, ap) {
  const attacker = game.actors?.get(payload.attackerId ?? payload.actorId ?? "");
  if (attacker && payload.weaponName) {
    const w = attacker.items.find(i => i.type === "weapon" && i.name === payload.weaponName)
           ?? attacker.items.find(i => i.type === "cyberware" && i.name === payload.weaponName);
    if (w) return weaponToPenetration(w, { apOverride: ap });
  }
  return penetrationFactor({ avgDamage: totalRolled, ap, smallArms: false });
}

/**
 * Route a `cyberpunk2020.weaponFired` payload aimed at a vehicle actor to the vehicle resolver.
 * Core: the summed rolled damage goes through SP→SDP. Maximum Metal: the firing weapon's
 * Penetration is compared to Armor Value (front facing). Honors `vehicleDamageEnabled`.
 * @returns {Promise<boolean>} whether it handled the hit.
 */
export async function routeWeaponFiredToVehicle(payload, vehicleActor) {
  if (!vehicleActor || vehicleActor.type !== "vehicle") return false;
  const enabled = (() => { try { return game.settings.get(SCOPE, "vehicleDamageEnabled"); } catch { return true; } })();
  if (!enabled) return false;

  let total = 0;
  for (const hits of Object.values(payload?.areaDamages ?? {})) {
    for (const h of (hits ?? [])) total += Number(h.damage ?? h.dmg) || 0;
  }
  const ap = !!payload?.ap;

  const ruleSystem = (() => { try { return game.settings.get(SCOPE, "vehicleRuleSystem"); } catch { return "Core"; } })();
  // Imported lazily to keep the pure-math top of this module free of Phase 4 UI deps in tests.
  const VD = await import("./vehicle-damage.js");
  if (ruleSystem === "MaximumMetal") {
    const pen = _payloadPenetration(payload, total, ap);
    await VD.applyVehicleDamageMM(vehicleActor, { basePen: pen, facing: "front" });
  } else {
    await VD.applyVehicleDamageCore(vehicleActor, { rawDamage: total, ap, facing: "front" });
  }
  return true;
}

/* ------------------------------------------------------------------ *
 *  Vehicle weapon mount firing — to-hit roll + Good Shot → resolver.  *
 * ------------------------------------------------------------------ */

const FACINGS = ["front", "side", "rear", "top", "bottom"];
const GUNNER_SKILL = "HeavyWeapons";   // the usual vehicle-weapon skill; prefilled, editable

/**
 * Candidate gunners for a vehicle: its boarded crew first, then the user's owned characters/npcs.
 * A vehicle weapon is operated by a crew member, but we don't HARD-require one — drones/RPVs/remote
 * turrets fire with no occupant — so a gunner is optional; picking one prefills REF + weapon skill.
 */
function _candidateGunners(actor) {
  const boarded = (canvas?.tokens?.placeables ?? [])
    .filter(t => t.document?.flags?.[SCOPE]?.boardedVehicle === actor.id && t.actor)
    .map(t => t.actor);
  const owned = game.actors.filter(a => (a.type === "character" || a.type === "npc") && a.isOwner);
  const out = [], seen = new Set();
  for (const a of [...boarded, ...owned]) { if (!seen.has(a.id)) { seen.add(a.id); out.push(a); } }
  return out;
}

/**
 * Fire one of a vehicle's weapon mounts at a target. Opens a dialog to set the gunner (prefills
 * REF/skill from a crew member), the to-hit situation (the common vehicle modifiers), and the shot,
 * then rolls to-hit; on a hit it resolves Good Shot + multiple-rounds and applies damage to the
 * target vehicle via the Phase 4 resolver. Singleton + honors `vehicleDamageEnabled`.
 * @param {Actor} actor  the firing vehicle
 * @param {object} mount {name, penetration, rof, arc}; if omitted, the dialog asks for penetration/ROF
 * @returns {Promise<Dialog|null>}
 */
export async function openVehicleFireDialog(actor, mount = {}) {
  if (!actor || actor.type !== "vehicle") return null;
  const enabled = (() => { try { return game.settings.get(SCOPE, "vehicleDamageEnabled"); } catch { return true; } })();
  if (!enabled) { ui.notifications?.warn?.("Vehicle damage automation is disabled in the system settings."); return null; }

  // Resolve the full vehicleWeapon Item (the sheet passes {itemId,...}); fall back to mount values.
  const item = mount.itemId ? actor.items.get(mount.itemId) : null;
  const w = item?.system ?? {};
  const wName = item?.name ?? mount.name ?? "weapon";
  const basePen = Number(w.penetration ?? mount.penetration) || 0;
  const wa = Number(w.wa) || 0;
  const rof0 = Number(w.rof ?? mount.rof) || 1;
  const arc = w.arc ?? mount.arc ?? "turret";
  const ap = !!w.ap, heat = !!w.heat, hiEx = !!w.hiEx;
  const hefPenetrator = heat || hiEx;             // HEAT / Hi-Ex → Penetration not reduced by range
  const weaponRange = Number(w.range) || 0;

  // Target = a single targeted token (vehicle OR character — the dispatcher routes both, MM p.6 / p.8).
  const targets = [...(game.user?.targets ?? [])];
  const targetTok = targets.length === 1 ? targets[0] : null;
  const targetActor = targetTok?.actor ?? null;

  // Diegetic facing + range band + arc check from the tokens (auto; facing/range overridable below).
  const VT = await import("./vehicle-targeting.js");
  const firerTok = canvas?.tokens?.placeables?.find(t => t.actor?.id === actor.id) ?? null;
  let detFacing = "front", detRange = "normal", arcWarn = "";
  if (firerTok && targetTok) {
    detFacing = VT.detectFacingFromTokens(firerTok, targetTok);
    const dist = (() => { try { return canvas.grid.measureDistance(firerTok.center, targetTok.center); } catch { return 0; } })();
    detRange = VT.rangeBand(dist, weaponRange);
    const bearing = VT.bearingFromFirer(firerTok, targetTok);
    if (!VT.mountArcBears(bearing, arc)) {
      arcWarn = `<div style="color:#e0a020;font-size:0.82em;margin-top:2px;">⚠ Target is to the <b>${bearing}</b> of the firer — outside the <b>${arc}</b> mount's arc. You can still fire (override).</div>`;
    }
  }

  const isTurret = String(arc).toLowerCase().includes("turret");
  const facingOpts = FACINGS.map(f => `<option value="${f}" ${f === detFacing ? "selected" : ""}>${f}</option>`).join("");
  const rangeOpts = ["normal", "long", "extreme"].map(r => `<option value="${r}" ${r === detRange ? "selected" : ""}>${r.charAt(0).toUpperCase() + r.slice(1)}</option>`).join("");

  // Gunner picker — prefills REF + weapon skill from a boarded crew member (optional).
  const gunners = _candidateGunners(actor);
  const gunnersById = Object.fromEntries(gunners.map(a => [a.id, a]));
  const firstGunner = gunners[0] ?? null;
  const ref0 = Number(firstGunner?.system?.stats?.ref?.total) || 0;
  const skill0 = firstGunner ? (firstGunner.getSkillVal?.(GUNNER_SKILL) ?? 0) : 0;
  const gunnerOpts = gunners.length
    ? gunners.map(a => `<option value="${a.id}">${a.name}</option>`).join("")
    : `<option value="">(no occupant — manual)</option>`;

  const content = `
<div class="cyberpunk vehicle-fire-dialog" style="display:flex;flex-direction:column;gap:4px;">
  <div style="opacity:0.7;font-size:0.85em;">${actor.name} fires <b>${wName}</b>${targetActor ? ` at <b>${targetActor.name}</b>` : " (no target — apply from the chat card afterward)"}.${wa ? ` <span style="opacity:0.8;">WA ${wa >= 0 ? "+" : ""}${wa} auto-applied.</span>` : ""}</div>
  ${arcWarn}
  <label>Gunner <select id="cp-vf-gunner" style="margin-left:6px;">${gunnerOpts}</select></label>
  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    <label>Gunner REF <input type="number" id="cp-vf-ref" value="${ref0}" style="width:48px;"></label>
    <label>Weapon skill <input type="number" id="cp-vf-skill" value="${skill0}" style="width:48px;"></label>
    <label>Target # (DV) <input type="number" id="cp-vf-tn" value="15" style="width:48px;"></label>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    <label>Base penetration <input type="number" id="cp-vf-pen" value="${basePen}" style="width:48px;"></label>
    <label>ROF <input type="number" id="cp-vf-rof" value="${rof0}" style="width:48px;"></label>
    <label>Facing <select id="cp-vf-facing">${facingOpts}</select></label>
    <label>Range <select id="cp-vf-range">${rangeOpts}</select></label>
  </div>
  <fieldset style="border:1px solid var(--color-border-light-tertiary);padding:4px 6px;">
    <legend style="font-size:0.8em;">To-hit modifiers</legend>
    <label><input type="checkbox" id="cp-vf-stationary"> Target stationary (+4)</label>
    <label style="margin-left:8px;">Target speed (mph) <input type="number" id="cp-vf-tspeed" value="0" style="width:48px;"></label><br>
    <label><input type="checkbox" id="cp-vf-turret" ${isTurret ? "checked" : ""}> Turret mount (+2)</label>
    <label style="margin-left:8px;"><input type="checkbox" id="cp-vf-link" ${actor.system?.vehicleLink ? "checked" : ""}> Vehicle link (+2)</label><br>
    <label><input type="checkbox" id="cp-vf-moving"> Firer moving, unstabilized (−3)</label><br>
    <label><input type="checkbox" id="cp-vf-dark"> Dark / obscured (−3)</label>
    <label style="margin-left:8px;" title="The vehicle's fire-control / targeting-computer bonus (system.fireControl), auto-applied. Edit to add an ad-hoc bonus on top.">Fire control <input type="number" id="cp-vf-other" value="${Number(actor.system?.fireControl) || 0}" style="width:44px;"></label>
  </fieldset>
</div>`;

  const dialog = new Dialog({
    title: `🎯 Fire — ${actor.name}`,
    content,
    buttons: {
      fire: {
        label: "🎯 Fire",
        callback: async (html) => {
          const root = html instanceof jQuery ? html[0] : html;
          const num = (id) => Number(root.querySelector(id)?.value) || 0;
          const chk = (id) => !!root.querySelector(id)?.checked;
          await _executeVehicleFire(actor, targetActor, {
            ref: num("#cp-vf-ref"), skill: num("#cp-vf-skill"), targetNumber: num("#cp-vf-tn"),
            penetration: num("#cp-vf-pen"), rof: num("#cp-vf-rof"),
            facing: root.querySelector("#cp-vf-facing")?.value || "front",
            range: root.querySelector("#cp-vf-range")?.value || "normal",
            ap, hefPenetrator, heat,
            mods: wa + vehicleToHitModifier({
              targetLarge: targetActor ? targetActor.type === "vehicle" : true,
              isACPATarget: !!targetActor?.system?.isACPA,
              stationary: chk("#cp-vf-stationary"), targetSpeedMph: num("#cp-vf-tspeed"),
              turret: chk("#cp-vf-turret"), vehicleLink: chk("#cp-vf-link"),
              firerMoving: chk("#cp-vf-moving"), darkObscured: chk("#cp-vf-dark"),
              targetingComputer: num("#cp-vf-other"),
            }),
            mountName: wName,
          });
        },
      },
      cancel: { label: "Cancel" },
    },
    default: "fire",
    render: (html) => {
      const root = html instanceof jQuery ? html[0] : html;
      const gSel = root.querySelector("#cp-vf-gunner");
      const refIn = root.querySelector("#cp-vf-ref");
      const skillIn = root.querySelector("#cp-vf-skill");
      gSel?.addEventListener("change", () => {
        const g = gunnersById[gSel.value];
        if (!g) return;
        if (refIn) refIn.value = Number(g.system?.stats?.ref?.total) || 0;
        if (skillIn) skillIn.value = g.getSkillVal?.(GUNNER_SKILL) ?? 0;
      });
    },
  });
  return openSingletonDialog(`vehicle-fire:${actor.id}`, () => dialog);
}

async function _executeVehicleFire(actor, targetActor, p) {
  const d10 = (await new Roll("1d10").evaluate());
  const res = resolveVehicleToHit({ d10: d10.total, ref: p.ref, skill: p.skill, mods: p.mods, targetNumber: p.targetNumber });
  const extraRounds = roundsPerHit(p.rof) - 1;

  const verdict = res.hit
    ? `<span style="color:#3ad13a;font-weight:bold;">HIT</span> (${res.total} vs ${p.targetNumber})${res.goodShotSteps ? ` — Good Shot ×${res.goodShotSteps}` : ""}`
    : `<span style="color:#ff6060;font-weight:bold;">MISS</span> (${res.total} vs ${p.targetNumber})`;

  // On a hit with no pre-selected target, offer an Apply button so the GM can target a vehicle and
  // apply the same shot afterward (mirrors the personnel Apply-Damage flow).
  let applyBtn = "";
  if (res.hit && !targetActor) {
    applyBtn = `<div style="margin-top:6px;border-top:1px solid var(--color-border-dark-tertiary);padding-top:4px;">
      <span style="font-size:0.85em;opacity:0.8;">No target selected. Target the enemy token (vehicle or person), then:</span><br>
      <button class="cp-vfire-apply" style="margin-top:4px;"
        data-pen="${p.penetration}" data-facing="${p.facing}" data-range="${p.range}"
        data-gs="${res.goodShotSteps}" data-rounds="${extraRounds}"
        data-ap="${p.ap ? 1 : 0}" data-hef="${p.hefPenetrator ? 1 : 0}" data-heat="${p.heat ? 1 : 0}" data-weapon="${p.mountName}">💥 Apply to Target</button>
    </div>`;
  }

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${actor.name} — ${p.mountName}`,
    content: `<div class="cyberpunk vehicle-fire-result"><h3>🎯 ${p.mountName}</h3>
      <div>To-hit: 1d10 ${d10.total} + REF ${p.ref} + skill ${p.skill} + mods ${p.mods >= 0 ? "+" : ""}${p.mods} = <b>${res.total}</b></div>
      <div style="margin-top:2px;">${verdict}</div>${applyBtn}</div>`,
    rolls: [d10],
  });

  if (!res.hit || !targetActor) return res;
  await _applyVehicleShot(targetActor, {
    penetration: p.penetration, facing: p.facing, range: p.range,
    goodShotSteps: res.goodShotSteps, extraRounds, ap: p.ap, hefPenetrator: p.hefPenetrator, heat: p.heat, weaponName: p.mountName
  });
  return res;
}

/**
 * Apply a resolved vehicle shot to ANY target via the unified 5c dispatcher: a vehicle target uses
 * the Phase-4 resolver (Pen vs Armor Value), a person uses MM p.8 (Penetration vs the personal AV).
 */
async function _applyVehicleShot(targetActor, { penetration = 0, facing = "front", range = "normal", goodShotSteps = 0, extraRounds = 0, ap = false, hefPenetrator = false, heat = false, weaponName = "weapon" } = {}) {
  const { dispatchAttack } = await import("./vehicle-targeting.js");
  await dispatchAttack({
    scale: "penetration", penetration, facing, range, goodShotSteps, extraRounds, ap, hefPenetrator, heat, weaponName
  }, targetActor);
}

/** Chat handler for the "Apply to Targeted Vehicle" button on a vehicle-fire card. */
export function registerVehicleFireHandlers() {
  document.addEventListener("click", async (ev) => {
    const btn = ev.target.closest?.(".cp-vfire-apply");
    if (!btn || btn.disabled) return;
    ev.preventDefault();
    const targets = [...(game.user?.targets ?? [])];
    if (targets.length !== 1) { ui.notifications?.warn?.("Target exactly one token (vehicle or person), then click Apply."); return; }
    await _applyVehicleShot(targets[0].actor, {
      penetration: Number(btn.dataset.pen) || 0, facing: btn.dataset.facing || "front",
      range: btn.dataset.range || "normal", goodShotSteps: Number(btn.dataset.gs) || 0,
      extraRounds: Number(btn.dataset.rounds) || 0, ap: btn.dataset.ap === "1",
      hefPenetrator: btn.dataset.hef === "1", heat: btn.dataset.heat === "1", weaponName: btn.dataset.weapon || "weapon",
    });
  });
}
