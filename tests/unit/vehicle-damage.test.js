/**
 * Unit tests for module/vehicle/vehicle-damage.js.
 *
 * All pure functions are imported directly. No Foundry globals are touched.
 */

import { describe, it, expect } from "vitest";
import {
  coreVehicleDamage,
  WEIGHT_MOD,
  coreCrashDamage,
  mmEffectivePenetration,
  reactiveDeflection,
  mmEffectiveArmor,
  mmDamageSeverity,
  mmSurfaceDamage,
  mmHitLocation,
  mmSubLocation,
  acpaHitLocation,
  MM_CRIT,
  damageControlIgnores,
} from "../../module/vehicle/vehicle-damage.js";

// ─── WEIGHT_MOD constant ────────────────────────────────────────────────────────

describe("WEIGHT_MOD", () => {
  it("has the five mass-class keys", () => {
    expect(WEIGHT_MOD).toHaveProperty("vlight");
    expect(WEIGHT_MOD).toHaveProperty("light");
    expect(WEIGHT_MOD).toHaveProperty("medium");
    expect(WEIGHT_MOD).toHaveProperty("heavy");
    expect(WEIGHT_MOD).toHaveProperty("vheavy");
  });

  it("has the correct multiplier values per Core p.112", () => {
    expect(WEIGHT_MOD.vlight).toBe(0.5);
    expect(WEIGHT_MOD.light).toBe(1);
    expect(WEIGHT_MOD.medium).toBe(2);
    expect(WEIGHT_MOD.heavy).toBe(3);
    expect(WEIGHT_MOD.vheavy).toBe(4);
  });
});

// ─── MM_CRIT constant ────────────────────────────────────────────────────────────

describe("MM_CRIT", () => {
  it("has entries for minor, major, catastrophic", () => {
    expect(MM_CRIT).toHaveProperty("minor");
    expect(MM_CRIT).toHaveProperty("major");
    expect(MM_CRIT).toHaveProperty("catastrophic");
  });

  it("minor: destroyPct 20, enginePct 0, fuelFirePct 25, crewDice 4d6", () => {
    expect(MM_CRIT.minor.destroyPct).toBe(20);
    expect(MM_CRIT.minor.enginePct).toBe(0);
    expect(MM_CRIT.minor.fuelFirePct).toBe(25);
    expect(MM_CRIT.minor.crewDice).toBe("4d6");
  });

  it("major: destroyPct 90, enginePct 50, fuelFirePct 50, crewDice 6d6", () => {
    expect(MM_CRIT.major.destroyPct).toBe(90);
    expect(MM_CRIT.major.enginePct).toBe(50);
    expect(MM_CRIT.major.fuelFirePct).toBe(50);
    expect(MM_CRIT.major.crewDice).toBe("6d6");
  });

  it("catastrophic: destroyPct 100, enginePct 90, fuelFirePct 50, crewDice 10d6", () => {
    expect(MM_CRIT.catastrophic.destroyPct).toBe(100);
    expect(MM_CRIT.catastrophic.enginePct).toBe(90);
    expect(MM_CRIT.catastrophic.fuelFirePct).toBe(50);
    expect(MM_CRIT.catastrophic.crewDice).toBe("10d6");
  });
});

// ─── coreVehicleDamage ───────────────────────────────────────────────────────────

