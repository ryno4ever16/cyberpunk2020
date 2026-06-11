/**
 * Unit tests for pure / near-pure exported functions in module/combat/DamageApplicator.js.
 *
 * All game.settings / canvas accesses in this module are wrapped in try/catch with safe
 * defaults, so they degrade gracefully in a Node test environment:
 *   - activeLimbModel()    → "Core"  (both settings throw)
 *   - computeNetDamage()   → Core rules (no head doubling, no limb doubling)
 *
 * Skipped (side-effects / Foundry dependencies):
 *   - applyAreaDamages     — awaits actor.update, ChatMessage.create, canvas, socket
 *   - assessWoundSeverity  — awaits ChatMessage, canvas, actor flags
 *   - ablateLocationOnce   — writes actor data
 */

import { describe, it, expect } from "vitest";
import {
  applyBTM,
  spLocationKey,
  LIMB_LOCATIONS,
  computeNetDamage,
  activeLimbModel,
  ARMOR_MODES,
} from "../../module/combat/DamageApplicator.js";

// ─── ARMOR_MODES constant ─────────────────────────────────────────────────────

describe("ARMOR_MODES", () => {
  it("has the expected mode strings", () => {
    expect(ARMOR_MODES.FULL).toBe("full");
    expect(ARMOR_MODES.SIMPLE).toBe("simple");
    expect(ARMOR_MODES.NONE).toBe("none");
  });
});

// ─── LIMB_LOCATIONS ───────────────────────────────────────────────────────────

describe("LIMB_LOCATIONS", () => {
  it("contains all four limb location keys", () => {
    expect(LIMB_LOCATIONS.has("rArm")).toBe(true);
    expect(LIMB_LOCATIONS.has("lArm")).toBe(true);
    expect(LIMB_LOCATIONS.has("rLeg")).toBe(true);
    expect(LIMB_LOCATIONS.has("lLeg")).toBe(true);
  });

  it("does not contain non-limb locations", () => {
    expect(LIMB_LOCATIONS.has("Head")).toBe(false);
    expect(LIMB_LOCATIONS.has("Torso")).toBe(false);
    expect(LIMB_LOCATIONS.has("Groin")).toBe(false);
  });
});

// ─── spLocationKey ────────────────────────────────────────────────────────────

describe("spLocationKey", () => {
  it("maps Groin to Torso", () => {
    expect(spLocationKey("Groin")).toBe("Torso");
  });

  it("passes all other locations through unchanged", () => {
    for (const loc of ["Head", "Torso", "rArm", "lArm", "rLeg", "lLeg"]) {
      expect(spLocationKey(loc)).toBe(loc);
    }
  });
});

// ─── applyBTM ─────────────────────────────────────────────────────────────────

describe("applyBTM", () => {
  it("returns 0 when not penetrated", () => {
    expect(applyBTM(15, 0, false)).toBe(0);
    expect(applyBTM(0, 0, false)).toBe(0);
    expect(applyBTM(100, 5, false)).toBe(0);
  });

  it("subtracts BTM from damage after SP (minimum 1)", () => {
    expect(applyBTM(10, 2, true)).toBe(8);
    expect(applyBTM(5, 5, true)).toBe(1);   // would be 0, floored to 1
    expect(applyBTM(3, 5, true)).toBe(1);   // negative, floored to 1
  });

  it("returns full damage when BTM is 0", () => {
    expect(applyBTM(7, 0, true)).toBe(7);
  });

  it("minimum result is always 1 when penetrated", () => {
    expect(applyBTM(0, 10, true)).toBe(1);
    expect(applyBTM(1, 100, true)).toBe(1);
  });

  it("handles negative afterSP (floored to 1)", () => {
    expect(applyBTM(-5, 2, true)).toBe(1);
  });
});

// ─── activeLimbModel (in Node, game.settings is undefined → "Core") ───────────

describe("activeLimbModel (Node fallback)", () => {
  it("returns 'Core' when game.settings is unavailable", () => {
    expect(activeLimbModel()).toBe("Core");
  });
});

// ─── computeNetDamage (Core mode fallback in Node) ────────────────────────────
// In Node: headDoubling=false, detailedLimb=false → same as applyBTM

describe("computeNetDamage (Core/no-doubling fallback)", () => {
  it("returns 0 when not penetrated", () => {
    expect(computeNetDamage(10, 2, false, "Torso")).toBe(0);
    expect(computeNetDamage(10, 2, false, "Head")).toBe(0);
  });

  it("applies BTM and floors at 1 when penetrated, normal location", () => {
    expect(computeNetDamage(10, 2, true, "Torso")).toBe(8);
    expect(computeNetDamage(5, 5, true, "Torso")).toBe(1);
  });

  it("Head location: no doubling in Core mode (headDoubling=false in Node)", () => {
    // In Node, headDoubling try/catch falls back to false → same as regular BTM
    expect(computeNetDamage(10, 2, true, "Head")).toBe(8);
  });

  it("Limb locations: no pre-BTM doubling in Core mode", () => {
    expect(computeNetDamage(10, 2, true, "rArm")).toBe(8);
    expect(computeNetDamage(10, 2, true, "lLeg")).toBe(8);
  });

  it("minimum 1 when penetrated", () => {
    expect(computeNetDamage(1, 100, true, "Torso")).toBe(1);
  });

  it("penetrating damage of exactly BTM floors to 1", () => {
    expect(computeNetDamage(3, 3, true, "Torso")).toBe(1);
  });
});
