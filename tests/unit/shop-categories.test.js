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
  CATEGORIES,
  EXCLUDED_PACKS,
  EXCLUDED_TYPES,
} from "../../module/shop/categories.js";

// ─── categoryOfPack ───────────────────────────────────────────────────────────

describe("categoryOfPack", () => {
  it("maps weapon packs to Weapons with the right sub", () => {
    expect(categoryOfPack("pistols")).toEqual({ category: "Weapons", sub: "Pistols" });
    expect(categoryOfPack("submachineguns")).toEqual({ category: "Weapons", sub: "SMGs" });
    expect(categoryOfPack("smgs-add")).toEqual({ category: "Weapons", sub: "SMGs" });
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
