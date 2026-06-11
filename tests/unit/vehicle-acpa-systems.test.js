/**
 * Unit tests for module/vehicle/vehicle-acpa-systems.js.
 *
 * All pure functions + exported constants are covered. No Foundry globals needed.
 */

import { describe, it, expect } from "vitest";
import {
  ACPA_SYSTEM_CATEGORIES,
  ACPA_SYSTEMS,
  acpaSystemDef,
  acpaSystemSop,
  acpaAreaSpaces,
  acpaSystemsSummary,
  acpaSpacesOver,
  acpaHitSystem,
  acpaBuildIssues,
} from "../../module/vehicle/vehicle-acpa-systems.js";

// ─── ACPA_SYSTEM_CATEGORIES constant ─────────────────────────────────────────────

describe("ACPA_SYSTEM_CATEGORIES", () => {
  it("contains the five expected categories", () => {
    expect(ACPA_SYSTEM_CATEGORIES).toContain("utility");
    expect(ACPA_SYSTEM_CATEGORIES).toContain("sensor");
    expect(ACPA_SYSTEM_CATEGORIES).toContain("movement");
    expect(ACPA_SYSTEM_CATEGORIES).toContain("defensive");
    expect(ACPA_SYSTEM_CATEGORIES).toContain("safety");
  });

  it("has exactly 5 entries", () => {
    expect(ACPA_SYSTEM_CATEGORIES.length).toBe(5);
  });
});

// ─── ACPA_SYSTEMS constant ────────────────────────────────────────────────────────

describe("ACPA_SYSTEMS", () => {
  it("each entry has required stat fields", () => {
    for (const [, v] of Object.entries(ACPA_SYSTEMS)) {
      expect(typeof v.key).toBe("string");
      expect(typeof v.label).toBe("string");
      expect(ACPA_SYSTEM_CATEGORIES).toContain(v.category);
      expect(typeof v.weight).toBe("number");
      expect(typeof v.spaces).toBe("number");
      expect(typeof v.cost).toBe("number");
      expect(typeof v.sop).toBe("number");
      expect(["internal","external","either","retract"]).toContain(v.mount);
    }
  });

  it("RADAR is a sensor with internal mount and 5kg weight", () => {
    expect(ACPA_SYSTEMS.RADAR.category).toBe("sensor");
    expect(ACPA_SYSTEMS.RADAR.mount).toBe("internal");
    expect(ACPA_SYSTEMS.RADAR.weight).toBe(5);
  });

  it("SENSORY_EXTENSIONS is external with sp=15", () => {
    expect(ACPA_SYSTEMS.SENSORY_EXTENSIONS.mount).toBe("external");
    expect(ACPA_SYSTEMS.SENSORY_EXTENSIONS.sp).toBe(15);
  });

  it("JUMP_JETS use retract mount", () => {
    expect(ACPA_SYSTEMS.JUMP_JETS.mount).toBe("retract");
  });

  it("ECM_SUITE is expensive (100000eb)", () => {
    expect(ACPA_SYSTEMS.ECM_SUITE.cost).toBe(100000);
  });
});

// ─── acpaSystemDef ────────────────────────────────────────────────────────────────

describe("acpaSystemDef", () => {
  it("known key returns the catalog entry", () => {
    const d = acpaSystemDef("RADAR");
    expect(d).not.toBeNull();
    expect(d.key).toBe("RADAR");
  });

  it("unknown key returns null", () => {
    expect(acpaSystemDef("NOT_A_SYSTEM")).toBeNull();
  });

  it("undefined key returns null", () => {
    expect(acpaSystemDef(undefined)).toBeNull();
  });
});

// ─── acpaSystemSop ────────────────────────────────────────────────────────────────

describe("acpaSystemSop", () => {
  it("entry with sop > 0: returns sop directly", () => {
    expect(acpaSystemSop({ sop: 15, sp: 20 })).toBe(15);
  });

  it("entry with sop=0 but sp > 0: SOP = sp × 3 (MM p.62)", () => {
    expect(acpaSystemSop({ sop: 0, sp: 10 })).toBe(30);
  });

  it("entry with neither sop nor sp: returns 0", () => {
    expect(acpaSystemSop({ sop: 0, sp: 0 })).toBe(0);
    expect(acpaSystemSop({})).toBe(0);
    expect(acpaSystemSop(null)).toBe(0);
  });

  it("RADAR from catalog: sop=15, sp=0 → returns 15", () => {
    expect(acpaSystemSop(acpaSystemDef("RADAR"))).toBe(15);
  });

  it("HEAVY_TOOL_SUITE: sop=20, sp=20 → sop takes precedence → 20", () => {
    expect(acpaSystemSop(acpaSystemDef("HEAVY_TOOL_SUITE"))).toBe(20);
  });
});

