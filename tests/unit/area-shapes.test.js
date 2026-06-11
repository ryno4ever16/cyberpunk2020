import { describe, it, expect } from "vitest";
import { buildAreaData } from "../../module/combat/area-shapes.js";

// Mock scene: 100px per 2m cell, units metres → 50 px/m, metersToUnits = identity.
const scene = { grid: { size: 100, distance: 2, units: "m" } };
const flags = { weaponName: "Test", isGasCloud: true };

describe("buildAreaData — MeasuredTemplate (v13)", () => {
  it("circle → t:circle with distance in scene units", () => {
    const d = buildAreaData(false, { kind: "circle", x: 1000, y: 1000, radiusM: 10, flags }, scene);
    expect(d.t).toBe("circle");
    expect(d.x).toBe(1000);
    expect(d.distance).toBe(10);              // metersToUnits(10) = 10
    expect(d.flags.cyberpunk2020).toEqual(flags);
  });

  it("cone → t:cone with full angle + distance", () => {
    const d = buildAreaData(false, { kind: "cone", x: 0, y: 0, dirDeg: 45, angleDeg: 60, rangeM: 8 }, scene);
    expect(d.t).toBe("cone");
    expect(d.direction).toBe(45);
    expect(d.angle).toBe(60);
    expect(d.distance).toBe(8);
  });

  it("ray → t:ray with distance + width in units", () => {
    const d = buildAreaData(false, { kind: "ray", x: 0, y: 0, dirDeg: 90, lengthM: 10, widthM: 2 }, scene);
    expect(d.t).toBe("ray");
    expect(d.direction).toBe(90);
    expect(d.distance).toBe(10);
    expect(d.width).toBe(2);
  });
});

describe("buildAreaData — Region (v14)", () => {
  it("circle → ellipse shape with pixel radius", () => {
    const d = buildAreaData(true, { kind: "circle", x: 1000, y: 1000, radiusM: 10, flags }, scene);
    expect(d.shapes).toHaveLength(1);
    expect(d.shapes[0]).toMatchObject({ type: "ellipse", x: 1000, y: 1000, radiusX: 500, radiusY: 500 });
    expect(d.visibility).toBe(1);
    expect(d.flags.cyberpunk2020).toEqual(flags);
  });

  it("cone → polygon shape, flat points, apex at origin", () => {
    const d = buildAreaData(true, { kind: "cone", x: 1000, y: 1000, dirDeg: 0, angleDeg: 60, rangeM: 8 }, scene);
    expect(d.shapes[0].type).toBe("polygon");
    const pts = d.shapes[0].points;
    expect(Array.isArray(pts)).toBe(true);
    expect(pts.every((v) => typeof v === "number")).toBe(true);
    expect([pts[0], pts[1]]).toEqual([1000, 1000]); // apex
    // first arc vertex at rangePx = 8 * 50 = 400 from apex
    const d0 = Math.hypot(pts[2] - 1000, pts[3] - 1000);
    expect(Math.abs(d0 - 400)).toBeLessThan(0.001);
  });

  it("ray → polygon shape with 8 numbers (pixel dims)", () => {
    const d = buildAreaData(true, { kind: "ray", x: 0, y: 0, dirDeg: 0, lengthM: 10, widthM: 2 }, scene);
    expect(d.shapes[0].type).toBe("polygon");
    expect(d.shapes[0].points).toHaveLength(8); // 4 corners
  });
});
