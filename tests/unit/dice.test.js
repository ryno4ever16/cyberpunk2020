/**
 * Unit tests for pure exported functions in module/dice.js.
 *
 * Skipped (not pure):
 *   - makeD10Roll     — calls `new Roll(...)` (Foundry global)
 *   - Multiroll class  — builds Roll objects internally
 *
 * classifyRollDice is pure given a roll-shaped argument: it only reads each die's
 * constructor.name / expression / total / faces / flavor / results[] and calls
 * d.getResultLabel(r). We exercise it with a minimal fake `Die` (below) — no Foundry.
 */

import { describe, it, expect } from "vitest";
import {
  BaseDie,
  DefaultRollTemplate,
  formulaHasDice,
  classifyRollDice,
} from "../../module/dice.js";

// Minimal stand-in for a Foundry DiceTerm: constructor.name drives the CSS class,
// and getResultLabel just echoes the face value (enough for classifyRollDice).
class Die {
  constructor(props) { Object.assign(this, props); }
  getResultLabel(r) { return String(r.result); }
}
const fakeRoll = (dice) => ({ dice });
const die = (props) => new Die({ expression: "1d10", total: 0, faces: 10, flavor: "", results: [], ...props });

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

// ─── classifyRollDice ─────────────────────────────────────────────────────────

describe("classifyRollDice", () => {
  it("maps the roll's dice to per-die display rows", () => {
    const roll = fakeRoll([
      die({ expression: "1d10", total: 8, faces: 10, flavor: "atk", results: [{ result: 8 }] }),
    ]);
    const parts = classifyRollDice(roll);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ formula: "1d10", total: 8, faces: 10, flavor: "atk" });
    expect(parts[0].subrolls).toHaveLength(1);
    expect(parts[0].subrolls[0].result).toBe("8");
  });

  it("puts the lowercased die-class name and dN into every subroll's classes", () => {
    const parts = classifyRollDice(fakeRoll([die({ results: [{ result: 5 }] })]));
    const classes = parts[0].subrolls[0].classes.split(" ");
    expect(classes).toContain("die"); // Die.constructor.name → "die"
    expect(classes).toContain("d10");
  });

  it("tags a natural max and a natural min when there is no success/failure flag", () => {
    const maxRow = classifyRollDice(fakeRoll([die({ results: [{ result: 10 }] })]))[0].subrolls[0];
    const minRow = classifyRollDice(fakeRoll([die({ results: [{ result: 1 }] })]))[0].subrolls[0];
    expect(maxRow.classes.split(" ")).toContain("max");
    expect(minRow.classes.split(" ")).toContain("min");
  });

  it("suppresses min/max when the result carries a success or failure flag", () => {
    const success = classifyRollDice(fakeRoll([die({ results: [{ result: 10, success: true }] })]))[0].subrolls[0];
    expect(success.classes.split(" ")).toContain("success");
    expect(success.classes.split(" ")).not.toContain("max");

    const failure = classifyRollDice(fakeRoll([die({ results: [{ result: 1, failure: true }] })]))[0].subrolls[0];
    expect(failure.classes.split(" ")).toContain("failure");
    expect(failure.classes.split(" ")).not.toContain("min");
  });

  it("includes exploded/rerolled/discarded flags (and exploded co-exists with max)", () => {
    const row = classifyRollDice(fakeRoll([
      die({ results: [{ result: 10, exploded: true, rerolled: true, discarded: true }] }),
    ]))[0].subrolls[0];
    const classes = row.classes.split(" ");
    expect(classes).toEqual(expect.arrayContaining(["exploded", "rerolled", "discarded", "max"]));
  });

  it("emits one subroll per result and handles multiple dice", () => {
    const parts = classifyRollDice(fakeRoll([
      die({ expression: "2d6", faces: 6, results: [{ result: 6 }, { result: 1 }] }),
      die({ expression: "1d10", faces: 10, results: [{ result: 4 }] }),
    ]));
    expect(parts).toHaveLength(2);
    expect(parts[0].subrolls).toHaveLength(2);
    expect(parts[0].subrolls[0].classes.split(" ")).toContain("max"); // 6 on a d6
    expect(parts[0].subrolls[1].classes.split(" ")).toContain("min"); // 1 on a d6
    expect(parts[1].subrolls).toHaveLength(1);
  });
});
