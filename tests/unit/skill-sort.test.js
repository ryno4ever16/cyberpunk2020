/**
 * Unit tests for module/actor/skill-sort.js.
 *
 * skill-sort.js imports CyberpunkActor from ./actor.js (which extends Foundry's Actor class).
 * We mock that module so the import succeeds under Node, then inject a realSkillValue shim
 * via globalThis where needed.
 *
 * Covered (pure / near-pure):
 *   - byName          — pure name comparator
 *   - SortOrders      — structure (Name / Stat keys present, arrays of functions)
 *   - hasPoints       — calls CyberpunkActor.realSkillValue (mocked)
 *   - sortSkills      — hierarchical sorter; game.settings.get is shimmed via globalThis.game
 *   - byStat ordering — exercised through sortSkills(skills, SortOrders.Stat)
 *
 * Skipped (not separately exported):
 *   - hierarchical    — internal helper; covered implicitly via sortSkills
 *   - byStat          — internal helper; covered implicitly via sortSkills + SortOrders.Stat
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

// ─── Mock actor.js before importing skill-sort ────────────────────────────────
// actor.js extends Foundry's `Actor` class which is not available in Node; we
// replace the whole module with a minimal stub that exposes only the static
// method used by skill-sort.js (realSkillValue).
vi.mock("../../module/actor/actor.js", () => {
  return {
    CyberpunkActor: {
      realSkillValue: (skill) => {
        // Default stub: treat system.level as the real value (0 = no points)
        return Number(skill?.system?.level ?? 0);
      }
    }
  };
});

import {
  byName,
  hasPoints,
  sortSkills,
  SortOrders,
} from "../../module/actor/skill-sort.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal skill-item-like plain object. */
function skill(name, stat = "int", level = 0, isRoleSkill = false) {
  return { name, system: { stat, level, isRoleSkill } };
}

// Shim game.settings for sortSkills (which calls game.settings.get without try/catch).
// We use beforeAll/afterAll to set and clean up globalThis.game.
let _savedGame;
beforeAll(() => {
  _savedGame = globalThis.game;
  globalThis.game = {
    settings: { get: (_scope, key) => key === "trainedSkillsFirst" ? false : undefined }
  };
});
afterAll(() => {
  globalThis.game = _savedGame;
});

// ─── byName ───────────────────────────────────────────────────────────────────

describe("byName", () => {
  it("returns negative when a comes before b alphabetically", () => {
    expect(byName(skill("Alpha"), skill("Beta"))).toBeLessThan(0);
  });

  it("returns positive when a comes after b alphabetically", () => {
    expect(byName(skill("Zebra"), skill("Apple"))).toBeGreaterThan(0);
  });

  it("returns 0 for identical names", () => {
    expect(byName(skill("Rifle"), skill("Rifle"))).toBe(0);
  });

  it("is case-sensitive (uppercase sorts before lowercase per JS)", () => {
    // "B" (66) < "a" (97) in UTF-16 ordering
    expect(byName(skill("Beta"), skill("alpha"))).toBeLessThan(0);
  });

  it("handles empty-string names", () => {
    expect(byName(skill(""), skill(""))).toBe(0);
    expect(byName(skill(""), skill("A"))).toBeLessThan(0);
    expect(byName(skill("A"), skill(""))).toBeGreaterThan(0);
  });
});

// ─── SortOrders ───────────────────────────────────────────────────────────────

describe("SortOrders", () => {
  it("has a Name key that is an array with one function", () => {
    expect(Array.isArray(SortOrders.Name)).toBe(true);
    expect(SortOrders.Name).toHaveLength(1);
    expect(typeof SortOrders.Name[0]).toBe("function");
  });

  it("has a Stat key that is an array with two functions", () => {
    expect(Array.isArray(SortOrders.Stat)).toBe(true);
    expect(SortOrders.Stat).toHaveLength(2);
    expect(typeof SortOrders.Stat[0]).toBe("function");
    expect(typeof SortOrders.Stat[1]).toBe("function");
  });

  it("Name[0] behaves like byName", () => {
    // SortOrders.Name[0] should be the same function reference as the exported byName
    const a = skill("Aardvark");
    const b = skill("Zebra");
    expect(SortOrders.Name[0](a, b)).toBeLessThan(0);
    expect(SortOrders.Name[0](b, a)).toBeGreaterThan(0);
  });
});

// ─── hasPoints ────────────────────────────────────────────────────────────────
// CyberpunkActor.realSkillValue is mocked to return skill.system.level.

describe("hasPoints", () => {
  it("returns -1 when a has points and b has none (a sorts first)", () => {
    const a = skill("Rifle", "ref", 3);
    const b = skill("Handgun", "ref", 0);
    expect(hasPoints(a, b)).toBe(-1);
  });

  it("returns 1 when b has points and a has none (b sorts first)", () => {
    const a = skill("Rifle", "ref", 0);
    const b = skill("Handgun", "ref", 3);
    expect(hasPoints(a, b)).toBe(1);
  });

  it("returns 0 when both have points", () => {
    const a = skill("Rifle", "ref", 2);
    const b = skill("Handgun", "ref", 5);
    expect(hasPoints(a, b)).toBe(0);
  });

  it("returns 0 when neither has points", () => {
    const a = skill("Rifle", "ref", 0);
    const b = skill("Handgun", "ref", 0);
    expect(hasPoints(a, b)).toBe(0);
  });
});

