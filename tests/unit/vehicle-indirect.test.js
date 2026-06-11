/**
 * Unit tests for module/vehicle/vehicle-indirect.js.
 *
 * Covers all exported pure functions: shellTravelTurns, indirectToHitNumber,
 * indirectToHitBonus, indirectDeviationM, bombDeviationM, scatterDirectionDeg,
 * deviationVector, bombDirectPen, diveBombAimBonus, bombFallSchedule,
 * bombFallTurns, indirectLanding, bombLanding, and warheadProfile.
 */

import { describe, it, expect } from "vitest";
import {
  shellTravelTurns,
  indirectToHitNumber,
  indirectToHitBonus,
  indirectDeviationM,
  bombDeviationM,
  scatterDirectionDeg,
  deviationVector,
  bombDirectPen,
  diveBombAimBonus,
  bombFallSchedule,
  bombFallTurns,
  indirectLanding,
  bombLanding,
  warheadProfile,
} from "../../module/vehicle/vehicle-indirect.js";

// ─── shellTravelTurns ────────────────────────────────────────────────────────

describe("shellTravelTurns", () => {
  it("artillery 600 m/turn: 600 m = 1 turn", () => {
    expect(shellTravelTurns(600, "artillery")).toBe(1);
  });

  it("artillery 1200 m = 2 turns", () => {
    expect(shellTravelTurns(1200, "artillery")).toBe(2);
  });

  it("artillery rounds UP: 601 m = 2 turns", () => {
    expect(shellTravelTurns(601, "artillery")).toBe(2);
  });

  it("grenade/mortar 400 m/turn: 400 m = 1 turn", () => {
    expect(shellTravelTurns(400, "mortar")).toBe(1);
    expect(shellTravelTurns(400, "grenade")).toBe(1);
  });

  it("grenade/mortar 800 m = 2 turns", () => {
    expect(shellTravelTurns(800, "mortar")).toBe(2);
  });

  it("grenade/mortar rounds UP: 401 m = 2 turns", () => {
    expect(shellTravelTurns(401, "mortar")).toBe(2);
  });

  it("0 m → minimum 1 turn", () => {
    expect(shellTravelTurns(0, "artillery")).toBe(1);
    expect(shellTravelTurns(0, "mortar")).toBe(1);
  });

  it("default kind is artillery", () => {
    expect(shellTravelTurns(600)).toBe(1);
    expect(shellTravelTurns(400)).toBe(1); // ceil(400/600)=1
  });

  it("null/undefined range → 1 turn minimum", () => {
    expect(shellTravelTurns(null)).toBe(1);
    expect(shellTravelTurns(undefined)).toBe(1);
  });
});

// ─── indirectToHitNumber ─────────────────────────────────────────────────────

describe("indirectToHitNumber", () => {
  it("not yet ranged in → 25", () => {
    expect(indirectToHitNumber({ alreadyRangedIn: false })).toBe(25);
    expect(indirectToHitNumber()).toBe(25);
  });

  it("already ranged in → 10", () => {
    expect(indirectToHitNumber({ alreadyRangedIn: true })).toBe(10);
  });
});

// ─── indirectToHitBonus ──────────────────────────────────────────────────────

describe("indirectToHitBonus", () => {
  it("basic calculation: (spotterHW + spotterINT)/2 + firerHW/2 + mods", () => {
    // (10+8)/2 + 6/2 + 2 = 9 + 3 + 2 = 14
    expect(indirectToHitBonus({ spotterHW: 10, spotterINT: 8, firerHW: 6, mods: 2 })).toBe(14);
  });

  it("floors each half independently", () => {
    // (7+4)/2 = floor(5.5) = 5; firerHW=5/2 = floor(2.5) = 2; total=7
    expect(indirectToHitBonus({ spotterHW: 7, spotterINT: 4, firerHW: 5, mods: 0 })).toBe(7);
  });

  it("zeros → 0", () => {
    expect(indirectToHitBonus({ spotterHW: 0, spotterINT: 0, firerHW: 0, mods: 0 })).toBe(0);
  });

  it("default {} → 0", () => {
    expect(indirectToHitBonus()).toBe(0);
  });

  it("negative mods reduce the bonus", () => {
    // (10+10)/2 + 10/2 + (−10) = 10+5−10 = 5
    expect(indirectToHitBonus({ spotterHW: 10, spotterINT: 10, firerHW: 10, mods: -10 })).toBe(5);
  });
});

// ─── indirectDeviationM ──────────────────────────────────────────────────────

