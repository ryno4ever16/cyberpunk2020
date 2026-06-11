/**
 * Unit tests for pure exported functions in module/shop/purchase.js.
 *
 * Tested (fully pure, no Foundry deps):
 *   - FASHION_STYLES  — the fashion style multiplier table (key/label/mult)
 *   - styleMultOf     — style key → price multiplier (unknown → 1)
 *   - styleLabelOf    — style key → display label (unknown → "")
 *   - priceFor        — catalog cost × style multiplier, rounded, clamped ≥ 0
 *
 * Skipped (async Foundry):
 *   - buyItem — actor.update / actor.createEmbeddedDocuments / ui.notifications /
 *               canShop() (game.settings) / ChatMessage.create
 */

import { describe, it, expect } from "vitest";
import {
  FASHION_STYLES,
  styleMultOf,
  styleLabelOf,
  priceFor,
} from "../../module/shop/purchase.js";

// ─── FASHION_STYLES ───────────────────────────────────────────────────────────

describe("FASHION_STYLES", () => {
  it("contains the five Core fashion styles with the book multipliers", () => {
    expect(FASHION_STYLES).toEqual([
      { key: "generic",     label: "Generic",      mult: 1 },
      { key: "leisure",     label: "Leisure",      mult: 2 },
      { key: "urbanflash",  label: "Urban Flash",  mult: 2 },
      { key: "business",    label: "Businesswear", mult: 3 },
      { key: "highfashion", label: "High Fashion", mult: 4 },
    ]);
  });

  it("has unique keys", () => {
    const keys = FASHION_STYLES.map(s => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ─── styleMultOf ──────────────────────────────────────────────────────────────

describe("styleMultOf", () => {
  it("returns the multiplier for each known style key", () => {
    expect(styleMultOf("generic")).toBe(1);
    expect(styleMultOf("leisure")).toBe(2);
    expect(styleMultOf("urbanflash")).toBe(2);
    expect(styleMultOf("business")).toBe(3);
    expect(styleMultOf("highfashion")).toBe(4);
  });

  it("unknown key falls back to ×1 (Generic)", () => {
    expect(styleMultOf("couture")).toBe(1);
  });

  it("empty / undefined / null key falls back to ×1", () => {
    expect(styleMultOf("")).toBe(1);
    expect(styleMultOf(undefined)).toBe(1);
    expect(styleMultOf(null)).toBe(1);
  });
});

// ─── styleLabelOf ─────────────────────────────────────────────────────────────

describe("styleLabelOf", () => {
  it("returns the display label for each known style key", () => {
    expect(styleLabelOf("generic")).toBe("Generic");
    expect(styleLabelOf("leisure")).toBe("Leisure");
    expect(styleLabelOf("urbanflash")).toBe("Urban Flash");
    expect(styleLabelOf("business")).toBe("Businesswear");
    expect(styleLabelOf("highfashion")).toBe("High Fashion");
  });

  it("unknown key returns the empty string", () => {
    expect(styleLabelOf("couture")).toBe("");
    expect(styleLabelOf("")).toBe("");
    expect(styleLabelOf(undefined)).toBe("");
    expect(styleLabelOf(null)).toBe("");
  });
});

// ─── priceFor ─────────────────────────────────────────────────────────────────

describe("priceFor", () => {
  it("returns the catalog cost when no style multiplier is given", () => {
    expect(priceFor({ system: { cost: 100 } })).toBe(100);
  });

  it("multiplies the catalog cost by the style multiplier", () => {
    expect(priceFor({ system: { cost: 100 } }, { styleMult: 4 })).toBe(400);
  });

  it("missing cost → 0", () => {
    expect(priceFor({})).toBe(0);
    expect(priceFor({ system: {} })).toBe(0);
  });

  it("null / undefined item → 0", () => {
    expect(priceFor(null)).toBe(0);
    expect(priceFor(undefined)).toBe(0);
  });

  it("styleMult 0 is treated as 1 (0 || 1)", () => {
    expect(priceFor({ system: { cost: 50 } }, { styleMult: 0 })).toBe(50);
  });

  it("non-numeric styleMult (NaN) falls back to 1", () => {
    expect(priceFor({ system: { cost: 50 } }, { styleMult: "abc" })).toBe(50);
    expect(priceFor({ system: { cost: 50 } }, { styleMult: NaN })).toBe(50);
  });

  it("rounds to the nearest integer", () => {
    expect(priceFor({ system: { cost: 10.4 } })).toBe(10);
    expect(priceFor({ system: { cost: 10.6 } })).toBe(11);
  });

  it("clamps negative results to 0", () => {
    expect(priceFor({ system: { cost: -100 } })).toBe(0);
    expect(priceFor({ system: { cost: 100 } }, { styleMult: -2 })).toBe(0);
  });

  it("numeric-string cost is coerced", () => {
    expect(priceFor({ system: { cost: "250" } }, { styleMult: 2 })).toBe(500);
  });
});