describe("coreVehicleDamage", () => {
  it("damage below SP is fully stopped", () => {
    const r = coreVehicleDamage({ rawDamage: 5, sp: 10, currentSDP: 50 });
    expect(r.through).toBe(0);
    expect(r.newSDP).toBe(50);
    expect(r.destroyed).toBe(false);
    expect(r.spUsed).toBe(10);
  });

  it("damage equal to SP passes nothing through", () => {
    const r = coreVehicleDamage({ rawDamage: 10, sp: 10, currentSDP: 50 });
    expect(r.through).toBe(0);
    expect(r.newSDP).toBe(50);
  });

  it("damage exceeds SP: remainder reduces SDP", () => {
    const r = coreVehicleDamage({ rawDamage: 20, sp: 10, currentSDP: 50 });
    expect(r.spUsed).toBe(10);
    expect(r.through).toBe(10);
    expect(r.newSDP).toBe(40);
    expect(r.destroyed).toBe(false);
  });

  it("damage reduces SDP to 0: destroyed=true, newSDP=0", () => {
    const r = coreVehicleDamage({ rawDamage: 60, sp: 10, currentSDP: 30 });
    expect(r.through).toBe(50);
    expect(r.newSDP).toBe(0);
    expect(r.destroyed).toBe(true);
  });

  it("AP halves SP (floor)", () => {
    const r = coreVehicleDamage({ rawDamage: 20, sp: 11, currentSDP: 50, ap: true });
    expect(r.spUsed).toBe(5);          // floor(11/2) = 5
    expect(r.through).toBe(15);
    expect(r.newSDP).toBe(35);
  });

  it("AP on even SP halves exactly", () => {
    const r = coreVehicleDamage({ rawDamage: 20, sp: 10, currentSDP: 50, ap: true });
    expect(r.spUsed).toBe(5);
    expect(r.through).toBe(15);
  });

  it("zero damage never goes negative through", () => {
    const r = coreVehicleDamage({ rawDamage: 0, sp: 10, currentSDP: 50 });
    expect(r.through).toBe(0);
    expect(r.newSDP).toBe(50);
  });

  it("negative rawDamage is treated as 0", () => {
    const r = coreVehicleDamage({ rawDamage: -5, sp: 10, currentSDP: 50 });
    expect(r.through).toBe(0);
    expect(r.newSDP).toBe(50);
  });

  it("default parameters: all zeros, no crash", () => {
    const r = coreVehicleDamage();
    expect(r.spUsed).toBe(0);
    expect(r.through).toBe(0);
    expect(r.newSDP).toBe(0);
    expect(r.destroyed).toBe(true);    // 0 SDP ≤ 0 → destroyed
  });

  it("newSDP is clamped at 0 — never negative", () => {
    const r = coreVehicleDamage({ rawDamage: 100, sp: 0, currentSDP: 5 });
    expect(r.newSDP).toBe(0);
    expect(r.destroyed).toBe(true);
  });
});

// ─── coreCrashDamage ─────────────────────────────────────────────────────────────

describe("coreCrashDamage", () => {
  it("speed 0 → 0 dice", () => {
    const r = coreCrashDamage({ speed: 0 });
    expect(r.numD6).toBe(0);
  });

  it("speed 19 → 0 dice (floor of 19/20 = 0)", () => {
    expect(coreCrashDamage({ speed: 19 }).numD6).toBe(0);
  });

  it("speed 20 → 1 die", () => {
    expect(coreCrashDamage({ speed: 20 }).numD6).toBe(1);
  });

  it("speed 40 → 2 dice", () => {
    expect(coreCrashDamage({ speed: 40 }).numD6).toBe(2);
  });

  it("speed 100 → 5 dice", () => {
    expect(coreCrashDamage({ speed: 100 }).numD6).toBe(5);
  });

  it("default weight class is 'light' (mult=1)", () => {
    const r = coreCrashDamage({ speed: 20 });
    expect(r.weightMult).toBe(1);
  });

  it("unknown weight class falls back to mult=1", () => {
    const r = coreCrashDamage({ speed: 20, weightClass: "giant" });
    expect(r.weightMult).toBe(1);
  });

  it("vheavy multiplier is 4", () => {
    expect(coreCrashDamage({ speed: 20, weightClass: "vheavy" }).weightMult).toBe(4);
  });

  it("with rolled value: vehicleDamage = floor(rolled × mult), occupantDamage = floor(vehicle/2)", () => {
    const r = coreCrashDamage({ speed: 20, weightClass: "medium", rolled: 10 });
    expect(r.vehicleDamage).toBe(20);   // 10 * 2
    expect(r.occupantDamage).toBe(10);  // 20 / 2
  });

  it("with rolled value and heavy (x3): correct split", () => {
    const r = coreCrashDamage({ speed: 40, weightClass: "heavy", rolled: 7 });
    expect(r.vehicleDamage).toBe(21);   // floor(7 * 3)
    expect(r.occupantDamage).toBe(10);  // floor(21/2)
  });

  it("without rolled: no vehicleDamage/occupantDamage in result", () => {
    const r = coreCrashDamage({ speed: 40 });
    expect(r.vehicleDamage).toBeUndefined();
    expect(r.occupantDamage).toBeUndefined();
  });

  it("default call returns 0 dice", () => {
    expect(coreCrashDamage().numD6).toBe(0);
  });
});

