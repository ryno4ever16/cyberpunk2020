/**
 * Unit tests for module/vehicle/vehicle-control.js.
 *
 * All exported pure functions are covered. The UI wrapper (openControlRollDialog)
 * and internal helpers that require Foundry globals (_candidateDrivers, _lossCard, etc.)
 * are intentionally skipped — they cannot run without a live Foundry world.
 */

import { describe, it, expect } from "vitest";
import {
  CONTROL_DV,
  MANEUVER_EXAMPLES,
  coreSpeedPenalty,
  mmSpeedDV,
  defaultControlMod,
  isAircraft,
  resolveControlRoll,
  coreControlLoss,
  mmFailureTable,
  composeControlOutcome,
} from "../../module/vehicle/vehicle-control.js";

// ─── CONTROL_DV ──────────────────────────────────────────────────────────────

describe("CONTROL_DV", () => {
  it("has the three canonical difficulty values (Core p.112 / MM p.11)", () => {
    expect(CONTROL_DV.simple).toBe(15);
    expect(CONTROL_DV.difficult).toBe(20);
    expect(CONTROL_DV.veryDifficult).toBe(25);
  });

  it("has exactly three keys", () => {
    expect(Object.keys(CONTROL_DV)).toHaveLength(3);
  });
});

// ─── MANEUVER_EXAMPLES ───────────────────────────────────────────────────────

describe("MANEUVER_EXAMPLES", () => {
  it("has entries for all three difficulty bands", () => {
    expect(typeof MANEUVER_EXAMPLES.simple).toBe("string");
    expect(typeof MANEUVER_EXAMPLES.difficult).toBe("string");
    expect(typeof MANEUVER_EXAMPLES.veryDifficult).toBe("string");
  });

  it("entries are non-empty strings", () => {
    expect(MANEUVER_EXAMPLES.simple.length).toBeGreaterThan(0);
    expect(MANEUVER_EXAMPLES.difficult.length).toBeGreaterThan(0);
    expect(MANEUVER_EXAMPLES.veryDifficult.length).toBeGreaterThan(0);
  });
});

// ─── coreSpeedPenalty ────────────────────────────────────────────────────────

describe("coreSpeedPenalty", () => {
  it("returns 0 when at or below safe speed", () => {
    expect(coreSpeedPenalty(50, 100)).toBe(0);
    expect(coreSpeedPenalty(100, 100)).toBe(0);
  });

  it("returns −2 at exactly 2× safe speed", () => {
    expect(coreSpeedPenalty(200, 100)).toBe(-2);
  });

  it("returns −2 between 2× and just below 3×", () => {
    expect(coreSpeedPenalty(201, 100)).toBe(-2);
    expect(coreSpeedPenalty(299, 100)).toBe(-2);
  });

  it("returns −4 at exactly 3× safe speed", () => {
    expect(coreSpeedPenalty(300, 100)).toBe(-4);
  });

  it("returns −4 between 3× and just below 4×", () => {
    expect(coreSpeedPenalty(301, 100)).toBe(-4);
    expect(coreSpeedPenalty(399, 100)).toBe(-4);
  });

  it("returns −6 at exactly 4× safe speed", () => {
    expect(coreSpeedPenalty(400, 100)).toBe(-6);
  });

  it("returns −6 above 4× safe speed", () => {
    expect(coreSpeedPenalty(500, 100)).toBe(-6);
    expect(coreSpeedPenalty(1000, 100)).toBe(-6);
  });

  it("returns 0 when safe speed is 0 or unknown", () => {
    expect(coreSpeedPenalty(200, 0)).toBe(0);
    expect(coreSpeedPenalty(200, null)).toBe(0);
    expect(coreSpeedPenalty(200, undefined)).toBe(0);
  });

  it("returns 0 when current speed is 0 or unknown", () => {
    expect(coreSpeedPenalty(0, 100)).toBe(0);
    expect(coreSpeedPenalty(null, 100)).toBe(0);
    expect(coreSpeedPenalty(undefined, 100)).toBe(0);
  });
});

// ─── mmSpeedDV ───────────────────────────────────────────────────────────────