describe("indirectDeviationM", () => {
  it("missedBy × (range/100): missedBy=5, range=1000 → 50 m", () => {
    expect(indirectDeviationM(1000, 5)).toBe(50);
  });

  it("missedBy=1, range=100 → 1 m", () => {
    expect(indirectDeviationM(100, 1)).toBe(1);
  });

  it("short range 200 m, missed by 10 → 20 m", () => {
    expect(indirectDeviationM(200, 10)).toBe(20);
  });

  it("0 range → 0 deviation regardless of miss", () => {
    expect(indirectDeviationM(0, 10)).toBe(0);
  });

  it("0 missedBy → 0 deviation", () => {
    expect(indirectDeviationM(1000, 0)).toBe(0);
  });

  it("negative missedBy clamped to 0", () => {
    expect(indirectDeviationM(1000, -5)).toBe(0);
  });

  it("null/undefined inputs → 0", () => {
    expect(indirectDeviationM(null, 5)).toBe(0);
    expect(indirectDeviationM(1000, null)).toBe(0);
  });
});

// ─── bombDeviationM ──────────────────────────────────────────────────────────

describe("bombDeviationM", () => {
  it("missedBy × 10 × (height/100): height=500, missed=3 → 3×10×5=150 m", () => {
    expect(bombDeviationM(500, 3)).toBe(150);
  });

  it("height=100, missed=1 → 10 m", () => {
    expect(bombDeviationM(100, 1)).toBe(10);
  });

  it("0 height → 0 deviation", () => {
    expect(bombDeviationM(0, 5)).toBe(0);
  });

  it("0 missedBy → 0 deviation", () => {
    expect(bombDeviationM(500, 0)).toBe(0);
  });

  it("negative missedBy clamped to 0", () => {
    expect(bombDeviationM(500, -3)).toBe(0);
  });

  it("null inputs → 0", () => {
    expect(bombDeviationM(null, 3)).toBe(0);
    expect(bombDeviationM(500, null)).toBe(0);
  });
});

// ─── scatterDirectionDeg ─────────────────────────────────────────────────────

describe("scatterDirectionDeg", () => {
  it("d10=1 → 0°", () => {
    expect(scatterDirectionDeg(1)).toBe(0);
  });

  it("d10=2 → 36°", () => {
    expect(scatterDirectionDeg(2)).toBe(36);
  });

  it("d10=5 → 144°", () => {
    expect(scatterDirectionDeg(5)).toBe(144);
  });

  it("d10=10 → 324°", () => {
    expect(scatterDirectionDeg(10)).toBe(324);
  });

  it("full table: every die face maps to (n-1)*36 degrees", () => {
    for (let d = 1; d <= 10; d++) {
      expect(scatterDirectionDeg(d)).toBe((d - 1) * 36);
    }
  });

  it("0 is clamped to 1 → 0°", () => {
    // Math.max(1, Math.min(10, round(0))) = Math.max(1,0)=1 → 0°
    expect(scatterDirectionDeg(0)).toBe(0);
  });

  it("11 is clamped to 10 → 324°", () => {
    expect(scatterDirectionDeg(11)).toBe(324);
  });

  it("null/undefined treated as 1 → 0°", () => {
    expect(scatterDirectionDeg(null)).toBe(0);
    expect(scatterDirectionDeg(undefined)).toBe(0);
  });
});

// ─── deviationVector ─────────────────────────────────────────────────────────

describe("deviationVector", () => {
  it("d10=1 → 0° east: dx=distanceM, dy≈0", () => {
    const v = deviationVector({ distanceM: 100, d10: 1 });
    expect(v.distanceM).toBe(100);
    expect(v.dirDeg).toBe(0);
    expect(v.dx).toBeCloseTo(100, 5);
    expect(v.dy).toBeCloseTo(0, 5);
  });

  it("d10=3 → 72° direction: cos/sin correctly applied", () => {
    // dirDeg = (3-1)*36 = 72°
    const DEG = Math.PI / 180;
    const distM = 50;
    const angle = 72 * DEG;
    const v = deviationVector({ distanceM: distM, d10: 3 });
    expect(v.dirDeg).toBe(72);
    expect(v.dx).toBeCloseTo(distM * Math.cos(angle), 5);
    expect(v.dy).toBeCloseTo(distM * Math.sin(angle), 5);
  });

  it("0 distanceM → dx≈0, dy≈0", () => {
    const v = deviationVector({ distanceM: 0, d10: 5 });
    // 0 * trig(angle) can produce −0 in JS; use toBeCloseTo to handle this
    expect(v.dx).toBeCloseTo(0, 10);
    expect(v.dy).toBeCloseTo(0, 10);
    expect(v.distanceM).toBe(0);
  });

  it("default {} → dirDeg=0, distanceM=0", () => {
    const v = deviationVector();
    expect(v.distanceM).toBe(0);
    expect(v.dirDeg).toBe(0);
    expect(v.dx).toBe(0);
    expect(v.dy).toBe(0);
  });

  it("returns all four keys: dx, dy, distanceM, dirDeg", () => {
    const v = deviationVector({ distanceM: 10, d10: 4 });
    expect(v).toHaveProperty("dx");
    expect(v).toHaveProperty("dy");
    expect(v).toHaveProperty("distanceM");
    expect(v).toHaveProperty("dirDeg");
  });
});

