/**
 * Unit tests for module/vehicle/vehicle-targeting.js.
 *
 * Pure exports covered: computeFacing, rangeBand, mountArcBears, resolvePenVsPerson.
 * Also covered (with plain token-like objects): detectFacingFromTokens, bearingFromFirer.
 *
 * SKIPPED (Foundry-dependent):
 *   resolveFacing      — reads canvas?.tokens?.get / canvas?.tokens?.placeables at call time
 *   dispatchAttack     — calls game, canvas, and dynamically imports vehicle-damage.js / save-rolls.js
 *   postLuckSavePrompt — calls ChatMessage.create
 *   registerVehicleTargetingHandlers — calls game.socket and onGlobalClick (DOM / Hooks)
 */

import { describe, it, expect } from "vitest";
import {
  computeFacing,
  detectFacingFromTokens,
  bearingFromFirer,
  rangeBand,
  mountArcBears,
  resolvePenVsPerson,
} from "../../module/vehicle/vehicle-targeting.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal token-like object for detectFacingFromTokens / bearingFromFirer.
 * center is optional (falls back to x, y if absent).
 */
function tok({ x = 0, y = 0, elevation = 0, rotation = 0, useCenter = true } = {}) {
  return {
    x, y,
    ...(useCenter ? { center: { x, y } } : {}),
    document: { elevation, rotation },
  };
}

// ─── computeFacing ────────────────────────────────────────────────────────────

describe("computeFacing", () => {
  // No arguments → defaults to 0,0,0,0 → dx=0,dy=0 so horiz=0 → "front"
  it("defaults (no args) return front", () => {
    expect(computeFacing()).toBe("front");
  });

  it("dx=0 dy=0 (same position) returns front", () => {
    expect(computeFacing({ dx: 0, dy: 0, dz: 0 })).toBe("front");
  });

  // Elevation checks come first (|dz| > horiz)
  it("steep upward shot (dz > horiz) returns top", () => {
    expect(computeFacing({ dx: 0, dy: 0, dz: 10 })).toBe("top");
  });

  it("steep downward shot (dz < -horiz) returns bottom", () => {
    expect(computeFacing({ dx: 0, dy: 0, dz: -10 })).toBe("bottom");
  });

  it("dz just below 45° threshold stays in horizontal arc", () => {
    // horiz = hypot(10,0) = 10; dz = 9 < 10 → horizontal arc used
    const result = computeFacing({ dx: 10, dy: 0, dz: 9, rotationDeg: 0 });
    expect(["front", "side", "rear"]).toContain(result);
  });

  it("dz exactly equal to horiz is NOT steep (strict >) → horizontal arc (side since dx=10,dy=0,rotation=0 is 90°)", () => {
    // |dz| > horiz requires strict greater-than. dz === horiz falls through to horizontal arc.
    // dx=10, dy=0, rotation=0 → facing=(0,-1); direction-to-attacker=(1,0); angle=90° → "side".
    const result = computeFacing({ dx: 10, dy: 0, dz: 10, rotationDeg: 0 });
    expect(result).toBe("side");
  });

  // Horizontal arc tests: rotation 0 = facing "up" (north = negative-y direction on canvas).
  // Target facing unit vector at rotation 0: (sin0, -cos0) = (0, -1) = pointing up.

  it("attacker directly ahead of target (dy < 0, rotation=0) → front", () => {
    // dx=0, dy=-100 → direction to attacker from target is (0,-1) = exactly aligned with facing
    expect(computeFacing({ dx: 0, dy: -100, dz: 0, rotationDeg: 0 })).toBe("front");
  });

  it("attacker directly behind target (dy > 0, rotation=0) → rear", () => {
    expect(computeFacing({ dx: 0, dy: 100, dz: 0, rotationDeg: 0 })).toBe("rear");
  });

  it("attacker directly to the side (dx=100, dy=0, rotation=0) → side", () => {
    // angle between facing (0,-1) and direction (1,0) = 90° → side
    expect(computeFacing({ dx: 100, dy: 0, dz: 0, rotationDeg: 0 })).toBe("side");
  });

  it("exactly 45° boundary is front-inclusive (fp-epsilon guarded)", () => {
    // Regression for an IEEE-754 boundary bug: Math.SQRT1_2 = cos(45°), and
    // acos(0.70710…)·180/π = 45.000000000000014, which a bare `<= 45` wrongly rejects → "side".
    // The source now guards the inclusive ±45° boundary with a tiny epsilon, so an exact-45°
    // bearing is "front" per the documented rule.
    const a = Math.SQRT1_2;
    expect(computeFacing({ dx: a, dy: -a, dz: 0, rotationDeg: 0 })).toBe("front");
  });

  it("angle just under 45° → front", () => {
    // Use 44.9° to stay safely inside the front arc despite floating-point rounding
    const a44 = 44.9 * Math.PI / 180;
    const dx = Math.sin(a44), dy = -Math.cos(a44);  // rotation=0, facing=(0,-1)
    expect(computeFacing({ dx, dy, dz: 0, rotationDeg: 0 })).toBe("front");
  });

  it("exactly 135° boundary is rear-inclusive", () => {
    // The mirror boundary: 135° off → dot = -SQRT1_2, acos = 135.000…01, which is "rear" per the
    // ±135° rule (the source guards this inclusive boundary with the same epsilon for symmetry).
    const a = Math.SQRT1_2;
    expect(computeFacing({ dx: a, dy: a, dz: 0, rotationDeg: 0 })).toBe("rear");
  });

  it("angle 136° off facing → rear", () => {
    // rotation=0, facing=(0,-1). We need angle between (0,-1) and (dx,dy)/horiz = 136°.
    // dot = (0*dx + (-1)*dy)/horiz = -dy/horiz = cos(136°) ≈ -0.719
    // So dy/horiz = 0.719 (positive = going "down" = toward behind target)
    // Pick a small dx and large positive dy so angle ≈ 136°.
    // Exact: dx = sin(136°) ≈ 0.6947, dy = -cos(136°) ≈ 0.7193
    const dx = Math.sin(136 * Math.PI / 180);
    const dy = -Math.cos(136 * Math.PI / 180);  // = cos(44°) > 0
    expect(computeFacing({ dx, dy, dz: 0, rotationDeg: 0 })).toBe("rear");
  });

  it("angle between 45° and 135° → side", () => {
    // ~90° off: dx=100, dy=0, rotation=0 → side
    expect(computeFacing({ dx: 100, dy: 0, dz: 0, rotationDeg: 0 })).toBe("side");
  });

  it("target rotated 180° (facing down/south): attacker above (dy<0) → rear", () => {
    // rotation=180 → facing=(sin180,-cos180)=(0,1) = pointing down
    // attacker at dy=-100 (above target) → direction (0,-1), angle with (0,1) = 180° → rear
    expect(computeFacing({ dx: 0, dy: -100, dz: 0, rotationDeg: 180 })).toBe("rear");
  });

  it("target rotated 90° (facing right/east): attacker to the right (dx>0) → front", () => {
    // rotation=90 → facing=(sin90,-cos90)=(1,0) = pointing right
    expect(computeFacing({ dx: 100, dy: 0, dz: 0, rotationDeg: 90 })).toBe("front");
  });

  it("negative dz with |dz| < horiz stays horizontal", () => {
    // |dz|=5, horiz=hypot(10,0)=10 → horizontal
    const r = computeFacing({ dx: 10, dy: 0, dz: -5, rotationDeg: 0 });
    expect(["front", "side", "rear"]).toContain(r);
  });
});

