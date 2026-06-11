/**
 * vehicle-control.js — Phase 3: vehicle Movement & Control rolls.
 *
 * Two toggle-selectable rule systems (the `vehicleRuleSystem` world setting):
 *
 *   CORE — "Vehicles in FNFF", CP2020 Core p.112.
 *     Control Roll = REF + Driving/Piloting Skill + 1d10 + modifiers, vs a Difficulty Value
 *     (Simple 15 / Difficult 20 / Very Difficult 25). Vehicle handling and over-safe-speed
 *     modifiers are ADDED to the roll. On a failed roll, 1d6 on the CONTROL LOSS TABLE:
 *       1-2 skid (no other effect)
 *       3-4 major skid: slide 1d10×10 ft sideways  /  aircraft stalls, lose 1d10×50 ft altitude
 *       5-6 roll: slide 1d10×10 ft then take 5d6 damage  /  aircraft spins, lose 1d10×100 ft
 *
 *   MAXIMUM METAL — Maneuvering/Chasing/Evading, MM p.10-11.
 *     Same roll, but speed and conditions raise the DIFFICULTY (DV) instead of lowering the roll:
 *       +1 per full 10% of speed over 50% of top speed; +10 can't see; +5 doing something else
 *       (unless cyberlinked); +3 slippery; +5 icy. Cyberlinked controls give +2 to the roll (p.51).
 *     On a failed roll, 1d6 + 1 per full 3 points missed by, on the FAILURE TABLE:
 *       1-4 skid/slew: weapons −5; DV15 control roll if within 2m of an obstacle or sideswipe
 *       5-6 lose control: weapons −10; skid 1d10×3 m (air: stall 1d10×50 ft); DV20 next turn to recover
 *       7+  catastrophic: no weapons; roll 1d10×3 m taking Pen 1d6 to thinnest armor (air: spin 1d10×100 ft)
 *
 * The math below is split into PURE, deterministic functions (they take the already-rolled die
 * faces as arguments) so the whole resolution can be unit-tested without a UI. The Dialog at the
 * bottom is a thin wrapper: it rolls the dice, calls these functions, and renders a chat card.
 */

import { localize, openSingletonDialog } from "../utils.js";
import { effectiveVehicleRuleSystem } from "../settings.js";

const SCOPE = "cyberpunk2020";

/** Difficulty Values shared by both systems (Core p.112 / MM p.11). */
export const CONTROL_DV = { simple: 15, difficult: 20, veryDifficult: 25 };

/** Example maneuvers per difficulty band, for the dialog's hint text (MM p.11 / Core p.112). */
export const MANEUVER_EXAMPLES = {
  simple:        "swerve, take off / land, hover, rotate, mild turn",
  difficult:     "tight turn, control a skid, emergency stop, pull out of a dive, reverse",
  veryDifficult: "bootlegger reverse, extremely tight turn, vertical aerial maneuver, regain control from a spin",
};

/**
 * Core over-safe-speed penalty (Core p.112): −2 at 2× safe speed, −4 at 3×, −6 at 4×.
 * Added to the roll (so negative). Returns 0 at or below safe speed, or if safe speed is unknown.
 */
export function coreSpeedPenalty(speed, safeSpeed) {
  const s = Number(speed) || 0;
  const safe = Number(safeSpeed) || 0;
  if (safe <= 0 || s <= 0) return 0;
  const ratio = s / safe;
  if (ratio >= 4) return -6;
  if (ratio >= 3) return -4;
  if (ratio >= 2) return -2;
  return 0;
}

/**
 * Maximum Metal speed difficulty (MM p.11): +1 to the DV per full 10% of top speed that the
 * current speed exceeds 50% of top speed. Returns 0 at or below half top speed / unknown top speed.
 */
export function mmSpeedDV(speed, topSpeed) {
  const s = Number(speed) || 0;
  const top = Number(topSpeed) || 0;
  if (top <= 0 || s <= 0) return 0;
  const halfTop = top * 0.5;
  if (s <= halfTop) return 0;
  return Math.floor((s - halfTop) / (top * 0.10));   // +1 per 10% of top speed over the half mark
}

/**
 * Default per-type vehicle handling modifier, used to PREFILL the dialog when the actor's stored
 * controlMod is 0. Core (p.112) and MM "Revised Control Modifiers" (p.11) differ for some types.
 * The GM can always override the prefilled value.
 */
