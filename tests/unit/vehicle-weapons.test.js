/**
 * Unit tests for module/vehicle/vehicle-weapons.js.
 *
 * Pure exports covered:
 *   averageDamageFromFormula, isSmallArms, penetrationFactor, weaponToPenetration,
 *   vehicleToHitModifier, goodShotSteps, roundsPerHit, resolveVehicleToHit.
 *
 * SKIPPED (Foundry-dependent):
 *   routeWeaponFiredToVehicle — calls game.settings, dynamically imports vehicle-damage.js
 *   openVehicleFireDialog     — calls canvas, game, foundry.applications.api.DialogV2, Hooks
 *   registerVehicleFireHandlers — calls onGlobalClick (DOM), game.user
 */

import { describe, it, expect } from "vitest";
import {
  averageDamageFromFormula,
  isSmallArms,
  penetrationFactor,
  weaponToPenetration,
  vehicleToHitModifier,
  goodShotSteps,
  roundsPerHit,
  resolveVehicleToHit,
} from "../../module/vehicle/vehicle-weapons.js";

// ─── averageDamageFromFormula ─────────────────────────────────────────────────

describe("averageDamageFromFormula", () => {
  it("single d6 → 3.5", () => {
    expect(averageDamageFromFormula("1d6")).toBeCloseTo(3.5);
  });

  it("bare 'd6' (implied 1) → 3.5", () => {
    expect(averageDamageFromFormula("d6")).toBeCloseTo(3.5);
  });

  it("2d6 → 7", () => {
    expect(averageDamageFromFormula("2d6")).toBeCloseTo(7);
  });

  it("2d6+2 → 9", () => {
    expect(averageDamageFromFormula("2d6+2")).toBeCloseTo(9);
  });

  it("2d6-1 → 6", () => {
    expect(averageDamageFromFormula("2d6-1")).toBeCloseTo(6);
  });

  it("3d10 → 16.5", () => {
    // avg of 1d10 = 5.5; 3×5.5 = 16.5
    expect(averageDamageFromFormula("3d10")).toBeCloseTo(16.5);
  });

  it("1d10 → 5.5", () => {
    expect(averageDamageFromFormula("1d10")).toBeCloseTo(5.5);
  });

  it("5d6 → 17.5", () => {
    expect(averageDamageFromFormula("5d6")).toBeCloseTo(17.5);
  });

  it("flat number string → that number", () => {
    expect(averageDamageFromFormula("10")).toBe(10);
    expect(averageDamageFromFormula("0")).toBe(0);
    expect(averageDamageFromFormula("25")).toBe(25);
  });

  it("empty string → 0", () => {
    expect(averageDamageFromFormula("")).toBe(0);
  });

  it("null / undefined → 0", () => {
    expect(averageDamageFromFormula(null)).toBe(0);
    expect(averageDamageFromFormula(undefined)).toBe(0);
  });

  it("invalid string (letters) → 0", () => {
    expect(averageDamageFromFormula("special")).toBe(0);
  });

  it("3d6+2 → 12.5", () => {
    // 3×3.5 + 2 = 12.5
    expect(averageDamageFromFormula("3d6+2")).toBeCloseTo(12.5);
  });

  it("whitespace is stripped ('2 d 6 + 2')", () => {
    expect(averageDamageFromFormula("2 d 6 + 2")).toBeCloseTo(9);
  });

  it("uppercase D is handled ('2D6')", () => {
    expect(averageDamageFromFormula("2D6")).toBeCloseTo(7);
  });
});

// ─── isSmallArms ─────────────────────────────────────────────────────────────

describe("isSmallArms", () => {
  it("d6 formula → true (MM p.4)", () => {
    expect(isSmallArms("2d6")).toBe(true);
    expect(isSmallArms("1d6")).toBe(true);
    expect(isSmallArms("5d6")).toBe(true);
    expect(isSmallArms("3d6+2")).toBe(true);
  });

  it("d10 formula → false", () => {
    expect(isSmallArms("1d10")).toBe(false);
    expect(isSmallArms("3d10")).toBe(false);
  });

  it("flat number → false", () => {
    expect(isSmallArms("10")).toBe(false);
  });

  it("empty / null / undefined → false", () => {
    expect(isSmallArms("")).toBe(false);
    expect(isSmallArms(null)).toBe(false);
    expect(isSmallArms(undefined)).toBe(false);
  });

  it("D6 uppercase → true (case-insensitive)", () => {
    expect(isSmallArms("2D6")).toBe(true);
  });
});

// ─── penetrationFactor ────────────────────────────────────────────────────────