// ─── mmEffectivePenetration ───────────────────────────────────────────────────────

describe("mmEffectivePenetration", () => {
  it("base pen only, no modifiers", () => {
    expect(mmEffectivePenetration({ basePen: 10 })).toBe(10);
  });

  it("Good Shot: +½ base pen per step (round(10*0.5) * 1 step = +5)", () => {
    expect(mmEffectivePenetration({ basePen: 10, goodShotSteps: 1 })).toBe(15);
  });

  it("Good Shot 2 steps: +10", () => {
    expect(mmEffectivePenetration({ basePen: 10, goodShotSteps: 2 })).toBe(20);
  });

  it("extra rounds: +¼ base pen per extra round (round(10*0.25)=3 per round)", () => {
    expect(mmEffectivePenetration({ basePen: 10, extraRounds: 1 })).toBe(13);
  });

  it("extra rounds 2: +6", () => {
    expect(mmEffectivePenetration({ basePen: 10, extraRounds: 2 })).toBe(16);
  });

  it("long range: -25% (round(10*0.75)=8)", () => {
    expect(mmEffectivePenetration({ basePen: 10, range: "long" })).toBe(8);
  });

  it("extreme range: -50% (round(10*0.5)=5)", () => {
    expect(mmEffectivePenetration({ basePen: 10, range: "extreme" })).toBe(5);
  });

  it("HEF penetrator ignores range penalty", () => {
    expect(mmEffectivePenetration({ basePen: 10, range: "extreme", hefPenetrator: true })).toBe(10);
  });

  it("highDensityAP ignores range penalty", () => {
    expect(mmEffectivePenetration({ basePen: 10, range: "extreme", highDensityAP: true })).toBe(10);
  });

  it("normal range: no reduction", () => {
    expect(mmEffectivePenetration({ basePen: 10, range: "normal" })).toBe(10);
  });

  it("combined: good shot + extra rounds at long range", () => {
    // basePen=10, +5 (1 good shot) + 3 (1 extra round) = 18, then long: round(18*0.75)=14
    expect(mmEffectivePenetration({ basePen: 10, goodShotSteps: 1, extraRounds: 1, range: "long" })).toBe(14);
  });

  it("zero base pen returns 0", () => {
    expect(mmEffectivePenetration({ basePen: 0 })).toBe(0);
    expect(mmEffectivePenetration()).toBe(0);
  });

  it("negative basePen is clamped to 0", () => {
    expect(mmEffectivePenetration({ basePen: -5 })).toBe(0);
  });

  it("negative goodShotSteps and extraRounds are treated as 0", () => {
    expect(mmEffectivePenetration({ basePen: 10, goodShotSteps: -2, extraRounds: -3 })).toBe(10);
  });
});

// ─── reactiveDeflection ──────────────────────────────────────────────────────────

