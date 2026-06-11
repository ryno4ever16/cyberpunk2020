/**
 * Unit tests for pure exported functions in module/shop/shops.js.
 *
 * shops.js calls game.settings.get (via _rawMap) in most functions, but two helpers
 * are fully pure:
 *   - normalizeShopItem  — no Foundry deps; normalizes a raw stock entry
 *   - effectivePrice     — pure given a ShopDef + sourceKey + catalogCost + styleMult;
 *                          calls normalizeShopItem internally, no game/canvas access
 *
 * Skipped (call game.settings / game.user / foundry.utils):
 *   - getShops, getShop, listShops, shopsVisibleTo   — _rawMap() → game.settings.get
 *   - createShop, updateShop, deleteShop             — game.user.isGM + game.settings.set
 *   - duplicateShop                                  — foundry.utils.randomID / deepClone
 *   - addShopItem, addShopItems, removeShopItem      — game.settings mutations
 *   - clearShopItems, setShopItem, setAllShopStock   — game.settings mutations
 *   - decrementShopStock                             — game.settings mutations
 *   - migrateShopActorsToDefs                        — game.actors / game.settings / Actor.deleteDocuments
 */

import { describe, it, expect } from "vitest";
import {
  normalizeShopItem,
  effectivePrice,
} from "../../module/shop/shops.js";

// ─── normalizeShopItem ────────────────────────────────────────────────────────

describe("normalizeShopItem", () => {
  it("returns sensible defaults for null / undefined / empty input", () => {
    for (const raw of [null, undefined, {}]) {
      const out = normalizeShopItem(raw);
      expect(out.price).toBeNull();
      expect(out.unlimited).toBe(true);  // missing flag → unlimited (safe default)
      expect(out.qty).toBe(0);
      expect(out.style).toBeNull();
    }
  });

  it("treats null price as no override (null, not 0)", () => {
    expect(normalizeShopItem({ price: null }).price).toBeNull();
  });

  it("treats undefined price as no override", () => {
    expect(normalizeShopItem({ price: undefined }).price).toBeNull();
  });

  it("treats empty-string price as no override", () => {
    expect(normalizeShopItem({ price: "" }).price).toBeNull();
  });

  it("Number(null) === 0 does NOT become a 0eb price override", () => {
    // This is the key contract: null must NOT be treated as a real 0-euro price
    expect(normalizeShopItem({ price: null }).price).toBeNull();
  });

  it("accepts a numeric price and rounds it", () => {
    expect(normalizeShopItem({ price: 49.7 }).price).toBe(50);
    expect(normalizeShopItem({ price: 100 }).price).toBe(100);
    expect(normalizeShopItem({ price: "250" }).price).toBe(250);
  });

  it("clamps negative price to 0", () => {
    expect(normalizeShopItem({ price: -50 }).price).toBe(0);
  });

  it("price 0 is a valid override (items can be free)", () => {
    expect(normalizeShopItem({ price: 0 }).price).toBe(0);
  });

  it("unlimited defaults to true when the flag is absent", () => {
    expect(normalizeShopItem({}).unlimited).toBe(true);
    expect(normalizeShopItem({ unlimited: true }).unlimited).toBe(true);
  });

  it("unlimited becomes false only when explicitly set to false", () => {
    expect(normalizeShopItem({ unlimited: false }).unlimited).toBe(false);
  });

  it("qty floors and clamps to non-negative integer", () => {
    expect(normalizeShopItem({ qty: 3.9 }).qty).toBe(3);
    expect(normalizeShopItem({ qty: -5 }).qty).toBe(0);
    expect(normalizeShopItem({ qty: 0 }).qty).toBe(0);
    expect(normalizeShopItem({ qty: "7" }).qty).toBe(7);
  });

  it("qty non-numeric/null/undefined → 0", () => {
    expect(normalizeShopItem({ qty: null }).qty).toBe(0);
    expect(normalizeShopItem({ qty: undefined }).qty).toBe(0);
    expect(normalizeShopItem({ qty: "abc" }).qty).toBe(0);
  });

  it("style carries through when a non-empty string", () => {
    expect(normalizeShopItem({ style: "highFashion" }).style).toBe("highFashion");
    expect(normalizeShopItem({ style: "gang" }).style).toBe("gang");
  });

  it("style is null for empty string, null, or undefined", () => {
    expect(normalizeShopItem({ style: "" }).style).toBeNull();
    expect(normalizeShopItem({ style: null }).style).toBeNull();
    expect(normalizeShopItem({ style: undefined }).style).toBeNull();
  });

  it("style is null for non-string values", () => {
    expect(normalizeShopItem({ style: 42 }).style).toBeNull();
    expect(normalizeShopItem({ style: true }).style).toBeNull();
  });
});