export function defaultControlMod(vehicleType, ruleSystem = "Core") {
  const t = String(vehicleType || "").toLowerCase();
  const core = {
    car: 0, sportscar: 2, limo: -3, "av-4": -2, "av-6": 2, "av-7": 1,
    cycle: 1, motorcycle: 1, truck: -4, rotor: 0, osprey: 0, boat: -1,
  };
  const mm = {
    car: 0, sportscar: 0, limo: -3, pickup: -3, cycle: 1, motorcycle: 1, truck: -4,
    apc: 2, ifv: 2, mbt: 2, tank: 2, hover: -2, boat: -1,
    "av-4": 0, "av-6": 0, "av-7": 0, av: 0, osprey: 0, rotor: -2, airship: 5,
  };
  const table = ruleSystem === "MaximumMetal" ? mm : core;
  return Object.prototype.hasOwnProperty.call(table, t) ? table[t] : 0;
}

/** Aircraft branch of the loss tables (stall/spin instead of skid/roll). */
export function isAircraft(vehicleType) {
  const t = String(vehicleType || "").toLowerCase();
  return /av-|\bav\b|rotor|osprey|heli|plane|jet|airship|gyro|aerodyne|dirigible|wing/.test(t);
}

/**
 * Resolve a control/maneuver roll given the d10 already rolled. PURE — no dice, no chat.
 * @returns {{ruleSystem, isMM, total, dv, success, missedBy, rollParts, dvParts}}
 *   rollParts/dvParts are [{label, value}] breakdowns for transparent display.
 */
export function resolveControlRoll({
  ruleSystem = "Core",
  difficulty = "simple",
  ref = 0, skill = 0, handlingMod = 0,
  currentSpeed = 0, safeSpeed = 0, topSpeed = 0,
  cyberlink = false, otherMod = 0,
  cantSee = false, multitask = false, slippery = false, icy = false,
  d10 = 0,
} = {}) {
  const isMM = ruleSystem === "MaximumMetal";
  const baseDV = CONTROL_DV[difficulty] ?? CONTROL_DV.simple;

  const rollParts = [
    { label: "1d10", value: Number(d10) || 0 },
    { label: "REF", value: Number(ref) || 0 },
    { label: "Skill", value: Number(skill) || 0 },
  ];
  if (handlingMod) rollParts.push({ label: "Handling", value: Number(handlingMod) || 0 });

  const dvParts = [{ label: difficulty, value: baseDV }];

  if (isMM) {
    if (cyberlink) rollParts.push({ label: "Cyberlink", value: 2 });
    const sdv = mmSpeedDV(currentSpeed, topSpeed);
    if (sdv) dvParts.push({ label: "Speed", value: sdv });
    if (cantSee) dvParts.push({ label: "Can't see", value: 10 });
    if (multitask) dvParts.push({ label: "Multitasking", value: 5 });
    if (slippery) dvParts.push({ label: "Slippery", value: 3 });
    if (icy) dvParts.push({ label: "Icy", value: 5 });
    if (Number(otherMod)) dvParts.push({ label: "Other", value: Number(otherMod) });
  } else {
    const sp = coreSpeedPenalty(currentSpeed, safeSpeed);
    if (sp) rollParts.push({ label: "Speed", value: sp });
    if (Number(otherMod)) rollParts.push({ label: "Other", value: Number(otherMod) });
  }

  const total = rollParts.reduce((s, p) => s + (Number(p.value) || 0), 0);
  const dv = dvParts.reduce((s, p) => s + (Number(p.value) || 0), 0);
  const success = total >= dv;                       // RAW: "equal to or greater than"
  return { ruleSystem, isMM, total, dv, success, missedBy: Math.max(0, dv - total), rollParts, dvParts };
}

/**
 * Core CONTROL LOSS TABLE outcome (p.112). PURE — pass the rolled die faces.
 * @param {number} d6        1d6 table roll
 * @param {object} opts
 * @param {boolean} opts.aircraft   stall/spin branch
 * @param {number}  opts.slideDie   a 1d10 (used ×10 ft skid / ×50 ft stall / ×100 ft spin)
 * @param {number}  opts.crashDamage 5d6 total (only used on the 5-6 ground result)
 */
