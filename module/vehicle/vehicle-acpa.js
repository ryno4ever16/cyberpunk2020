/**
 * vehicle-acpa.js — Phase 6: powered-armor (ACPA) combat math core. Maximum Metal p.52-60.
 *
 * ACPA suits are already vehicles (the isACPA flag): they take Penetration-vs-Armor-Value damage with
 * an ACPA hit-location table. This module adds the detailed powered-armor combat layer on top:
 *   - the System Hit Table + Critical Hit Chart + System Integrity Check (p.55-56, charts p.103-104)
 *   - ACPA hand-to-hand damage (Punch/Crush/Kick, p.58)
 *   - derived movement (run / jump, p.57) and the naked Linear-Frame hit chance (p.56)
 *
 * Everything here is PURE and deterministic — pass the rolled d10s; no documents, no dice, no canvas.
 * The stateful integration (applying critical effects, per-turn cooling/interface ticks, the melee
 * dialog) is built on top in later commits.
 */

/* --------------------------- System Hit Table (MM p.55) --------------------------- */

/**
 * After damage penetrates the armor + Toughness Mod, a 50% (5-in-10) chance an EXTERNAL system is
 * hit instead of the suit proper (MM p.55). PURE: d10 1-5 → external.
 */
export function externalSystemHit(d10) {
  return (Math.max(1, Math.min(10, Math.round(Number(d10) || 1)))) <= 5;
}

/**
 * System Hit Table (MM p.55). PURE — pass a d10.
 *   1-3 chassis · 4-6 enclosed · 7-9 weapons · 10 → roll again (use acpaRollAgain).
 */
export function acpaSystemHit(d10) {
  const r = Math.max(1, Math.min(10, Math.round(Number(d10) || 1)));
  if (r <= 3) return "chassis";
  if (r <= 6) return "enclosed";
  if (r <= 9) return "weapons";
  return "rollAgain";
}

/** Resolve the "10 → roll again" branch: even → Critical Damage, odd → another System Hit. PURE. */
export function acpaRollAgain(d10) {
  const r = Math.max(1, Math.min(10, Math.round(Number(d10) || 1)));
  return (r % 2 === 0) ? "critical" : "systemHit";
}

/**
 * System Integrity Check (MM p.56). PURE. Given the SOP a struck system lost vs its total:
 *   lost < ½ total → 25% chance inoperable · ≥ ½ (not exceeding) → 75% · exceeds total → destroyed.
 * @returns {{destroyed:boolean, inopChance:number}}
 */
export function systemIntegrity({ sopLost = 0, sopTotal = 0 } = {}) {
  const lost = Math.max(0, Number(sopLost) || 0);
  const total = Math.max(0, Number(sopTotal) || 0);
  if (total > 0 && lost > total) return { destroyed: true, inopChance: 1 };
  const inopChance = (total > 0 && lost >= total / 2) ? 0.75 : 0.25;
  return { destroyed: false, inopChance };
}

/**
 * ACPA body-area hit location (the PA data form: Head[1], R.Arm[2], L.Arm[3], R.Leg[4-5],
 * L.Leg[6-7], Torso[8-0]). PURE — pass a d10.
 */
export function acpaBodyArea(d10) {
  const r = Math.max(1, Math.min(10, Math.round(Number(d10) || 1)));
  if (r === 1) return "Head";
  if (r === 2) return "Right Arm";
  if (r === 3) return "Left Arm";
  if (r <= 5) return "Right Leg";
  if (r <= 7) return "Left Leg";
  return "Torso";
}

/* --------------------------- Critical Hit Chart (MM p.55-56) --------------------------- */

/**
 * Critical Hit Chart (MM p.55-56, chart p.104). PURE — pass a d10. Returns the effect descriptor;
 * the resolver rolls the listed formula and applies it (tracked stat losses / timers).
 *   1-2 seize-up (1d10+1 rounds, body-area penalties)  · 3 cooling failure (heatstroke in 2d10 min)
 *   4-5 Suit STR −1d6                                   · 6-7 Suit REF −1d6/2
 *   8 Power Unit −(1d6×2) hours of life                 · 9 Interface out 1d6 rounds (2d6 civilian)
 *   10 Mechanical Shock: 1d6 extra SOP to a random area + pilot stunned that many rounds
 */