// ─── acpaAreaSpaces ───────────────────────────────────────────────────────────────

describe("acpaAreaSpaces", () => {
  it("STR 16-20 (small): head=2, armLeg=2, torso=3", () => {
    const r = acpaAreaSpaces(16);
    expect(r.head.internal).toBe(2);
    expect(r.rArm.internal).toBe(2);
    expect(r.torso.internal).toBe(3);
  });

  it("STR 25-37 (medium): head=2, armLeg=3, torso=4", () => {
    const r = acpaAreaSpaces(25);
    expect(r.head.internal).toBe(2);
    expect(r.rArm.internal).toBe(3);
    expect(r.torso.internal).toBe(4);
  });

  it("STR 37 (upper edge of medium): head=2, armLeg=3, torso=4", () => {
    const r = acpaAreaSpaces(37);
    expect(r.head.internal).toBe(2);
    expect(r.rLeg.internal).toBe(3);
    expect(r.torso.internal).toBe(4);
  });

  it("STR 40 (large): head=3, armLeg=4, torso=5", () => {
    const r = acpaAreaSpaces(40);
    expect(r.head.internal).toBe(3);
    expect(r.lArm.internal).toBe(4);
    expect(r.torso.internal).toBe(5);
  });

  it("external spaces = internal − 1 for all areas with internal ≥ 1", () => {
    const r = acpaAreaSpaces(40);
    for (const area of ["head","rArm","lArm","rLeg","lLeg","torso"]) {
      expect(r[area].external).toBe(Math.max(0, r[area].internal - 1));
    }
  });

  it("STR below 16: falls through to the small (16-20) case", () => {
    const r = acpaAreaSpaces(0);
    expect(r.head.internal).toBe(2);
    expect(r.torso.internal).toBe(3);
  });

  it("external spaces are never negative", () => {
    const r = acpaAreaSpaces(0);
    for (const area of Object.keys(r)) {
      expect(r[area].external).toBeGreaterThanOrEqual(0);
    }
  });
});

// ─── acpaSystemsSummary ───────────────────────────────────────────────────────────

describe("acpaSystemsSummary", () => {
  it("empty list: totalWeight=0, totalCost=0, all spaces zero", () => {
    const r = acpaSystemsSummary([]);
    expect(r.totalWeight).toBe(0);
    expect(r.totalCost).toBe(0);
    for (const v of Object.values(r.byArea)) {
      expect(v.internal).toBe(0);
      expect(v.external).toBe(0);
    }
  });

  it("single internal system: weight and cost from catalog, internal spaces used", () => {
    const r = acpaSystemsSummary([{ key: "RADAR", area: "head" }]);
    expect(r.totalWeight).toBe(5);      // RADAR weight=5
    expect(r.totalCost).toBe(1000);     // RADAR cost=1000
    expect(r.byArea.head.internal).toBe(0.5);   // RADAR spaces=0.5
    expect(r.byArea.head.external).toBe(0);
  });

  it("external system uses external space bucket", () => {
    const r = acpaSystemsSummary([{ key: "SENSORY_EXTENSIONS", area: "head" }]);
    expect(r.byArea.head.external).toBe(0.5);
    expect(r.byArea.head.internal).toBe(0);
  });

  it("two systems in different areas: weight and cost accumulate", () => {
    const r = acpaSystemsSummary([
      { key: "RADAR", area: "head" },
      { key: "INFRARED", area: "torso" },
    ]);
    expect(r.totalWeight).toBe(5 + 0);   // RADAR=5, INFRARED=0
    expect(r.totalCost).toBe(1000 + 400);
  });

  it("unknown key: skipped (zero contribution)", () => {
    const r = acpaSystemsSummary([{ key: "BOGUS", area: "torso" }]);
    expect(r.totalWeight).toBe(0);
    expect(r.totalCost).toBe(0);
  });

  it("mounted entry overrides catalog weight/cost/spaces", () => {
    const r = acpaSystemsSummary([{ key: "RADAR", area: "head", weight: 99, cost: 9999, spaces: 2 }]);
    expect(r.totalWeight).toBe(99);
    expect(r.totalCost).toBe(9999);
    expect(r.byArea.head.internal).toBe(2);
  });

  it("unknown area falls back to torso", () => {
    const r = acpaSystemsSummary([{ key: "RADAR", area: "neck" }]);
    expect(r.byArea.torso.internal).toBe(0.5);
  });

  it("either/retract mount goes to internal bucket", () => {
    // JUMP_JETS is retract
    const r = acpaSystemsSummary([{ key: "JUMP_JETS", area: "torso" }]);
    expect(r.byArea.torso.internal).toBeGreaterThan(0);
    expect(r.byArea.torso.external).toBe(0);
  });
});

