/**
 * Unit tests for pure exported functions in module/utils.js.
 *
 * Skipped (not pure / need Foundry globals):
 *   - localize, tryLocalize, localizeParam, shortLocalize — call game.i18n
 *   - rollLocation                                        — calls new Roll / game.settings
 *   - openSingletonDialog                                 — manages UI Application instances
 *   - getDefaultSkills, getSkillsPackNames, getSkillIndex — call game.packs / game.i18n
 *   - getInitialD10Result, isFumbleRoll                  — need foundry.dice.terms.Die
 *   - buildSkillFumbleData, buildRangedCombatFumbleData   — async, call Roll / game.i18n
 *   - reliabilityLabel                                    — calls game.i18n
 *   - deleteFieldUpdate                                   — uses globalThis.foundry (may be fine,
 *       tested below for the pure fallback path only)
 */

import { describe, it, expect } from "vitest";
import {
  properCase,
  replaceIn,
  deepLookup,
  deepSet,
  clamp,
  cwHasType,
  cwIsEnabled,
  cwIsSkinweave,
  reliabilityThreshold,
  deleteFieldUpdate,
} from "../../module/utils.js";

// ─── properCase ───────────────────────────────────────────────────────────────

describe("properCase", () => {
  it("capitalises the first letter of each word", () => {
    expect(properCase("hello world")).toBe("Hello World");
    expect(properCase("HELLO WORLD")).toBe("Hello World");
    expect(properCase("the quick brown fox")).toBe("The Quick Brown Fox");
  });

  it("handles single words", () => {
    expect(properCase("cyberpunk")).toBe("Cyberpunk");
    expect(properCase("NIGHT")).toBe("Night");
  });

  it("handles empty string", () => {
    expect(properCase("")).toBe("");
  });

  it("lowercases everything after the first character", () => {
    expect(properCase("mCDONALD")).toBe("Mcdonald");
  });
});

// ─── replaceIn ────────────────────────────────────────────────────────────────

describe("replaceIn", () => {
  it("replaces [VAR] with the given value", () => {
    expect(replaceIn("Hello [VAR]!", "World")).toBe("Hello World!");
    expect(replaceIn("Damage: [VAR]", "10")).toBe("Damage: 10");
  });

  it("replaces only the first occurrence of [VAR]", () => {
    expect(replaceIn("[VAR] [VAR]", "X")).toBe("X [VAR]");
  });

  it("returns the string unchanged when [VAR] is absent", () => {
    expect(replaceIn("No placeholder", "X")).toBe("No placeholder");
  });

  it("handles empty strings", () => {
    expect(replaceIn("", "X")).toBe("");
    expect(replaceIn("[VAR]", "")).toBe("");
  });
});

// ─── clamp ────────────────────────────────────────────────────────────────────

describe("clamp", () => {
  it("returns the value when within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it("clamps to min", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(-100, -10, 10)).toBe(-10);
  });

  it("clamps to max", () => {
    expect(clamp(15, 0, 10)).toBe(10);
    expect(clamp(1000, 0, 100)).toBe(100);
  });

  it("handles equal min and max (clamps to single value)", () => {
    expect(clamp(7, 5, 5)).toBe(5);
    expect(clamp(3, 5, 5)).toBe(5);
  });
});

// ─── deepLookup ───────────────────────────────────────────────────────────────