// ─── effectivePrice ───────────────────────────────────────────────────────────

/** Build a minimal ShopDef for testing effectivePrice. */
function shopDef(opts = {}) {
  return {
    discountPct: opts.discountPct ?? 0,
    items: opts.items ?? {}
  };
}

describe("effectivePrice", () => {
  it("returns catalogCost when no override and no discount", () => {
    const def = shopDef({ items: { "packA.item1": {} } });
    expect(effectivePrice(def, "packA.item1", 100)).toBe(100);
  });

  it("uses per-item price override instead of catalogCost", () => {
    const def = shopDef({ items: { "packA.item1": { price: 75 } } });
    expect(effectivePrice(def, "packA.item1", 100)).toBe(75);
  });

  it("override price of 0 makes item free", () => {
    const def = shopDef({ items: { "packA.item1": { price: 0 } } });
    expect(effectivePrice(def, "packA.item1", 500)).toBe(0);
  });

  it("falls back to catalogCost when sourceKey is not in items", () => {
    const def = shopDef({ items: {} });
    expect(effectivePrice(def, "packA.item99", 200)).toBe(200);
  });

  it("applies shop-wide discount correctly", () => {
    const def = shopDef({ discountPct: 25, items: { "k": {} } });
    // 100 * (1 - 0.25) = 75
    expect(effectivePrice(def, "k", 100)).toBe(75);
  });

  it("50% discount halves the price", () => {
    const def = shopDef({ discountPct: 50, items: { "k": {} } });
    expect(effectivePrice(def, "k", 200)).toBe(100);
  });

  it("100% discount makes everything free", () => {
    const def = shopDef({ discountPct: 100, items: { "k": {} } });
    expect(effectivePrice(def, "k", 9999)).toBe(0);
  });

  it("discount clamps to [0, 100] (cannot go above 100% off)", () => {
    const def = shopDef({ discountPct: 150, items: { "k": {} } });
    // clamped to 100% → free
    expect(effectivePrice(def, "k", 500)).toBe(0);
  });

  it("negative discount is clamped to 0 (no mark-up via discountPct)", () => {
    const def = shopDef({ discountPct: -20, items: { "k": {} } });
    // clamped to 0% → no discount
    expect(effectivePrice(def, "k", 100)).toBe(100);
  });

  it("styleMult multiplies the effective base price", () => {
    const def = shopDef({ items: { "k": {} } });
    // catalogCost=100, styleMult=2 → 200
    expect(effectivePrice(def, "k", 100, 2)).toBe(200);
  });

  it("styleMult combined with discount: (base × mult) × (1 - disc/100)", () => {
    const def = shopDef({ discountPct: 50, items: { "k": { price: 100 } } });
    // override=100, styleMult=2 → 200 × 0.5 = 100
    expect(effectivePrice(def, "k", 999, 2)).toBe(100);
  });

  it("missing styleMult defaults to 1", () => {
    const def = shopDef({ items: { "k": {} } });
    expect(effectivePrice(def, "k", 50)).toBe(50);
    expect(effectivePrice(def, "k", 50, undefined)).toBe(50);
  });

  it("non-numeric styleMult falls back to 1", () => {
    const def = shopDef({ items: { "k": {} } });
    // Number("abc") is NaN, || 1 → 1
    expect(effectivePrice(def, "k", 100, "abc")).toBe(100);
  });

  it("result is rounded to an integer", () => {
    const def = shopDef({ discountPct: 33, items: { "k": {} } });
    // 100 * 0.67 = 67 (rounded)
    const result = effectivePrice(def, "k", 100);
    expect(Number.isInteger(result)).toBe(true);
  });

  it("result is clamped to ≥ 0", () => {
    // Edge: negative catalogCost should not produce a negative price
    const def = shopDef({ items: { "k": {} } });
    expect(effectivePrice(def, "k", -100)).toBe(0);
  });

  it("null / undefined def → treats as no items and no discount (uses catalogCost)", () => {
    expect(effectivePrice(null, "any.key", 80)).toBe(80);
    expect(effectivePrice(undefined, "any.key", 80)).toBe(80);
  });

  it("null catalogCost treated as 0 (no price available)", () => {
    const def = shopDef({ items: { "k": {} } });
    expect(effectivePrice(def, "k", null)).toBe(0);
  });
});