// ─── acpaSpacesOver ───────────────────────────────────────────────────────────────

describe("acpaSpacesOver", () => {
  it("empty build on STR 40: all values ≤ 0 (within budget)", () => {
    const r = acpaSpacesOver([], 40);
    for (const v of Object.values(r)) {
      expect(v.internal).toBeLessThanOrEqual(0);
      expect(v.external).toBeLessThanOrEqual(0);
    }
  });

  it("single system that fits: internal overage ≤ 0", () => {
    // RADAR uses 0.5 spaces; STR 40 head has 3 internal → plenty of room
    const r = acpaSpacesOver([{ key: "RADAR", area: "head" }], 40);
    expect(r.head.internal).toBeLessThanOrEqual(0);
  });

  it("over-budget: multiple systems in same area exceeding budget", () => {
    // Put 10 RADAR (0.5 sp each = 5 total) in head; STR 16 head has 2 internal → overage = 3
    const mounted = Array(10).fill({ key: "RADAR", area: "head" });
    const r = acpaSpacesOver(mounted, 16);
    // used=5, available=2 → overage=3
    expect(r.head.internal).toBeCloseTo(3, 5);
  });

  it("external overage reported in external bucket", () => {
    // 6 SENSORY_EXTENSIONS (0.5 sp each = 3 total external); STR 16 head has 1 external → overage = 2
    const mounted = Array(6).fill({ key: "SENSORY_EXTENSIONS", area: "head" });
    const r = acpaSpacesOver(mounted, 16);
    expect(r.head.external).toBeCloseTo(2, 5);
  });
});

// ─── acpaHitSystem ────────────────────────────────────────────────────────────────

describe("acpaHitSystem", () => {
  it("no systems mounted: index=-1, overflow=sopDamage", () => {
    const r = acpaHitSystem([], "torso", 10);
    expect(r.index).toBe(-1);
    expect(r.overflow).toBe(10);
    expect(r.hitKey).toBeNull();
    expect(r.destroyed).toBe(false);
  });

  it("system in a different area: not hit (index=-1)", () => {
    const r = acpaHitSystem([{ key: "RADAR", area: "head", sop: 15 }], "torso", 5);
    expect(r.index).toBe(-1);
  });

  it("system in the struck area absorbs SOP damage (not destroyed)", () => {
    const r = acpaHitSystem([{ key: "RADAR", area: "head", sop: 15 }], "head", 5);
    expect(r.index).toBe(0);
    expect(r.destroyed).toBe(false);
    expect(r.overflow).toBe(0);
    expect(r.updated[0].sopDamage).toBe(5);
    expect(r.updated[0].destroyed).toBe(false);
  });

  it("system destroyed when sopDamage meets/exceeds sop", () => {
    const r = acpaHitSystem([{ key: "RADAR", area: "head", sop: 15 }], "head", 15);
    expect(r.destroyed).toBe(true);
    expect(r.overflow).toBe(0);
    expect(r.updated[0].sopDamage).toBe(15);
    expect(r.updated[0].destroyed).toBe(true);
  });

  it("overflow = damage − sop when damage exceeds sop", () => {
    const r = acpaHitSystem([{ key: "RADAR", area: "head", sop: 15 }], "head", 20);
    expect(r.destroyed).toBe(true);
    expect(r.overflow).toBe(5);
  });

  it("accumulates sopDamage over prior hits", () => {
    const r = acpaHitSystem([{ key: "RADAR", area: "head", sop: 15, sopDamage: 10 }], "head", 3);
    expect(r.updated[0].sopDamage).toBe(13);
    expect(r.destroyed).toBe(false);
  });

  it("prior sopDamage + new hits sop exactly: destroyed, no overflow", () => {
    const r = acpaHitSystem([{ key: "RADAR", area: "head", sop: 15, sopDamage: 10 }], "head", 5);
    expect(r.destroyed).toBe(true);
    expect(r.overflow).toBe(0);
  });

  it("already-destroyed system is skipped (finds next live one)", () => {
    const mounted = [
      { key: "RADAR",    area: "head", sop: 15, destroyed: true },
      { key: "INFRARED", area: "head", sop: 5 },
    ];
    const r = acpaHitSystem(mounted, "head", 3);
    expect(r.index).toBe(1);
    expect(r.hitKey).toBe("INFRARED");
  });

  it("all systems in area are destroyed: index=-1", () => {
    const mounted = [
      { key: "RADAR", area: "head", sop: 15, destroyed: true },
    ];
    const r = acpaHitSystem(mounted, "head", 5);
    expect(r.index).toBe(-1);
    expect(r.overflow).toBe(5);
  });

  it("falls back to catalog SOP when mounted entry has no sop field", () => {
    // RADAR catalog sop=15; mounted entry has no sop
    const r = acpaHitSystem([{ key: "RADAR", area: "torso" }], "torso", 5);
    expect(r.updated[0].sopDamage).toBe(5);
    expect(r.destroyed).toBe(false);   // 5 < 15
  });

  it("zero sopDamage: system hit but nothing consumed", () => {
    const r = acpaHitSystem([{ key: "RADAR", area: "head", sop: 15 }], "head", 0);
    expect(r.index).toBe(0);
    expect(r.updated[0].sopDamage).toBe(0);
    expect(r.destroyed).toBe(false);
    expect(r.overflow).toBe(0);
  });

  it("does not mutate the original mounted array", () => {
    const orig = [{ key: "RADAR", area: "head", sop: 15, sopDamage: 0 }];
    const origCopy = JSON.parse(JSON.stringify(orig));
    acpaHitSystem(orig, "head", 5);
    expect(orig[0].sopDamage).toBe(origCopy[0].sopDamage);
  });
});

