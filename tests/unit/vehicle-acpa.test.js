/**
 * Unit tests for module/vehicle/vehicle-acpa.js.
 *
 * All pure functions + exported constants are covered. No Foundry globals are needed.
 */

import { describe, it, expect } from "vitest";
import {
  externalSystemHit,
  acpaSystemHit,
  acpaRollAgain,
  systemIntegrity,
  acpaBodyArea,
  acpaCriticalEffect,
  acpaCriticalUpdate,
  ACPA_ROUND_MINUTES,
  HEATSTROKE_LEVELS,
  acpaTickStatus,
  acpaMeleeDamage,
  acpaRunM,
  acpaJumpM,
  acpaAreaSOP,
  chassisStats,
  REALITY_INTERFACES,
  realityInterface,
  REFLEX_CONTROLS,
  reflexControl,
  acpaReflexMod,
  acpaEffectiveRef,
  ARMOR_INVENTORY,
  acpaArmorWeight,
  acpaArmorCost,
  acpaSib,
  acpaInitiativeRollData,
  linearFrameHitChance,
} from "../../module/vehicle/vehicle-acpa.js";

// ─── ACPA_ROUND_MINUTES / HEATSTROKE_LEVELS constants ────────────────────────────

describe("ACPA_ROUND_MINUTES", () => {
  it("is 0.05 (3 seconds per round ÷ 60)", () => {
    expect(ACPA_ROUND_MINUTES).toBeCloseTo(0.05);
  });
});

describe("HEATSTROKE_LEVELS", () => {
  it("index 0 is empty string (not yet in heatstroke)", () => {
    expect(HEATSTROKE_LEVELS[0]).toBe("");
  });

  it("escalates through Serious → Critical → Mortal → unconscious", () => {
    expect(HEATSTROKE_LEVELS[1]).toBe("Serious");
    expect(HEATSTROKE_LEVELS[2]).toBe("Critical");
    expect(HEATSTROKE_LEVELS[3]).toBe("Mortal");
    expect(HEATSTROKE_LEVELS[4]).toMatch(/unconscious/i);
  });
});

// ─── REALITY_INTERFACES constant ─────────────────────────────────────────────────

describe("REALITY_INTERFACES", () => {
  it("has all seven interface keys", () => {
    const keys = ["APERTURE_BASED","ENHANCED_APERTURE","WIDEBAND_APERTURE",
                  "FULL_HUD_WIDEBAND","ECI_WIDEBAND_HUD","RUSSIAN_ARMS_VRI","MILITECH_VRI"];
    for (const k of keys) expect(REALITY_INTERFACES).toHaveProperty(k);
  });

  it("each entry has required stat fields", () => {
    for (const [, v] of Object.entries(REALITY_INTERFACES)) {
      expect(typeof v.sib).toBe("number");
      expect(typeof v.dfb).toBe("number");
      expect(typeof v.sop).toBe("number");
      expect(typeof v.cost).toBe("number");
      expect(typeof v.maxWeapons).toBe("number");
    }
  });

  it("FULL_HUD_WIDEBAND has sib=0 (neutral baseline)", () => {
    expect(REALITY_INTERFACES.FULL_HUD_WIDEBAND.sib).toBe(0);
  });

  it("APERTURE_BASED has sib=-6 (worst), RUSSIAN_ARMS_VRI has sib=3 (tied best)", () => {
    expect(REALITY_INTERFACES.APERTURE_BASED.sib).toBe(-6);
    expect(REALITY_INTERFACES.RUSSIAN_ARMS_VRI.sib).toBe(3);
  });
});

// ─── REFLEX_CONTROLS constant ─────────────────────────────────────────────────────

describe("REFLEX_CONTROLS", () => {
  it("has four keys", () => {
    for (const k of ["BASIC","ADVANCED","LOW_BOOST","HIGH_BOOST"]) {
      expect(REFLEX_CONTROLS).toHaveProperty(k);
    }
  });

  it("ADVANCED has refMod=0 and maxRef=10 (military standard)", () => {
    expect(REFLEX_CONTROLS.ADVANCED.refMod).toBe(0);
    expect(REFLEX_CONTROLS.ADVANCED.maxRef).toBe(10);
  });

  it("BASIC has refMod=-2, refModHeavy=-3 (STR42+ variant)", () => {
    expect(REFLEX_CONTROLS.BASIC.refMod).toBe(-2);
    expect(REFLEX_CONTROLS.BASIC.refModHeavy).toBe(-3);
  });

  it("HIGH_BOOST has the highest maxRef (12)", () => {
    expect(REFLEX_CONTROLS.HIGH_BOOST.maxRef).toBe(12);
    expect(REFLEX_CONTROLS.HIGH_BOOST.refMod).toBe(2);
  });
});