// ─── detectFacingFromTokens ───────────────────────────────────────────────────

describe("detectFacingFromTokens", () => {
  it("returns front when either token is missing", () => {
    expect(detectFacingFromTokens(null, tok())).toBe("front");
    expect(detectFacingFromTokens(tok(), null)).toBe("front");
    expect(detectFacingFromTokens(null, null)).toBe("front");
  });

  it("attacker directly above target (dy<0 on canvas) + rotation=0 → front", () => {
    const attacker = tok({ x: 100, y: 0 });
    const target   = tok({ x: 100, y: 100, rotation: 0 });
    // ac.y=0 - tc.y=100 = -100, dx=0 → attacker is "above" (dy < 0) = in front of rotation=0 target
    expect(detectFacingFromTokens(attacker, target)).toBe("front");
  });

  it("attacker behind target (dy>0) + rotation=0 → rear", () => {
    const attacker = tok({ x: 100, y: 200 });
    const target   = tok({ x: 100, y: 100, rotation: 0 });
    expect(detectFacingFromTokens(attacker, target)).toBe("rear");
  });

  it("uses center property when present", () => {
    // Token at (0,0) with center at (50,50), target at (50,50) center (50,150) + rotation=0
    // dx = 50-50=0, dy = 50-150=-100 → front
    const attacker = { center: { x: 50, y: 50 },   document: { elevation: 0, rotation: 0 } };
    const target   = { center: { x: 50, y: 150 },  document: { elevation: 0, rotation: 0 } };
    expect(detectFacingFromTokens(attacker, target)).toBe("front");
  });

  it("elevation steep enough → top", () => {
    // attacker elevated 200 above target, same xy → dz > horiz → top
    const attacker = tok({ x: 100, y: 100, elevation: 200 });
    const target   = tok({ x: 100, y: 100, elevation: 0 });
    expect(detectFacingFromTokens(attacker, target)).toBe("top");
  });

  it("falls back to x/y when center is absent", () => {
    const attacker = { x: 100, y: 0,   document: { elevation: 0, rotation: 0 } };
    const target   = { x: 100, y: 100, document: { elevation: 0, rotation: 0 } };
    // dy = ac.y - tc.y = 0 - 100 = -100 → front (target facing up)
    expect(detectFacingFromTokens(attacker, target)).toBe("front");
  });
});