describe("reactiveDeflection", () => {
  it("not installed → fired=false, deflected=false, no tile consumed", () => {
    const r = reactiveDeflection({ installed: false, heat: true, d10: 7 });
    expect(r.fired).toBe(false);
    expect(r.deflected).toBe(false);
    expect(r.newHits).toBe(0);
  });

  it("installed but not HEAT → not fired (no deflection roll), but HE still consumes tile", () => {
    const r = reactiveDeflection({ installed: true, heat: false, hiEx: true, priorHits: 0, d10: 8 });
    expect(r.fired).toBe(false);
    expect(r.deflected).toBe(false);
    expect(r.newHits).toBe(1);   // tile consumed by HE
  });

  it("installed HEAT with fresh array (no prior hits): d10=2 fires and deflects", () => {
    const r = reactiveDeflection({ installed: true, heat: true, priorHits: 0, d10: 2 });
    expect(r.fired).toBe(true);
    expect(r.deflected).toBe(true);
    expect(r.subtract).toBe(0);
    expect(r.newHits).toBe(1);
  });

  it("d10=10 (fresh): always deflects", () => {
    const r = reactiveDeflection({ installed: true, heat: true, priorHits: 0, d10: 10 });
    expect(r.deflected).toBe(true);
  });

  it("d10=1 (fresh): does NOT deflect (need 2-10)", () => {
    const r = reactiveDeflection({ installed: true, heat: true, priorHits: 0, d10: 1 });
    expect(r.fired).toBe(true);
    expect(r.deflected).toBe(false);
  });

  it("worn: 2 prior hits → subtract=1; d10=2 still deflects (2-1=1 < 2? no: 2-1=1 < 2 → fails)", () => {
    // subtract = floor(2/2) = 1; (d10 - subtract) = 2 - 1 = 1, which is < 2 → NOT deflected
    const r = reactiveDeflection({ installed: true, heat: true, priorHits: 2, d10: 2 });
    expect(r.fired).toBe(true);
    expect(r.subtract).toBe(1);
    expect(r.deflected).toBe(false);
  });

  it("worn: 2 prior hits + d10=3 → deflects (3-1=2 ≥ 2)", () => {
    const r = reactiveDeflection({ installed: true, heat: true, priorHits: 2, d10: 3 });
    expect(r.deflected).toBe(true);
  });

  it("4 prior hits → subtract=2; d10=3: 3-2=1 < 2, not deflected", () => {
    const r = reactiveDeflection({ installed: true, heat: true, priorHits: 4, d10: 3 });
    expect(r.subtract).toBe(2);
    expect(r.deflected).toBe(false);
  });

  it("non-HE, non-HEAT hit: installed but no tile consumed", () => {
    const r = reactiveDeflection({ installed: true, heat: false, hiEx: false, priorHits: 0, d10: 5 });
    expect(r.fired).toBe(false);
    expect(r.newHits).toBe(0);   // nothing consumed
  });

  it("default call: not fired, no hits consumed", () => {
    const r = reactiveDeflection();
    expect(r.fired).toBe(false);
    expect(r.newHits).toBe(0);
  });
});

// ─── mmEffectiveArmor ────────────────────────────────────────────────────────────

describe("mmEffectiveArmor", () => {
  it("front facing: full armor value", () => {
    expect(mmEffectiveArmor(100, "front")).toBe(100);
  });

  it("default (no facing): full armor value", () => {
    expect(mmEffectiveArmor(100)).toBe(100);
  });

  it("side: ceil(75%) of front AV", () => {
    expect(mmEffectiveArmor(100, "side")).toBe(75);
    expect(mmEffectiveArmor(101, "side")).toBe(Math.ceil(101 * 0.75));
  });

  it("top: ceil(50%) of front AV", () => {
    expect(mmEffectiveArmor(100, "top")).toBe(50);
    expect(mmEffectiveArmor(101, "top")).toBe(Math.ceil(101 * 0.5));
  });

  it("rear: ceil(50%)", () => {
    expect(mmEffectiveArmor(100, "rear")).toBe(50);
  });

  it("back: ceil(50%) — alias for rear", () => {
    expect(mmEffectiveArmor(100, "back")).toBe(50);
  });

  it("bottom: ceil(50%)", () => {
    expect(mmEffectiveArmor(100, "bottom")).toBe(50);
  });

  it("zero AV always returns 0", () => {
    expect(mmEffectiveArmor(0, "front")).toBe(0);
    expect(mmEffectiveArmor(0, "side")).toBe(0);
    expect(mmEffectiveArmor(0, "rear")).toBe(0);
  });

  it("negative AV clamped to 0", () => {
    expect(mmEffectiveArmor(-20, "front")).toBe(0);
  });

  it("unknown facing falls back to front (full value)", () => {
    expect(mmEffectiveArmor(100, "warp")).toBe(100);
  });
});

// ─── mmDamageSeverity ────────────────────────────────────────────────────────────

