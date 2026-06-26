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
  isValidPrice,
  isPositivePrice,
  resolveCatalogPrice,
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

// ─── isValidPrice / isPositivePrice ───────────────────────────────────────────

describe("isValidPrice", () => {
  it("accepts finite non-negative numbers and numeric strings (0 allowed)", () => {
    expect(isValidPrice(0)).toBe(true);
    expect(isValidPrice("0")).toBe(true);
    expect(isValidPrice(500)).toBe(true);
    expect(isValidPrice("1000")).toBe(true);
  });
  it("rejects blank, absent, non-numeric, and negative", () => {
    expect(isValidPrice("")).toBe(false);
    expect(isValidPrice("   ")).toBe(false);
    expect(isValidPrice(null)).toBe(false);
    expect(isValidPrice(undefined)).toBe(false);
    expect(isValidPrice("Varies by design")).toBe(false);
    expect(isValidPrice(-5)).toBe(false);
    expect(isValidPrice(NaN)).toBe(false);
  });
});

describe("isPositivePrice", () => {
  it("is the >0 trust gate for a compendium cost (0 is NOT positive)", () => {
    expect(isPositivePrice(0)).toBe(false);
    expect(isPositivePrice("0")).toBe(false);
    expect(isPositivePrice("")).toBe(false);
    expect(isPositivePrice(1)).toBe(true);
    expect(isPositivePrice("500")).toBe(true);
  });
});

// ─── resolveCatalogPrice (precedence: compendium>0 → override≥0 → unpurchasable) ─
// The DataModel defaults a blank cost to the number 0, so 0 means "unpriced", not "free".

describe("resolveCatalogPrice", () => {
  it("trusts a POSITIVE compendium cost", () => {
    expect(resolveCatalogPrice("500", "id", {})).toEqual({ price: 500, purchasable: true, source: "compendium" });
    expect(resolveCatalogPrice(75, "id", {})).toEqual({ price: 75, purchasable: true, source: "compendium" });
  });
  it("treats a 0 / blank / non-numeric compendium cost as unpurchasable (no override)", () => {
    expect(resolveCatalogPrice(0, "id", {})).toEqual({ price: null, purchasable: false, source: "none" });
    expect(resolveCatalogPrice("", "id", {})).toEqual({ price: null, purchasable: false, source: "none" });
    expect(resolveCatalogPrice("Varies by design", "id", {})).toEqual({ price: null, purchasable: false, source: "none" });
  });
  it("uses a GM override when the compendium cost is unusable (0 override = free)", () => {
    expect(resolveCatalogPrice("", "id", { id: 250 })).toEqual({ price: 250, purchasable: true, source: "override" });
    expect(resolveCatalogPrice(0, "id", { id: 0 })).toEqual({ price: 0, purchasable: true, source: "override" });
  });
  it("SELF-DISENGAGES: a positive compendium cost always wins over an override", () => {
    expect(resolveCatalogPrice("300", "id", { id: 999 })).toEqual({ price: 300, purchasable: true, source: "compendium" });
  });
});
