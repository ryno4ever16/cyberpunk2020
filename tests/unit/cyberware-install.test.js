/**
 * Unit tests for the pure exports of module/cyberware/install.js — the cyberware
 * buy-and-install flow. The module is import-safe in Node (its imports — dice.js,
 * utils.js, settings.js, compat.js — are all import-safe), and two exports are pure:
 *   - SURGERY    — the Core Surgery table (code → { label, cost, damage })
 *   - getSurgery — raw surgCode normalization → SURGERY entry (blank/unknown → N)
 *
 * Skipped (async; new Roll / DialogV2 / actor + item writes):
 *   - rollCyberwareHumanity   — new Roll, item.update, ChatMessage
 *   - installCyberware        — actor/item updates, chat cards
 *   - buyAndInstallCyberware  — DialogV2 confirm, money deduction, installCyberware
 */

import { describe, it, expect } from "vitest";
import { SURGERY, getSurgery } from "../../module/cyberware/install.js";

// ─── SURGERY table ────────────────────────────────────────────────────────────

describe("SURGERY", () => {
  it("matches the Core Surgery table (cost + damage per code)", () => {
    expect(SURGERY.N).toEqual({ label: "Negligible", cost: 0, damage: "1" });
    expect(SURGERY.M).toEqual({ label: "Minor", cost: 500, damage: "1d6+1" });
    expect(SURGERY.MA).toEqual({ label: "Major", cost: 1500, damage: "2d6+1" });
    expect(SURGERY.CR).toEqual({ label: "Critical", cost: 2500, damage: "3d6+1" });
    expect(SURGERY.CRX2).toEqual({ label: "Critical ×2", cost: 5000, damage: "6d6+2" });
  });

  it("holds the key cost/damage invariants", () => {
    expect(SURGERY.M.cost).toBe(500);
    expect(SURGERY.CRX2.damage).toBe("6d6+2");
    expect(SURGERY.CRX2.cost).toBe(2 * SURGERY.CR.cost); // CRx2 = double Critical
  });
});

// ─── getSurgery ───────────────────────────────────────────────────────────────

describe("getSurgery", () => {
  it("maps exact codes to their SURGERY entries", () => {
    expect(getSurgery("N")).toBe(SURGERY.N);
    expect(getSurgery("ma")).toBe(SURGERY.MA);
    expect(getSurgery("cr")).toBe(SURGERY.CR);
  });

  it("is case-insensitive", () => {
    expect(getSurgery("m")).toBe(SURGERY.M);
    expect(getSurgery("CRx2")).toBe(SURGERY.CRX2);
  });

  it("strips internal whitespace and trims", () => {
    expect(getSurgery("cr x2")).toBe(SURGERY.CRX2);
    expect(getSurgery(" M ")).toBe(SURGERY.M);
  });

  it("falls back to Negligible for blank / missing / unknown codes", () => {
    expect(getSurgery("")).toBe(SURGERY.N);
    expect(getSurgery(undefined)).toBe(SURGERY.N);
    expect(getSurgery(null)).toBe(SURGERY.N);
    expect(getSurgery("bogus")).toBe(SURGERY.N);
  });
});