// ─── ARMOR_INVENTORY constant ─────────────────────────────────────────────────────

describe("ARMOR_INVENTORY", () => {
  it("has 6 entries", () => {
    expect(ARMOR_INVENTORY.length).toBe(6);
  });

  it("entries are sorted ascending by SP", () => {
    for (let i = 0; i < ARMOR_INVENTORY.length - 1; i++) {
      expect(ARMOR_INVENTORY[i].sp).toBeLessThan(ARMOR_INVENTORY[i + 1].sp);
    }
  });

  it("each entry has sp, weight, cost", () => {
    for (const e of ARMOR_INVENTORY) {
      expect(typeof e.sp).toBe("number");
      expect(typeof e.weight).toBe("number");
      expect(typeof e.cost).toBe("number");
    }
  });

  it("first row is SP 25, last row is SP 80", () => {
    expect(ARMOR_INVENTORY[0].sp).toBe(25);
    expect(ARMOR_INVENTORY[ARMOR_INVENTORY.length - 1].sp).toBe(80);
  });
});

// ─── externalSystemHit ───────────────────────────────────────────────────────────

describe("externalSystemHit", () => {
  it("d10 1 → external (true)", () => {
    expect(externalSystemHit(1)).toBe(true);
  });

  it("d10 5 → external (true, upper boundary)", () => {
    expect(externalSystemHit(5)).toBe(true);
  });

  it("d10 6 → NOT external (boundary)", () => {
    expect(externalSystemHit(6)).toBe(false);
  });

  it("d10 10 → NOT external", () => {
    expect(externalSystemHit(10)).toBe(false);
  });

  it("full range 1..10 exactly half each", () => {
    let externalCount = 0;
    for (let d = 1; d <= 10; d++) {
      if (externalSystemHit(d)) externalCount++;
    }
    expect(externalCount).toBe(5);
  });
});

// ─── acpaSystemHit ────────────────────────────────────────────────────────────────

describe("acpaSystemHit", () => {
  it("d10 1 → chassis", () => {
    expect(acpaSystemHit(1)).toBe("chassis");
  });

  it("d10 3 → chassis (upper boundary)", () => {
    expect(acpaSystemHit(3)).toBe("chassis");
  });

  it("d10 4 → enclosed (boundary)", () => {
    expect(acpaSystemHit(4)).toBe("enclosed");
  });

  it("d10 6 → enclosed (upper boundary)", () => {
    expect(acpaSystemHit(6)).toBe("enclosed");
  });

  it("d10 7 → weapons (boundary)", () => {
    expect(acpaSystemHit(7)).toBe("weapons");
  });

  it("d10 9 → weapons (upper boundary)", () => {
    expect(acpaSystemHit(9)).toBe("weapons");
  });

  it("d10 10 → rollAgain", () => {
    expect(acpaSystemHit(10)).toBe("rollAgain");
  });

  it("full range 1..10", () => {
    const expected = ["chassis","chassis","chassis","enclosed","enclosed","enclosed","weapons","weapons","weapons","rollAgain"];
    for (let d = 1; d <= 10; d++) {
      expect(acpaSystemHit(d)).toBe(expected[d - 1]);
    }
  });
});

// ─── acpaRollAgain ────────────────────────────────────────────────────────────────

describe("acpaRollAgain", () => {
  it("even d10 → critical", () => {
    for (const d of [2, 4, 6, 8, 10]) {
      expect(acpaRollAgain(d)).toBe("critical");
    }
  });

  it("odd d10 → systemHit", () => {
    for (const d of [1, 3, 5, 7, 9]) {
      expect(acpaRollAgain(d)).toBe("systemHit");
    }
  });
});

// ─── systemIntegrity ─────────────────────────────────────────────────────────────

describe("systemIntegrity", () => {
  it("sopLost > sopTotal → destroyed=true, inopChance=1", () => {
    const r = systemIntegrity({ sopLost: 11, sopTotal: 10 });
    expect(r.destroyed).toBe(true);
    expect(r.inopChance).toBe(1);
  });

  it("sopLost = sopTotal → not destroyed (≥½ but ≤total), inopChance=0.75", () => {
    const r = systemIntegrity({ sopLost: 10, sopTotal: 10 });
    expect(r.destroyed).toBe(false);
    expect(r.inopChance).toBe(0.75);
  });

  it("sopLost = exactly half → 75% inop chance", () => {
    const r = systemIntegrity({ sopLost: 5, sopTotal: 10 });
    expect(r.inopChance).toBe(0.75);
  });

  it("sopLost just below half → 25% inop chance", () => {
    const r = systemIntegrity({ sopLost: 4, sopTotal: 10 });
    expect(r.inopChance).toBe(0.25);
  });

  it("sopLost = 0 → 25% inop chance", () => {
    const r = systemIntegrity({ sopLost: 0, sopTotal: 10 });
    expect(r.inopChance).toBe(0.25);
    expect(r.destroyed).toBe(false);
  });

  it("sopTotal = 0 → 25% inop chance (degenerate, no comparison possible)", () => {
    const r = systemIntegrity({ sopLost: 5, sopTotal: 0 });
    expect(r.inopChance).toBe(0.25);
    expect(r.destroyed).toBe(false);
  });

  it("default call → 25% inop chance", () => {
    const r = systemIntegrity();
    expect(r.inopChance).toBe(0.25);
    expect(r.destroyed).toBe(false);
  });
});

