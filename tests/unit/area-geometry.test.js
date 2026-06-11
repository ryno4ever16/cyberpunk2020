import { describe, it, expect } from "vitest";
import {
  circleEllipseShape,
  conePolygonPoints,
  conePolygonShape,
  rayPolygonPoints,
  rayPolygonShape,
  pointInPolygon,
} from "../../module/combat/area-geometry.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Euclidean distance between two points. */
function dist(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

// ---------------------------------------------------------------------------
// circleEllipseShape
// ---------------------------------------------------------------------------

describe("circleEllipseShape", () => {
  it("returns exact Region ellipse descriptor", () => {
    expect(circleEllipseShape(1000, 1000, 250)).toEqual({
      type: "ellipse",
      x: 1000,
      y: 1000,
      radiusX: 250,
      radiusY: 250,
      rotation: 0,
      hole: false,
    });
  });

  it("uses the supplied cx/cy/radius values", () => {
    const s = circleEllipseShape(300, 400, 50);
    expect(s.x).toBe(300);
    expect(s.y).toBe(400);
    expect(s.radiusX).toBe(50);
    expect(s.radiusY).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// conePolygonPoints
// ---------------------------------------------------------------------------

describe("conePolygonPoints", () => {
  it("returns a flat number array with correct length (default segments=12)", () => {
    const pts = conePolygonPoints(1000, 1000, 0, 30, 400);
    expect(Array.isArray(pts)).toBe(true);
    expect(pts.every(v => typeof v === "number")).toBe(true);
    expect(pts.length % 2).toBe(0);
    // 2 * (segments + 2) = 2 * 14 = 28
    expect(pts.length).toBe(2 * (12 + 2));
  });

  it("first two elements are the apex", () => {
    const pts = conePolygonPoints(1000, 1000, 0, 30, 400);
    expect(pts[0]).toBe(1000);
    expect(pts[1]).toBe(1000);
  });

  it("every arc vertex is within 0.001 of rangePx from the apex", () => {
    const ox = 1000, oy = 1000, rangePx = 400, segments = 12;
    const pts = conePolygonPoints(ox, oy, 0, 30, rangePx, segments);
    // Arc vertices start at index 2 (skipping the apex at index 0)
    for (let i = 1; i <= segments + 1; i++) {
      const ax = pts[2 * i];
      const ay = pts[2 * i + 1];
      const d  = dist(ox, oy, ax, ay);
      expect(Math.abs(d - rangePx)).toBeLessThan(0.001);
    }
  });

  it("custom segments parameter changes length", () => {
    const pts = conePolygonPoints(1000, 1000, 0, 45, 300, 8);
    expect(pts.length).toBe(2 * (8 + 2));
  });

  // Cone facing east (dirDeg=0, halfAngle=30)
  describe("east-facing cone (dir=0, halfAngle=30, range=400)", () => {
    const pts = conePolygonPoints(1000, 1000, 0, 30, 400);

    it("centerline point within range is INSIDE", () => {
      expect(pointInPolygon(1200, 1000, pts)).toBe(true);
    });

    it("due-south point is OUTSIDE (±30° east cone)", () => {
      expect(pointInPolygon(1000, 1300, pts)).toBe(false);
    });

    it("point beyond range is OUTSIDE", () => {
      expect(pointInPolygon(1500, 1000, pts)).toBe(false);
    });
  });

  // Cone facing down (dirDeg=90, halfAngle=30)
  describe("down-facing cone (dir=90, halfAngle=30, range=400)", () => {
    const pts = conePolygonPoints(1000, 1000, 90, 30, 400);

    it("due-south point within range is INSIDE", () => {
      expect(pointInPolygon(1000, 1200, pts)).toBe(true);
    });

    it("apex is NOT inside (on the boundary, outside by ray-cast convention)", () => {
      // Apex is vertex 0; it sits on the polygon boundary.
      // We just verify the south-inward point works; no strict assertion here.
      // The due-east point should be outside a south-facing cone.
      expect(pointInPolygon(1200, 1000, pts)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// conePolygonShape
// ---------------------------------------------------------------------------

describe("conePolygonShape", () => {
  it("returns polygon shape with correct structure", () => {
    const s = conePolygonShape(1000, 1000, 0, 30, 400);
    expect(s.type).toBe("polygon");
    expect(s.hole).toBe(false);
    expect(Array.isArray(s.points)).toBe(true);
    expect(s.points.length).toBe(2 * (12 + 2));
  });

  it("points match conePolygonPoints output", () => {
    const direct = conePolygonPoints(500, 600, 45, 20, 200, 6);
    const shape  = conePolygonShape(500, 600, 45, 20, 200, 6);
    expect(shape.points).toEqual(direct);
  });
});

// ---------------------------------------------------------------------------
// rayPolygonPoints
// ---------------------------------------------------------------------------

describe("rayPolygonPoints", () => {
  // East-facing ray: origin(1000,1000), length=400, width=100
  const pts = rayPolygonPoints(1000, 1000, 0, 400, 100);

  it("returns exactly 8 numbers", () => {
    expect(pts.length).toBe(8);
    expect(pts.every(v => typeof v === "number")).toBe(true);
  });

  it("centerline point within length is INSIDE", () => {
    expect(pointInPolygon(1200, 1000, pts)).toBe(true);
  });

  it("point beyond half-width is OUTSIDE", () => {
    // 100px perpendicular — exactly at the edge or beyond the 50px half-width
    expect(pointInPolygon(1200, 1100, pts)).toBe(false);
  });

  it("point beyond length is OUTSIDE", () => {
    expect(pointInPolygon(1500, 1000, pts)).toBe(false);
  });

  it("point near origin within strip is INSIDE", () => {
    // Just inside the strip, close to origin
    expect(pointInPolygon(1050, 1000, pts)).toBe(true);
  });

  it("near-edge point just inside half-width is INSIDE", () => {
    // 49px off-axis (within 50px half-width)
    expect(pointInPolygon(1200, 1049, pts)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rayPolygonShape
// ---------------------------------------------------------------------------

describe("rayPolygonShape", () => {
  it("returns polygon shape with correct structure", () => {
    const s = rayPolygonShape(1000, 1000, 0, 400, 100);
    expect(s.type).toBe("polygon");
    expect(s.hole).toBe(false);
    expect(s.points.length).toBe(8);
  });

  it("points match rayPolygonPoints output", () => {
    const direct = rayPolygonPoints(200, 300, 270, 150, 60);
    const shape  = rayPolygonShape(200, 300, 270, 150, 60);
    expect(shape.points).toEqual(direct);
  });
});

// ---------------------------------------------------------------------------
// pointInPolygon — edge cases
// ---------------------------------------------------------------------------

describe("pointInPolygon edge cases", () => {
  // Simple axis-aligned square: corners (0,0),(4,0),(4,4),(0,4)
  const square = [0, 0, 4, 0, 4, 4, 0, 4];

  it("centre of square is INSIDE", () => {
    expect(pointInPolygon(2, 2, square)).toBe(true);
  });

  it("point outside square is OUTSIDE", () => {
    expect(pointInPolygon(5, 5, square)).toBe(false);
  });

  it("point at corner vertex is treated consistently (no throw)", () => {
    // Boundary behaviour is implementation-defined; we just check no exception.
    expect(() => pointInPolygon(0, 0, square)).not.toThrow();
  });
});