export function coreControlLoss(d6, { aircraft = false, slideDie = 0, crashDamage = 0 } = {}) {
  const r = Number(d6) || 0;
  if (r <= 2) {
    return { band: "1-2", severity: "minor", text: "Skid or slew — no other effect." };
  }
  if (r <= 4) {
    return aircraft
      ? { band: "3-4", severity: "major", text: `Stall — the aircraft loses ${slideDie * 50} ft of altitude (${slideDie}×50).` }
      : { band: "3-4", severity: "major", text: `Major skid — slide ${slideDie * 10} ft (${slideDie}×10) sideways in the direction of travel.` };
  }
  return aircraft
    ? { band: "5-6", severity: "catastrophic", text: `Spin — the aircraft loses ${slideDie * 100} ft of altitude (${slideDie}×100).` }
    : { band: "5-6", severity: "catastrophic", damage: crashDamage,
        text: `Roll — slide ${slideDie * 10} ft sideways, then the vehicle takes <b>${crashDamage}</b> damage (5d6) to its SDP. Occupants take half.` };
}

/**
 * Maximum Metal FAILURE TABLE outcome (p.10). PURE.
 * @param {number} tableRoll   1d6 + floor(missedBy/3)
 * @param {object} opts
 * @param {boolean} opts.aircraft
 * @param {number}  opts.skidDie  a 1d10 (×3 m skid / ×50 ft stall / ×100 ft spin)
 */
export function mmFailureTable(tableRoll, { aircraft = false, skidDie = 0 } = {}) {
  const r = Number(tableRoll) || 0;
  if (r <= 4) {
    return { band: "1-4", severity: "skid",
      text: "Skid / slew sideways. All weapon fire is −5 this turn. If within 2 m of an obstacle or another vehicle, succeed at a Difficulty 15 control roll or sustain a sideswipe collision." };
  }
  if (r <= 6) {
    return aircraft
      ? { band: "5-6", severity: "lose-control",
          text: `Lose control. All weapon fire −10 this turn. The aircraft stalls, losing ${skidDie * 50} ft (${skidDie}×50, ≈15 m) of altitude. Make a Difficulty 20 control roll next turn to regain control, or roll the Failure Table again.` }
      : { band: "5-6", severity: "lose-control",
          text: `Lose control. All weapon fire −10 this turn. The vehicle skids ${skidDie * 3} m (${skidDie}×3) sideways. Make a Difficulty 20 control roll next turn to regain control, or roll the Failure Table again. It crashes if it meets an obstacle within the skid distance.` };
  }
  return aircraft
    ? { band: "7+", severity: "catastrophic",
        text: `Catastrophic control loss — no weapon fire this turn. The aircraft goes into a tailspin, losing ${skidDie * 100} ft (${skidDie}×100, ≈30 m) of altitude per turn until control is regained (Difficulty 25 Pilot roll) or it crashes.` }
    : { band: "7+", severity: "catastrophic",
        text: `Catastrophic control loss — no weapon fire this turn. The vehicle rolls ${skidDie * 3} m (${skidDie}×3), taking a Penetration 1d6 hit to its thinnest armor; it keeps rolling (speed/20 turns), taking Pen 1d6 to the thinnest armor each turn.` };
}

/**
 * Compose a full control-roll outcome from already-rolled die faces. PURE — no Foundry Roll, no
 * chat. The live dialog AND the test suite both call this, so the dice→table wiring (which table,
 * the +missedBy/3 escalation, the "5d6 only on a ground 5-6" rule) is exercised by tests rather
 * than duplicated in a parallel copy.
 *
 * @param {object} params  same shape as resolveControlRoll, plus `vehicleType` for the aircraft branch
 * @param {object} dice    { d10, tableD6, slideD10, crashD6Total }
 * @returns {{result, outcome:(object|null), aircraft:boolean}}
 */
export function composeControlOutcome(params = {}, dice = {}) {
  const result = resolveControlRoll({ ...params, d10: dice.d10 ?? 0 });
  const aircraft = isAircraft(params.vehicleType);
  let outcome = null;
  if (!result.success) {
    const tableD6 = Number(dice.tableD6) || 0;
    const slide = Number(dice.slideD10) || 0;
    if (result.isMM) {
      const tableTotal = tableD6 + Math.floor(result.missedBy / 3);
      outcome = mmFailureTable(tableTotal, { aircraft, skidDie: slide });
      outcome.tableTotal = tableTotal;
    } else {
      const crash = (tableD6 >= 5 && !aircraft) ? (Number(dice.crashD6Total) || 0) : 0;
      outcome = coreControlLoss(tableD6, { aircraft, slideDie: slide, crashDamage: crash });
      outcome.tableTotal = tableD6;
    }
  }
  return { result, outcome, aircraft };
}