// ─── bearingFromFirer ─────────────────────────────────────────────────────────

describe("bearingFromFirer", () => {
  it("returns front when either token is missing", () => {
    expect(bearingFromFirer(null, tok())).toBe("front");
    expect(bearingFromFirer(tok(), null)).toBe("front");
  });

  it("target directly ahead of firer (firer rotation=0, target above) → front", () => {
    // firer faces up (rotation=0), target is above: dx=0, dy=-100 (negative-y on canvas)
    const firer  = tok({ x: 100, y: 100, rotation: 0 });
    const target = tok({ x: 100, y: 0 });
    expect(bearingFromFirer(firer, target)).toBe("front");
  });

  it("target directly behind firer → rear", () => {
    const firer  = tok({ x: 100, y: 100, rotation: 0 });
    const target = tok({ x: 100, y: 200 });
    expect(bearingFromFirer(firer, target)).toBe("rear");
  });

  it("target to the side of firer → side", () => {
    const firer  = tok({ x: 100, y: 100, rotation: 0 });
    const target = tok({ x: 200, y: 100 });
    expect(bearingFromFirer(firer, target)).toBe("side");
  });

  it("firer rotation 90° (facing east): target to the right (east) → front", () => {
    const firer  = tok({ x: 100, y: 100, rotation: 90 });
    const target = tok({ x: 200, y: 100 });
    expect(bearingFromFirer(firer, target)).toBe("front");
  });
});

// ─── rangeBand ────────────────────────────────────────────────────────────────

describe("rangeBand", () => {
  it("returns normal when weaponRange is 0 or absent", () => {
    expect(rangeBand(9999, 0)).toBe("normal");
    expect(rangeBand(9999, null)).toBe("normal");
    expect(rangeBand(9999, undefined)).toBe("normal");
  });

  it("distance 0 → normal", () => {
    expect(rangeBand(0, 100)).toBe("normal");
  });

  it("distance ≤ half range → normal", () => {
    expect(rangeBand(50, 100)).toBe("normal");
    expect(rangeBand(49, 100)).toBe("normal");
    expect(rangeBand(1, 100)).toBe("normal");
  });

  it("distance exactly half range → normal (boundary inclusive d <= r*0.5)", () => {
    expect(rangeBand(50, 100)).toBe("normal");
  });

  it("distance just over half range → long", () => {
    expect(rangeBand(51, 100)).toBe("long");
  });

  it("distance exactly at weapon range → long (boundary d <= r)", () => {
    expect(rangeBand(100, 100)).toBe("long");
  });

  it("distance beyond weapon range → extreme", () => {
    expect(rangeBand(101, 100)).toBe("extreme");
    expect(rangeBand(9999, 100)).toBe("extreme");
  });

  it("non-numeric distance treated as 0 → normal", () => {
    expect(rangeBand(null, 100)).toBe("normal");
    expect(rangeBand(undefined, 100)).toBe("normal");
  });
});

// ─── mountArcBears ────────────────────────────────────────────────────────────

describe("mountArcBears", () => {
  // Turret = 360° — always bears
  it("turret bears for all bearings", () => {
    for (const b of ["front", "side", "rear", "top", "bottom"]) {
      expect(mountArcBears(b, "turret")).toBe(true);
    }
  });

  it("turret is the default arc", () => {
    expect(mountArcBears("front")).toBe(true);
    expect(mountArcBears("rear")).toBe(true);
  });

  // top/bottom out of arc for everything except turret
  it("top bearing → false for front arc", () => {
    expect(mountArcBears("top", "front")).toBe(false);
  });

  it("bottom bearing → false for front arc", () => {
    expect(mountArcBears("bottom", "front")).toBe(false);
  });

  it("top bearing → false for side arc", () => {
    expect(mountArcBears("top", "side")).toBe(false);
  });

  it("top bearing → false for rear arc", () => {
    expect(mountArcBears("top", "rear")).toBe(false);
  });

  // front arc
  it("front arc bears only on front bearing", () => {
    expect(mountArcBears("front", "front")).toBe(true);
    expect(mountArcBears("side", "front")).toBe(false);
    expect(mountArcBears("rear", "front")).toBe(false);
  });

  // rear arc
  it("rear arc bears only on rear bearing", () => {
    expect(mountArcBears("rear", "rear")).toBe(true);
    expect(mountArcBears("front", "rear")).toBe(false);
    expect(mountArcBears("side", "rear")).toBe(false);
  });

  // side arc (the "articulated/side" mount type: front or side)
  it("side arc bears on front or side, not rear", () => {
    expect(mountArcBears("front", "side")).toBe(true);
    expect(mountArcBears("side", "side")).toBe(true);
    expect(mountArcBears("rear", "side")).toBe(false);
  });

  // Unknown arc → true (default case)
  it("unknown arc type falls through to true", () => {
    expect(mountArcBears("side", "omnidirectional")).toBe(true);
  });
});