export function acpaCriticalEffect(d10) {
  const r = Math.max(1, Math.min(10, Math.round(Number(d10) || 1)));
  switch (true) {
    case r <= 2:  return { roll: r, type: "seizeUp",      formula: "1d10+1", unit: "rounds", label: "Body area seizes up (immobile)" };
    case r === 3: return { roll: r, type: "cooling",      formula: "2d10",   unit: "minutes", label: "Cooling failure — heatstroke" };
    case r <= 5:  return { roll: r, type: "strLoss",      formula: "1d6",    label: "Suit Strength lowered" };
    case r <= 7:  return { roll: r, type: "refLoss",      formula: "1d6", divisor: 2, label: "Suit Reflexes lowered (−1d6/2)" };
    case r === 8: return { roll: r, type: "powerLoss",    formula: "1d6", mult: 2, unit: "hours", label: "Power unit life reduced" };
    case r === 9: return { roll: r, type: "interfaceOut", formula: "1d6",    unit: "rounds", label: "Interface/electronics out" };
    default:      return { roll: r, type: "mechShock",    formula: "1d6",    unit: "SOP", label: "Mechanical shock (frame damage + stun)" };
  }
}

/**
 * Translate a rolled Critical Hit effect + its rolled amount into the actor update + a note. PURE
 * (no dice, no documents) so the field-writing is unit-testable. `sys` is the ACPA's current system.
 * @param {object} sys     the ACPA actor's system (reads current strDamage/refDamage/powerHours/…)
 * @param {object} effect  from acpaCriticalEffect()
 * @param {number} amount  the rolled value of effect.formula
 * @returns {{updates:object, note:string}}
 */
export function acpaCriticalUpdate(sys, effect, amount) {
  const cur = sys ?? {};
  const A = Math.max(0, Number(amount) || 0);
  switch (effect?.type) {
    case "seizeUp":
      return { updates: { "system.seizeUp": Math.max(Number(cur.seizeUp) || 0, A), "system.immobilized": true }, note: `seizes up ${A} round(s)` };
    case "cooling":
      return { updates: { "system.coolingTimer": A }, note: `overheats in ${A} min — heatstroke` };
    case "strLoss":
      return { updates: { "system.strDamage": (Number(cur.strDamage) || 0) + A }, note: `Suit STR −${A}` };
    case "refLoss": {
      const r = Math.round(A / (effect.divisor || 1));
      return { updates: { "system.refDamage": (Number(cur.refDamage) || 0) + r }, note: `Suit REF −${r}` };
    }
    case "powerLoss": {
      const h = A * (effect.mult || 1);
      return { updates: { "system.powerHours": Math.max(0, (Number(cur.powerHours ?? 24)) - h) }, note: `power-cell −${h}h` };
    }
    case "interfaceOut":
      return { updates: { "system.interfaceOut": Math.max(Number(cur.interfaceOut) || 0, A) }, note: `interface out ${A} round(s)` };
    case "mechShock": {
      const sdp = Number(cur.sdp?.value) || 0;
      return { updates: { "system.sdp": { value: Math.max(0, sdp - A), max: Number(cur.sdp?.max) || 0 } }, note: `${A} frame damage + pilot stun` };
    }
    default:
      return { updates: {}, note: effect?.label || "" };
  }
}

/**
 * One combat round of ACPA status decay (MM p.55-56). PURE — pass the suit's system, get the actor
 * update + narration lines. Round-based timers (seize-up, interface-out) count down; seize-up ending
 * restores mobility. (Cooling is tracked in minutes and left for the GM / the sheet readout.)
 * @returns {{updates:object, lines:string[]}}
 */
export function acpaTickStatus(sys) {
  const seize = Number(sys?.seizeUp) || 0;
  const iface = Number(sys?.interfaceOut) || 0;
  const updates = {};
  const lines = [];
  if (seize > 0) {
    const next = seize - 1;
    updates["system.seizeUp"] = next;
    if (next <= 0) { updates["system.immobilized"] = false; lines.push("seize-up ends — mobility restored"); }
    else lines.push(`seized up (${next} round${next !== 1 ? "s" : ""} left)`);
  }
  if (iface > 0) {
    const next = iface - 1;
    updates["system.interfaceOut"] = next;
    lines.push(next <= 0 ? "interface/electronics restored" : `interface out (${next} round${next !== 1 ? "s" : ""} left)`);
  }
  return { updates, lines };
}

/* ------------------------------- Hand-to-hand (MM p.58) ------------------------------- */

/**
 * ACPA melee damage in d10s (MM p.58). PURE.
 *   X = round(STR / 9);  Punch = X d10 · Crush = (X+1) d10 · Kick = round(1.5·X) d10.
 * @returns {{x:number, dice:number, formula:string}}
 */
export function acpaMeleeDamage(str, kind = "punch") {
  const x = Math.max(0, Math.round((Number(str) || 0) / 9));
  let dice;
  switch (String(kind).toLowerCase()) {
    case "crush": dice = x + 1; break;
    case "kick":  dice = Math.round(x * 1.5); break;
    default:      dice = x; break;   // punch
  }
  dice = Math.max(1, dice);
  return { x, dice, formula: `${dice}d10` };
}

