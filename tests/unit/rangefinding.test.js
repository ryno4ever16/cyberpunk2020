/**
 * Unit tests for module/combat/rangefinding.js.
 *
 * Covers: RANGE_CATEGORIES (constant shape/values), RANGE_HIT_NUMBERS (constant values),
 * getWeaponLongRange (plain item objects), getRangeCategory (every band boundary).
 *
 * Skipped (canvas dependency — accessed at call time, not import time):
 *   - gridDistanceBetween   — reads canvas.grid.*
 *   - measureTokenDistance  — calls gridDistanceBetween → canvas
 *   - resolveAttackRange    — calls measureTokenDistance → canvas
 *
 * Both constants and the two pure functions import cleanly under Node (no Foundry globals
 * at module-load time).
 */

import { describe, it, expect } from "vitest";
import {
  RANGE_CATEGORIES,
  RANGE_HIT_NUMBERS,
  getWeaponLongRange,
  getRangeCategory,
} from "../../module/combat/rangefinding.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal weapon-item-like plain object. */
function weaponItem({ range = undefined, weaponType = undefined } = {}) {
  return {
    name: "Test Weapon",
    system: {
      ...(range     !== undefined ? { range }      : {}),
      ...(weaponType !== undefined ? { weaponType } : {}),
    },
  };
}

// ─── RANGE_CATEGORIES ────────────────────────────────────────────────────────

describe("RANGE_CATEGORIES", () => {
  it("has all six expected category keys", () => {
    expect(RANGE_CATEGORIES).toHaveProperty("POINT_BLANK");
    expect(RANGE_CATEGORIES).toHaveProperty("CLOSE");
    expect(RANGE_CATEGORIES).toHaveProperty("MEDIUM");
    expect(RANGE_CATEGORIES).toHaveProperty("LONG");
    expect(RANGE_CATEGORIES).toHaveProperty("EXTREME");
    expect(RANGE_CATEGORIES).toHaveProperty("OUT_OF_RANGE");
  });

  it("values are the expected camelCase strings", () => {
    expect(RANGE_CATEGORIES.POINT_BLANK).toBe("pointBlank");
    expect(RANGE_CATEGORIES.CLOSE).toBe("close");
    expect(RANGE_CATEGORIES.MEDIUM).toBe("medium");
    expect(RANGE_CATEGORIES.LONG).toBe("long");
    expect(RANGE_CATEGORIES.EXTREME).toBe("extreme");
    expect(RANGE_CATEGORIES.OUT_OF_RANGE).toBe("outOfRange");
  });
});

// ─── RANGE_HIT_NUMBERS ───────────────────────────────────────────────────────

describe("RANGE_HIT_NUMBERS (CP2020 p.99)", () => {
  it("has the five range entries", () => {
    expect(RANGE_HIT_NUMBERS).toHaveProperty("pointBlank");
    expect(RANGE_HIT_NUMBERS).toHaveProperty("close");
    expect(RANGE_HIT_NUMBERS).toHaveProperty("medium");
    expect(RANGE_HIT_NUMBERS).toHaveProperty("long");
    expect(RANGE_HIT_NUMBERS).toHaveProperty("extreme");
  });

  it("Point Blank hit number is 10", () => {
    expect(RANGE_HIT_NUMBERS.pointBlank).toBe(10);
  });

  it("Close hit number is 15", () => {
    expect(RANGE_HIT_NUMBERS.close).toBe(15);
  });

  it("Medium hit number is 20", () => {
    expect(RANGE_HIT_NUMBERS.medium).toBe(20);
  });

  it("Long hit number is 25", () => {
    expect(RANGE_HIT_NUMBERS.long).toBe(25);
  });

  it("Extreme hit number is 30", () => {
    expect(RANGE_HIT_NUMBERS.extreme).toBe(30);
  });

  it("hit numbers increase monotonically (closer = easier)", () => {
    // Lower number = lower difficulty = easier to hit at close range
    expect(RANGE_HIT_NUMBERS.pointBlank).toBeLessThan(RANGE_HIT_NUMBERS.close);
    expect(RANGE_HIT_NUMBERS.close).toBeLessThan(RANGE_HIT_NUMBERS.medium);
    expect(RANGE_HIT_NUMBERS.medium).toBeLessThan(RANGE_HIT_NUMBERS.long);
    expect(RANGE_HIT_NUMBERS.long).toBeLessThan(RANGE_HIT_NUMBERS.extreme);
  });
});