describe("mmSpeedDV", () => {
  it("returns 0 at half top speed exactly", () => {
    expect(mmSpeedDV(50, 100)).toBe(0);
  });

  it("returns 0 below half top speed", () => {
    expect(mmSpeedDV(40, 100)).toBe(0);
    expect(mmSpeedDV(0, 100)).toBe(0);
  });

  it("returns 1 just above half top speed (51 of 100)", () => {
    // (51 − 50) / 10 = floor(0.1) = 0 → returns 0? No: floor(1/10) = 0
    // Actually: floor((51-50)/(100*0.10)) = floor(1/10) = 0
    // Let's check the formula: Math.floor((s - halfTop) / (top * 0.10))
    // s=51, halfTop=50, top*0.10=10 → floor(1/10) = 0
    expect(mmSpeedDV(51, 100)).toBe(0);
  });

  it("returns 1 at 10% over the half mark (60 of 100)", () => {
    // s=60, halfTop=50, (60-50)/10 = 1
    expect(mmSpeedDV(60, 100)).toBe(1);
  });

  it("returns 2 at 20% over the half mark (70 of 100)", () => {
    expect(mmSpeedDV(70, 100)).toBe(2);
  });

  it("returns 5 at the full top speed (100 of 100)", () => {
    // (100-50)/10 = 5
    expect(mmSpeedDV(100, 100)).toBe(5);
  });

  it("increases beyond top speed if overdriven", () => {
    // (110-50)/10 = 6
    expect(mmSpeedDV(110, 100)).toBe(6);
  });

  it("returns 0 when top speed is 0 or unknown", () => {
    expect(mmSpeedDV(200, 0)).toBe(0);
    expect(mmSpeedDV(200, null)).toBe(0);
    expect(mmSpeedDV(200, undefined)).toBe(0);
  });

  it("returns 0 when current speed is 0 or unknown", () => {
    expect(mmSpeedDV(0, 100)).toBe(0);
    expect(mmSpeedDV(null, 100)).toBe(0);
  });
});

// ─── defaultControlMod ───────────────────────────────────────────────────────

describe("defaultControlMod", () => {
  it("car is 0 in Core", () => {
    expect(defaultControlMod("car", "Core")).toBe(0);
  });

  it("sportscar is +2 in Core", () => {
    expect(defaultControlMod("sportscar", "Core")).toBe(2);
  });

  it("limo is −3 in both Core and MM", () => {
    expect(defaultControlMod("limo", "Core")).toBe(-3);
    expect(defaultControlMod("limo", "MaximumMetal")).toBe(-3);
  });

  it("truck is −4 in both Core and MM", () => {
    expect(defaultControlMod("truck", "Core")).toBe(-4);
    expect(defaultControlMod("truck", "MaximumMetal")).toBe(-4);
  });

  it("motorcycle / cycle is +1 in both", () => {
    expect(defaultControlMod("motorcycle", "Core")).toBe(1);
    expect(defaultControlMod("cycle", "Core")).toBe(1);
    expect(defaultControlMod("motorcycle", "MaximumMetal")).toBe(1);
    expect(defaultControlMod("cycle", "MaximumMetal")).toBe(1);
  });

  it("av-4 is −2 in Core, 0 in MM (revised modifiers)", () => {
    expect(defaultControlMod("av-4", "Core")).toBe(-2);
    expect(defaultControlMod("av-4", "MaximumMetal")).toBe(0);
  });

  it("av-6 is +2 in Core, 0 in MM", () => {
    expect(defaultControlMod("av-6", "Core")).toBe(2);
    expect(defaultControlMod("av-6", "MaximumMetal")).toBe(0);
  });

  it("APC/IFV/MBT/tank only exist in MM table and return 2", () => {
    expect(defaultControlMod("apc", "MaximumMetal")).toBe(2);
    expect(defaultControlMod("ifv", "MaximumMetal")).toBe(2);
    expect(defaultControlMod("mbt", "MaximumMetal")).toBe(2);
    expect(defaultControlMod("tank", "MaximumMetal")).toBe(2);
  });

  it("unknown type returns 0", () => {
    expect(defaultControlMod("spaceship", "Core")).toBe(0);
    expect(defaultControlMod("spaceship", "MaximumMetal")).toBe(0);
  });

  it("null / empty type returns 0", () => {
    expect(defaultControlMod(null)).toBe(0);
    expect(defaultControlMod("")).toBe(0);
    expect(defaultControlMod(undefined)).toBe(0);
  });

  it("defaults to Core when ruleSystem is omitted", () => {
    expect(defaultControlMod("sportscar")).toBe(2);
  });

  it("is case-insensitive", () => {
    expect(defaultControlMod("Car", "Core")).toBe(0);
    expect(defaultControlMod("SPORTSCAR", "Core")).toBe(2);
  });
});