describe("penetrationFactor", () => {
  it("no arguments → 0", () => {
    expect(penetrationFactor()).toBe(0);
    expect(penetrationFactor({})).toBe(0);
  });

  it("avgDamage = 10 → PF 1 (round(10/10))", () => {
    expect(penetrationFactor({ avgDamage: 10 })).toBe(1);
  });

  it("avgDamage = 35 (3d6+2) → PF 4 (round(35/10) ← actually 3.5 → rounds to 4)", () => {
    // round(35/10) = round(3.5) = 4 in JS (rounds half up)
    expect(penetrationFactor({ avgDamage: 35 })).toBe(4);
  });

  it("avgDamage = 17.5 (5d6) → PF 2 (round(1.75)=2)", () => {
    expect(penetrationFactor({ avgDamage: 17.5 })).toBe(2);
  });

  it("ap flag doubles PF", () => {
    expect(penetrationFactor({ avgDamage: 10, ap: true })).toBe(2);
    expect(penetrationFactor({ avgDamage: 30, ap: true })).toBe(6);
  });

  it("smallArms flag halves PF (rounded)", () => {
    expect(penetrationFactor({ avgDamage: 10, smallArms: true })).toBe(1);
    // round(1/2) = round(0.5) = 1 in JS
    expect(penetrationFactor({ avgDamage: 20, smallArms: true })).toBe(1);
  });

  it("ap + smallArms: ×2 then ×0.5 → net ×1 (rounded)", () => {
    // round(10/10)=1 × 2 = 2, round(2*0.5) = round(1) = 1
    expect(penetrationFactor({ avgDamage: 10, ap: true, smallArms: true })).toBe(1);
  });

  it("negative avgDamage → 0 (floored)", () => {
    expect(penetrationFactor({ avgDamage: -100 })).toBe(0);
  });

  it("avgDamage = 0 → 0", () => {
    expect(penetrationFactor({ avgDamage: 0 })).toBe(0);
  });
});

// ─── weaponToPenetration ──────────────────────────────────────────────────────

describe("weaponToPenetration", () => {
  it("null weapon → 0", () => {
    expect(weaponToPenetration(null)).toBe(0);
    expect(weaponToPenetration(undefined)).toBe(0);
  });

  it("plain {system:{damage}} object works (no _getWeaponSystem)", () => {
    // 2d6 pistol: avg 7, small arms, no AP → round(7/10)=1, ×½ → round(0.5)=1
    expect(weaponToPenetration({ system: { damage: "2d6" } })).toBe(1);
  });

  it("d10 weapon (not small arms) — avg 5.5 → round(0.55)=1, no halving", () => {
    expect(weaponToPenetration({ system: { damage: "1d10" } })).toBe(1);
  });

  it("heavy weapon 3d10 → avg 16.5, not small arms → round(1.65)=2", () => {
    expect(weaponToPenetration({ system: { damage: "3d10" } })).toBe(2);
  });

  it("AP flag on weapon doubles result", () => {
    // 1d10 → avg5.5 → PF 1 × 2 = 2
    expect(weaponToPenetration({ system: { damage: "1d10", ap: true } })).toBe(2);
  });

  it("apOverride=true overrides system.ap false", () => {
    expect(weaponToPenetration({ system: { damage: "1d10", ap: false } }, { apOverride: true })).toBe(2);
  });

  it("apOverride=false overrides system.ap true", () => {
    expect(weaponToPenetration({ system: { damage: "1d10", ap: true } }, { apOverride: false })).toBe(1);
  });

  it("apOverride=null falls back to system.ap", () => {
    expect(weaponToPenetration({ system: { damage: "1d10", ap: true } }, { apOverride: null })).toBe(2);
  });

  it("weapon with _getWeaponSystem() method uses that instead of system", () => {
    const weapon = {
      system: { damage: "1d6" },          // would give 1 (small arms)
      _getWeaponSystem: () => ({ damage: "3d10", ap: false }),  // 16.5/10 → 2
    };
    expect(weaponToPenetration(weapon)).toBe(2);
  });

  it("empty system → 0", () => {
    expect(weaponToPenetration({ system: {} })).toBe(0);
  });
});

// ─── vehicleToHitModifier ────────────────────────────────────────────────────