// ─── resolvePenVsPerson ───────────────────────────────────────────────────────

describe("resolvePenVsPerson", () => {
  // ── 1. Luck save ──────────────────────────────────────────────────────────
  it("luck save success (luckTotal >= 15 default DC) → grazed with 5d6 + half armor", () => {
    const res = resolvePenVsPerson({ pen: 5, av: 2, luckTotal: 15 });
    expect(res.outcome).toBe("grazed");
    expect(res.damageFormula).toBe("5d6");
    expect(res.armorMult).toBeCloseTo(0.5);
  });

  it("luck save of exactly DC passes", () => {
    const res = resolvePenVsPerson({ pen: 3, av: 1, luckTotal: 15, luckDC: 15 });
    expect(res.outcome).toBe("grazed");
  });

  it("luck save one below DC fails", () => {
    const res = resolvePenVsPerson({ pen: 3, av: 1, luckTotal: 14, luckDC: 15 });
    expect(res.outcome).not.toBe("grazed");
  });

  it("custom luckDC is respected", () => {
    const res = resolvePenVsPerson({ pen: 2, av: 0, luckTotal: 12, luckDC: 10 });
    expect(res.outcome).toBe("grazed");
  });

  // ── 2. Luck failed: Pen ≤ AV → stopped ───────────────────────────────────
  it("Pen <= AV with luck fail → stopped, 2d6 formula, spStripped = 10 * Pen", () => {
    const res = resolvePenVsPerson({ pen: 3, av: 5, luckTotal: 0 });
    expect(res.outcome).toBe("stopped");
    expect(res.damageFormula).toBe("2d6");
    expect(res.spStripped).toBe(30);    // 10 × pen(3)
    expect(res.diff).toBeLessThanOrEqual(0);
  });

  it("Pen === AV → stopped (diff = 0)", () => {
    const res = resolvePenVsPerson({ pen: 4, av: 4, luckTotal: 0 });
    expect(res.outcome).toBe("stopped");
    expect(res.diff).toBe(0);
    expect(res.spStripped).toBe(40);
  });

  it("Pen = 0, AV = 0 → stopped (diff 0, spStripped 0)", () => {
    const res = resolvePenVsPerson({ pen: 0, av: 0, luckTotal: 0 });
    expect(res.outcome).toBe("stopped");
    expect(res.diff).toBe(0);
    expect(res.spStripped).toBe(0);
  });

  // ── 3. Luck failed: Pen > AV → penetrated ─────────────────────────────────
  it("Pen > AV with luck fail → penetrated, damage = (Pen-AV)*10, armorDestroyed", () => {
    const res = resolvePenVsPerson({ pen: 6, av: 2, luckTotal: 0 });
    expect(res.outcome).toBe("penetrated");
    expect(res.diff).toBe(4);
    expect(res.damage).toBe(40);        // (6-2)*10
    expect(res.armorDestroyed).toBe(true);
  });

  it("diff of 1 → minimum penetrated damage of 10", () => {
    const res = resolvePenVsPerson({ pen: 3, av: 2, luckTotal: 0 });
    expect(res.outcome).toBe("penetrated");
    expect(res.damage).toBe(10);
  });

  // ── 4. Edge / default behaviour ───────────────────────────────────────────
  it("default args (no args) → stopped with 0 pen, 0 sp stripped", () => {
    const res = resolvePenVsPerson();
    expect(res.outcome).toBe("stopped");
    expect(res.spStripped).toBe(0);
  });

  it("negative pen is clamped to 0", () => {
    const res = resolvePenVsPerson({ pen: -5, av: 0, luckTotal: 0 });
    expect(res.outcome).toBe("stopped");
    expect(res.spStripped).toBe(0);
  });

  it("high luck (very over DC) still just grazed — not penetrated", () => {
    const res = resolvePenVsPerson({ pen: 10, av: 0, luckTotal: 25 });
    expect(res.outcome).toBe("grazed");
  });
});