// ─── acpaBodyArea ─────────────────────────────────────────────────────────────────

describe("acpaBodyArea", () => {
  it("d10=1 → Head", () => {
    expect(acpaBodyArea(1)).toBe("Head");
  });

  it("d10=2 → Right Arm", () => {
    expect(acpaBodyArea(2)).toBe("Right Arm");
  });

  it("d10=3 → Left Arm", () => {
    expect(acpaBodyArea(3)).toBe("Left Arm");
  });

  it("d10=4 → Right Leg", () => {
    expect(acpaBodyArea(4)).toBe("Right Leg");
  });

  it("d10=5 → Right Leg (upper boundary)", () => {
    expect(acpaBodyArea(5)).toBe("Right Leg");
  });

  it("d10=6 → Left Leg", () => {
    expect(acpaBodyArea(6)).toBe("Left Leg");
  });

  it("d10=7 → Left Leg (upper boundary)", () => {
    expect(acpaBodyArea(7)).toBe("Left Leg");
  });

  it("d10=8 → Torso", () => {
    expect(acpaBodyArea(8)).toBe("Torso");
  });

  it("d10=9 → Torso", () => {
    expect(acpaBodyArea(9)).toBe("Torso");
  });

  it("d10=10 → Torso (treated as 10 = roll 0 clamped to 1 by max; actually 10 ≥8)", () => {
    expect(acpaBodyArea(10)).toBe("Torso");
  });

  it("full range 1..10 all map correctly", () => {
    const expected = ["Head","Right Arm","Left Arm","Right Leg","Right Leg","Left Leg","Left Leg","Torso","Torso","Torso"];
    for (let d = 1; d <= 10; d++) {
      expect(acpaBodyArea(d)).toBe(expected[d - 1]);
    }
  });
});

// ─── acpaCriticalEffect ───────────────────────────────────────────────────────────

describe("acpaCriticalEffect", () => {
  it("d10=1 → seizeUp", () => {
    expect(acpaCriticalEffect(1).type).toBe("seizeUp");
    expect(acpaCriticalEffect(1).formula).toBe("1d10+1");
  });

  it("d10=2 → seizeUp (upper boundary)", () => {
    expect(acpaCriticalEffect(2).type).toBe("seizeUp");
  });

  it("d10=3 → cooling failure", () => {
    const e = acpaCriticalEffect(3);
    expect(e.type).toBe("cooling");
    expect(e.formula).toBe("2d10");
    expect(e.unit).toBe("minutes");
  });

  it("d10=4 → strLoss", () => {
    expect(acpaCriticalEffect(4).type).toBe("strLoss");
    expect(acpaCriticalEffect(4).formula).toBe("1d6");
  });

  it("d10=5 → strLoss (upper boundary)", () => {
    expect(acpaCriticalEffect(5).type).toBe("strLoss");
  });

  it("d10=6 → refLoss", () => {
    const e = acpaCriticalEffect(6);
    expect(e.type).toBe("refLoss");
    expect(e.divisor).toBe(2);
  });

  it("d10=7 → refLoss (upper boundary)", () => {
    expect(acpaCriticalEffect(7).type).toBe("refLoss");
  });

  it("d10=8 → powerLoss", () => {
    const e = acpaCriticalEffect(8);
    expect(e.type).toBe("powerLoss");
    expect(e.mult).toBe(2);
    expect(e.unit).toBe("hours");
  });

  it("d10=9 → interfaceOut", () => {
    const e = acpaCriticalEffect(9);
    expect(e.type).toBe("interfaceOut");
    expect(e.unit).toBe("rounds");
  });

  it("d10=10 → mechShock", () => {
    const e = acpaCriticalEffect(10);
    expect(e.type).toBe("mechShock");
    expect(e.formula).toBe("1d6");
    expect(e.unit).toBe("SOP");
  });

  it("full range 1..10 all map to a known type", () => {
    const types = ["seizeUp","seizeUp","cooling","strLoss","strLoss","refLoss","refLoss","powerLoss","interfaceOut","mechShock"];
    for (let d = 1; d <= 10; d++) {
      expect(acpaCriticalEffect(d).type).toBe(types[d - 1]);
    }
  });
});