describe("mmDamageSeverity", () => {
  it("pen < AV → noPenetration, penetrated=false", () => {
    const r = mmDamageSeverity({ pen: 5, effectiveArmorValue: 10, bodyValue: 0, d10: 10 });
    expect(r.penetrated).toBe(false);
    expect(r.severity).toBe("noPenetration");
    expect(r.score).toBeNull();
    expect(r.diff).toBe(-5);
  });

  it("pen equal to AV: diff=0, penetrated, score = d10 + 0 - body", () => {
    const r = mmDamageSeverity({ pen: 10, effectiveArmorValue: 10, bodyValue: 0, d10: 5 });
    expect(r.penetrated).toBe(true);
    expect(r.diff).toBe(0);
    expect(r.score).toBe(5);
    expect(r.severity).toBe("minor");   // 1-5
  });

  it("score ≤ 0 → surface", () => {
    const r = mmDamageSeverity({ pen: 10, effectiveArmorValue: 10, bodyValue: 5, d10: 1 });
    // score = 1 + 0 - 5 = -4 → surface
    expect(r.severity).toBe("surface");
    expect(r.score).toBe(-4);
  });

  it("score 0 → surface (boundary)", () => {
    const r = mmDamageSeverity({ pen: 10, effectiveArmorValue: 10, bodyValue: 0, d10: 0 });
    expect(r.severity).toBe("surface");
    expect(r.score).toBe(0);
  });

  it("score 1 → minor (boundary)", () => {
    const r = mmDamageSeverity({ pen: 10, effectiveArmorValue: 10, bodyValue: 0, d10: 1 });
    expect(r.severity).toBe("minor");
    expect(r.score).toBe(1);
  });

  it("score 5 → minor (upper boundary)", () => {
    const r = mmDamageSeverity({ pen: 10, effectiveArmorValue: 10, bodyValue: 0, d10: 5 });
    expect(r.severity).toBe("minor");
  });

  it("score 6 → major (boundary)", () => {
    const r = mmDamageSeverity({ pen: 10, effectiveArmorValue: 10, bodyValue: 0, d10: 6 });
    expect(r.severity).toBe("major");
  });

  it("score 9 → major (upper boundary)", () => {
    const r = mmDamageSeverity({ pen: 10, effectiveArmorValue: 10, bodyValue: 0, d10: 9 });
    expect(r.severity).toBe("major");
  });

  it("score 10 → catastrophic (boundary)", () => {
    const r = mmDamageSeverity({ pen: 10, effectiveArmorValue: 10, bodyValue: 0, d10: 10 });
    expect(r.severity).toBe("catastrophic");
  });

  it("high pen vs low AV boosts the score", () => {
    // pen=20 av=5 → diff=15, body=0, d10=3 → score=18 → catastrophic
    const r = mmDamageSeverity({ pen: 20, effectiveArmorValue: 5, bodyValue: 0, d10: 3 });
    expect(r.severity).toBe("catastrophic");
    expect(r.score).toBe(18);
  });

  it("default parameters: diff=-0 penetrated, surface", () => {
    // pen=0 av=0 body=0 d10=0 → diff=0 penetrated, score=0 → surface
    const r = mmDamageSeverity();
    expect(r.penetrated).toBe(true);
    expect(r.severity).toBe("surface");
  });
});

// ─── mmSurfaceDamage ─────────────────────────────────────────────────────────────

describe("mmSurfaceDamage", () => {
  it("d10 1-6: no item damaged", () => {
    for (let d = 0; d <= 6; d++) {
      expect(mmSurfaceDamage(d).itemDamaged).toBe(false);
    }
  });

  it("d10=7: item damaged (boundary)", () => {
    expect(mmSurfaceDamage(7).itemDamaged).toBe(true);
  });

  it("d10 7-10: item damaged", () => {
    for (let d = 7; d <= 10; d++) {
      expect(mmSurfaceDamage(d).itemDamaged).toBe(true);
    }
  });

  it("basePen < 3: item damaged but not destroyed", () => {
    expect(mmSurfaceDamage(9, 2).destroyed).toBe(false);
    expect(mmSurfaceDamage(7, 0).destroyed).toBe(false);
  });

  it("basePen = 3: item destroyed (boundary)", () => {
    expect(mmSurfaceDamage(9, 3).destroyed).toBe(true);
  });

  it("basePen > 3: item destroyed", () => {
    expect(mmSurfaceDamage(10, 5).destroyed).toBe(true);
  });

  it("no item damaged → no destroyed property returned", () => {
    const r = mmSurfaceDamage(3);
    expect(r.itemDamaged).toBe(false);
    expect(r.destroyed).toBeUndefined();
  });

  it("default pen=0: no destruction even if damaged", () => {
    expect(mmSurfaceDamage(9).destroyed).toBe(false);
  });
});