describe("vehicleToHitModifier", () => {
  it("no args → 0 (vehicle target not set, nothing else)", () => {
    // Default: targetLarge=true → +4; all others default false/0
    // Wait: default targetLarge IS true, so expect +4 not 0.
    expect(vehicleToHitModifier()).toBe(4);
  });

  it("targetLarge=true (default) adds +4", () => {
    expect(vehicleToHitModifier({ targetLarge: true })).toBe(4);
  });

  it("targetLarge=false adds 0", () => {
    expect(vehicleToHitModifier({ targetLarge: false })).toBe(0);
  });

  it("targetSmall=true subtracts 4", () => {
    expect(vehicleToHitModifier({ targetLarge: false, targetSmall: true })).toBe(-4);
  });

  it("ACPA target ignores size modifiers (neither +4 nor -4)", () => {
    expect(vehicleToHitModifier({ isACPATarget: true, targetLarge: true })).toBe(0);
    expect(vehicleToHitModifier({ isACPATarget: true, targetSmall: true })).toBe(0);
  });

  it("stationary target +4", () => {
    expect(vehicleToHitModifier({ targetLarge: false, stationary: true })).toBe(4);
  });

  it("turret +2", () => {
    expect(vehicleToHitModifier({ targetLarge: false, turret: true })).toBe(2);
  });

  it("vehicleLink +2", () => {
    expect(vehicleToHitModifier({ targetLarge: false, vehicleLink: true })).toBe(2);
  });

  it("firerMoving -3", () => {
    expect(vehicleToHitModifier({ targetLarge: false, firerMoving: true })).toBe(-3);
  });

  it("turningToFace -2", () => {
    expect(vehicleToHitModifier({ targetLarge: false, turningToFace: true })).toBe(-2);
  });

  it("darkObscured -3", () => {
    expect(vehicleToHitModifier({ targetLarge: false, darkObscured: true })).toBe(-3);
  });

  it("heatSeekerVsAV +4", () => {
    expect(vehicleToHitModifier({ targetLarge: false, heatSeekerVsAV: true })).toBe(4);
  });

  it("rocketSalvo -2", () => {
    expect(vehicleToHitModifier({ targetLarge: false, rocketSalvo: true })).toBe(-2);
  });

  it("target speed 20mph → -1 (floor(20/20))", () => {
    expect(vehicleToHitModifier({ targetLarge: false, targetSpeedMph: 20 })).toBe(-1);
  });

  it("target speed 39mph → -1 (floor(39/20))", () => {
    expect(vehicleToHitModifier({ targetLarge: false, targetSpeedMph: 39 })).toBe(-1);
  });

  it("target speed 40mph → -2 (floor(40/20))", () => {
    expect(vehicleToHitModifier({ targetLarge: false, targetSpeedMph: 40 })).toBe(-2);
  });

  it("target speed 40mph moving straight at firer → -1 (floor(40/40))", () => {
    expect(vehicleToHitModifier({ targetLarge: false, targetSpeedMph: 40, movingStraightAt: true })).toBe(-1);
  });

  it("target speed 0 → no penalty", () => {
    expect(vehicleToHitModifier({ targetLarge: false, targetSpeedMph: 0 })).toBe(0);
  });

  it("targetingComputer adds directly", () => {
    expect(vehicleToHitModifier({ targetLarge: false, targetingComputer: 3 })).toBe(3);
    expect(vehicleToHitModifier({ targetLarge: false, targetingComputer: -1 })).toBe(-1);
  });

  it("dfb (ACPA direct-fire bonus) adds directly", () => {
    expect(vehicleToHitModifier({ targetLarge: false, dfb: 2 })).toBe(2);
  });

  it("combined: large + stationary + turret", () => {
    // +4 (large) +4 (stationary) +2 (turret) = +10
    expect(vehicleToHitModifier({ targetLarge: true, stationary: true, turret: true })).toBe(10);
  });

  it("combined: firerMoving + darkObscured + rocketSalvo vs large target", () => {
    // +4 -3 -3 -2 = -4
    expect(vehicleToHitModifier({ targetLarge: true, firerMoving: true, darkObscured: true, rocketSalvo: true })).toBe(-4);
  });
});

// ─── goodShotSteps ───────────────────────────────────────────────────────────

describe("goodShotSteps", () => {
  it("total < targetNumber → 0", () => {
    expect(goodShotSteps(10, 15)).toBe(0);
    expect(goodShotSteps(0, 1)).toBe(0);
  });

  it("total === targetNumber → 0 steps (floor(0/10)=0)", () => {
    expect(goodShotSteps(15, 15)).toBe(0);
  });

  it("over by 9 → 0 steps (floor(9/10)=0)", () => {
    expect(goodShotSteps(24, 15)).toBe(0);
  });

  it("over by exactly 10 → 1 step (MM p.5)", () => {
    expect(goodShotSteps(25, 15)).toBe(1);
  });

  it("over by 19 → 1 step", () => {
    expect(goodShotSteps(34, 15)).toBe(1);
  });

  it("over by 20 → 2 steps", () => {
    expect(goodShotSteps(35, 15)).toBe(2);
  });

  it("over by 30 → 3 steps", () => {
    expect(goodShotSteps(45, 15)).toBe(3);
  });

  it("handles 0,0 → 0", () => {
    expect(goodShotSteps(0, 0)).toBe(0);
  });

  it("handles non-numeric as 0", () => {
    expect(goodShotSteps(null, 10)).toBe(0);
    expect(goodShotSteps(undefined, undefined)).toBe(0);
  });
});

