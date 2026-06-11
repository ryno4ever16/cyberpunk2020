/**
 * Unit tests for module/vehicle/vehicle-missiles.js.
 *
 * Covers all exported pure functions: missileSpeed, turnsToImpact, minRange,
 * resolveMissileToHit, resolvePaintHit, interceptResult, countermeasureModifier,
 * electronicDetect, and visualDetectDV.
 * The CM_EFFECT constant is internal (not exported) but its behaviour is exercised
 * through countermeasureModifier.
 */

import { describe, it, expect } from "vitest";
import {
  missileSpeed,
  turnsToImpact,
  minRange,
  resolveMissileToHit,
  resolvePaintHit,
  interceptResult,
  countermeasureModifier,
  electronicDetect,
  visualDetectDV,
} from "../../module/vehicle/vehicle-missiles.js";

// ─── missileSpeed ─────────────────────────────────────────────────────────────

describe("missileSpeed", () => {
  it("semi-active default returns 750 m/turn", () => {
    expect(missileSpeed("semiActive")).toBe(750);
    expect(missileSpeed()).toBe(750);          // default param
  });

  it("active returns 1500 m/turn", () => {
    expect(missileSpeed("active")).toBe(1500);
  });

  it("paint returns 3000 m/turn", () => {
    expect(missileSpeed("paint")).toBe(3000);
  });

  it("unknown guidance defaults to semiActive speed (750)", () => {
    expect(missileSpeed("banana")).toBe(750);
  });

  it("positive override supersedes guidance", () => {
    expect(missileSpeed("active", 2000)).toBe(2000);
    expect(missileSpeed("paint", 500)).toBe(500);
  });

  it("zero or negative override is ignored — guidance speed used", () => {
    expect(missileSpeed("active", 0)).toBe(1500);
    expect(missileSpeed("active", -100)).toBe(1500);
  });
});

// ─── turnsToImpact ────────────────────────────────────────────────────────────

describe("turnsToImpact", () => {
  it("exact division: 1500 m at 750 m/turn = 2 turns", () => {
    expect(turnsToImpact(1500, 750)).toBe(2);
  });

  it("rounds UP when not exact: 751 m at 750 m/turn = 2 turns", () => {
    expect(turnsToImpact(751, 750)).toBe(2);
  });

  it("1 m at 750 m/turn = 1 turn (ceil rounds up to 1)", () => {
    expect(turnsToImpact(1, 750)).toBe(1);
  });

  it("0 m → always at least 1 turn (minimum 1)", () => {
    expect(turnsToImpact(0, 750)).toBe(1);
  });

  it("minimum 1 turn even for absurd speed", () => {
    expect(turnsToImpact(1, 999999)).toBe(1);
  });

  it("handles null/undefined gracefully", () => {
    // null distance → Math.max(0, 0)=0 → ceil(0/750)=0 → max(1,0)=1
    expect(turnsToImpact(null, 750)).toBe(1);
    // null speed → Math.max(1, null||1)=1 → ceil(1500/1)=1500
    expect(turnsToImpact(1500, null)).toBe(1500);
  });

  it("3000 m at 1500 m/turn = 2 turns (active missile)", () => {
    expect(turnsToImpact(3000, 1500)).toBe(2);
  });

  it("speed=0 treated as 1 (avoids division by zero)", () => {
    expect(turnsToImpact(100, 0)).toBe(100); // ceil(100/1)=100
  });
});

// ─── minRange ─────────────────────────────────────────────────────────────────

describe("minRange", () => {
  it("1/10 of long range, floored", () => {
    expect(minRange(1000)).toBe(100);
    expect(minRange(150)).toBe(15);
  });

  it("rounds down (floor)", () => {
    expect(minRange(105)).toBe(10);  // floor(105/10)=10
    expect(minRange(109)).toBe(10);
    expect(minRange(110)).toBe(11);
  });

  it("0 long range → 0", () => {
    expect(minRange(0)).toBe(0);
  });

  it("handles null/undefined gracefully (returns 0)", () => {
    expect(minRange(null)).toBe(0);
    expect(minRange(undefined)).toBe(0);
  });

  it("negative long range → 0 (clamped)", () => {
    expect(minRange(-100)).toBe(0);
  });
});

// ─── resolveMissileToHit ─────────────────────────────────────────────────────