// ─── mmHitLocation ───────────────────────────────────────────────────────────────

describe("mmHitLocation", () => {
  // Front facing (no shift)
  it("front: d10 ≤ 0 → Fuel", () => {
    expect(mmHitLocation(0, "front")).toBe("Fuel");
  });

  it("front: d10 1 → Motive Gear", () => {
    expect(mmHitLocation(1, "front")).toBe("Motive Gear");
  });

  it("front: d10 3 → Motive Gear (upper boundary)", () => {
    expect(mmHitLocation(3, "front")).toBe("Motive Gear");
  });

  it("front: d10 4 → Hull (boundary)", () => {
    expect(mmHitLocation(4, "front")).toBe("Hull");
  });

  it("front: d10 7 → Hull (upper boundary)", () => {
    expect(mmHitLocation(7, "front")).toBe("Hull");
  });

  it("front: d10 8 → Turret (boundary)", () => {
    expect(mmHitLocation(8, "front")).toBe("Turret");
  });

  it("front: d10 10 → Turret", () => {
    expect(mmHitLocation(10, "front")).toBe("Turret");
  });

  // Top facing (+2)
  it("top: d10 2 → effective 4 → Hull", () => {
    expect(mmHitLocation(2, "top")).toBe("Hull");
  });

  it("top: d10 1 → effective 3 → Motive Gear", () => {
    expect(mmHitLocation(1, "top")).toBe("Motive Gear");
  });

  it("top: d10 6 → effective 8 → Turret", () => {
    expect(mmHitLocation(6, "top")).toBe("Turret");
  });

  // Side facing (-1)
  it("side: d10 4 → effective 3 → Motive Gear", () => {
    expect(mmHitLocation(4, "side")).toBe("Motive Gear");
  });

  it("side: d10 1 → effective 0 → Fuel", () => {
    expect(mmHitLocation(1, "side")).toBe("Fuel");
  });

  // Rear facing (-2)
  it("rear: d10 4 → effective 2 → Motive Gear", () => {
    expect(mmHitLocation(4, "rear")).toBe("Motive Gear");
  });

  it("rear: d10 2 → effective 0 → Fuel", () => {
    expect(mmHitLocation(2, "rear")).toBe("Fuel");
  });

  it("back is an alias for rear", () => {
    expect(mmHitLocation(4, "back")).toBe(mmHitLocation(4, "rear"));
  });

  it("bottom is treated same as rear (−2)", () => {
    expect(mmHitLocation(4, "bottom")).toBe(mmHitLocation(4, "rear"));
  });

  it("default facing (front) when omitted", () => {
    expect(mmHitLocation(5)).toBe("Hull");
  });
});

// ─── mmSubLocation ───────────────────────────────────────────────────────────────