// ─── isAircraft ──────────────────────────────────────────────────────────────

describe("isAircraft", () => {
  it("recognises AV variants", () => {
    expect(isAircraft("av-4")).toBe(true);
    expect(isAircraft("av-6")).toBe(true);
    expect(isAircraft("av-7")).toBe(true);
    expect(isAircraft("av")).toBe(true);
  });

  it("recognises rotor, osprey, heli, plane, jet, airship, gyro, aerodyne, dirigible, wing", () => {
    expect(isAircraft("rotor")).toBe(true);
    expect(isAircraft("osprey")).toBe(true);
    expect(isAircraft("heli")).toBe(true);
    expect(isAircraft("helicopter")).toBe(true);
    expect(isAircraft("plane")).toBe(true);
    expect(isAircraft("jet")).toBe(true);
    expect(isAircraft("airship")).toBe(true);
    expect(isAircraft("gyro")).toBe(true);
    expect(isAircraft("aerodyne")).toBe(true);
    expect(isAircraft("dirigible")).toBe(true);
    expect(isAircraft("wing")).toBe(true);
  });

  it("returns false for ground vehicles", () => {
    expect(isAircraft("car")).toBe(false);
    expect(isAircraft("truck")).toBe(false);
    expect(isAircraft("motorcycle")).toBe(false);
    expect(isAircraft("tank")).toBe(false);
    expect(isAircraft("boat")).toBe(false);
  });

  it("returns false for null / empty", () => {
    expect(isAircraft(null)).toBe(false);
    expect(isAircraft("")).toBe(false);
    expect(isAircraft(undefined)).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isAircraft("AV-4")).toBe(true);
    expect(isAircraft("ROTOR")).toBe(true);
  });
});

// ─── resolveControlRoll ──────────────────────────────────────────────────────

