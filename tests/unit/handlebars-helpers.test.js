/**
 * Unit tests for the pure Handlebars helpers in module/handlebars-helpers.js.
 *
 * The module exports only registerHandlebarsHelpers(), which registers every
 * helper via the global `Handlebars.registerHelper(name, fn)`. The module's
 * top level does not touch Handlebars, so we stub the global, call the
 * register function once, and capture each helper into a plain map.
 *
 * Tested helpers (pure, no Foundry deps at call time):
 *   - and, equals, compare, math, inc
 *   - cwHasType, ammoHasEffect, hasProperty
 *   - concat, skillRef, hasElements, isObject
 *   - template, CPTemplate, displayRange, localizeStat, deepLookup
 *   - block helpers: repeat, selectOption, damageBoxes (via fake options.fn)
 *
 * Skipped (localization-dependent — they call game.i18n at invocation time):
 *   - CPLocal, CPLocalParam            — game.i18n.has / localize / format
 *   - shortCPLocal (shortLocalize)     — game.i18n lookups
 *   - armorSummary                     — maps keys through shortLocalize
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { registerHandlebarsHelpers } from "../../module/handlebars-helpers.js";

const helpers = {};

beforeAll(() => {
  globalThis.Handlebars = {
    registerHelper: (name, fn) => { helpers[name] = fn; },
  };
  registerHandlebarsHelpers();
});

afterAll(() => {
  delete globalThis.Handlebars;
});

// ─── and / equals ─────────────────────────────────────────────────────────────

describe("and", () => {
  it("returns x && y", () => {
    expect(helpers["and"](true, true)).toBe(true);
    expect(helpers["and"](true, false)).toBe(false);
  });

  it("short-circuits on falsy x (returns 0, not false)", () => {
    expect(helpers["and"](0, 5)).toBe(0);
  });
});

describe("equals", () => {
  it("uses strict equality", () => {
    expect(helpers["equals"](2, 2)).toBe(true);
    expect(helpers["equals"](2, "2")).toBe(false);
  });
});

// ─── compare ──────────────────────────────────────────────────────────────────

describe("compare", () => {
  it("supports relational operators", () => {
    expect(helpers["compare"](2, ">", 1)).toBe(true);
    expect(helpers["compare"](2, "<=", 2)).toBe(true);
    expect(helpers["compare"](2, ">=", 3)).toBe(false);
    expect(helpers["compare"](1, "<", 2)).toBe(true);
  });

  it("supports equality operators (strict and loose)", () => {
    expect(helpers["compare"]("a", "===", "a")).toBe(true);
    expect(helpers["compare"](2, "==", "2")).toBe(true);
    expect(helpers["compare"](1, "!==", 2)).toBe(true);
    expect(helpers["compare"](1, "!=", "1")).toBe(false);
  });

  it("supports logical operators (returning the operand, JS-style)", () => {
    expect(helpers["compare"](true, "&&", false)).toBe(false);
    expect(helpers["compare"](0, "||", 5)).toBe(5);
  });

  it("returns undefined for an unknown operator", () => {
    expect(helpers["compare"](1, "%%", 2)).toBeUndefined();
  });
});

// ─── math / inc ───────────────────────────────────────────────────────────────

describe("math", () => {
  it("supports + - * /", () => {
    expect(helpers["math"](2, "+", 3)).toBe(5);
    expect(helpers["math"](5, "-", 1)).toBe(4);
    expect(helpers["math"](4, "*", 2)).toBe(8);
    expect(helpers["math"](6, "/", 2)).toBe(3);
  });

  it("returns undefined for an unknown operator", () => {
    expect(helpers["math"](1, "%", 2)).toBeUndefined();
  });
});

describe("inc", () => {
  it("returns Number(v) + 1", () => {
    expect(helpers["inc"](4)).toBe(5);
    expect(helpers["inc"]("4")).toBe(5);
  });
});

// ─── cwHasType / ammoHasEffect / hasProperty ─────────────────────────────────

describe("cwHasType", () => {
  it("matches when type is in the Types array", () => {
    expect(helpers["cwHasType"]({ Types: ["Armor", "X"] }, "Armor")).toBe(true);
  });

  it("falls back to the legacy singular Type field", () => {
    expect(helpers["cwHasType"]({ Type: "Armor" }, "Armor")).toBe(true);
  });

  it("returns false when neither matches", () => {
    expect(helpers["cwHasType"]({ Types: ["X"] }, "Armor")).toBe(false);
    expect(helpers["cwHasType"]({}, "Armor")).toBe(false);
  });

  it("is null-safe", () => {
    expect(helpers["cwHasType"](null, "Armor")).toBe(false);
  });
});

describe("ammoHasEffect", () => {
  it("matches within an effectTypes array", () => {
    expect(helpers["ammoHasEffect"]({ effectTypes: ["AP", "HP"] }, "AP")).toBe(true);
  });

  it("wraps a scalar effectTypes into a list", () => {
    expect(helpers["ammoHasEffect"]({ effectTypes: "AP" }, "AP")).toBe(true);
  });

  it("defaults missing effectTypes to [\"None\"]", () => {
    expect(helpers["ammoHasEffect"]({}, "None")).toBe(true);
    expect(helpers["ammoHasEffect"]({}, "AP")).toBe(false);
  });
});

describe("hasProperty", () => {
  it("checks the property is not undefined", () => {
    expect(helpers["hasProperty"]({ a: 1 }, "a")).toBe(true);
    expect(helpers["hasProperty"]({ a: 1 }, "b")).toBe(false);
  });
});

// ─── concat / skillRef / hasElements / isObject ──────────────────────────────

describe("concat", () => {
  it("concatenates all args except the trailing Handlebars options object", () => {
    expect(helpers["concat"]("a", "b", "c", {})).toBe("abc");
    expect(helpers["concat"]("x", "y", {})).toBe("xy");
  });
});

describe("skillRef", () => {
  it("prefixes the last dotted segment with CYBERPUNK.Skill", () => {
    expect(helpers["skillRef"]("Handgun")).toBe("CYBERPUNK.SkillHandgun");
    expect(helpers["skillRef"]("a.b.Rifle")).toBe("CYBERPUNK.SkillRifle");
  });
});

describe("hasElements", () => {
  it("is true only for non-empty arrays", () => {
    expect(helpers["hasElements"]([1])).toBe(true);
    expect(helpers["hasElements"]([])).toBe(false);
  });
});

describe("isObject", () => {
  it("uses instanceof Object semantics", () => {
    expect(helpers["isObject"]({})).toBe(true);
    expect(helpers["isObject"]([])).toBe(true);   // arrays are Objects
    expect(helpers["isObject"]("x")).toBe(false); // primitive string is not
    expect(helpers["isObject"](null)).toBe(false);
    expect(helpers["isObject"](5)).toBe(false);
  });
});

// ─── template paths ──────────────────────────────────────────────────────────

describe("template", () => {
  it("builds a full .hbs template path", () => {
    expect(helpers["template"]("foo")).toBe("systems/cyberpunk2020/templates/foo.hbs");
  });
});

describe("CPTemplate", () => {
  it("prefixes the template root without appending an extension", () => {
    expect(helpers["CPTemplate"]("a/b.hbs")).toBe("systems/cyberpunk2020/templates/a/b.hbs");
  });
});

// ─── displayRange / localizeStat / deepLookup ────────────────────────────────

describe("displayRange", () => {
  it("joins a two-element range with a dash", () => {
    expect(helpers["displayRange"]([2, 4])).toBe("2-4");
  });

  it("stringifies a single-element range", () => {
    expect(helpers["displayRange"]([1])).toBe("1");
  });

  it("returns empty string for an empty range", () => {
    expect(helpers["displayRange"]([])).toBe("");
  });
});

describe("localizeStat", () => {
  it("returns CYBERPUNK. + properCase(stat)", () => {
    expect(helpers["localizeStat"]("ref")).toBe("CYBERPUNK.Ref");
  });
});

describe("deepLookup", () => {
  it("resolves a dotted path through nested objects", () => {
    expect(helpers["deepLookup"]({ a: { b: 2 } }, "a.b")).toBe(2);
  });
});

// ─── block helpers (fake options.fn) ─────────────────────────────────────────

describe("repeat (block helper)", () => {
  it("invokes options.fn with i = 1..amount and concatenates", () => {
    expect(helpers["repeat"](3, { fn: (ctx) => `[${ctx.i}]` })).toBe("[1][2][3]");
  });

  it("returns empty string for amount 0", () => {
    expect(helpers["repeat"](0, { fn: () => "X" })).toBe("");
  });
});

describe("selectOption (block helper)", () => {
  it("translates a simple string choice into a full option context", () => {
    expect(helpers["selectOption"]("one", { fn: (c) => c })).toEqual({
      value: "one",
      localKey: "one",
      localData: undefined,
      text: undefined,
    });
  });

  it("passes through a complex choice, defaulting localKey to value when absent", () => {
    const choice = { value: "close", localKey: "RangeClose", localData: { range: 50 } };
    expect(helpers["selectOption"](choice, { fn: (c) => c })).toEqual({
      value: "close",
      localKey: "RangeClose",
      localData: { range: 50 },
      text: undefined,
    });
  });
});

describe("damageBoxes (block helper)", () => {
  it("renders 4 boxes per wound state and returns a string", () => {
    const contexts = [];
    const out = helpers["damageBoxes"](0, 2, {
      fn: (ctx) => { contexts.push(ctx); return JSON.stringify(ctx); },
    });
    expect(typeof out).toBe("string");
    expect(contexts).toHaveLength(4); // one fn call per box in the wound state
    // damage=2 on wound state 0: boxes 1-2 filled, box 2 is the checked one
    expect(contexts[0].classes).toContain("filled");
    expect(contexts[1].isChecked).toBe(true);
    expect(contexts[2].classes).toContain("unfilled");
  });
});
