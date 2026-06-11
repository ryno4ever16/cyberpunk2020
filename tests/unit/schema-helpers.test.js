/**
 * Unit tests for the pure helpers in module/data/schema-helpers.js.
 *
 * Covered (Foundry-free under node): clone, mergeDefaults, normalizeNumber,
 * normalizeBoolean, normalizeArray.
 *
 * NOT covered (need foundry.data.fields, absent in node): the field factories
 * stringField / htmlField / numberField / booleanField / objectField / arrayField /
 * filePathField, and fields() itself.
 *
 * Note on the Foundry-fallback paths: under node `foundry` is undefined, so `clone`
 * uses its JSON deep-clone fallback and `mergeDefaults` uses its shallow `{...defaults,
 * ...source}` spread fallback (the recursive foundry.utils.mergeObject path only runs
 * with Foundry present). These tests assert the node-fallback behaviour, which is what
 * runs in this environment.
 */

import { describe, it, expect } from "vitest";
import {
  clone,
  mergeDefaults,
  normalizeNumber,
  normalizeBoolean,
  normalizeArray,
} from "../../module/data/schema-helpers.js";

// ─── clone ─────────────────────────────────────────────────────────────────────

describe("clone", () => {
  it("returns a deep copy (new top-level reference)", () => {
    const src = { a: 1, b: { c: 2 } };
    const out = clone(src);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
  });

  it("deep-copies nested objects (mutating the copy doesn't touch the source)", () => {
    const src = { nested: { x: 1 }, arr: [1, 2] };
    const out = clone(src);
    out.nested.x = 99;
    out.arr.push(3);
    expect(src.nested.x).toBe(1);
    expect(src.arr).toEqual([1, 2]);
  });

  it("handles arrays", () => {
    const src = [{ a: 1 }, { b: 2 }];
    const out = clone(src);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
    expect(out[0]).not.toBe(src[0]);
  });

  it("handles primitives", () => {
    expect(clone(5)).toBe(5);
    expect(clone("hi")).toBe("hi");
    expect(clone(true)).toBe(true);
    expect(clone(null)).toBe(null);
  });
});

// ─── mergeDefaults ───────────────────────────────────────────────────────────────

describe("mergeDefaults (node fallback: shallow {...defaults, ...source})", () => {
  it("fills missing keys from defaults", () => {
    expect(mergeDefaults({ a: 1 }, { a: 0, b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it("source values override defaults", () => {
    expect(mergeDefaults({ a: 5 }, { a: 1, b: 2 })).toEqual({ a: 5, b: 2 });
  });

  it("null/undefined source → just the defaults", () => {
    expect(mergeDefaults(null, { a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
    expect(mergeDefaults(undefined, { a: 1 })).toEqual({ a: 1 });
  });

  it("does not mutate the defaults object", () => {
    const defaults = { a: 1, b: 2 };
    mergeDefaults({ a: 9 }, defaults);
    expect(defaults).toEqual({ a: 1, b: 2 });
  });

  it("empty source + empty defaults → empty object", () => {
    expect(mergeDefaults({}, {})).toEqual({});
  });

  it("keeps source-only keys not present in defaults", () => {
    expect(mergeDefaults({ extra: true }, { a: 1 })).toEqual({ a: 1, extra: true });
  });
});

// ─── normalizeNumber ─────────────────────────────────────────────────────────────

describe("normalizeNumber", () => {
  it("passes through finite numbers", () => {
    expect(normalizeNumber(5)).toBe(5);
    expect(normalizeNumber(0)).toBe(0);
    expect(normalizeNumber(-3.5)).toBe(-3.5);
  });

  it("coerces numeric strings", () => {
    expect(normalizeNumber("7")).toBe(7);
    expect(normalizeNumber("-2.5")).toBe(-2.5);
  });

  it("returns the fallback for non-numeric input", () => {
    expect(normalizeNumber("abc")).toBe(0);
    expect(normalizeNumber(null)).toBe(0);
    expect(normalizeNumber(undefined)).toBe(0);
    expect(normalizeNumber(NaN)).toBe(0);
  });

  it("respects a custom fallback", () => {
    expect(normalizeNumber("x", 10)).toBe(10);
    expect(normalizeNumber(undefined, -1)).toBe(-1);
  });

  it("empty string coerces to 0 (Number('') === 0)", () => {
    expect(normalizeNumber("")).toBe(0);
  });

  it("Infinity is not finite → fallback", () => {
    expect(normalizeNumber(Infinity, 42)).toBe(42);
  });
});

// ─── normalizeBoolean ────────────────────────────────────────────────────────────

describe("normalizeBoolean", () => {
  it("passes through real booleans", () => {
    expect(normalizeBoolean(true)).toBe(true);
    expect(normalizeBoolean(false)).toBe(false);
  });

  it('parses the strings "true" / "false"', () => {
    expect(normalizeBoolean("true")).toBe(true);
    expect(normalizeBoolean("false")).toBe(false);
  });

  it("returns the fallback for anything else", () => {
    expect(normalizeBoolean(null)).toBe(false);
    expect(normalizeBoolean(undefined)).toBe(false);
    expect(normalizeBoolean(1)).toBe(false);
    expect(normalizeBoolean("yes")).toBe(false);
  });

  it("respects a custom fallback", () => {
    expect(normalizeBoolean("maybe", true)).toBe(true);
    expect(normalizeBoolean(undefined, true)).toBe(true);
  });
});

// ─── normalizeArray ──────────────────────────────────────────────────────────────

describe("normalizeArray", () => {
  it("passes through arrays unchanged (same reference)", () => {
    const arr = [1, 2, 3];
    expect(normalizeArray(arr)).toBe(arr);
  });

  it("wraps a non-array scalar in a single-element array", () => {
    expect(normalizeArray("x")).toEqual(["x"]);
    expect(normalizeArray(5)).toEqual([5]);
    expect(normalizeArray(true)).toEqual([true]);
  });

  it("null / undefined / empty-string → a clone of the fallback", () => {
    expect(normalizeArray(null)).toEqual([]);
    expect(normalizeArray(undefined)).toEqual([]);
    expect(normalizeArray("")).toEqual([]);
  });

  it("returns a CLONE of the fallback (not the same reference)", () => {
    const fb = [1, 2];
    const out = normalizeArray(null, fb);
    expect(out).toEqual([1, 2]);
    expect(out).not.toBe(fb);
  });

  it("respects a custom fallback for empty input", () => {
    expect(normalizeArray(undefined, ["d"])).toEqual(["d"]);
  });

  it("an object (non-array) is wrapped, not treated as empty", () => {
    expect(normalizeArray({ a: 1 })).toEqual([{ a: 1 }]);
  });
});