/* --------------------------------- Movement (MM p.57) --------------------------------- */

/** Running speed in metres/combat round: (SIB + MA) × 3 (MM p.57). PURE. */
export function acpaRunM({ sib = 0, ma = 0 } = {}) {
  return ((Number(sib) || 0) + (Number(ma) || 0)) * 3;
}

/** Jump distance in metres (MM p.57): stationary = run/6, running = run/4, vertical = horizontal/3. PURE. */
export function acpaJumpM(runM, { running = false, vertical = false } = {}) {
  const r = Math.max(0, Number(runM) || 0);
  const horizontal = running ? r / 4 : r / 6;
  return vertical ? horizontal / 3 : horizontal;
}

/* ------------------------------ Construction / Linear Frame (MM p.61-63) ------------------------------ */

/**
 * Per-body-area frame SOP from chassis STR (MM p.61): Head and each Arm 25%, each Leg 50%, Torso 75%
 * (rounded). These are the Structural Damage Points of the FRAME in each area; destroying an area's
 * frame SOP knocks out its systems, and destroying the Torso shuts the suit down. PURE.
 * @returns {{head:number, rArm:number, lArm:number, rLeg:number, lLeg:number, torso:number}}
 */
export function acpaAreaSOP(str) {
  const s = Math.max(0, Number(str) || 0);
  const r = (p) => Math.round(s * p);
  return { head: r(0.25), rArm: r(0.25), lArm: r(0.25), rLeg: r(0.5), lLeg: r(0.5), torso: r(0.75) };
}

/** The Chassis Inventory Table (MM p.62): chassis STR → frame stats. Toughness Mod reduces incoming damage. */
const CHASSIS_TABLE = [
  { str: 12, toughness: -5,  damMod: "+4",     lift: 600,  carry: 180, weight: 125, cost: 5000 },
  { str: 14, toughness: -5,  damMod: "+6",     lift: 700,  carry: 210, weight: 138, cost: 7000 },
  { str: 16, toughness: -5,  damMod: "1d6+2",  lift: 800,  carry: 240, weight: 150, cost: 9000 },
  { str: 20, toughness: -6,  damMod: "1d10",   lift: 1000, carry: 300, weight: 116, cost: 28450 },
  { str: 25, toughness: -7,  damMod: "1d10+2", lift: 1250, carry: 375, weight: 138, cost: 37360 },
  { str: 27, toughness: -7,  damMod: "1d10+5", lift: 1350, carry: 405, weight: 146, cost: 38700 },
  { str: 30, toughness: -8,  damMod: "1d10+5", lift: 1500, carry: 450, weight: 158, cost: 46990 },
  { str: 32, toughness: -8,  damMod: "3d6-1",  lift: 1600, carry: 480, weight: 166, cost: 50890 },
  { str: 35, toughness: -9,  damMod: "3d6-1",  lift: 1750, carry: 525, weight: 180, cost: 56140 },
  { str: 37, toughness: -9,  damMod: "3d6-1",  lift: 1850, carry: 555, weight: 185, cost: 61050 },
  { str: 40, toughness: -10, damMod: "2d10",   lift: 2000, carry: 600, weight: 200, cost: 66000 },
  { str: 42, toughness: -10, damMod: "2d10",   lift: 2100, carry: 630, weight: 208, cost: 69970 },
  { str: 45, toughness: -11, damMod: "2d10",   lift: 2250, carry: 675, weight: 222, cost: 75250 },
  { str: 50, toughness: -12, damMod: "2d10+5", lift: 2500, carry: 750, weight: 242, cost: 85230 },
  { str: 52, toughness: -12, damMod: "2d10+5", lift: 2600, carry: 780, weight: 250, cost: 89230 },
];

/** Frame stats for a chassis STR (the row at or below it; clamped to the smallest). PURE. */
export function chassisStats(str) {
  const s = Number(str) || 0;
  let row = CHASSIS_TABLE[0];
  for (const r of CHASSIS_TABLE) { if (s >= r.str) row = r; else break; }
  return { ...row };
}

/* ------------------------------ Linear Frame (naked) (MM p.56) ------------------------------ */

/**
 * A naked Linear Frame takes a weapon hit only on a chance based on size (MM p.56). PURE.
 *   basic (STR 12-16) → 2-in-10 (0.2) · advanced (STR 20-52) → 3-in-10 (0.3).
 */
export function linearFrameHitChance(str) {
  const s = Number(str) || 0;
  if (s >= 20) return 0.3;
  if (s >= 12) return 0.2;
  return 0.2;
}