describe("resolveMissileToHit", () => {
  it("semi-active uses operatorBonus, ignores missileSkill", () => {
    const r = resolveMissileToHit({ guidance: "semiActive", d10: 5, operatorBonus: 8, missileSkill: 20, targetNumber: 10 });
    expect(r.total).toBe(13);   // 5+8
    expect(r.dv).toBe(10);
    expect(r.hit).toBe(true);
  });

  it("active uses missileSkill, ignores operatorBonus", () => {
    const r = resolveMissileToHit({ guidance: "active", d10: 5, operatorBonus: 8, missileSkill: 15, targetNumber: 10 });
    expect(r.total).toBe(20);   // 5+15
    expect(r.hit).toBe(true);
  });

  it("hits when total exactly equals dv (equal counts as hit)", () => {
    const r = resolveMissileToHit({ guidance: "semiActive", d10: 3, operatorBonus: 7, targetNumber: 10 });
    expect(r.total).toBe(10);
    expect(r.dv).toBe(10);
    expect(r.hit).toBe(true);
  });

  it("misses when total is one below dv", () => {
    const r = resolveMissileToHit({ guidance: "semiActive", d10: 2, operatorBonus: 7, targetNumber: 10 });
    expect(r.total).toBe(9);
    expect(r.hit).toBe(false);
  });

  it("difficultyMods add to dv (countermeasures)", () => {
    const r = resolveMissileToHit({ guidance: "semiActive", d10: 5, operatorBonus: 5, targetNumber: 10, difficultyMods: 10 });
    expect(r.dv).toBe(20);
    expect(r.total).toBe(10);
    expect(r.hit).toBe(false);
  });

  it("rollMods add to total", () => {
    const r = resolveMissileToHit({ guidance: "semiActive", d10: 5, operatorBonus: 5, targetNumber: 10, rollMods: -3 });
    expect(r.total).toBe(7);   // 5+5−3
  });

  it("default {} → total=0, dv=0, hit=true", () => {
    const r = resolveMissileToHit();
    expect(r.total).toBe(0);
    expect(r.dv).toBe(0);
    expect(r.hit).toBe(true);
  });

  it("paint guidance uses operatorBonus (falls through to default)", () => {
    // paint is not "active", so operatorBonus is used
    const r = resolveMissileToHit({ guidance: "paint", d10: 5, operatorBonus: 6, missileSkill: 20, targetNumber: 10 });
    expect(r.total).toBe(11);  // 5+6
  });
});

// ─── resolvePaintHit ─────────────────────────────────────────────────────────

describe("resolvePaintHit", () => {
  it("d10=1 → miss (fails, below 2)", () => {
    expect(resolvePaintHit(1)).toBe(false);
  });

  it("d10=2 → hit (lower bound of success range)", () => {
    expect(resolvePaintHit(2)).toBe(true);
  });

  it("d10=3 through 10 → all hits", () => {
    for (let i = 3; i <= 10; i++) {
      expect(resolvePaintHit(i)).toBe(true);
    }
  });

  it("d10=0 or null → miss", () => {
    expect(resolvePaintHit(0)).toBe(false);
    expect(resolvePaintHit(null)).toBe(false);
    expect(resolvePaintHit(undefined)).toBe(false);
  });
});

// ─── interceptResult ─────────────────────────────────────────────────────────

describe("interceptResult", () => {
  it("d10=10, no extra missiles → destroyed", () => {
    expect(interceptResult(10, 0).outcome).toBe("destroyed");
  });

  it("d10=4 → destroyed (boundary: ≥4)", () => {
    expect(interceptResult(4, 0).outcome).toBe("destroyed");
  });

  it("d10=3 → burst (detonates near target, half damage)", () => {
    expect(interceptResult(3, 0).outcome).toBe("burst");
  });

  it("d10=1 → burst (lower boundary of burst range)", () => {
    expect(interceptResult(1, 0).outcome).toBe("burst");
  });

  it("d10=0 → fail", () => {
    expect(interceptResult(0, 0).outcome).toBe("fail");
  });

  it("negative effective roll → fail", () => {
    expect(interceptResult(-1, 0).outcome).toBe("fail");
  });

  it("extra missiles reduce effective roll: d10=5, extra=2 → effective=3 → burst", () => {
    expect(interceptResult(5, 2).outcome).toBe("burst");
  });

  it("extra missiles can drag destroyed down to fail: d10=4, extra=5 → effective=−1 → fail", () => {
    expect(interceptResult(4, 5).outcome).toBe("fail");
  });

  it("extra=0 default: d10=7 → destroyed", () => {
    expect(interceptResult(7).outcome).toBe("destroyed");
  });

  it("null d10 → effective=0 → fail", () => {
    expect(interceptResult(null).outcome).toBe("fail");
  });

  // Full d10 range with no extra missiles
  it("full range test: d10 1-3 burst, 4-10 destroyed, ≤0 fail", () => {
    expect(interceptResult(1).outcome).toBe("burst");
    expect(interceptResult(2).outcome).toBe("burst");
    expect(interceptResult(3).outcome).toBe("burst");
    expect(interceptResult(4).outcome).toBe("destroyed");
    expect(interceptResult(5).outcome).toBe("destroyed");
    expect(interceptResult(10).outcome).toBe("destroyed");
  });
});

