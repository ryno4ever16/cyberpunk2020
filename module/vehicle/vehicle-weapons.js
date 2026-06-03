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