// ─── bombDirectPen ────────────────────────────────────────────────────────────

describe("bombDirectPen", () => {
  it("multiplies Pen ×5", () => {
    expect(bombDirectPen(10)).toBe(50);
    expect(bombDirectPen(3)).toBe(15);
  });

  it("Pen=1 → 5", () => {
    expect(bombDirectPen(1)).toBe(5);
  });

  it("0 pen → 0", () => {
    expect(bombDirectPen(0)).toBe(0);
  });

  it("negative pen clamped to 0", () => {
    expect(bombDirectPen(-5)).toBe(0);
  });

  it("null/undefined pen → 0", () => {
    expect(bombDirectPen(null)).toBe(0);
    expect(bombDirectPen(undefined)).toBe(0);
  });
});

// ─── diveBombAimBonus ────────────────────────────────────────────────────────

describe("diveBombAimBonus", () => {
  it("1 turn (first turn, no bonus)", () => {
    expect(diveBombAimBonus(1)).toBe(0);
  });

  it("2 turns → +1", () => {
    expect(diveBombAimBonus(2)).toBe(1);
  });

  it("3 turns → +2", () => {
    expect(diveBombAimBonus(3)).toBe(2);
  });

  it("4 turns → +3 (max)", () => {
    expect(diveBombAimBonus(4)).toBe(3);
  });

  it("5+ turns → still +3 (capped at 3)", () => {
    expect(diveBombAimBonus(5)).toBe(3);
    expect(diveBombAimBonus(100)).toBe(3);
  });

  it("0 or negative turns → 0", () => {
    expect(diveBombAimBonus(0)).toBe(0);
    expect(diveBombAimBonus(-1)).toBe(0);
  });

  it("null/undefined → 0", () => {
    expect(diveBombAimBonus(null)).toBe(0);
    expect(diveBombAimBonus(undefined)).toBe(0);
  });
});

// ─── bombFallSchedule ────────────────────────────────────────────────────────

describe("bombFallSchedule", () => {
  it("normal drop (no diveSpeed): height=175 m → [175]", () => {
    expect(bombFallSchedule(175)).toEqual([175]);
  });

  it("normal drop: height=350 m → [175, 175]", () => {
    expect(bombFallSchedule(350)).toEqual([175, 175]);
  });

  it("normal drop: height=200 m → [175, 175] (overshoot: 200-175=25 remaining → one more step)", () => {
    // After first step: remaining = 200 - 175 = 25 > 0, speed stays 175 → another step
    expect(bombFallSchedule(200)).toEqual([175, 175]);
  });

  it("dive drop: starts at diveSpeed, halves each turn, floors at 175", () => {
    // diveSpeed=600: 600, 300, 175 (floor(300/2)=150 < 175 → clamped to 175)
    // height=1000:
    //   step1: 1000-600=400 remaining, speed=max(175, floor(600/2))=300
    //   step2: 400-300=100 remaining, speed=max(175, floor(300/2))=175
    //   step3: 100-175 → done
    // → [600, 300, 175]
    expect(bombFallSchedule(1000, { diveSpeed: 600 })).toEqual([600, 300, 175]);
  });

  it("diveSpeed ≤ 175 is treated as 175 (floor applied)", () => {
    // diveSpeed=100 < 175 → speed = FLOOR = 175
    expect(bombFallSchedule(175, { diveSpeed: 100 })).toEqual([175]);
  });

  it("0 height → returns [175] (the FLOOR guard, regardless of diveSpeed)", () => {
    // When remaining=0 the while loop is skipped, so steps=[] → guard returns [FLOOR=175]
    expect(bombFallSchedule(0)).toEqual([175]);
    expect(bombFallSchedule(0, { diveSpeed: 600 })).toEqual([175]);
  });

  it("dive halving stops at 175 floor", () => {
    const steps = bombFallSchedule(2000, { diveSpeed: 800 });
    // Speeds should be: 800, 400, 200, 175, 175, ...
    expect(steps[0]).toBe(800);
    expect(steps[1]).toBe(400);
    expect(steps[2]).toBe(200);
    expect(steps[3]).toBe(175);
    // Every subsequent step is 175
    for (let i = 4; i < steps.length; i++) {
      expect(steps[i]).toBe(175);
    }
  });
});

