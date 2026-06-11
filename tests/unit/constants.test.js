/**
 * Unit tests for module/constants.js — runtime constants kept independent from
 * Foundry's legacy system-template runtime. All exports tested:
 *   - DEFAULT_STATS          — the 9 CP2020 stats, each { base:5, tempMod:0 }
 *   - STAT_KEYS              — frozen key list mirroring DEFAULT_STATS
 *   - DEFAULT_HIT_LOCATIONS  — d10 hit-location ranges per body part
 *   - HIT_LOCATION_KEYS      — frozen key list mirroring DEFAULT_HIT_LOCATIONS
 *   - DEFAULT_SDP            — vehicle/armor SDP shape (sum/current/touched)
 *   - cloneSystemDefault     — deep clone (foundry.utils.deepClone fallback to JSON;
 *                              in Node there is no foundry global, so the JSON path runs)
 *
 * Skipped: nothing — no Foundry-dependent exports in this module.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_STATS,
  STAT_KEYS,
  DEFAULT_HIT_LOCATIONS,
  HIT_LOCATION_KEYS,
  DEFAULT_SDP,
  cloneSystemDefault,
} from "../../module/constants.js";

const STAT_NAMES = ["int", "ref", "tech", "cool", "attr", "luck", "ma", "bt", "emp"];
const LOCATION_NAMES = ["Head", "Torso", "lArm", "rArm", "lLeg", "rLeg"];

// ─── DEFAULT_STATS / STAT_KEYS ────────────────────────────────────────────────

describe("DEFAULT_STATS", () => {
  it("has exactly the 9 CP2020 stat keys", () => {
    expect(Object.keys(DEFAULT_STATS)).toEqual(STAT_NAMES);
  });

  it("every stat defaults to { base: 5, tempMod: 0 }", () => {
    for (const key of STAT_NAMES) {
      expect(DEFAULT_STATS[key]).toEqual({ base: 5, tempMod: 0 });
    }
  });
});

describe("STAT_KEYS", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(STAT_KEYS)).toBe(true);
  });

  it("equals the DEFAULT_STATS keys in order", () => {
    expect([...STAT_KEYS]).toEqual(Object.keys(DEFAULT_STATS));
  });
});

// ─── DEFAULT_HIT_LOCATIONS / HIT_LOCATION_KEYS ────────────────────────────────

describe("DEFAULT_HIT_LOCATIONS", () => {
  it("maps each body part to its d10 location range", () => {
    expect(DEFAULT_HIT_LOCATIONS).toEqual({
      Head: { location: [1] },
      Torso: { location: [2, 4] },
      lArm: { location: [6] },
      rArm: { location: [5] },
      lLeg: { location: [7, 8] },
      rLeg: { location: [9, 10] },
    });
  });
});

describe("HIT_LOCATION_KEYS", () => {
  it("is frozen", () => {
    expect(Object.isFrozen(HIT_LOCATION_KEYS)).toBe(true);
  });

  it("equals the DEFAULT_HIT_LOCATIONS keys in order", () => {
    expect([...HIT_LOCATION_KEYS]).toEqual(Object.keys(DEFAULT_HIT_LOCATIONS));
  });
});

// ─── DEFAULT_SDP ──────────────────────────────────────────────────────────────

describe("DEFAULT_SDP", () => {
  it("has sum / current / touched sections", () => {
    expect(Object.keys(DEFAULT_SDP)).toEqual(["sum", "current", "touched"]);
  });

  it("sum and current cover all 6 locations, all zero", () => {
    for (const section of ["sum", "current"]) {
      expect(Object.keys(DEFAULT_SDP[section])).toEqual(LOCATION_NAMES);
      for (const loc of LOCATION_NAMES) {
        expect(DEFAULT_SDP[section][loc]).toBe(0);
      }
    }
  });

  it("touched covers all 6 locations, all false", () => {
    expect(Object.keys(DEFAULT_SDP.touched)).toEqual(LOCATION_NAMES);
    for (const loc of LOCATION_NAMES) {
      expect(DEFAULT_SDP.touched[loc]).toBe(false);
    }
  });
});

// ─── cloneSystemDefault ───────────────────────────────────────────────────────

describe("cloneSystemDefault", () => {
  it("deep-clones DEFAULT_STATS to an equal but distinct structure", () => {
    const clone = cloneSystemDefault(DEFAULT_STATS);
    expect(clone).toEqual(DEFAULT_STATS);
    expect(clone).not.toBe(DEFAULT_STATS);
    expect(clone.int).not.toBe(DEFAULT_STATS.int);
  });

  it("mutating a clone's nested object does not touch the original", () => {
    const clone = cloneSystemDefault(DEFAULT_STATS);
    clone.int.base = 99;
    expect(DEFAULT_STATS.int.base).toBe(5);
  });

  it("clones nested arrays/objects independently", () => {
    const input = { list: [1, 2, { deep: true }], nested: { arr: ["a"] } };
    const clone = cloneSystemDefault(input);
    expect(clone).toEqual(input);
    expect(clone.list).not.toBe(input.list);
    expect(clone.list[2]).not.toBe(input.list[2]);
    expect(clone.nested.arr).not.toBe(input.nested.arr);
    clone.list[2].deep = false;
    clone.nested.arr.push("b");
    expect(input.list[2].deep).toBe(true);
    expect(input.nested.arr).toEqual(["a"]);
  });
});