// ─── acpaCriticalUpdate ───────────────────────────────────────────────────────────

describe("acpaCriticalUpdate", () => {
  it("seizeUp: sets seizeUp timer (max of existing vs amount) and immobilized=true", () => {
    const r = acpaCriticalUpdate({ seizeUp: 2 }, { type: "seizeUp" }, 5);
    expect(r.updates["system.seizeUp"]).toBe(5);
    expect(r.updates["system.immobilized"]).toBe(true);
  });

  it("seizeUp: keeps existing value if it is higher", () => {
    const r = acpaCriticalUpdate({ seizeUp: 8 }, { type: "seizeUp" }, 3);
    expect(r.updates["system.seizeUp"]).toBe(8);
  });

  it("cooling: sets coolingTimer to rolled amount", () => {
    const r = acpaCriticalUpdate({}, { type: "cooling" }, 14);
    expect(r.updates["system.coolingTimer"]).toBe(14);
    expect(r.note).toMatch(/14/);
  });

  it("strLoss: accumulates strDamage", () => {
    const r = acpaCriticalUpdate({ strDamage: 2 }, { type: "strLoss" }, 4);
    expect(r.updates["system.strDamage"]).toBe(6);
  });

  it("refLoss: applies divisor (rounds), accumulates refDamage", () => {
    // divisor=2, amount=5 → round(5/2)=3; existing refDamage=1 → total 4
    const e = acpaCriticalEffect(6);   // refLoss with divisor=2
    const r = acpaCriticalUpdate({ refDamage: 1 }, e, 5);
    expect(r.updates["system.refDamage"]).toBe(4);
    expect(r.note).toMatch(/−3/);
  });

  it("powerLoss: reduces powerHours by amount * mult", () => {
    // mult=2, amount=3 → h=6; existing 24h → 18h
    const e = acpaCriticalEffect(8);   // powerLoss with mult=2
    const r = acpaCriticalUpdate({ powerHours: 24 }, e, 3);
    expect(r.updates["system.powerHours"]).toBe(18);
    expect(r.note).toMatch(/6h/);
  });

  it("powerLoss: power clamped at 0", () => {
    const e = acpaCriticalEffect(8);
    const r = acpaCriticalUpdate({ powerHours: 2 }, e, 5);   // 2 - 10 = clamped to 0
    expect(r.updates["system.powerHours"]).toBe(0);
  });

  it("interfaceOut: sets interfaceOut timer (max of existing vs amount)", () => {
    const r = acpaCriticalUpdate({ interfaceOut: 3 }, { type: "interfaceOut" }, 6);
    expect(r.updates["system.interfaceOut"]).toBe(6);
  });

  it("mechShock: reduces SDP by amount", () => {
    const r = acpaCriticalUpdate({ sdp: { value: 50, max: 100 } }, { type: "mechShock" }, 4);
    expect(r.updates["system.sdp"].value).toBe(46);
    expect(r.updates["system.sdp"].max).toBe(100);
  });

  it("mechShock: SDP cannot go below 0", () => {
    const r = acpaCriticalUpdate({ sdp: { value: 2, max: 100 } }, { type: "mechShock" }, 10);
    expect(r.updates["system.sdp"].value).toBe(0);
  });

  it("unknown type returns empty updates + label as note", () => {
    const r = acpaCriticalUpdate({}, { type: "unknown", label: "test label" }, 5);
    expect(r.updates).toEqual({});
    expect(r.note).toBe("test label");
  });
});

// ─── acpaTickStatus ───────────────────────────────────────────────────────────────