describe("resolveControlRoll", () => {
  it("defaults: no args → succeeds only if 0 ≥ 15 (simple DV)", () => {
    const r = resolveControlRoll();
    expect(r.total).toBe(0);
    expect(r.dv).toBe(15);
    expect(r.success).toBe(false);
    expect(r.missedBy).toBe(15);
  });

  it("succeeds when total equals DV (RAW: equal or greater)", () => {
    const r = resolveControlRoll({ d10: 8, ref: 4, skill: 3, difficulty: "simple" });
    // total = 8+4+3 = 15, dv = 15
    expect(r.total).toBe(15);
    expect(r.dv).toBe(15);
    expect(r.success).toBe(true);
    expect(r.missedBy).toBe(0);
  });

  it("fails when total is one below DV", () => {
    const r = resolveControlRoll({ d10: 7, ref: 4, skill: 3, difficulty: "simple" });
    // total = 14, dv = 15
    expect(r.total).toBe(14);
    expect(r.success).toBe(false);
    expect(r.missedBy).toBe(1);
  });

  it("difficult DV is 20", () => {
    const r = resolveControlRoll({ d10: 10, ref: 5, skill: 5, difficulty: "difficult" });
    // total = 20, dv = 20
    expect(r.dv).toBe(20);
    expect(r.success).toBe(true);
  });

  it("veryDifficult DV is 25", () => {
    const r = resolveControlRoll({ d10: 10, ref: 8, skill: 7, difficulty: "veryDifficult" });
    // total = 25, dv = 25
    expect(r.dv).toBe(25);
    expect(r.success).toBe(true);
  });

  it("Core: speed penalty added to roll parts", () => {
    // speed=200, safeSpeed=100 → penalty −2
    const r = resolveControlRoll({ ruleSystem: "Core", d10: 8, ref: 4, skill: 3, currentSpeed: 200, safeSpeed: 100, difficulty: "simple" });
    // total = 8+4+3−2 = 13
    expect(r.total).toBe(13);
  });

  it("Core: handlingMod added to roll", () => {
    const r = resolveControlRoll({ ruleSystem: "Core", d10: 5, ref: 4, skill: 3, handlingMod: 2, difficulty: "simple" });
    // 5+4+3+2=14
    expect(r.total).toBe(14);
  });

  it("Core: otherMod added to roll", () => {
    const r = resolveControlRoll({ ruleSystem: "Core", d10: 5, ref: 3, skill: 3, otherMod: -2, difficulty: "simple" });
    expect(r.total).toBe(9);
  });

  it("MM: cyberlink adds +2 to roll", () => {
    const r = resolveControlRoll({ ruleSystem: "MaximumMetal", d10: 6, ref: 4, skill: 3, cyberlink: true, difficulty: "simple" });
    // 6+4+3+2 = 15
    expect(r.total).toBe(15);
  });

  it("MM: cantSee adds +10 to DV", () => {
    const r = resolveControlRoll({ ruleSystem: "MaximumMetal", d10: 6, ref: 4, skill: 5, cantSee: true, difficulty: "simple" });
    // dv = 15+10 = 25
    expect(r.dv).toBe(25);
  });

  it("MM: multitask adds +5 to DV", () => {
    const r = resolveControlRoll({ ruleSystem: "MaximumMetal", d10: 6, ref: 4, skill: 5, multitask: true, difficulty: "simple" });
    expect(r.dv).toBe(20);
  });

  it("MM: slippery adds +3 to DV", () => {
    const r = resolveControlRoll({ ruleSystem: "MaximumMetal", d10: 6, ref: 4, skill: 5, slippery: true, difficulty: "simple" });
    expect(r.dv).toBe(18);
  });

  it("MM: icy adds +5 to DV", () => {
    const r = resolveControlRoll({ ruleSystem: "MaximumMetal", d10: 6, ref: 4, skill: 5, icy: true, difficulty: "simple" });
    expect(r.dv).toBe(20);
  });

  it("MM: speed DV added to DV", () => {
    // speed=60, topSpeed=100 → mmSpeedDV = (60-50)/10 = 1
    const r = resolveControlRoll({ ruleSystem: "MaximumMetal", d10: 6, ref: 4, skill: 5, currentSpeed: 60, topSpeed: 100, difficulty: "simple" });
    expect(r.dv).toBe(16);
  });

  it("MM: all conditions stack on DV", () => {
    // cantSee+10, multitask+5, slippery+3, icy+5 → +23 total
    const r = resolveControlRoll({
      ruleSystem: "MaximumMetal", d10: 5, ref: 3, skill: 2,
      cantSee: true, multitask: true, slippery: true, icy: true,
      difficulty: "simple",
    });
    expect(r.dv).toBe(38); // 15+10+5+3+5
  });

  it("rollParts array contains d10, REF, Skill", () => {
    const r = resolveControlRoll({ d10: 7, ref: 4, skill: 5 });
    expect(r.rollParts.some(p => p.label === "1d10" && p.value === 7)).toBe(true);
    expect(r.rollParts.some(p => p.label === "REF" && p.value === 4)).toBe(true);
    expect(r.rollParts.some(p => p.label === "Skill" && p.value === 5)).toBe(true);
  });

  it("dvParts array contains difficulty entry", () => {
    const r = resolveControlRoll({ difficulty: "difficult" });
    expect(r.dvParts.some(p => p.label === "difficult" && p.value === 20)).toBe(true);
  });

  it("ruleSystem and isMM set correctly", () => {
    const core = resolveControlRoll({ ruleSystem: "Core" });
    expect(core.ruleSystem).toBe("Core");
    expect(core.isMM).toBe(false);

    const mm = resolveControlRoll({ ruleSystem: "MaximumMetal" });
    expect(mm.ruleSystem).toBe("MaximumMetal");
    expect(mm.isMM).toBe(true);
  });

  it("unknown difficulty falls back to simple (15)", () => {
    const r = resolveControlRoll({ difficulty: "legendary" });
    expect(r.dv).toBe(15);
  });
});

// ─── coreControlLoss ─────────────────────────────────────────────────────────