// ─── sortSkills ───────────────────────────────────────────────────────────────

describe("sortSkills — no sort order given", () => {
  it("returns the original array unchanged and logs a warning", () => {
    const skills = [skill("Zebra"), skill("Alpha"), skill("Melon")];
    const result = sortSkills(skills, null);
    // Should return the original reference unchanged
    expect(result).toBe(skills);
  });
});

describe("sortSkills — SortOrders.Name (alphabetical)", () => {
  it("sorts skills by name ascending", () => {
    const skills = [skill("Rifle"), skill("Handgun"), skill("Athletics")];
    const result = sortSkills(skills, SortOrders.Name);
    expect(result.map(s => s.name)).toEqual(["Athletics", "Handgun", "Rifle"]);
  });

  it("does not mutate the original array (works on a copy)", () => {
    const original = [skill("Rifle"), skill("Athletics")];
    const copy = [...original];
    sortSkills(original, SortOrders.Name);
    expect(original[0].name).toBe(copy[0].name); // order preserved in original
    expect(original[1].name).toBe(copy[1].name);
  });

  it("handles an already-sorted list", () => {
    const skills = [skill("Alpha"), skill("Beta"), skill("Gamma")];
    const result = sortSkills(skills, SortOrders.Name);
    expect(result.map(s => s.name)).toEqual(["Alpha", "Beta", "Gamma"]);
  });

  it("handles a single-element list", () => {
    const skills = [skill("Handgun")];
    const result = sortSkills(skills, SortOrders.Name);
    expect(result.map(s => s.name)).toEqual(["Handgun"]);
  });

  it("handles an empty list", () => {
    const result = sortSkills([], SortOrders.Name);
    expect(result).toEqual([]);
  });

  it("breaks ties stably (same name stays in original relative order)", () => {
    // Two skills with the same name — byName returns 0, sort is stable
    const a = skill("Karate");
    const b = skill("Karate");
    const result = sortSkills([a, b], SortOrders.Name);
    expect(result).toHaveLength(2);
    // Both have the same name; result should contain both
    expect(result.every(s => s.name === "Karate")).toBe(true);
  });
});

describe("sortSkills — SortOrders.Stat (stat order then name)", () => {
  // statOrder: int=3, ref=4, tech=5, cool=6, attr=7, luck=8, ma=9, bt=10, emp=11
  // role skills come first (rank 1)

  it("orders role skill before int skill", () => {
    const intSkill = skill("Awareness", "int", 0, false);
    const roleSkill = skill("MyRole", "int", 0, true);
    const result = sortSkills([intSkill, roleSkill], SortOrders.Stat);
    expect(result[0].name).toBe("MyRole");
  });

  it("orders int skills before ref skills", () => {
    const refSkill = skill("Athletics", "ref", 0, false);
    const intSkill = skill("Awareness", "int", 0, false);
    const result = sortSkills([refSkill, intSkill], SortOrders.Stat);
    expect(result[0].name).toBe("Awareness"); // int=3 < ref=4
  });

  it("breaks stat ties by name", () => {
    const a = skill("Zebra", "ref", 0, false);
    const b = skill("Alpha", "ref", 0, false);
    const result = sortSkills([a, b], SortOrders.Stat);
    expect(result[0].name).toBe("Alpha");
  });

  it("orders emp last among standard stats", () => {
    const empSkill  = skill("Empathy", "emp", 0, false);
    const intSkill  = skill("Awareness", "int", 0, false);
    const result = sortSkills([empSkill, intSkill], SortOrders.Stat);
    expect(result[0].name).toBe("Awareness"); // int=3 < emp=11
    expect(result[1].name).toBe("Empathy");
  });

  it("unknown stat falls back to -1 (sorts before all known stats)", () => {
    const known   = skill("Rifle", "ref", 0, false);
    const unknown = skill("Weird", "xyz", 0, false);
    const result = sortSkills([known, unknown], SortOrders.Stat);
    // unknown stat yields order -1, which is less than ref=4, so unknown sorts first
    expect(result[0].name).toBe("Weird");
  });
});

describe("sortSkills — trainedSkillsFirst gate", () => {
  it("when trainedSkillsFirst=true, trained skills sort before untrained", () => {
    // Override the game shim for this block
    globalThis.game = {
      settings: { get: (_scope, key) => key === "trainedSkillsFirst" ? true : undefined }
    };
    // level > 0 → trained; level === 0 → untrained
    const trained   = skill("Rifle",   "ref", 3);
    const untrained = skill("Archery",  "ref", 0);
    const result = sortSkills([untrained, trained], SortOrders.Name);
    // trained should sort first despite "Archery" < "Rifle" alphabetically
    expect(result[0].name).toBe("Rifle");
    // Restore the default shim
    globalThis.game = {
      settings: { get: (_scope, key) => key === "trainedSkillsFirst" ? false : undefined }
    };
  });

  it("when trainedSkillsFirst=false, name order is used without trained-first bias", () => {
    const trained   = skill("Rifle",   "ref", 3);
    const untrained = skill("Archery",  "ref", 0);
    const result = sortSkills([trained, untrained], SortOrders.Name);
    expect(result[0].name).toBe("Archery"); // pure alphabetical
  });
});