// ─── bombFallTurns ────────────────────────────────────────────────────────────

describe("bombFallTurns", () => {
  it("175 m normal drop → 1 turn", () => {
    expect(bombFallTurns(175)).toBe(1);
  });

  it("350 m normal drop → 2 turns", () => {
    expect(bombFallTurns(350)).toBe(2);
  });

  it("0 height → 1 turn (minimum via guard)", () => {
    expect(bombFallTurns(0)).toBe(1);
  });

  it("dive drop: matches length of bombFallSchedule", () => {
    const opts = { diveSpeed: 600 };
    expect(bombFallTurns(1000, opts)).toBe(bombFallSchedule(1000, opts).length);
  });
});

// ─── indirectLanding ─────────────────────────────────────────────────────────

describe("indirectLanding", () => {
  it("direct hit (total ≥ number): point = aim, deviationM=0, hit=true", () => {
    const r = indirectLanding({ aim: { x: 100, y: 200 }, rangeM: 1000, toHitTotal: 25, toHitNumber: 25, d10dir: 3, ppm: 10 });
    expect(r.hit).toBe(true);
    expect(r.point.x).toBe(100);
    expect(r.point.y).toBe(200);
    expect(r.deviationM).toBe(0);
    expect(r.missedBy).toBe(0);
  });

  it("direct hit when total exceeds number", () => {
    const r = indirectLanding({ aim: { x: 50, y: 50 }, rangeM: 500, toHitTotal: 30, toHitNumber: 25, d10dir: 1, ppm: 5 });
    expect(r.hit).toBe(true);
  });

  it("miss: deviates by missedBy × (range/100) m in the d10 direction", () => {
    // total=20, number=25 → missedBy=5, range=1000 → deviationM=50
    // d10dir=1 → dirDeg=0 → dx=50, dy=0 (times ppm=1)
    const r = indirectLanding({ aim: { x: 0, y: 0 }, rangeM: 1000, toHitTotal: 20, toHitNumber: 25, d10dir: 1, ppm: 1 });
    expect(r.hit).toBe(false);
    expect(r.deviationM).toBe(50);
    expect(r.dirDeg).toBe(0);
    expect(r.point.x).toBeCloseTo(50, 5);  // aim.x + 50*cos(0)*1
    expect(r.point.y).toBeCloseTo(0, 5);
    expect(r.missedBy).toBe(5);
  });

  it("ppm scales the pixel displacement", () => {
    const r = indirectLanding({ aim: { x: 0, y: 0 }, rangeM: 1000, toHitTotal: 20, toHitNumber: 25, d10dir: 1, ppm: 10 });
    // deviationM=50, d10=1→east, ppm=10 → point.x=500
    expect(r.point.x).toBeCloseTo(500, 5);
  });

  it("default {} → hit (total=0 ≥ number=25 is false, actually missedBy=25)", () => {
    // toHitTotal defaults 0, toHitNumber defaults 25 → missedBy=25 → miss
    const r = indirectLanding();
    expect(r.hit).toBe(false);
    expect(r.missedBy).toBe(25);
  });
});

// ─── bombLanding ─────────────────────────────────────────────────────────────

describe("bombLanding", () => {
  it("direct hit: point = aim, hit=true", () => {
    const r = bombLanding({ aim: { x: 100, y: 100 }, heightM: 500, toHitTotal: 25, toHitNumber: 25, d10dir: 1, ppm: 1 });
    expect(r.hit).toBe(true);
    expect(r.point.x).toBe(100);
    expect(r.point.y).toBe(100);
  });

  it("miss: deviates by missedBy × 10 × (height/100) m", () => {
    // total=20, number=25 → missedBy=5, height=100 → deviationM=5×10×1=50
    // d10dir=1 → 0° east → dx=50, dy≈0 at ppm=1
    const r = bombLanding({ aim: { x: 0, y: 0 }, heightM: 100, toHitTotal: 20, toHitNumber: 25, d10dir: 1, ppm: 1 });
    expect(r.hit).toBe(false);
    expect(r.deviationM).toBe(50);
    expect(r.point.x).toBeCloseTo(50, 5);
    expect(r.point.y).toBeCloseTo(0, 5);
  });

  it("ppm scales pixel displacement for bombs too", () => {
    const r = bombLanding({ aim: { x: 0, y: 0 }, heightM: 100, toHitTotal: 20, toHitNumber: 25, d10dir: 1, ppm: 5 });
    expect(r.point.x).toBeCloseTo(250, 5); // 50m * 5 ppm
  });

  it("default {} → miss (0 < 25)", () => {
    const r = bombLanding();
    expect(r.hit).toBe(false);
    expect(r.missedBy).toBe(25);
  });
});