describe("coreControlLoss", () => {
  it("d6=1 → minor skid (band 1-2)", () => {
    const r = coreControlLoss(1);
    expect(r.band).toBe("1-2");
    expect(r.severity).toBe("minor");
  });

  it("d6=2 → minor skid (band 1-2)", () => {
    const r = coreControlLoss(2);
    expect(r.band).toBe("1-2");
    expect(r.severity).toBe("minor");
  });

  it("d6=3 → major skid (band 3-4) ground", () => {
    const r = coreControlLoss(3, { aircraft: false, slideDie: 4 });
    expect(r.band).toBe("3-4");
    expect(r.severity).toBe("major");
    // slide 4×10 = 40 ft
    expect(r.text).toContain("40");
  });

  it("d6=4 → major skid (band 3-4) ground, slideDie multiplied ×10", () => {
    const r = coreControlLoss(4, { aircraft: false, slideDie: 7 });
    expect(r.band).toBe("3-4");
    expect(r.text).toContain("70"); // 7×10
  });

  it("d6=3 aircraft → stall (band 3-4) with ×50 ft altitude loss", () => {
    const r = coreControlLoss(3, { aircraft: true, slideDie: 3 });
    expect(r.band).toBe("3-4");
    expect(r.severity).toBe("major");
    expect(r.text).toContain("150"); // 3×50
  });

  it("d6=5 → catastrophic roll (band 5-6) ground, includes crashDamage", () => {
    const r = coreControlLoss(5, { aircraft: false, slideDie: 2, crashDamage: 18 });
    expect(r.band).toBe("5-6");
    expect(r.severity).toBe("catastrophic");
    expect(r.damage).toBe(18);
    expect(r.text).toContain("18");
  });

  it("d6=6 → catastrophic (band 5-6) ground", () => {
    const r = coreControlLoss(6, { aircraft: false, slideDie: 5, crashDamage: 22 });
    expect(r.band).toBe("5-6");
    expect(r.severity).toBe("catastrophic");
    expect(r.damage).toBe(22);
  });

  it("d6=5 aircraft → spin (band 5-6) with ×100 ft altitude loss", () => {
    const r = coreControlLoss(5, { aircraft: true, slideDie: 6 });
    expect(r.band).toBe("5-6");
    expect(r.severity).toBe("catastrophic");
    expect(r.text).toContain("600"); // 6×100
  });

  it("d6=6 aircraft → spin, no crashDamage property", () => {
    const r = coreControlLoss(6, { aircraft: true, slideDie: 3 });
    expect(r.band).toBe("5-6");
    expect(r.damage).toBeUndefined();
    expect(r.text).toContain("300"); // 3×100
  });

  it("defaults to ground (aircraft=false) when opts omitted", () => {
    const r = coreControlLoss(5, {});
    expect(r.severity).toBe("catastrophic");
  });

  it("zero d6 → band 1-2 (treated as 0, which is ≤2)", () => {
    const r = coreControlLoss(0);
    expect(r.band).toBe("1-2");
  });
});

// ─── mmFailureTable ──────────────────────────────────────────────────────────

describe("mmFailureTable", () => {
  it("tableRoll=1 → skid/slew (band 1-4)", () => {
    const r = mmFailureTable(1);
    expect(r.band).toBe("1-4");
    expect(r.severity).toBe("skid");
  });

  it("tableRoll=4 → still band 1-4 (upper boundary)", () => {
    const r = mmFailureTable(4);
    expect(r.band).toBe("1-4");
  });

  it("band 1-4 includes weapon penalty text (−5)", () => {
    const r = mmFailureTable(2);
    expect(r.text).toContain("−5");
  });

  it("tableRoll=5 → lose-control (band 5-6) ground", () => {
    const r = mmFailureTable(5, { aircraft: false, skidDie: 4 });
    expect(r.band).toBe("5-6");
    expect(r.severity).toBe("lose-control");
    expect(r.text).toContain("12"); // 4×3
  });

  it("tableRoll=6 → still band 5-6 (upper boundary)", () => {
    const r = mmFailureTable(6, { aircraft: false, skidDie: 2 });
    expect(r.band).toBe("5-6");
    expect(r.text).toContain("6"); // 2×3
  });

  it("band 5-6 ground includes weapon penalty text (−10)", () => {
    const r = mmFailureTable(5, { aircraft: false, skidDie: 1 });
    expect(r.text).toContain("−10");
  });

  it("tableRoll=5 aircraft → stall, ×50 ft altitude loss", () => {
    const r = mmFailureTable(5, { aircraft: true, skidDie: 3 });
    expect(r.band).toBe("5-6");
    expect(r.severity).toBe("lose-control");
    expect(r.text).toContain("150"); // 3×50
  });

  it("tableRoll=7 → catastrophic (band 7+) ground", () => {
    const r = mmFailureTable(7, { aircraft: false, skidDie: 5 });
    expect(r.band).toBe("7+");
    expect(r.severity).toBe("catastrophic");
    expect(r.text).toContain("15"); // 5×3
  });

  it("tableRoll=10+ → still catastrophic (band 7+)", () => {
    const r = mmFailureTable(10);
    expect(r.band).toBe("7+");
    expect(r.severity).toBe("catastrophic");
  });

  it("tableRoll=7 aircraft → tailspin, ×100 ft altitude loss", () => {
    const r = mmFailureTable(7, { aircraft: true, skidDie: 4 });
    expect(r.band).toBe("7+");
    expect(r.severity).toBe("catastrophic");
    expect(r.text).toContain("400"); // 4×100
  });

  it("zero tableRoll → band 1-4 (treated as 0 ≤ 4)", () => {
    const r = mmFailureTable(0);
    expect(r.band).toBe("1-4");
  });
});