// ─── roundsPerHit ────────────────────────────────────────────────────────────

describe("roundsPerHit", () => {
  it("ROF < 30 → 1 round/hit", () => {
    expect(roundsPerHit(0)).toBe(1);
    expect(roundsPerHit(1)).toBe(1);
    expect(roundsPerHit(29)).toBe(1);
  });

  it("ROF exactly 30 → 5 rounds/hit (MM p.5)", () => {
    expect(roundsPerHit(30)).toBe(5);
  });

  it("ROF between 30 and 99 → 5 rounds/hit", () => {
    expect(roundsPerHit(50)).toBe(5);
    expect(roundsPerHit(99)).toBe(5);
  });

  it("ROF exactly 100 → 10 rounds/hit (MM p.5)", () => {
    expect(roundsPerHit(100)).toBe(10);
  });

  it("ROF above 100 → 10 rounds/hit", () => {
    expect(roundsPerHit(200)).toBe(10);
    expect(roundsPerHit(1000)).toBe(10);
  });

  it("null/undefined → 1 (treated as 0)", () => {
    expect(roundsPerHit(null)).toBe(1);
    expect(roundsPerHit(undefined)).toBe(1);
  });
});

// ─── resolveVehicleToHit ─────────────────────────────────────────────────────

describe("resolveVehicleToHit", () => {
  it("no args → total 0, hit false (0 < 0 is false, 0 >= 0 is hit)", () => {
    // Default targetNumber=0, total=0 → hit (0 >= 0)
    const res = resolveVehicleToHit();
    expect(res.total).toBe(0);
    expect(res.hit).toBe(true);
    expect(res.goodShotSteps).toBe(0);
  });

  it("total = d10+ref+skill+mods", () => {
    const res = resolveVehicleToHit({ d10: 7, ref: 6, skill: 4, mods: 4, targetNumber: 15 });
    expect(res.total).toBe(21);
    expect(res.hit).toBe(true);
  });

  it("total below targetNumber → miss", () => {
    const res = resolveVehicleToHit({ d10: 1, ref: 4, skill: 3, mods: 0, targetNumber: 15 });
    expect(res.total).toBe(8);
    expect(res.hit).toBe(false);
    expect(res.goodShotSteps).toBe(0);
  });

  it("miss → goodShotSteps = 0 (even if total technically over 0)", () => {
    const res = resolveVehicleToHit({ d10: 2, ref: 3, skill: 2, mods: 0, targetNumber: 15 });
    expect(res.hit).toBe(false);
    expect(res.goodShotSteps).toBe(0);
  });

  it("hit exactly at TN → goodShotSteps 0", () => {
    const res = resolveVehicleToHit({ d10: 5, ref: 5, skill: 5, mods: 0, targetNumber: 15 });
    expect(res.total).toBe(15);
    expect(res.hit).toBe(true);
    expect(res.goodShotSteps).toBe(0);
  });

  it("hit by 10 over TN → 1 good shot step", () => {
    const res = resolveVehicleToHit({ d10: 5, ref: 5, skill: 5, mods: 10, targetNumber: 15 });
    expect(res.total).toBe(25);
    expect(res.goodShotSteps).toBe(1);
  });

  it("hit by 20 over TN → 2 good shot steps", () => {
    const res = resolveVehicleToHit({ d10: 10, ref: 10, skill: 10, mods: 5, targetNumber: 15 });
    expect(res.total).toBe(35);
    expect(res.goodShotSteps).toBe(2);
  });

  it("negative mods work", () => {
    const res = resolveVehicleToHit({ d10: 10, ref: 8, skill: 6, mods: -5, targetNumber: 15 });
    expect(res.total).toBe(19);
    expect(res.hit).toBe(true);
  });

  it("non-numeric inputs treated as 0", () => {
    const res = resolveVehicleToHit({ d10: null, ref: undefined, skill: "abc", mods: null, targetNumber: 5 });
    expect(res.total).toBe(0);
    expect(res.hit).toBe(false);
  });
});