// ─── getWeaponLongRange ───────────────────────────────────────────────────────

describe("getWeaponLongRange", () => {
  it("returns item.system.range when set and positive", () => {
    expect(getWeaponLongRange(weaponItem({ range: 200 }))).toBe(200);
    expect(getWeaponLongRange(weaponItem({ range: 1 }))).toBe(1);
  });

  it("ignores item.system.range of 0 and falls back to type default", () => {
    // range=0 is falsy → falls to weaponType lookup
    expect(getWeaponLongRange(weaponItem({ range: 0, weaponType: "Pistol" }))).toBe(50);
  });

  it("ignores negative item.system.range and falls back to type default", () => {
    // -10 is truthy but <= 0, so should fall back
    expect(getWeaponLongRange(weaponItem({ range: -10, weaponType: "Rifle" }))).toBe(400);
  });

  it("Pistol type default is 50m (p.99)", () => {
    expect(getWeaponLongRange(weaponItem({ weaponType: "Pistol" }))).toBe(50);
  });

  it("SMG type default is 150m (p.99)", () => {
    expect(getWeaponLongRange(weaponItem({ weaponType: "SMG" }))).toBe(150);
  });

  it("Shotgun type default is 50m (p.99)", () => {
    expect(getWeaponLongRange(weaponItem({ weaponType: "Shotgun" }))).toBe(50);
  });

  it("Rifle type default is 400m (p.99)", () => {
    expect(getWeaponLongRange(weaponItem({ weaponType: "Rifle" }))).toBe(400);
  });

  it("Heavy type default is 400m", () => {
    expect(getWeaponLongRange(weaponItem({ weaponType: "Heavy" }))).toBe(400);
  });

  it("Melee type default is 1m (p.99)", () => {
    expect(getWeaponLongRange(weaponItem({ weaponType: "Melee" }))).toBe(1);
  });

  it("Bow type default is 150m", () => {
    expect(getWeaponLongRange(weaponItem({ weaponType: "Bow" }))).toBe(150);
  });

  it("Exotic type default is 20m", () => {
    expect(getWeaponLongRange(weaponItem({ weaponType: "Exotic" }))).toBe(20);
  });

  it("unknown weaponType falls back to 50m (??-default)", () => {
    expect(getWeaponLongRange(weaponItem({ weaponType: "Grenade" }))).toBe(50);
  });

  it("missing system altogether falls back to 50m", () => {
    expect(getWeaponLongRange({ name: "Bare Hands" })).toBe(50);
  });

  it("string numeric range is coerced correctly", () => {
    expect(getWeaponLongRange(weaponItem({ range: "300" }))).toBe(300);
  });
});

// ─── getRangeCategory ────────────────────────────────────────────────────────

// CP2020 p.99 bands relative to longRange L:
//   ≤ 1m            = Point Blank
//   ≤ L/4           = Close
//   ≤ L/2           = Medium
//   ≤ L             = Long
//   ≤ 2×L           = Extreme
//   > 2×L           = Out of Range

