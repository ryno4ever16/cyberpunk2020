/**
 * Unit tests for module/combat/movement-gate.js.
 *
 * Covers the pure decision `shouldBlockMovement` across every gating axis: the setting toggle,
 * position-change detection, active-combat requirement, the GM override, and the has-acted signal.
 *
 * The live hook `registerMovementGate` (and the actor/round flag reads it wraps) is NOT exercised
 * here — it reads Foundry globals at call time and belongs to the E2E suite.
 */

import { describe, it, expect } from "vitest";
import { shouldBlockMovement } from "../../module/combat/movement-gate.js";

/** A fully "should block" set of inputs; individual tests flip one axis at a time. */
function blockingInputs(overrides = {}) {
  return {
    enabled: true,
    inCombat: true,
    isGM: false,
    isPositionChange: true,
    hasActed: true,
    ...overrides,
  };
}

describe("shouldBlockMovement", () => {
  it("blocks a player move once they have acted this turn (all conditions met)", () => {
    expect(shouldBlockMovement(blockingInputs())).toBe(true);
  });

  it("does not block when the setting is off", () => {
    expect(shouldBlockMovement(blockingInputs({ enabled: false }))).toBe(false);
  });

  it("does not block a non-position update (elevation / name / etc.)", () => {
    expect(shouldBlockMovement(blockingInputs({ isPositionChange: false }))).toBe(false);
  });

  it("does not block outside of an active combat", () => {
    expect(shouldBlockMovement(blockingInputs({ inCombat: false }))).toBe(false);
  });

  it("never blocks a GM (override — GMs may reposition any token)", () => {
    expect(shouldBlockMovement(blockingInputs({ isGM: true }))).toBe(false);
  });

  it("does not block before the actor has taken a tracked action this turn", () => {
    expect(shouldBlockMovement(blockingInputs({ hasActed: false }))).toBe(false);
  });

  it("allows free repositioning before acting, then locks after acting", () => {
    // The intended player experience: reposition freely, then commit to an action, then locked.
    expect(shouldBlockMovement(blockingInputs({ hasActed: false }))).toBe(false); // pre-action
    expect(shouldBlockMovement(blockingInputs({ hasActed: true }))).toBe(true);   // post-action
  });

  it("coerces a truthy non-boolean hasActed to a real boolean true", () => {
    expect(shouldBlockMovement(blockingInputs({ hasActed: 1 }))).toBe(true);
  });

  it("the setting toggle takes priority over every other axis", () => {
    // Even with a post-action player mid-combat, setting off ⇒ never blocked.
    expect(shouldBlockMovement({
      enabled: false, inCombat: true, isGM: false, isPositionChange: true, hasActed: true,
    })).toBe(false);
  });

  it("the GM override takes priority over has-acted", () => {
    expect(shouldBlockMovement({
      enabled: true, inCombat: true, isGM: true, isPositionChange: true, hasActed: true,
    })).toBe(false);
  });
});