// ─── warheadProfile ──────────────────────────────────────────────────────────

describe("warheadProfile", () => {
  it("heat: pen preserved, burstM defaults to 4, heat=true", () => {
    const p = warheadProfile("heat", { pen: 12 });
    expect(p.pen).toBe(12);
    expect(p.burstM).toBe(4);
    expect(p.heat).toBe(true);
  });

  it("heat: burstM override respected", () => {
    const p = warheadProfile("heat", { pen: 10, burstM: 6 });
    expect(p.burstM).toBe(6);
  });

  it("wp: pen=0, burstM defaults 4, dot formula=3d6 for 10 turns", () => {
    const p = warheadProfile("wp", { pen: 15 });
    expect(p.pen).toBe(0);
    expect(p.burstM).toBe(4);
    expect(p.dot).toEqual({ formula: "3d6", turns: 10 });
    expect(p.heat).toBeUndefined();
  });

  it("phosphorus and whitephosphorus are aliases for wp", () => {
    const p1 = warheadProfile("phosphorus", { pen: 10 });
    const p2 = warheadProfile("whitephosphorus", { pen: 10 });
    expect(p1.pen).toBe(0);
    expect(p2.pen).toBe(0);
    expect(p1.dot).toBeDefined();
    expect(p2.dot).toBeDefined();
  });

  it("cluster: pen capped at 4, burstM ×3", () => {
    const p = warheadProfile("cluster", { pen: 10, burstM: 5 });
    expect(p.pen).toBe(4);           // capped at 4
    expect(p.burstM).toBe(15);       // 5×3
    expect(p.cluster).toBe(true);
  });

  it("cluster: pen below cap preserved", () => {
    const p = warheadProfile("cluster", { pen: 2, burstM: 3 });
    expect(p.pen).toBe(2);           // not capped (2 < 4)
    expect(p.burstM).toBe(9);
  });

  it("cluster: burstM defaults to 1 if not given → ×3 = 3", () => {
    const p = warheadProfile("cluster", { pen: 2 });
    expect(p.burstM).toBe(3);        // (0||1)*3
  });

  it("chemical/smoke/gas: pen=0, burstM ×3, gas=true", () => {
    for (const w of ["chemical", "smoke", "gas"]) {
      const p = warheadProfile(w, { pen: 8, burstM: 4 });
      expect(p.pen).toBe(0);
      expect(p.burstM).toBe(12);
      expect(p.gas).toBe(true);
    }
  });

  it("chemical: burstM defaults to 1 → ×3 = 3", () => {
    const p = warheadProfile("chemical", { pen: 5 });
    expect(p.burstM).toBe(3);
  });

  it("plain HE (default): pen and burstM passed through unchanged", () => {
    const p = warheadProfile("he", { pen: 8, burstM: 10 });
    expect(p.pen).toBe(8);
    expect(p.burstM).toBe(10);
    expect(p.heat).toBeUndefined();
    expect(p.gas).toBeUndefined();
    expect(p.cluster).toBeUndefined();
    expect(p.dot).toBeUndefined();
  });

  it("empty / unknown warhead → plain HE passthrough", () => {
    const p = warheadProfile("unknown", { pen: 5, burstM: 7 });
    expect(p.pen).toBe(5);
    expect(p.burstM).toBe(7);
  });

  it("null warhead → plain HE", () => {
    const p = warheadProfile(null, { pen: 3, burstM: 2 });
    expect(p.pen).toBe(3);
    expect(p.burstM).toBe(2);
  });

  it("warhead matching is case-insensitive", () => {
    expect(warheadProfile("HEAT", { pen: 5 }).heat).toBe(true);
    expect(warheadProfile("WP", { pen: 5 }).dot).toBeDefined();
    expect(warheadProfile("Cluster", { pen: 2, burstM: 3 }).cluster).toBe(true);
  });

  it("negative pen clamped to 0 for all types", () => {
    expect(warheadProfile("heat", { pen: -5 }).pen).toBe(0);
    expect(warheadProfile("he", { pen: -5 }).pen).toBe(0);
    expect(warheadProfile("cluster", { pen: -1 }).pen).toBe(0);
  });

  it("no opts → pen=0, burstM defaults apply", () => {
    const p = warheadProfile("heat");
    expect(p.pen).toBe(0);
    expect(p.burstM).toBe(4);
  });
});