// ─── countermeasureModifier ──────────────────────────────────────────────────

describe("countermeasureModifier", () => {
  it("empty list → 0 for any homing method", () => {
    expect(countermeasureModifier([], "radar")).toBe(0);
    expect(countermeasureModifier([], "thermal")).toBe(0);
    expect(countermeasureModifier([], "laser")).toBe(0);
  });

  it("chaff adds +10 vs radar, nothing vs thermal", () => {
    expect(countermeasureModifier(["chaff"], "radar")).toBe(10);
    expect(countermeasureModifier(["chaff"], "thermal")).toBe(0);
  });

  it("flares adds +10 vs thermal, nothing vs radar", () => {
    expect(countermeasureModifier(["flares"], "thermal")).toBe(10);
    expect(countermeasureModifier(["flares"], "radar")).toBe(0);
  });

  it("irBaffling adds +5 vs thermal", () => {
    expect(countermeasureModifier(["irBaffling"], "thermal")).toBe(5);
  });

  it("irSmoke adds +15 vs thermal and +15 vs optical", () => {
    expect(countermeasureModifier(["irSmoke"], "thermal")).toBe(15);
    expect(countermeasureModifier(["irSmoke"], "optical")).toBe(15);
  });

  it("jamming adds +15 vs radar", () => {
    expect(countermeasureModifier(["jamming"], "radar")).toBe(15);
  });

  it("ecm adds +15 vs radar", () => {
    expect(countermeasureModifier(["ecm"], "radar")).toBe(15);
  });

  it("smoke adds +15 vs optical", () => {
    expect(countermeasureModifier(["smoke"], "optical")).toBe(15);
  });

  it("stealth adds +15 vs radar", () => {
    expect(countermeasureModifier(["stealth"], "radar")).toBe(15);
  });

  it("antiLaserAerosol adds +15 vs laser", () => {
    expect(countermeasureModifier(["antiLaserAerosol"], "laser")).toBe(15);
  });

  it("multiple CMs of the same type stack", () => {
    expect(countermeasureModifier(["chaff", "jamming", "ecm"], "radar")).toBe(40); // 10+15+15
  });

  it("mixed CMs only count matching homing method", () => {
    expect(countermeasureModifier(["chaff", "flares"], "radar")).toBe(10);
    expect(countermeasureModifier(["chaff", "flares"], "thermal")).toBe(10);
    expect(countermeasureModifier(["chaff", "flares"], "optical")).toBe(0);
  });

  it("unknown CM key contributes 0", () => {
    expect(countermeasureModifier(["banana"], "radar")).toBe(0);
  });

  it("null activeCMs → 0 (graceful)", () => {
    expect(countermeasureModifier(null, "radar")).toBe(0);
    expect(countermeasureModifier(undefined, "radar")).toBe(0);
  });
});

// ─── electronicDetect ────────────────────────────────────────────────────────

describe("electronicDetect", () => {
  it("d10=1 → not detected (below 2)", () => {
    expect(electronicDetect(1)).toBe(false);
  });

  it("d10=2 → detected (90% sensor chance)", () => {
    expect(electronicDetect(2)).toBe(true);
  });

  it("d10=3 through 10 → all detected", () => {
    for (let i = 3; i <= 10; i++) {
      expect(electronicDetect(i)).toBe(true);
    }
  });

  it("d10=0 → not detected", () => {
    expect(electronicDetect(0)).toBe(false);
  });

  it("null / undefined → not detected", () => {
    expect(electronicDetect(null)).toBe(false);
    expect(electronicDetect(undefined)).toBe(false);
  });
});

// ─── visualDetectDV ──────────────────────────────────────────────────────────

describe("visualDetectDV", () => {
  it("'firing' situation → DV 10", () => {
    expect(visualDetectDV("firing")).toBe(10);
  });

  it("'inFlight' situation → DV 20", () => {
    expect(visualDetectDV("inFlight")).toBe(20);
  });

  it("default (no arg) → DV 20 (inFlight is default)", () => {
    expect(visualDetectDV()).toBe(20);
  });

  it("unknown situation → DV 20 (falls through to else)", () => {
    expect(visualDetectDV("spotted")).toBe(20);
    expect(visualDetectDV("")).toBe(20);
  });
});
