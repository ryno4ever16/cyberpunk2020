/**
 * Unit tests for pure exports in module/shop/categories.js.
 *
 * Tested (fully pure, no Foundry deps):
 *   - categoryOfPack — pack name → { category, sub }, with a Gear/Other fallback
 *   - CATEGORIES     — the shop-UI filter taxonomy (top category → ordered subs)
 *   - EXCLUDED_PACKS — packs that are never personal-shop goods
 *   - EXCLUDED_TYPES — item types never sold in the shop
 *
 * Skipped (Foundry):
 *   - catalogPacks — iterates game.packs
 */

import { describe, it, expect } from "vitest";
import {
  categoryOfPack,
  categoryOfItem,
  vehicleSubOf,
  CATEGORIES,
  EXCLUDED_PACKS,
  EXCLUDED_TYPES,
} from "../../module/shop/categories.js";

// ─── categoryOfPack ───────────────────────────────────────────────────────────

describe("categoryOfPack", () => {
  it("maps weapon packs to Weapons with the right sub", () => {
    expect(categoryOfPack("pistols")).toEqual({ category: "Weapons", sub: "Pistols" });
    expect(categoryOfPack("submachineguns")).toEqual({ category: "Weapons", sub: "SMGs" });
  });

  it("maps armor to Armor with no sub", () => {
    expect(categoryOfPack("armor")).toEqual({ category: "Armor", sub: "" });
  });

  it('maps "fashonware" (the pack\'s actual spelling) to Cyberware / Fashionware', () => {
    expect(categoryOfPack("fashonware")).toEqual({ category: "Cyberware", sub: "Fashionware" });
  });

  it("maps programs to Programs with no sub", () => {
    expect(categoryOfPack("programs")).toEqual({ category: "Programs", sub: "" });
  });

  it("maps rentalandservices to Gear / Rentals & Services", () => {
    expect(categoryOfPack("rentalandservices")).toEqual({ category: "Gear", sub: "Rentals & Services" });
  });

  it("unmapped pack names fall back to Gear / Other", () => {
    expect(categoryOfPack("totally-unknown-pack")).toEqual({ category: "Gear", sub: "Other" });
    expect(categoryOfPack("")).toEqual({ category: "Gear", sub: "Other" });
    expect(categoryOfPack(undefined)).toEqual({ category: "Gear", sub: "Other" });
  });
});

// ─── EXCLUDED_PACKS / EXCLUDED_TYPES ─────────────────────────────────────────

describe("EXCLUDED_PACKS", () => {
  it("is a Set excluding ammo, sell-the-dead, MM vehicle/ACPA packs, and skills", () => {
    expect(EXCLUDED_PACKS).toBeInstanceOf(Set);
    expect(EXCLUDED_PACKS.has("ammo")).toBe(true);
    expect(EXCLUDED_PACKS.has("sellthedead")).toBe(true);
    expect(EXCLUDED_PACKS.has("vehicle-weapons")).toBe(true);
    expect(EXCLUDED_PACKS.has("acpa-systems")).toBe(true);
    expect(EXCLUDED_PACKS.has("default-skills-en")).toBe(true);
  });

  it("does NOT exclude buyable packs", () => {
    expect(EXCLUDED_PACKS.has("pistols")).toBe(false);
  });
});

describe("EXCLUDED_TYPES", () => {
  it("is a Set of exactly skill and ammo", () => {
    expect(EXCLUDED_TYPES).toBeInstanceOf(Set);
    expect([...EXCLUDED_TYPES].sort()).toEqual(["ammo", "skill"]);
    expect(EXCLUDED_TYPES.has("skill")).toBe(true);
    expect(EXCLUDED_TYPES.has("ammo")).toBe(true);
    expect(EXCLUDED_TYPES.has("armor")).toBe(false);
  });
});

// ─── CATEGORIES ───────────────────────────────────────────────────────────────