describe("mmSubLocation", () => {
  // Hull table, front (+1)
  it("Hull/front: d10=1 → effective 2 → Cargo/Ammo (≤2)", () => {
    expect(mmSubLocation(1, "Hull", "front")).toBe("Cargo/Ammo");
  });

  it("Hull/front: d10=2 → effective 3 → Engine (≤4)", () => {
    expect(mmSubLocation(2, "Hull", "front")).toBe("Engine");
  });

  it("Hull/front: d10=3 → effective 4 → Engine (≤4)", () => {
    expect(mmSubLocation(3, "Hull", "front")).toBe("Engine");
  });

  it("Hull/front: d10=4 → effective 5 → Crew (≤7)", () => {
    expect(mmSubLocation(4, "Hull", "front")).toBe("Crew");
  });

  it("Hull/front: d10=7 → effective 8 → Equipment (=8)", () => {
    expect(mmSubLocation(7, "Hull", "front")).toBe("Equipment");
  });

  it("Hull/front: d10=8 → effective 9 → Weapon (=9)", () => {
    expect(mmSubLocation(8, "Hull", "front")).toBe("Weapon");
  });

  it("Hull/front: d10=9 → effective 10 → Empty Space", () => {
    expect(mmSubLocation(9, "Hull", "front")).toBe("Empty Space");
  });

  // Hull table, rear (-1)
  it("Hull/rear: d10=2 → effective 1 → Cargo/Ammo (≤2)", () => {
    expect(mmSubLocation(2, "Hull", "rear")).toBe("Cargo/Ammo");
  });

  it("Hull/rear: d10=3 → effective 2 → Cargo/Ammo", () => {
    expect(mmSubLocation(3, "Hull", "rear")).toBe("Cargo/Ammo");
  });

  it("Hull/rear: d10=10 → effective 9 → Weapon", () => {
    expect(mmSubLocation(10, "Hull", "rear")).toBe("Weapon");
  });

  // Turret table, front (+1)
  it("Turret/front: d10=1 → effective 2 → Cargo/Ammo (≤2)", () => {
    expect(mmSubLocation(1, "Turret", "front")).toBe("Cargo/Ammo");
  });

  it("Turret/front: d10=2 → effective 3 → Crew (≤7)", () => {
    expect(mmSubLocation(2, "Turret", "front")).toBe("Crew");
  });

  it("Turret/front: d10=7 → effective 8 → Equipment (=8)", () => {
    expect(mmSubLocation(7, "Turret", "front")).toBe("Equipment");
  });

  it("Turret/front: d10=8 → effective 9 → Weapon (9-11)", () => {
    expect(mmSubLocation(8, "Turret", "front")).toBe("Weapon");
  });

  it("Turret/front: d10=10 → effective 11 → Weapon (9-11)", () => {
    expect(mmSubLocation(10, "Turret", "front")).toBe("Weapon");
  });

  it("default table=Hull, default facing=front", () => {
    expect(mmSubLocation(5)).toBe(mmSubLocation(5, "Hull", "front"));
  });
});

// ─── acpaHitLocation ─────────────────────────────────────────────────────────────

describe("acpaHitLocation", () => {
  it("d10 ≤ 0 → Power Cell", () => {
    expect(acpaHitLocation(0)).toBe("Power Cell");
    expect(acpaHitLocation(-1)).toBe("Power Cell");
  });

  it("d10 1 → Legs (boundary)", () => {
    expect(acpaHitLocation(1)).toBe("Legs");
  });

  it("d10 3 → Legs (upper boundary)", () => {
    expect(acpaHitLocation(3)).toBe("Legs");
  });

  it("d10 4 → Arms (boundary)", () => {
    expect(acpaHitLocation(4)).toBe("Arms");
  });

  it("d10 6 → Arms (upper boundary)", () => {
    expect(acpaHitLocation(6)).toBe("Arms");
  });

  it("d10 7 → Torso/Head (boundary)", () => {
    expect(acpaHitLocation(7)).toBe("Torso/Head");
  });

  it("d10 10 → Torso/Head", () => {
    expect(acpaHitLocation(10)).toBe("Torso/Head");
  });

  it("full range 1..10 all map correctly", () => {
    const expected = ["Legs","Legs","Legs","Arms","Arms","Arms","Torso/Head","Torso/Head","Torso/Head","Torso/Head"];
    for (let d = 1; d <= 10; d++) {
      expect(acpaHitLocation(d)).toBe(expected[d - 1]);
    }
  });
});

// ─── damageControlIgnores ────────────────────────────────────────────────────────

describe("damageControlIgnores", () => {
  it("d10 1-5: does NOT ignore the hit", () => {
    for (let d = 0; d <= 5; d++) {
      expect(damageControlIgnores(d)).toBe(false);
    }
  });

  it("d10 6: ignores (boundary)", () => {
    expect(damageControlIgnores(6)).toBe(true);
  });

  it("d10 7-10: ignores", () => {
    for (let d = 7; d <= 10; d++) {
      expect(damageControlIgnores(d)).toBe(true);
    }
  });

  it("null/undefined treated as 0 → does not ignore", () => {
    expect(damageControlIgnores(null)).toBe(false);
    expect(damageControlIgnores(undefined)).toBe(false);
  });
});
