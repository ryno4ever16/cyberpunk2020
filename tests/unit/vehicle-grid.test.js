/**
 * Unit tests for module/vehicle/vehicle-grid.js.
 *
 * All five exports are pure functions that accept a plain scene-like object and
 * numeric arguments — no Foundry globals needed.
 */

import { describe, it, expect } from "vitest";
import {
  metersPerUnit,
  pxPerMeter,
  metersToPixels,
  pixelsToMeters,
  metersToUnits,
} from "../../module/vehicle/vehicle-grid.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal scene-like object for tests. */
function scene(units = "m", size = 100, distance = 1) {
  return { grid: { units, size, distance } };
}

// ─── metersPerUnit ────────────────────────────────────────────────────────────

describe("metersPerUnit", () => {
  it("metres variants return 1", () => {
    expect(metersPerUnit(scene("m"))).toBe(1);
    expect(metersPerUnit(scene("meter"))).toBe(1);
    expect(metersPerUnit(scene("meters"))).toBe(1);
    expect(metersPerUnit(scene("metre"))).toBe(1);
    expect(metersPerUnit(scene("metres"))).toBe(1);
    expect(metersPerUnit(scene("M"))).toBe(1);   // case-insensitive
  });

  it("foot variants return 0.3048", () => {
    expect(metersPerUnit(scene("ft"))).toBeCloseTo(0.3048);
    expect(metersPerUnit(scene("foot"))).toBeCloseTo(0.3048);
    expect(metersPerUnit(scene("feet"))).toBeCloseTo(0.3048);
    expect(metersPerUnit(scene("'"))).toBeCloseTo(0.3048);
    expect(metersPerUnit(scene("FT"))).toBeCloseTo(0.3048);
  });

  it("yard variants return 0.9144", () => {
    expect(metersPerUnit(scene("yd"))).toBeCloseTo(0.9144);
    expect(metersPerUnit(scene("yard"))).toBeCloseTo(0.9144);
    expect(metersPerUnit(scene("yards"))).toBeCloseTo(0.9144);
  });

  it("kilometre variants return 1000", () => {
    expect(metersPerUnit(scene("km"))).toBe(1000);
    expect(metersPerUnit(scene("kilometer"))).toBe(1000);
    expect(metersPerUnit(scene("kilometers"))).toBe(1000);
    expect(metersPerUnit(scene("kilometre"))).toBe(1000);
    expect(metersPerUnit(scene("kilometres"))).toBe(1000);
  });

  it("mile variants return 1609.344", () => {
    expect(metersPerUnit(scene("mi"))).toBeCloseTo(1609.344);
    expect(metersPerUnit(scene("mile"))).toBeCloseTo(1609.344);
    expect(metersPerUnit(scene("miles"))).toBeCloseTo(1609.344);
  });

  it("unknown unit falls back to 1", () => {
    expect(metersPerUnit(scene("parsec"))).toBe(1);
    expect(metersPerUnit(scene("xu"))).toBe(1);
  });

  it("empty/absent units fall back to 1", () => {
    expect(metersPerUnit(scene(""))).toBe(1);
    expect(metersPerUnit({})).toBe(1);
    expect(metersPerUnit(null)).toBe(1);
    expect(metersPerUnit(undefined)).toBe(1);
  });
});

// ─── pxPerMeter ──────────────────────────────────────────────────────────────

describe("pxPerMeter", () => {
  it("standard 100px/1m grid returns 100 px/m", () => {
    expect(pxPerMeter(scene("m", 100, 1))).toBe(100);
  });

  it("100px / 5m grid (Fantasy default) returns 20 px/m", () => {
    expect(pxPerMeter(scene("m", 100, 5))).toBe(20);
  });

  it("uses feet conversion: 100px/5ft → (100/5)/0.3048 ≈ 65.6 px/m", () => {
    expect(pxPerMeter(scene("ft", 100, 5))).toBeCloseTo(100 / 5 / 0.3048, 3);
  });

  it("falls back to 100px and dist=1 for missing/zero values", () => {
    // No grid at all → size defaults 100, distance defaults 1, units → m → 100 px/m
    expect(pxPerMeter(null)).toBe(100);
    expect(pxPerMeter({})).toBe(100);
    // Zero distance is treated as 1
    expect(pxPerMeter(scene("m", 100, 0))).toBe(100);
  });
});

// ─── metersToPixels ───────────────────────────────────────────────────────────

describe("metersToPixels", () => {
  it("converts metres to pixels correctly", () => {
    // 100px/m → 50m = 5000px
    expect(metersToPixels(scene("m", 100, 1), 50)).toBe(5000);
  });

  it("handles feet grid", () => {
    const s = scene("ft", 100, 5);
    const ppm = pxPerMeter(s);
    expect(metersToPixels(s, 10)).toBeCloseTo(10 * ppm, 5);
  });

  it("returns 0 for zero metres", () => {
    expect(metersToPixels(scene("m", 100, 1), 0)).toBe(0);
  });

  it("handles non-numeric metres gracefully (returns 0)", () => {
    expect(metersToPixels(scene("m", 100, 1), null)).toBe(0);
    expect(metersToPixels(scene("m", 100, 1), undefined)).toBe(0);
  });
});

// ─── pixelsToMeters ───────────────────────────────────────────────────────────

describe("pixelsToMeters", () => {
  it("converts pixels to metres correctly", () => {
    // 100px/m → 5000px = 50m
    expect(pixelsToMeters(scene("m", 100, 1), 5000)).toBe(50);
  });

  it("is the inverse of metersToPixels", () => {
    const s = scene("ft", 100, 5);
    const m = 37;
    const px = metersToPixels(s, m);
    expect(pixelsToMeters(s, px)).toBeCloseTo(m, 5);
  });

  it("returns 0 for zero pixels", () => {
    expect(pixelsToMeters(scene("m", 100, 1), 0)).toBe(0);
  });

  it("handles null/undefined pixels gracefully (returns 0)", () => {
    expect(pixelsToMeters(scene("m", 100, 1), null)).toBe(0);
    expect(pixelsToMeters(scene("m", 100, 1), undefined)).toBe(0);
  });
});

// ─── metersToUnits ────────────────────────────────────────────────────────────

describe("metersToUnits", () => {
  it("returns metres unchanged for a metre-unit scene", () => {
    expect(metersToUnits(scene("m"), 100)).toBe(100);
    expect(metersToUnits(scene("m"), 0)).toBe(0);
  });

  it("converts metres to feet for a feet-unit scene", () => {
    // 100m / 0.3048 ≈ 328.08 ft
    expect(metersToUnits(scene("ft"), 100)).toBeCloseTo(100 / 0.3048, 3);
  });

  it("converts metres to kilometres", () => {
    expect(metersToUnits(scene("km"), 2000)).toBeCloseTo(2, 5);
  });

  it("handles null metres (returns 0)", () => {
    expect(metersToUnits(scene("m"), null)).toBe(0);
  });

  it("handles missing scene (treats as 1 m/unit)", () => {
    expect(metersToUnits(null, 50)).toBe(50);
    expect(metersToUnits(undefined, 50)).toBe(50);
  });
});