describe("acpaTickStatus", () => {
  it("no active timers → empty updates and lines", () => {
    const r = acpaTickStatus({});
    expect(r.updates).toEqual({});
    expect(r.lines).toEqual([]);
  });

  it("seize-up > 1: decrements by 1", () => {
    const r = acpaTickStatus({ seizeUp: 3 });
    expect(r.updates["system.seizeUp"]).toBe(2);
    expect(r.lines[0].key).toBe("Vehicle.AcpaSeizedUp");
    expect(r.lines[0].params.rounds).toBe(2);
  });

  it("seize-up = 1: decrements to 0 and restores mobility", () => {
    const r = acpaTickStatus({ seizeUp: 1 });
    expect(r.updates["system.seizeUp"]).toBe(0);
    expect(r.updates["system.immobilized"]).toBe(false);
    expect(r.lines[0].key).toBe("Vehicle.AcpaSeizeEnds");
  });

  it("interfaceOut > 1: decrements by 1", () => {
    const r = acpaTickStatus({ interfaceOut: 2 });
    expect(r.updates["system.interfaceOut"]).toBe(1);
    expect(r.lines[0].key).toBe("Vehicle.AcpaInterfaceOut");
  });

  it("interfaceOut = 1: decrements to 0 and notes restored", () => {
    const r = acpaTickStatus({ interfaceOut: 1 });
    expect(r.updates["system.interfaceOut"]).toBe(0);
    expect(r.lines[0].key).toBe("Vehicle.AcpaInterfaceRestored");
  });

  it("cooling > ROUND_MINUTES: ticks down by ROUND_MINUTES", () => {
    const r = acpaTickStatus({ coolingTimer: 1.0 });
    const expected = Math.round((1.0 - ACPA_ROUND_MINUTES) * 100) / 100;
    expect(r.updates["system.coolingTimer"]).toBeCloseTo(expected, 5);
    expect(r.lines[0].key).toBe("Vehicle.AcpaOverheating");
  });

  it("cooling ≤ ROUND_MINUTES: timer reaches 0, heatstroke begins at level 1", () => {
    const r = acpaTickStatus({ coolingTimer: 0.05 });
    expect(r.updates["system.coolingTimer"]).toBe(0);
    expect(r.updates["system.heatstrokeLevel"]).toBe(1);
    expect(r.lines[0].key).toBe("Vehicle.AcpaHeatstrokeBegins");
  });

  it("heatstrokeLevel active (not cooling): escalates +1 level", () => {
    const r = acpaTickStatus({ heatstrokeLevel: 1 });
    expect(r.updates["system.heatstrokeLevel"]).toBe(2);
    expect(r.lines[0].key).toBe("Vehicle.AcpaHeatstrokeWorsens");
    expect(r.lines[0].params.level).toBe(HEATSTROKE_LEVELS[2]);
  });

  it("heatstrokeLevel clamped at max index", () => {
    const maxIdx = HEATSTROKE_LEVELS.length - 1;
    const r = acpaTickStatus({ heatstrokeLevel: maxIdx });
    expect(r.updates["system.heatstrokeLevel"]).toBe(maxIdx);
  });
});

// ─── acpaMeleeDamage ──────────────────────────────────────────────────────────────

describe("acpaMeleeDamage", () => {
  it("str=0: punch → dice=max(1,0)=1d10", () => {
    const r = acpaMeleeDamage(0, "punch");
    expect(r.x).toBe(0);
    expect(r.dice).toBe(1);   // min 1
    expect(r.formula).toBe("1d10");
  });

  it("str=9: x=1; punch=1d10, crush=2d10, kick=round(1.5*1)=2d10", () => {
    expect(acpaMeleeDamage(9, "punch").dice).toBe(1);
    expect(acpaMeleeDamage(9, "crush").dice).toBe(2);
    expect(acpaMeleeDamage(9, "kick").dice).toBe(2);   // round(1.5)=2
  });

  it("str=18: x=2; punch=2, crush=3, kick=round(3)=3", () => {
    expect(acpaMeleeDamage(18, "punch").dice).toBe(2);
    expect(acpaMeleeDamage(18, "crush").dice).toBe(3);
    expect(acpaMeleeDamage(18, "kick").dice).toBe(3);
  });

  it("str=27: x=3; kick=round(4.5)=5? check: Math.round(3*1.5)=5? No: round(4.5)=5", () => {
    // Math.round(3 * 1.5) = Math.round(4.5) = 5
    expect(acpaMeleeDamage(27, "kick").dice).toBe(5);
  });

  it("default kind (punch): x=round(str/9); formula has 1d10 minimum", () => {
    const r = acpaMeleeDamage(9);
    expect(r.formula).toBe("1d10");
  });

  it("crush always = x + 1", () => {
    for (const str of [9, 18, 27, 36]) {
      const x = Math.round(str / 9);
      expect(acpaMeleeDamage(str, "crush").dice).toBe(x + 1);
    }
  });

  it("kick is at least 1 even when x=0", () => {
    expect(acpaMeleeDamage(0, "kick").dice).toBe(1);
  });

  it("formula string matches dice count", () => {
    const r = acpaMeleeDamage(18, "punch");
    expect(r.formula).toBe(`${r.dice}d10`);
  });
});

// ─── acpaRunM ─────────────────────────────────────────────────────────────────────

describe("acpaRunM", () => {
  it("(SIB + MA) × 3", () => {
    expect(acpaRunM({ sib: 2, ma: 5 })).toBe(21);
  });

  it("sib=0, ma=10: 30 m/round", () => {
    expect(acpaRunM({ sib: 0, ma: 10 })).toBe(30);
  });

  it("zero args returns 0", () => {
    expect(acpaRunM()).toBe(0);
    expect(acpaRunM({})).toBe(0);
  });
});