describe("deepLookup", () => {
  it("retrieves a top-level property", () => {
    expect(deepLookup({ a: 1 }, "a")).toBe(1);
  });

  it("retrieves a nested property", () => {
    expect(deepLookup({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
  });

  it("retrieves an intermediate object", () => {
    const inner = { b: 99 };
    const obj = { a: inner };
    expect(deepLookup(obj, "a")).toBe(inner);
  });

  it("returns undefined for a missing path", () => {
    expect(deepLookup({ a: 1 }, "b")).toBeUndefined();
  });
});

// ─── deepSet ──────────────────────────────────────────────────────────────────

describe("deepSet", () => {
  it("sets a top-level property", () => {
    const obj = {};
    deepSet(obj, "a", 42);
    expect(obj.a).toBe(42);
  });

  it("sets a nested property, creating intermediate objects", () => {
    const obj = {};
    deepSet(obj, "a.b.c", 99);
    expect(obj.a.b.c).toBe(99);
  });

  it("returns the original object", () => {
    const obj = { x: 1 };
    const result = deepSet(obj, "y", 2);
    expect(result).toBe(obj);
  });

  it("does not overwrite when overwrite=false and value exists", () => {
    const obj = { a: 1 };
    deepSet(obj, "a", 99, false);
    expect(obj.a).toBe(1);
  });

  it("overwrites by default when value exists", () => {
    const obj = { a: 1 };
    deepSet(obj, "a", 99);
    expect(obj.a).toBe(99);
  });

  it("sets alongside existing nested structure", () => {
    const obj = { a: { existing: true } };
    deepSet(obj, "a.b", "new");
    expect(obj.a.existing).toBe(true);
    expect(obj.a.b).toBe("new");
  });
});

// ─── cwHasType ────────────────────────────────────────────────────────────────

describe("cwHasType", () => {
  it("returns true when Types array includes the type", () => {
    const item = { system: { CyberWorkType: { Types: ["Skill", "Stat"] } } };
    expect(cwHasType(item, "Skill")).toBe(true);
    expect(cwHasType(item, "Stat")).toBe(true);
  });

  it("returns false when Types array does not include the type", () => {
    const item = { system: { CyberWorkType: { Types: ["Skill"] } } };
    expect(cwHasType(item, "Stat")).toBe(false);
  });

  it("falls back to Type property", () => {
    const item = { system: { CyberWorkType: { Type: "Skill", Types: [] } } };
    expect(cwHasType(item, "Skill")).toBe(true);
    expect(cwHasType(item, "Stat")).toBe(false);
  });

  it("accepts the CyberWorkType object directly", () => {
    const cwt = { Types: ["Boost"], Type: "Boost" };
    expect(cwHasType(cwt, "Boost")).toBe(true);
    expect(cwHasType(cwt, "Skill")).toBe(false);
  });

  it("accepts the system object directly", () => {
    const sys = { CyberWorkType: { Types: ["Weapon"] } };
    expect(cwHasType(sys, "Weapon")).toBe(true);
  });

  it("handles null/undefined gracefully", () => {
    expect(cwHasType(null, "Skill")).toBe(false);
    expect(cwHasType(undefined, "Skill")).toBe(false);
    expect(cwHasType({}, "Skill")).toBe(false);
  });
});

// ─── cwIsEnabled ──────────────────────────────────────────────────────────────

describe("cwIsEnabled", () => {
  it("returns true for Permanent mode (default)", () => {
    expect(cwIsEnabled({ system: { EffectMode: "Permanent" } })).toBe(true);
    expect(cwIsEnabled({ system: {} })).toBe(true);   // EffectMode absent → Permanent
  });

  it("returns true for Activatable mode when EffectActive is true", () => {
    expect(cwIsEnabled({ system: { EffectMode: "Activatable", EffectActive: true } })).toBe(true);
  });

  it("returns false for Activatable mode when EffectActive is false/absent", () => {
    expect(cwIsEnabled({ system: { EffectMode: "Activatable", EffectActive: false } })).toBe(false);
    expect(cwIsEnabled({ system: { EffectMode: "Activatable" } })).toBe(false);
  });

  it("accepts system object directly (without item wrapper)", () => {
    expect(cwIsEnabled({ EffectMode: "Activatable", EffectActive: true })).toBe(true);
    expect(cwIsEnabled({ EffectMode: "Activatable", EffectActive: false })).toBe(false);
  });
});

// ─── cwIsSkinweave ────────────────────────────────────────────────────────────

describe("cwIsSkinweave", () => {
  it("detects the SKINWEAVE subtype regardless of the item name", () => {
    // Thermaskin is SKINWEAVE-subtype with no "skinweave" in its name — the old name check missed it.
    expect(cwIsSkinweave({ name: "Thermaskin", system: { cyberwareSubtype: "SKINWEAVE" } })).toBe(true);
    // A localized/renamed Skinweave still resolves by subtype.
    expect(cwIsSkinweave({ name: "Подкожное плетение", system: { cyberwareSubtype: "SKINWEAVE" } })).toBe(true);
  });

  it("does not false-positive on a skinweave-like name without the subtype", () => {
    expect(cwIsSkinweave({ name: "Skinweave Knockoff", system: { cyberwareSubtype: "" } })).toBe(false);
    expect(cwIsSkinweave({ name: "Subdermal Armor", system: { cyberwareSubtype: "SUBDERMAL" } })).toBe(false);
  });

  it("accepts a system object directly and is safe on empty/nullish input", () => {
    expect(cwIsSkinweave({ cyberwareSubtype: "SKINWEAVE" })).toBe(true);
    expect(cwIsSkinweave({})).toBe(false);
    expect(cwIsSkinweave(null)).toBe(false);
    expect(cwIsSkinweave(undefined)).toBe(false);
  });
});

// ─── reliabilityThreshold ────────────────────────────────────────────────────

describe("reliabilityThreshold", () => {
  it("Very Reliable variants return 3", () => {
    expect(reliabilityThreshold("VeryReliable")).toBe(3);
    expect(reliabilityThreshold("very")).toBe(3);
    expect(reliabilityThreshold("VR")).toBe(3);
    expect(reliabilityThreshold("vr")).toBe(3);
  });

  it("Standard variants return 5", () => {
    expect(reliabilityThreshold("Standard")).toBe(5);
    expect(reliabilityThreshold("standard")).toBe(5);
    expect(reliabilityThreshold("ST")).toBe(5);
    expect(reliabilityThreshold("st")).toBe(5);
  });

  it("Unreliable variants return 8", () => {
    expect(reliabilityThreshold("Unreliable")).toBe(8);
    expect(reliabilityThreshold("unreliable")).toBe(8);
    expect(reliabilityThreshold("UR")).toBe(8);
    expect(reliabilityThreshold("ur")).toBe(8);
  });

  it("falls back to 5 for unknown keys", () => {
    expect(reliabilityThreshold("")).toBe(5);
    expect(reliabilityThreshold(null)).toBe(5);
    expect(reliabilityThreshold(undefined)).toBe(5);
    expect(reliabilityThreshold("unknown")).toBe(5);
  });
});

// ─── deleteFieldUpdate (pure-fallback path) ───────────────────────────────────
// In a Node test environment globalThis.foundry is undefined, so the function
// falls through to the last branch and returns the "-=key" deletion syntax.

describe("deleteFieldUpdate (no-foundry fallback)", () => {
  it("returns a -=key deletion update for a simple path", () => {
    const result = deleteFieldUpdate("system.someField");
    expect(result).toEqual({ "system.-=someField": null });
  });

  it("works for a single-segment path (no prefix)", () => {
    // When path has no dot, parts.join("") is "" → key becomes ".-=someField".
    // This is the actual fallback behaviour (Foundry's -=key operator still works).
    const result = deleteFieldUpdate("someField");
    expect(result).toEqual({ ".-=someField": null });
  });

  it("works for a three-segment path", () => {
    const result = deleteFieldUpdate("a.b.c");
    expect(result).toEqual({ "a.b.-=c": null });
  });
});