describe("CATEGORIES", () => {
  it("is an array of { key, subs } entries", () => {
    expect(Array.isArray(CATEGORIES)).toBe(true);
    for (const entry of CATEGORIES) {
      expect(typeof entry.key).toBe("string");
      expect(Array.isArray(entry.subs)).toBe(true);
    }
  });

  it("keys are unique", () => {
    const keys = CATEGORIES.map(c => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("includes all the expected top-level categories", () => {
    const keys = new Set(CATEGORIES.map(c => c.key));
    for (const expected of [
      "Weapons", "Armor", "Ammo", "Cyberware",
      "Gear", "Netrunning", "Programs", "Vehicles",
    ]) {
      expect(keys.has(expected)).toBe(true);
    }
  });
});

// ─── categoryOfItem (type-grouped packs categorize from item data) ───────────

describe("categoryOfItem", () => {
  it("weapons sub-categorize by system.weaponType, unknown types → Other", () => {
    expect(categoryOfItem("weapon", { weaponType: "Pistol" })).toEqual({ category: "Weapons", sub: "Pistols" });
    expect(categoryOfItem("weapon", { weaponType: "Heavy" })).toEqual({ category: "Weapons", sub: "Heavy" });
    expect(categoryOfItem("weapon", { weaponType: "Blunderbuss" })).toEqual({ category: "Weapons", sub: "Other" });
    expect(categoryOfItem("weapon", {})).toEqual({ category: "Weapons", sub: "Other" });
  });

  it("vehicles sub-categorize by system.vehicleType via vehicleSubOf", () => {
    expect(categoryOfItem("vehicle", { vehicleType: "Car" })).toEqual({ category: "Vehicles", sub: "Cars" });
    expect(categoryOfItem("vehicle", { vehicleType: "" })).toEqual({ category: "Vehicles", sub: "" });
    expect(categoryOfItem("vehicle", {})).toEqual({ category: "Vehicles", sub: "" });
  });

  it("non-weapon/vehicle types keep their flat mapping", () => {
    expect(categoryOfItem("armor", {})).toEqual({ category: "Armor", sub: "" });
    expect(categoryOfItem("program", {})).toEqual({ category: "Programs", sub: "" });
    expect(categoryOfItem("cyberware", {})).toEqual({ category: "Cyberware", sub: "Other" });
    expect(categoryOfItem("misc", {})).toEqual({ category: "Gear", sub: "Other" });
  });

  it("skill chips (cyberwareType CHIPWARE) sub-categorize as Chipware", () => {
    expect(categoryOfItem("cyberware", { cyberwareType: "CHIPWARE" })).toEqual({ category: "Cyberware", sub: "Chipware" });
    expect(categoryOfItem("cyberware", { cyberwareType: "chipware" })).toEqual({ category: "Cyberware", sub: "Chipware" });
    expect(categoryOfItem("cyberware", { cyberwareType: "CYBEROPTIC" })).toEqual({ category: "Cyberware", sub: "Other" });
    const cyber = CATEGORIES.find(c => c.key === "Cyberware");
    expect(cyber.subs).toContain("Chipware");
  });
});

// ─── vehicleSubOf (soft-enum class → Vehicles sub-filter) ────────────────────

describe("vehicleSubOf", () => {
  it("maps every canonical VEHICLE_TYPE_SUGGESTIONS value to a sub", () => {
    // The 18 datalist suggestions (module/lookups.js) — the sheet's soft-enum vocabulary.
    const canon = {
      "Car": "Cars", "Cycle": "Cycles", "Truck": "Trucks",
      "Hovercraft": "Hover", "AV (Aerodyne)": "AVs",
      "Helicopter": "Aircraft", "Fixed-Wing": "Aircraft", "Osprey": "Aircraft",
      "Dirigible": "Aircraft", "Ultralight": "Aircraft",
      "Boat": "Watercraft", "Submarine": "Watercraft",
      "Spacecraft": "Spacecraft",
      "Tank": "Military", "APC/IFV": "Military",
      "RPV/Drone": "Drones", "Construction": "Trucks",
      "ACPA (Powered Armor)": "ACPA",
    };
    for (const [cls, sub] of Object.entries(canon)) {
      expect(vehicleSubOf(cls), `class "${cls}"`).toBe(sub);
    }
  });

  it("normalizes the books' free-text class vocabulary (case-insensitive keywords)", () => {
    expect(vehicleSubOf("Sports Car")).toBe("Cars");
    expect(vehicleSubOf("aerodyne")).toBe("AVs");
    expect(vehicleSubOf("AV-4")).toBe("AVs");
    expect(vehicleSubOf("Attack Helicopter")).toBe("Aircraft");
    expect(vehicleSubOf("Hover Tank")).toBe("Hover");     // locomotion wins — MM panzers are hovercraft
    expect(vehicleSubOf("panzer")).toBe("Hover");
    expect(vehicleSubOf("Main Battle Tank")).toBe("Military");
    expect(vehicleSubOf("motorcycle")).toBe("Cycles");
    expect(vehicleSubOf("Patrol Boat")).toBe("Watercraft");
    expect(vehicleSubOf("submersible")).toBe("Watercraft");
    expect(vehicleSubOf("Orbital Shuttle")).toBe("Spacecraft");
    expect(vehicleSubOf("remote drone")).toBe("Drones");
    expect(vehicleSubOf("powered armor")).toBe("ACPA");
  });

  it('empty/blank means unclassified (""), an unrecognized class means "Other"', () => {
    expect(vehicleSubOf("")).toBe("");
    expect(vehicleSubOf("   ")).toBe("");
    expect(vehicleSubOf(null)).toBe("");
    expect(vehicleSubOf(undefined)).toBe("");
    expect(vehicleSubOf("Mule")).toBe("Other");
  });

  it("every non-empty result is a declared Vehicles sub (taxonomy consistency)", () => {
    const vehicles = CATEGORIES.find(c => c.key === "Vehicles");
    const probes = ["Car", "Cycle", "Truck", "Hovercraft", "AV (Aerodyne)", "Helicopter",
      "Boat", "Spacecraft", "Tank", "RPV/Drone", "ACPA (Powered Armor)", "Mule"];
    for (const p of probes) {
      const sub = vehicleSubOf(p);
      expect(vehicles.subs, `sub "${sub}" for "${p}"`).toContain(sub);
    }
  });
});

// ─── Consistency invariant: pack mapping ⊆ CATEGORIES taxonomy ───────────────

describe("categoryOfPack ↔ CATEGORIES consistency", () => {
  const representativePacks = [
    "pistols", "submachineguns", "fashonware", "rentalandservices", "armor", "programs",
  ];

  for (const pack of representativePacks) {
    it(`pack "${pack}" maps to a category whose subs list contains its sub (or sub is "")`, () => {
      const { category, sub } = categoryOfPack(pack);
      const entry = CATEGORIES.find(c => c.key === category);
      expect(entry).toBeDefined();
      if (sub !== "") expect(entry.subs).toContain(sub);
    });
  }
});