// ─── acpaJumpM ────────────────────────────────────────────────────────────────────

describe("acpaJumpM", () => {
  it("stationary horizontal = runM / 6", () => {
    expect(acpaJumpM(60, { running: false })).toBeCloseTo(10, 5);
  });

  it("running horizontal = runM / 4", () => {
    expect(acpaJumpM(60, { running: true })).toBe(15);
  });

  it("vertical = horizontal / 3", () => {
    expect(acpaJumpM(60, { running: false, vertical: true })).toBeCloseTo(60 / 6 / 3, 5);
  });

  it("running vertical = (runM/4) / 3", () => {
    expect(acpaJumpM(60, { running: true, vertical: true })).toBeCloseTo(5, 5);
  });

  it("zero runM returns 0", () => {
    expect(acpaJumpM(0)).toBe(0);
    expect(acpaJumpM(null)).toBe(0);
  });

  it("default options: stationary, horizontal", () => {
    expect(acpaJumpM(30)).toBeCloseTo(5, 5);
  });
});

// ─── acpaAreaSOP ──────────────────────────────────────────────────────────────────

describe("acpaAreaSOP", () => {
  it("all areas from STR 40: head=round(40*0.25)=10, each arm=10, each leg=20, torso=30", () => {
    const r = acpaAreaSOP(40);
    expect(r.head).toBe(10);
    expect(r.rArm).toBe(10);
    expect(r.lArm).toBe(10);
    expect(r.rLeg).toBe(20);
    expect(r.lLeg).toBe(20);
    expect(r.torso).toBe(30);
  });

  it("str=0 → all zeros", () => {
    const r = acpaAreaSOP(0);
    for (const v of Object.values(r)) expect(v).toBe(0);
  });

  it("torso is always the largest area (75%)", () => {
    for (const str of [12, 25, 40, 50]) {
      const r = acpaAreaSOP(str);
      const max = Math.max(r.head, r.rArm, r.lArm, r.rLeg, r.lLeg);
      expect(r.torso).toBeGreaterThanOrEqual(max);
    }
  });

  it("head = rArm = lArm (all 25%)", () => {
    const r = acpaAreaSOP(20);
    expect(r.head).toBe(r.rArm);
    expect(r.rArm).toBe(r.lArm);
  });

  it("rLeg = lLeg (both 50%)", () => {
    const r = acpaAreaSOP(20);
    expect(r.rLeg).toBe(r.lLeg);
  });
});

// ─── chassisStats ─────────────────────────────────────────────────────────────────

describe("chassisStats", () => {
  it("STR below minimum (12) → clamps to first row (STR 12)", () => {
    const r = chassisStats(5);
    expect(r.str).toBe(12);
  });

  it("STR exactly 12 → STR 12 row", () => {
    expect(chassisStats(12).str).toBe(12);
  });

  it("STR exactly 14 → STR 14 row", () => {
    expect(chassisStats(14).str).toBe(14);
  });

  it("STR between rows → uses the row at-or-below (STR 15 → STR 14 row)", () => {
    expect(chassisStats(15).str).toBe(14);
  });

  it("STR exactly 40 → STR 40 row", () => {
    expect(chassisStats(40).str).toBe(40);
  });

  it("STR 52 → last row (STR 52)", () => {
    expect(chassisStats(52).str).toBe(52);
  });

  it("STR > 52 → last row (clamped)", () => {
    expect(chassisStats(100).str).toBe(52);
  });

  it("each row has required fields: lift, carry, weight, cost, toughness", () => {
    for (const str of [12, 20, 40, 52]) {
      const r = chassisStats(str);
      expect(typeof r.lift).toBe("number");
      expect(typeof r.carry).toBe("number");
      expect(typeof r.weight).toBe("number");
      expect(typeof r.cost).toBe("number");
      expect(typeof r.toughness).toBe("number");
    }
  });

  it("STR 12 toughness is -5", () => {
    expect(chassisStats(12).toughness).toBe(-5);
  });

  it("STR 52 toughness is -12", () => {
    expect(chassisStats(52).toughness).toBe(-12);
  });
});

// ─── realityInterface ─────────────────────────────────────────────────────────────

describe("realityInterface", () => {
  it("valid key returns that entry", () => {
    const r = realityInterface("APERTURE_BASED");
    expect(r.key).toBe("APERTURE_BASED");
    expect(r.sib).toBe(-6);
  });

  it("unknown key defaults to FULL_HUD_WIDEBAND", () => {
    const r = realityInterface("BOGUS");
    expect(r.key).toBe("FULL_HUD_WIDEBAND");
  });

  it("null/undefined defaults to FULL_HUD_WIDEBAND", () => {
    expect(realityInterface(null).key).toBe("FULL_HUD_WIDEBAND");
    expect(realityInterface(undefined).key).toBe("FULL_HUD_WIDEBAND");
  });
});