describe("getRangeCategory (CP2020 p.99)", () => {
  // Rifle: longRange = 400m → bands: PB≤1, Close≤100, Medium≤200, Long≤400, Extreme≤800
  const L = 400;

  it("distance 0 is Point Blank", () => {
    expect(getRangeCategory(0, L)).toBe(RANGE_CATEGORIES.POINT_BLANK);
  });

  it("distance exactly 1m is Point Blank (≤ 1)", () => {
    expect(getRangeCategory(1, L)).toBe(RANGE_CATEGORIES.POINT_BLANK);
  });

  it("distance 1.01m is Close (just past Point Blank)", () => {
    expect(getRangeCategory(1.01, L)).toBe(RANGE_CATEGORIES.CLOSE);
  });

  it("distance exactly L/4 is Close (100m for Rifle)", () => {
    expect(getRangeCategory(100, L)).toBe(RANGE_CATEGORIES.CLOSE);
  });

  it("distance L/4 + 0.01 is Medium (just past Close)", () => {
    expect(getRangeCategory(100.01, L)).toBe(RANGE_CATEGORIES.MEDIUM);
  });

  it("distance exactly L/2 is Medium (200m for Rifle)", () => {
    expect(getRangeCategory(200, L)).toBe(RANGE_CATEGORIES.MEDIUM);
  });

  it("distance L/2 + 0.01 is Long (just past Medium)", () => {
    expect(getRangeCategory(200.01, L)).toBe(RANGE_CATEGORIES.LONG);
  });

  it("distance exactly L is Long (400m for Rifle)", () => {
    expect(getRangeCategory(400, L)).toBe(RANGE_CATEGORIES.LONG);
  });

  it("distance L + 0.01 is Extreme (just past Long)", () => {
    expect(getRangeCategory(400.01, L)).toBe(RANGE_CATEGORIES.EXTREME);
  });

  it("distance exactly 2×L is Extreme (800m for Rifle)", () => {
    expect(getRangeCategory(800, L)).toBe(RANGE_CATEGORIES.EXTREME);
  });

  it("distance 2×L + 0.01 is Out of Range", () => {
    expect(getRangeCategory(800.01, L)).toBe(RANGE_CATEGORIES.OUT_OF_RANGE);
  });

  it("very large distance is Out of Range", () => {
    expect(getRangeCategory(99999, L)).toBe(RANGE_CATEGORIES.OUT_OF_RANGE);
  });

  // Pistol: longRange = 50m → bands: PB≤1, Close≤12.5, Medium≤25, Long≤50, Extreme≤100
  describe("Pistol (L=50m)", () => {
    const LP = 50;
    it("0.5m = Point Blank", () => expect(getRangeCategory(0.5, LP)).toBe(RANGE_CATEGORIES.POINT_BLANK));
    it("1m = Point Blank", () => expect(getRangeCategory(1, LP)).toBe(RANGE_CATEGORIES.POINT_BLANK));
    it("12.5m = Close", () => expect(getRangeCategory(12.5, LP)).toBe(RANGE_CATEGORIES.CLOSE));
    it("25m = Medium", () => expect(getRangeCategory(25, LP)).toBe(RANGE_CATEGORIES.MEDIUM));
    it("50m = Long", () => expect(getRangeCategory(50, LP)).toBe(RANGE_CATEGORIES.LONG));
    it("100m = Extreme", () => expect(getRangeCategory(100, LP)).toBe(RANGE_CATEGORIES.EXTREME));
    it("100.1m = Out of Range", () => expect(getRangeCategory(100.1, LP)).toBe(RANGE_CATEGORIES.OUT_OF_RANGE));
  });

  // Melee: longRange = 1m → everything past 1m is immediately Close
  describe("Melee weapon (L=1m)", () => {
    const LM = 1;
    it("0m = Point Blank", () => expect(getRangeCategory(0, LM)).toBe(RANGE_CATEGORIES.POINT_BLANK));
    it("1m = Point Blank (exactly at L=1, still ≤1)", () => expect(getRangeCategory(1, LM)).toBe(RANGE_CATEGORIES.POINT_BLANK));
    it("1.01m = Close (L/4=0.25, but 1.01 > 1 so falls through Point Blank, L/4=0.25 → already past Close → Medium?", () => {
      // L=1: L/4=0.25, L/2=0.5, L=1. At 1.01m: 1.01>1 (PB), 1.01>0.25 (Close), 1.01>0.5 (Medium), 1.01>1 (Long), 1.01≤2 (Extreme)
      expect(getRangeCategory(1.01, LM)).toBe(RANGE_CATEGORIES.EXTREME);
    });
    it("2m exactly = Extreme (2×L=2)", () => expect(getRangeCategory(2, LM)).toBe(RANGE_CATEGORIES.EXTREME));
    it("2.01m = Out of Range", () => expect(getRangeCategory(2.01, LM)).toBe(RANGE_CATEGORIES.OUT_OF_RANGE));
  });

  // SMG: longRange = 150m → bands: PB≤1, Close≤37.5, Medium≤75, Long≤150, Extreme≤300
  describe("SMG (L=150m)", () => {
    const LS = 150;
    it("37.5m = Close", () => expect(getRangeCategory(37.5, LS)).toBe(RANGE_CATEGORIES.CLOSE));
    it("75m = Medium", () => expect(getRangeCategory(75, LS)).toBe(RANGE_CATEGORIES.MEDIUM));
    it("150m = Long", () => expect(getRangeCategory(150, LS)).toBe(RANGE_CATEGORIES.LONG));
    it("300m = Extreme", () => expect(getRangeCategory(300, LS)).toBe(RANGE_CATEGORIES.EXTREME));
    it("301m = Out of Range", () => expect(getRangeCategory(301, LS)).toBe(RANGE_CATEGORIES.OUT_OF_RANGE));
  });
});