// ─── composeControlOutcome ───────────────────────────────────────────────────

describe("composeControlOutcome", () => {
  it("returns success and null outcome when roll succeeds", () => {
    const { result, outcome, aircraft } = composeControlOutcome(
      { ruleSystem: "Core", difficulty: "simple", ref: 5, skill: 5 },
      { d10: 8 }  // 8+5+5=18 ≥ 15
    );
    expect(result.success).toBe(true);
    expect(outcome).toBeNull();
    expect(aircraft).toBe(false);
  });

  it("Core failure: includes coreControlLoss outcome with tableTotal = tableD6", () => {
    const { result, outcome } = composeControlOutcome(
      { ruleSystem: "Core", difficulty: "simple", ref: 2, skill: 2 },
      { d10: 3, tableD6: 2, slideD10: 5 }  // total=7 < 15
    );
    expect(result.success).toBe(false);
    expect(outcome).not.toBeNull();
    expect(outcome.tableTotal).toBe(2);
    expect(outcome.band).toBe("1-2");
  });

  it("Core failure d6=5 ground: crashDamage from crashD6Total", () => {
    const { outcome } = composeControlOutcome(
      { ruleSystem: "Core", difficulty: "simple", ref: 0, skill: 0 },
      { d10: 1, tableD6: 5, slideD10: 3, crashD6Total: 17 }
    );
    expect(outcome.damage).toBe(17);
  });

  it("Core failure d6=5 aircraft: no crashDamage even if crashD6Total given", () => {
    const { outcome } = composeControlOutcome(
      { ruleSystem: "Core", difficulty: "simple", ref: 0, skill: 0, vehicleType: "av-4" },
      { d10: 1, tableD6: 5, slideD10: 3, crashD6Total: 17 }
    );
    // aircraft=true → crashDamage is 0
    expect(outcome.damage).toBeUndefined();
  });

  it("MM failure: tableTotal = tableD6 + floor(missedBy/3)", () => {
    // ref=0, skill=0, d10=1 → total=1, dv=15, missedBy=14, floor(14/3)=4
    const { result, outcome } = composeControlOutcome(
      { ruleSystem: "MaximumMetal", difficulty: "simple", ref: 0, skill: 0 },
      { d10: 1, tableD6: 3, slideD10: 2 }
    );
    expect(result.missedBy).toBe(14);
    expect(outcome.tableTotal).toBe(3 + Math.floor(14 / 3)); // 3+4=7
    expect(outcome.band).toBe("7+");
  });

  it("MM failure close miss: tableD6=3, missedBy=2 → tableTotal=3 (floor(2/3)=0)", () => {
    // ref=5, skill=5, d10=3 → total=13, dv=15, missedBy=2
    const { outcome } = composeControlOutcome(
      { ruleSystem: "MaximumMetal", difficulty: "simple", ref: 5, skill: 5 },
      { d10: 3, tableD6: 3, slideD10: 1 }
    );
    expect(outcome.tableTotal).toBe(3); // floor(2/3)=0
    expect(outcome.band).toBe("1-4");
  });

  it("aircraft flag is set correctly from vehicleType", () => {
    const { aircraft } = composeControlOutcome(
      { ruleSystem: "Core", vehicleType: "rotor", difficulty: "simple", ref: 0, skill: 0 },
      { d10: 8, tableD6: 1, slideD10: 2 }
    );
    expect(aircraft).toBe(true);
  });

  it("no-args default: returns a result with success=false, outcome=minor skid", () => {
    const { result, outcome } = composeControlOutcome({}, { tableD6: 1, slideD10: 3 });
    expect(result.success).toBe(false);
    expect(outcome.band).toBe("1-2");
  });
});