// ─── reflexControl ────────────────────────────────────────────────────────────────

describe("reflexControl", () => {
  it("valid key returns that entry", () => {
    expect(reflexControl("BASIC").refMod).toBe(-2);
  });

  it("unknown key defaults to ADVANCED", () => {
    expect(reflexControl("BOGUS").key).toBe("ADVANCED");
  });

  it("null defaults to ADVANCED", () => {
    expect(reflexControl(null).key).toBe("ADVANCED");
  });
});

// ─── acpaReflexMod ────────────────────────────────────────────────────────────────

describe("acpaReflexMod", () => {
  it("BASIC, STR < 42 → refMod=-2", () => {
    expect(acpaReflexMod("BASIC", 30)).toBe(-2);
  });

  it("BASIC, STR exactly 42 → refModHeavy=-3 (boundary)", () => {
    expect(acpaReflexMod("BASIC", 42)).toBe(-3);
  });

  it("BASIC, STR > 42 → refModHeavy=-3", () => {
    expect(acpaReflexMod("BASIC", 50)).toBe(-3);
  });

  it("ADVANCED, any STR → refMod=0", () => {
    expect(acpaReflexMod("ADVANCED", 50)).toBe(0);
    expect(acpaReflexMod("ADVANCED", 42)).toBe(0);
  });

  it("HIGH_BOOST → refMod=2 (STR irrelevant)", () => {
    expect(acpaReflexMod("HIGH_BOOST", 50)).toBe(2);
  });
});

// ─── acpaEffectiveRef ─────────────────────────────────────────────────────────────

describe("acpaEffectiveRef", () => {
  it("simple: pilotRef + refMod, clamped to maxRef", () => {
    expect(acpaEffectiveRef({ pilotRef: 8, refMod: 0, maxRef: 10, refDamage: 0 })).toBe(8);
  });

  it("negative refMod: reduces below pilot REF", () => {
    expect(acpaEffectiveRef({ pilotRef: 8, refMod: -2, maxRef: 10, refDamage: 0 })).toBe(6);
  });

  it("capped at maxRef when pilotRef + refMod > maxRef", () => {
    expect(acpaEffectiveRef({ pilotRef: 10, refMod: 2, maxRef: 10, refDamage: 0 })).toBe(10);
  });

  it("refDamage further reduces from the capped value", () => {
    expect(acpaEffectiveRef({ pilotRef: 8, refMod: 0, maxRef: 10, refDamage: 3 })).toBe(5);
  });

  it("result clamped at 0 — never negative", () => {
    expect(acpaEffectiveRef({ pilotRef: 2, refMod: -5, maxRef: 10, refDamage: 5 })).toBe(0);
  });

  it("default: all zeros → 0", () => {
    expect(acpaEffectiveRef()).toBe(0);
    expect(acpaEffectiveRef({})).toBe(0);
  });

  it("High Boost maxRef 12: pilot 10 + 2 refMod = 12 (exactly at cap)", () => {
    expect(acpaEffectiveRef({ pilotRef: 10, refMod: 2, maxRef: 12, refDamage: 0 })).toBe(12);
  });
});

// ─── acpaArmorWeight / acpaArmorCost ──────────────────────────────────────────────

describe("acpaArmorWeight", () => {
  it("SP exactly at table rows returns exact weights", () => {
    expect(acpaArmorWeight(25)).toBe(36);
    expect(acpaArmorWeight(30)).toBe(150);
    expect(acpaArmorWeight(80)).toBe(400);
  });

  it("SP 0 returns 0", () => {
    expect(acpaArmorWeight(0)).toBe(0);
  });

  it("SP above max (>80) clamps to heaviest row weight", () => {
    expect(acpaArmorWeight(100)).toBe(400);
  });

  it("SP between rows returns interpolated value", () => {
    // midpoint between SP25(36kg) and SP30(150kg): SP=27.5 → t=0.5 → round(36 + 0.5*(150-36))=round(93)=93
    const t = (27.5 - 25) / (30 - 25);
    const expected = Math.round(36 + t * (150 - 36));
    expect(acpaArmorWeight(27.5)).toBe(expected);
  });
});