// ─── acpaBuildIssues ──────────────────────────────────────────────────────────────

describe("acpaBuildIssues", () => {
  it("valid build: returns empty array", () => {
    const r = acpaBuildIssues({ str: 40, armorSP: 60, totalWeight: 500, chassisCapacity: 2000, spacesOver: {} });
    expect(r).toEqual([]);
  });

  it("armorSP exceeds 2× STR: reports armor issue", () => {
    const r = acpaBuildIssues({ str: 20, armorSP: 50, totalWeight: 0, chassisCapacity: 0 });
    // 50 > 2*20=40 → issue
    expect(r.length).toBeGreaterThanOrEqual(1);
    expect(r[0]).toMatch(/Armor SP/);
  });

  it("armorSP exactly 2× STR: no armor issue (boundary)", () => {
    const r = acpaBuildIssues({ str: 20, armorSP: 40, totalWeight: 0, chassisCapacity: 0 });
    expect(r.some(s => s.includes("Armor SP"))).toBe(false);
  });

  it("armorSP = 2×STR + 1: reports armor issue (boundary +1)", () => {
    const r = acpaBuildIssues({ str: 20, armorSP: 41, totalWeight: 0, chassisCapacity: 0 });
    expect(r.some(s => s.includes("Armor SP"))).toBe(true);
  });

  it("overweight: reports overweight issue", () => {
    const r = acpaBuildIssues({ str: 40, armorSP: 0, totalWeight: 3000, chassisCapacity: 2000 });
    expect(r.some(s => s.includes("Overweight"))).toBe(true);
  });

  it("totalWeight exactly at capacity: no overweight issue (boundary)", () => {
    const r = acpaBuildIssues({ str: 40, armorSP: 0, totalWeight: 2000, chassisCapacity: 2000 });
    expect(r.some(s => s.includes("Overweight"))).toBe(false);
  });

  it("space overage in head.internal: reports head internal issue", () => {
    const r = acpaBuildIssues({ str: 40, spacesOver: { head: { internal: 1, external: 0 } } });
    expect(r.some(s => s.includes("Head") && s.includes("internal"))).toBe(true);
  });

  it("space overage in torso.external: reports torso external issue", () => {
    const r = acpaBuildIssues({ str: 40, spacesOver: { torso: { internal: 0, external: 0.5 } } });
    expect(r.some(s => s.includes("Torso") && s.includes("external"))).toBe(true);
  });

  it("zero or negative overage in spacesOver: no space issue", () => {
    const r = acpaBuildIssues({ str: 40, spacesOver: { head: { internal: 0, external: -1 } } });
    expect(r.some(s => s.includes("Head"))).toBe(false);
  });

  it("multiple issues can be reported simultaneously", () => {
    const r = acpaBuildIssues({
      str: 10, armorSP: 50, totalWeight: 5000, chassisCapacity: 100,
      spacesOver: { head: { internal: 3, external: 2 } },
    });
    expect(r.length).toBeGreaterThanOrEqual(3);
  });

  it("default call: no issues (all zeros, no caps violated)", () => {
    const r = acpaBuildIssues();
    expect(r).toEqual([]);
  });
});
