/**
 * Unit tests for module/vehicle/vehicle-area.js.
 *
 * Pure exports covered: pointInCircle, pointInCone.
 *
 * SKIPPED (Foundry-dependent):
 *   resolveAreaShot — calls canvas?.scene, dynamically imports vehicle-targeting.js,
 *                     and calls scene.createEmbeddedDocuments (FoundryVTT API).
 */

import { describe, it, expect } from "vitest";
import {
  pointInCircle,
  pointInCone,
} from "../../module/vehicle/vehicle-area.js";

// ─── pointInCircle ────────────────────────────────────────────────────────────

describe("pointInCircle", () => {
  // Circle centred at (100,100), radius 50

  it("centre of circle is inside (distance 0)", () => {
    expect(pointInCircle(100, 100, 100, 100, 50)).toBe(true);
  });

  it("point on the exact boundary (distance === r) is inside (<=)", () => {
    // Point exactly 50 pixels to the right
    expect(pointInCircle(150, 100, 100, 100, 50)).toBe(true);
  });

  it("point just inside boundary is inside", () => {
    expect(pointInCircle(149, 100, 100, 100, 50)).toBe(true);
  });

  it("point just outside boundary is not inside", () => {
    expect(pointInCircle(151, 100, 100, 100, 50)).toBe(false);
  });

  it("point far away is not inside", () => {
    expect(pointInCircle(300, 300, 100, 100, 50)).toBe(false);
  });

  it("works on circle at origin", () => {
    expect(pointInCircle(0, 0, 0, 0, 10)).toBe(true);
    expect(pointInCircle(10, 0, 0, 0, 10)).toBe(true);
    expect(pointInCircle(11, 0, 0, 0, 10)).toBe(false);
  });

  it("radius 0 — only the exact centre qualifies", () => {
    expect(pointInCircle(0, 0, 0, 0, 0)).toBe(true);
    expect(pointInCircle(1, 0, 0, 0, 0)).toBe(false);
  });

  it("diagonal hit at sqrt(2)*r ≈ boundary", () => {
    // distance = hypot(35.36, 35.36) ≈ 50 — on boundary
    const d = 50 / Math.SQRT2;
    expect(pointInCircle(100 + d, 100 + d, 100, 100, 50)).toBe(true);
  });

  it("negative coordinates work", () => {
    expect(pointInCircle(-50, -50, -100, -100, 80)).toBe(true);
    // distance = hypot(50,50) ≈ 70.7 < 80 → inside
  });
});

// ─── pointInCone ─────────────────────────────────────────────────────────────
// Convention (per implementation): dirDeg is screen degrees (0=east/+x, clockwise).
// halfDeg = half the total cone angle.
// The origin point itself always returns true.

describe("pointInCone", () => {
  // Cone from (0,0) facing east (dirDeg=0), half-angle 30°, range 100

  it("origin point is always inside", () => {
    expect(pointInCone(0, 0, 0, 0, 0, 30, 100)).toBe(true);
  });

  it("point directly on axis ahead is inside", () => {
    // dirDeg=0 = east (+x). Point at (50,0) — directly on axis.
    expect(pointInCone(50, 0, 0, 0, 0, 30, 100)).toBe(true);
  });

  it("point at 30° off axis (on boundary) is inside", () => {
    // 30° off east: x=cos30*50, y=sin30*50 (screen coords: +y is down, but math is symmetric here)
    const x = Math.cos(30 * Math.PI / 180) * 50;
    const y = Math.sin(30 * Math.PI / 180) * 50;
    expect(pointInCone(x, y, 0, 0, 0, 30, 100)).toBe(true);
  });

  it("point at 31° off axis (just outside angle) is not inside", () => {
    const x = Math.cos(31 * Math.PI / 180) * 50;
    const y = Math.sin(31 * Math.PI / 180) * 50;
    expect(pointInCone(x, y, 0, 0, 0, 30, 100)).toBe(false);
  });

  it("point beyond range is not inside", () => {
    expect(pointInCone(101, 0, 0, 0, 0, 30, 100)).toBe(false);
  });

  it("point exactly at range on axis is inside (dist <= range)", () => {
    expect(pointInCone(100, 0, 0, 0, 0, 30, 100)).toBe(true);
  });

  it("point behind origin (180° off axis) is not inside", () => {
    expect(pointInCone(-50, 0, 0, 0, 0, 30, 100)).toBe(false);
  });

  it("point within range but to the side (90° off axis) is not inside for narrow cone", () => {
    expect(pointInCone(0, 50, 0, 0, 0, 30, 100)).toBe(false);
  });

  it("cone facing south (dirDeg=90 in screen coords: 0=east, +y down)", () => {
    // dirDeg=90 = pointing in +y direction (south on canvas)
    expect(pointInCone(0, 50, 0, 0, 90, 30, 100)).toBe(true);
    expect(pointInCone(0, -50, 0, 0, 90, 30, 100)).toBe(false);
  });

  it("cone facing west (dirDeg=180)", () => {
    expect(pointInCone(-50, 0, 0, 0, 180, 30, 100)).toBe(true);
    expect(pointInCone(50, 0, 0, 0, 180, 30, 100)).toBe(false);
  });

  it("cone facing north (dirDeg=270)", () => {
    // 270° in screen-degrees = -y direction (north on canvas, up)
    expect(pointInCone(0, -50, 0, 0, 270, 30, 100)).toBe(true);
    expect(pointInCone(0, 50, 0, 0, 270, 30, 100)).toBe(false);
  });

  it("wide half-angle (90°) accepts points to the left and right", () => {
    expect(pointInCone(0, 50, 0, 0, 0, 90, 100)).toBe(true);
    expect(pointInCone(0, -50, 0, 0, 0, 90, 100)).toBe(true);
    // Still rejects behind (dist within range but 180° off)
    expect(pointInCone(-50, 0, 0, 0, 0, 89, 100)).toBe(false);
  });

  it("cone from non-origin point works the same way", () => {
    // Cone from (200, 200) facing east, range 100
    expect(pointInCone(250, 200, 200, 200, 0, 30, 100)).toBe(true);
    expect(pointInCone(150, 200, 200, 200, 0, 30, 100)).toBe(false);
  });

  it("range 0 only accepts the origin", () => {
    // dist > range for any non-origin point, so only origin (dist=0) is inside
    expect(pointInCone(0, 0, 0, 0, 0, 60, 0)).toBe(true);
    expect(pointInCone(1, 0, 0, 0, 0, 60, 0)).toBe(false);
  });
});