describe("acpaArmorCost", () => {
  it("SP exactly at table rows returns exact costs", () => {
    expect(acpaArmorCost(25)).toBe(1200);
    expect(acpaArmorCost(30)).toBe(5600);
    expect(acpaArmorCost(80)).toBe(25600);
  });

  it("SP 0 returns 0", () => {
    expect(acpaArmorCost(0)).toBe(0);
  });

  it("SP above max clamps to heaviest cost", () => {
    expect(acpaArmorCost(100)).toBe(25600);
  });
});

// ─── acpaSib ─────────────────────────────────────────────────────────────────────

describe("acpaSib", () => {
  it("worked example from MM: cap≈2500 / total≈1235 kg, Full-HUD (sib=0) → SIB +1", () => {
    // ratio = 2500/1235 ≈ 2.024; whole=2, frac=0.024 < 0.8 → rounded=2; SIB = (2-1)+0 = 1
    expect(acpaSib({ chassisCapacity: 2500, totalWeight: 1235, interfaceSib: 0 })).toBe(1);
  });

  it("ratio exactly 2.0: whole=2, frac=0 → rounded=2, SIB=1 (no interface)", () => {
    expect(acpaSib({ chassisCapacity: 200, totalWeight: 100, interfaceSib: 0 })).toBe(1);
  });

  it("ratio with frac ≥ 0.8 rounds up: ratio=2.9 → whole=2, frac=0.9 → rounded=3, SIB=2", () => {
    // cap=290, total=100 → ratio=2.9; whole=2, frac=0.9 ≥ 0.8 → rounded=3 → SIB=(3-1)+0=2
    expect(acpaSib({ chassisCapacity: 290, totalWeight: 100, interfaceSib: 0 })).toBe(2);
  });

  it("ratio < 1: treated as 0, SIB = 0-1+interface = -1 (no interface)", () => {
    // cap=50, total=100 → ratio=0.5 < 1 → rounded=0 → SIB = (0-1)+0 = -1
    expect(acpaSib({ chassisCapacity: 50, totalWeight: 100, interfaceSib: 0 })).toBe(-1);
  });

  it("interface SIB is added to the base", () => {
    // same as worked example but RUSSIAN_ARMS_VRI (sib=3) → 1+3=4
    expect(acpaSib({ chassisCapacity: 2500, totalWeight: 1235, interfaceSib: 3 })).toBe(4);
  });

  it("zero totalWeight returns (0-1) + iface = -1 for no interface", () => {
    expect(acpaSib({ chassisCapacity: 1000, totalWeight: 0, interfaceSib: 0 })).toBe(-1);
  });
});

// ─── acpaInitiativeRollData ───────────────────────────────────────────────────────

describe("acpaInitiativeRollData", () => {
  it("maps effectiveRef to stats.ref.total", () => {
    const r = acpaInitiativeRollData({ effectiveRef: 7 });
    expect(r.stats.ref.total).toBe(7);
  });

  it("maps sib to initiativeMod", () => {
    const r = acpaInitiativeRollData({ sib: 2 });
    expect(r.initiativeMod).toBe(2);
  });

  it("commandComputer → initiativeImplantMod = 1", () => {
    expect(acpaInitiativeRollData({ commandComputer: true }).initiativeImplantMod).toBe(1);
    expect(acpaInitiativeRollData({ commandComputer: false }).initiativeImplantMod).toBe(0);
  });

  it("CombatSenseMod is always 0 (ACPA has no native Combat Sense)", () => {
    expect(acpaInitiativeRollData({ effectiveRef: 5 }).CombatSenseMod).toBe(0);
  });

  it("null/undefined sys → defaults all to 0", () => {
    const r = acpaInitiativeRollData(null);
    expect(r.stats.ref.total).toBe(0);
    expect(r.initiativeMod).toBe(0);
    expect(r.initiativeImplantMod).toBe(0);
  });
});

// ─── linearFrameHitChance ─────────────────────────────────────────────────────────

describe("linearFrameHitChance", () => {
  it("STR 12 → 0.2 (basic frame)", () => {
    expect(linearFrameHitChance(12)).toBe(0.2);
  });

  it("STR 16 → 0.2 (upper boundary of basic)", () => {
    expect(linearFrameHitChance(16)).toBe(0.2);
  });

  it("STR 19 → 0.2 (still below 20)", () => {
    expect(linearFrameHitChance(19)).toBe(0.2);
  });

  it("STR 20 → 0.3 (advanced frame, boundary)", () => {
    expect(linearFrameHitChance(20)).toBe(0.3);
  });

  it("STR 52 → 0.3 (heaviest frame)", () => {
    expect(linearFrameHitChance(52)).toBe(0.3);
  });

  it("STR below 12 → 0.2 (clamp to basic)", () => {
    expect(linearFrameHitChance(0)).toBe(0.2);
    expect(linearFrameHitChance(11)).toBe(0.2);
  });
});