/* ------------------------------------------------------------------ *
 *  UI wrapper — Control Roll dialog + chat card (thin over the math). *
 * ------------------------------------------------------------------ */

const SEV_COLOR = { minor: "#caa300", major: "#e07b00", catastrophic: "#ff3030", skid: "#caa300", "lose-control": "#e07b00" };

function _candidateDrivers(actor) {
  // Crew currently boarded to this vehicle on the canvas, then the user's owned characters.
  const boarded = (canvas?.tokens?.placeables ?? [])
    .filter(t => t.document?.flags?.[SCOPE]?.boardedVehicle === actor.id && t.actor)
    .map(t => t.actor);
  const owned = game.actors.filter(a => (a.type === "character" || a.type === "npc") && a.isOwner && !a.getFlag(SCOPE, "missileProxy"));
  const seen = new Set();
  const out = [];
  for (const a of [...boarded, ...owned]) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

const DRIVE_SKILLS = ["Driving", "Motorcycle", "Pilot", "OperateHeavyMachinery"];

function _skillOptions(selected) {
  return DRIVE_SKILLS.map(k => {
    const label = (() => { try { return localize("Skill" + k); } catch { return k; } })();
    return `<option value="${k}" ${k === selected ? "selected" : ""}>${label}</option>`;
  }).join("");
}

/**
 * Open the Control / Maneuver Roll dialog for a vehicle actor, roll it, and post a result card.
 * Honors the `vehicleControlEnabled` and `vehicleRuleSystem` settings.
 * @returns {Promise<Dialog|null>} the opened Dialog, or null when gated off / not a vehicle.
 */
export async function openControlRollDialog(actor, opts = {}) {
  if (!actor || actor.type !== "vehicle") return null;
  const enabled = (() => { try { return game.settings.get(SCOPE, "vehicleControlEnabled"); } catch { return true; } })();
  if (!enabled) { ui.notifications?.warn?.("Vehicle control rolls are disabled in the system settings."); return null; }
  const ruleSystem = (() => { try { return effectiveVehicleRuleSystem(); } catch { return "Core"; } })();   // Core whenever Maximum Metal is off
  const isMM = ruleSystem === "MaximumMetal";

  const sys = actor.system ?? {};
  const drivers = _candidateDrivers(actor);
  const firstDriver = drivers[0] ?? null;
  // An ACPA pilots with the suit's capped effective REF when no separate driver is boarded.
  const ref0 = Number(firstDriver?.system?.stats?.ref?.total) || (sys.isACPA ? (Number(sys.effectiveRef) || 0) : 0);
  const skill0 = firstDriver ? (firstDriver.getSkillVal?.("Driving") ?? 0) : 0;
  const handling0 = Number(sys.controlMod) || defaultControlMod(sys.vehicleType, ruleSystem);
  const speedRef = isMM ? (Number(sys.topSpeed) || 0) : (Number(sys.safeSpeed) || 0);

  const driverOptions = drivers.length
    ? drivers.map(a => `<option value="${a.id}">${a.name}</option>`).join("")
    : `<option value="">(manual entry)</option>`;

  const mmConditions = `
    <fieldset style="border:1px solid var(--color-border-light-tertiary); padding:4px 6px;">
      <legend style="font-size:0.8em;">Conditions (raise Difficulty)</legend>
      <label><input type="checkbox" id="cp-ctl-cantsee"> Can't see / no sensors (+10)</label><br>
      <label><input type="checkbox" id="cp-ctl-multitask"> Doing something else (+5)</label><br>
      <label><input type="checkbox" id="cp-ctl-slippery"> Slippery road (+3)</label>
      <label style="margin-left:8px;"><input type="checkbox" id="cp-ctl-icy"> Icy road (+5)</label><br>
      <label><input type="checkbox" id="cp-ctl-cyberlink"> Cyberlinked controls (+2 to roll)</label>
    </fieldset>`;

  const content = `
<div class="cyberpunk vehicle-control-dialog" style="display:flex; flex-direction:column; gap:6px;">
  <div style="opacity:0.7; font-size:0.85em;">${isMM ? "Maximum Metal — Maneuver" : "Core — Control"} roll for <b>${actor.name}</b>.</div>
  <label>Driver
    <select id="cp-ctl-driver" style="margin-left:6px;">${driverOptions}</select>
  </label>
  <div style="display:flex; gap:8px;">
    <label>REF <input type="number" id="cp-ctl-ref" value="${ref0}" style="width:56px;"></label>
    <label>Skill
      <select id="cp-ctl-skillkey" style="margin:0 4px;">${_skillOptions("Driving")}</select>
      <input type="number" id="cp-ctl-skill" value="${skill0}" style="width:56px;">
    </label>
  </div>
  <label>Maneuver
    <select id="cp-ctl-difficulty" style="margin-left:6px;">
      <option value="simple">Simple — 15</option>
      <option value="difficult">Difficult — 20</option>
      <option value="veryDifficult">Very Difficult — 25</option>
    </select>
  </label>
  <div id="cp-ctl-maneuver-hint" style="font-size:0.78em; opacity:0.65;">${MANEUVER_EXAMPLES.simple}</div>
  <div style="display:flex; gap:8px; align-items:center;">
    <label>Current speed <input type="number" id="cp-ctl-speed" value="0" style="width:64px;"></label>
    <span style="font-size:0.78em; opacity:0.65;">${isMM ? `top ${speedRef}` : `safe ${speedRef}`} (${isMM ? "kph÷1.2 or mph×1.33 = m/turn" : "same units as safe speed"})</span>
  </div>
  <label>Vehicle handling mod <input type="number" id="cp-ctl-handling" value="${handling0}" style="width:56px;"></label>
  ${isMM ? mmConditions : `<label>Other modifier to roll <input type="number" id="cp-ctl-other" value="0" style="width:56px;"></label>`}
  ${isMM ? `<label>Other Difficulty modifier <input type="number" id="cp-ctl-otherdv" value="0" style="width:56px;"></label>` : ""}
</div>`;

  const driversById = Object.fromEntries(drivers.map(a => [a.id, a]));

  const dialog = new foundry.applications.api.DialogV2({
    window: { title: `🎲 ${isMM ? "Maneuver" : "Control"} Roll — ${actor.name}` },
    content,
    buttons: [
      {
        action: "roll",
        label: "🎲 Roll",
        default: true,
        callback: async (ev, btn, dlg) => {
          const root = dlg.element;
          const num = (id) => Number(root.querySelector(id)?.value) || 0;
          const checked = (id) => !!root.querySelector(id)?.checked;
          const driverId = root.querySelector("#cp-ctl-driver")?.value || "";
          const driver = driversById[driverId] ?? null;
          const difficulty = root.querySelector("#cp-ctl-difficulty")?.value || "simple";

          await _executeControlRoll(actor, {
            ruleSystem, isMM, driver, difficulty,
            ref: num("#cp-ctl-ref"), skill: num("#cp-ctl-skill"),
            handlingMod: num("#cp-ctl-handling"),
            currentSpeed: num("#cp-ctl-speed"),
            safeSpeed: Number(sys.safeSpeed) || 0,
            topSpeed: Number(sys.topSpeed) || 0,
            otherMod: isMM ? 0 : num("#cp-ctl-other"),
            otherDV: isMM ? num("#cp-ctl-otherdv") : 0,
            cyberlink: isMM && checked("#cp-ctl-cyberlink"),
            cantSee: isMM && checked("#cp-ctl-cantsee"),
            multitask: isMM && checked("#cp-ctl-multitask"),
            slippery: isMM && checked("#cp-ctl-slippery"),
            icy: isMM && checked("#cp-ctl-icy"),
          });
        },
      },
      { action: "cancel", label: "Cancel" },
    ],
    render: (event, dlg) => {
      const root = dlg.element;
      const refIn = root.querySelector("#cp-ctl-ref");
      const skillIn = root.querySelector("#cp-ctl-skill");
      const skillKey = root.querySelector("#cp-ctl-skillkey");
      const driverSel = root.querySelector("#cp-ctl-driver");
      const diffSel = root.querySelector("#cp-ctl-difficulty");
      const hint = root.querySelector("#cp-ctl-maneuver-hint");
      const refreshDriver = () => {
        const a = driversById[driverSel?.value];
        if (!a) return;
        if (refIn) refIn.value = Number(a.system?.stats?.ref?.total) || 0;
        if (skillIn) skillIn.value = a.getSkillVal?.(skillKey?.value || "Driving") ?? 0;
      };
      const refreshSkill = () => {
        const a = driversById[driverSel?.value];
        if (a && skillIn) skillIn.value = a.getSkillVal?.(skillKey?.value || "Driving") ?? 0;
      };
      driverSel?.addEventListener("change", refreshDriver);
      skillKey?.addEventListener("change", refreshSkill);
      diffSel?.addEventListener("change", () => { if (hint) hint.textContent = MANEUVER_EXAMPLES[diffSel.value] ?? ""; });
    },
  });
  return openSingletonDialog(`vehicle-control:${actor.id}`, () => dialog);
}

/** Roll the dice, run the pure resolver + loss tables, and post the result card. */
async function _executeControlRoll(actor, p) {
  const params = {
    ruleSystem: p.ruleSystem, difficulty: p.difficulty, vehicleType: actor.system?.vehicleType,
    ref: p.ref, skill: p.skill, handlingMod: p.handlingMod,
    currentSpeed: p.currentSpeed, safeSpeed: p.safeSpeed, topSpeed: p.topSpeed,
    cyberlink: p.cyberlink, otherMod: p.isMM ? p.otherDV : p.otherMod,
    cantSee: p.cantSee, multitask: p.multitask, slippery: p.slippery, icy: p.icy,
  };

  const d10Roll = await new Roll("1d10").evaluate();
  const rolls = [d10Roll];

  // Peek at success with the rolled d10 so we only roll loss-table dice when needed.
  const preview = resolveControlRoll({ ...params, d10: d10Roll.total });
  const dice = { d10: d10Roll.total };
  if (!preview.success) {
    const tblRoll = await new Roll("1d6").evaluate();
    const slideRoll = await new Roll("1d10").evaluate();
    rolls.push(tblRoll, slideRoll);
    dice.tableD6 = tblRoll.total;
    dice.slideD10 = slideRoll.total;
    if (!p.isMM && tblRoll.total >= 5 && !isAircraft(params.vehicleType)) {
      const dmg = await new Roll("5d6").evaluate();
      rolls.push(dmg);
      dice.crashD6Total = dmg.total;
    }
  }

  const { result, outcome } = composeControlOutcome(params, dice);
  let lossHtml = "";
  if (outcome) {
    const rollStr = result.isMM
      ? `1d6 ${dice.tableD6} + ${Math.floor(result.missedBy / 3)} (missed by ${result.missedBy}) = <b>${outcome.tableTotal}</b>`
      : `1d6 = <b>${dice.tableD6}</b>`;
    lossHtml = _lossCard(result.isMM ? "Failure Table" : "Control Loss Table", rollStr, outcome);
  }

  const rollPartsStr = result.rollParts.map(p2 => `${p2.label} ${p2.value >= 0 ? "+" : "−"}${Math.abs(p2.value)}`).join(" ").replace(/^[+−]/, "");
  const dvPartsStr = result.dvParts.map(p2 => `${p2.label} ${p2.value}`).join(" + ");
  const driverName = p.driver?.name ?? "Driver";
  const verdict = result.success
    ? `<span style="color:#3ad13a;font-weight:bold;">✅ SUCCESS</span> — ${actor.name} holds the line.`
    : `<span style="color:#ff3030;font-weight:bold;">❌ FAILED</span> — control lost (rolled below DV by ${result.missedBy}).`;

  const content = `
<div class="cyberpunk vehicle-control-result">
  <h3>🎲 ${p.isMM ? "Maneuver" : "Control"} Roll — ${actor.name}</h3>
  <div style="font-size:0.9em;">${driverName} · <b>${p.difficulty}</b> maneuver</div>
  <div style="margin-top:2px;">Roll: <b>${result.total}</b> (${rollPartsStr}) vs DV <b>${result.dv}</b> (${dvPartsStr})</div>
  <div style="margin-top:4px;">${verdict}</div>
  ${lossHtml}
</div>`;

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: `${p.isMM ? "Maximum Metal" : "Core"} ${p.difficulty} maneuver — need ≥ ${result.dv}`,
    content,
    rolls,
  });
  return result;
}

function _lossCard(tableName, rollStr, outcome) {
  const color = SEV_COLOR[outcome.severity] ?? "#e07b00";
  return `
  <div style="margin-top:6px; border-top:1px solid var(--color-border-dark-tertiary); padding-top:4px;">
    <div style="font-size:0.85em; opacity:0.8;">${tableName}: ${rollStr} → <b>${outcome.band}</b></div>
    <div style="margin-top:2px; color:${color};">${outcome.text}</div>
  </div>`;
}
