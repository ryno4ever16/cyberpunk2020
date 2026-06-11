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
  effectiveArmorSP,
  personnelArmorValue,
} from "../../module/combat/DamageApplicator.js";

// Minimal actor mock for the armor helpers. getArmorContributors reads
// actor.items.contents and actor.system.armorLayers (see armor-layers.test.js).
let _armorId = 0;
const armorItem = (coverage, equipped = true) => ({
  id: `arm-${++_armorId}`, type: "armor", name: "Mock Armor",
  system: { equipped, encumbrance: 0, coverage },
});
// coverageMap: { [location]: stoppingPower }; builds one armor item covering all listed locations.
const armorActor = (coverageMap) => {
  const coverage = Object.fromEntries(Object.entries(coverageMap).map(([loc, sp]) => [loc, { stoppingPower: sp }]));
  return { system: { armorLayers: {} }, items: { contents: [armorItem(coverage)] } };
};

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

// ─── effectiveArmorSP ─────────────────────────────────────────────────────────

describe("effectiveArmorSP", () => {
  it("returns the equipped armor's SP at a covered location", () => {
    const actor = armorActor({ Torso: 19, Head: 14 });
    expect(effectiveArmorSP(actor, "Torso")).toBe(19);
    expect(effectiveArmorSP(actor, "Head")).toBe(14);
  });

  it("returns 0 at an uncovered location", () => {
    const actor = armorActor({ Torso: 19 });
    expect(effectiveArmorSP(actor, "lLeg")).toBe(0);
  });

  it("ignores unequipped armor", () => {
    const actor = { system: { armorLayers: {} }, items: { contents: [armorItem({ Torso: { stoppingPower: 19 } }, false)] } };
    expect(effectiveArmorSP(actor, "Torso")).toBe(0);
  });
});

// ─── personnelArmorValue (Maximum Metal p.8) ──────────────────────────────────

describe("personnelArmorValue", () => {
  it("matches the book worked example: SP19 over 3 of 6 locations → AV 1", () => {
    // mean SP = (19+19+19+0+0+0)/6 = 9.5 → round 10 → /20 = 0.5 → round 1.
    const actor = armorActor({ Torso: 19, lLeg: 19, rLeg: 19 });
    expect(personnelArmorValue(actor)).toBe(1);
  });

  it("returns 0 with no armor", () => {
    expect(personnelArmorValue(armorActor({}))).toBe(0);
    expect(personnelArmorValue(null)).toBe(0);
  });

  it("full-body heavy armor yields a higher AV", () => {
    // SP20 on all six locations → mean 20 → /20 = 1.
    const actor = armorActor({ Head: 20, Torso: 20, lArm: 20, rArm: 20, lLeg: 20, rLeg: 20 });
    expect(personnelArmorValue(actor)).toBe(1);
  });
});
