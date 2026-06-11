/**
 * Unit tests for pure exported functions in module/dice.js.
 *
 * Skipped (not pure):
 *   - makeD10Roll     — calls `new Roll(...)` (Foundry global)
 *   - classifyRollDice — needs a Roll object with `.dice`/`.results` arrays
 *   - Multiroll class  — builds Roll objects internally
 */

import { describe, it, expect } from "vitest";
import {
  BaseDie,
  DefaultRollTemplate,
  formulaHasDice,
} from "../../module/dice.js";

// ─── BaseDie / DefaultRollTemplate constants ──────────────────────────────────

describe("BaseDie", () => {
  it("is the exploding d10 formula", () => {
    expect(BaseDie).toBe("1d10x10");
  });
});

describe("DefaultRollTemplate", () => {
  it("is the expected HBS template path", () => {
    expect(DefaultRollTemplate).toBe(
      "systems/cyberpunk2020/templates/chat/default-roll.hbs"
    );
  });
});

// ─── formulaHasDice ───────────────────────────────────────────────────────────

describe("formulaHasDice", () => {
  it("returns a truthy value for standard dice expressions", () => {
    expect(formulaHasDice("1d10")).toBeTruthy();
    expect(formulaHasDice("2d6")).toBeTruthy();
    expect(formulaHasDice("1d10x10")).toBeTruthy();
    expect(formulaHasDice("3d8 + 5")).toBeTruthy();
    expect(formulaHasDice("d6")).toBeTruthy();
  });

  it("returns a falsy value for numeric-only formulas", () => {
    expect(formulaHasDice("10")).toBeFalsy();
    expect(formulaHasDice("0")).toBeFalsy();
    expect(formulaHasDice("3 + 5")).toBeFalsy();
  });

  it("returns falsy for empty/blank strings", () => {
    expect(formulaHasDice("")).toBeFalsy();
    expect(formulaHasDice("   ")).toBeFalsy();
  });

  it("handles uppercase D in dice expressions", () => {
    expect(formulaHasDice("1D10")).toBeTruthy();
    expect(formulaHasDice("2D6")).toBeTruthy();
  });

  it("matches BaseDie formula", () => {
    // The CP2020 exploding-d10 formula definitely has dice
    expect(formulaHasDice(BaseDie)).toBeTruthy();
  });
});
