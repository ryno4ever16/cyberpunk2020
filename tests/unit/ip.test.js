/**
 * Unit tests for module/ip/ip.js.
 *
 * Covered:
 *   - ipCost(skill)            — PURE; cost formula across all skill levels + diffMod variants
 *   - ipLockState(actor)       — near-pure; game.settings.get wrapped in try/catch → "owner" default
 *   - canEditSkillLevels(actor) — near-pure; ipEnabled() throws → false → always returns true in Node
 *
 * Both ipLockState and canEditSkillLevels call ipSkillLockMode() / ipEnabled() which are
 * wrapped in try/catch with safe defaults ("owner" / "disabled"), so no Foundry globals
 * affect results when using plain actor mocks without a getFlag method.
 *
 * Skipped (Foundry dependencies — game.settings/Hooks/socket/ChatMessage):
 *   - getQueue            — game.settings.get (no fallback path for non-test envs)
 *   - recordSkillRoll     — game.socket.emit / _isActiveGM requires game.user.isGM
 *   - registerIpHooks     — Hooks.on + game.socket.on
 *   - awardPending        — skill.update (Foundry Item write)
 *   - applyPending        — actor.items + updateEmbeddedDocuments
 *   - levelUpSkill        — foundry.applications.api.DialogV2
 *   - toggleSkillLock     — actor.setFlag + game.user.isGM
 *   - addToPool           — actor.update (Foundry Actor write)
 *   - resolveQueueRow     — game.actors.get
 *   - dismissQueueRow     — game.settings.set (queue write)
 *   - updateQueueRow      — game.settings.set
 *   - resetThrottle       — game.settings.set
 *   - resolveAllQueue     — calls resolveQueueRow → game.actors.get
 */

import { describe, it, expect } from "vitest";
import {
  ipCost,
  ipLockState,
  canEditSkillLevels,
} from "../../module/ip/ip.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Build a minimal skill-item-like plain object. */
function skill({ level = 0, diffMod = undefined } = {}) {
  return {
    type: "skill",
    name: "Test Skill",
    system: {
      level,
      ...(diffMod !== undefined ? { diffMod } : {}),
    },
  };
}

/** Build a minimal actor-like plain object. */
function actor({ ownerLock = undefined, gmLock = undefined } = {}) {
  const flags = {};
  if (ownerLock !== undefined) flags["ipOwnerLock"] = ownerLock;
  if (gmLock    !== undefined) flags["ipGmLock"]    = gmLock;

  // Only attach getFlag if we actually want to supply lock flags.
  if (Object.keys(flags).length > 0) {
    return {
      getFlag: (_scope, key) => flags[key],
    };
  }
  // Plain actor with no getFlag → optional-chaining returns undefined throughout
  return {};
}

// ─── ipCost ──────────────────────────────────────────────────────────────────
//
// RAW: "cost to raise a skill = current level × 10 × difficulty multiplier"
// "first level = 10" (level 0 → cost uses max(1, 0) = 1 as the base multiplier)
//
// Formula: Math.max(1, level) * 10 * Math.max(1, diffMod || 1)

describe("ipCost — default diffMod (1×)", () => {
  it("level 0 → cost 10 (first level)", () => {
    // max(1, 0) * 10 * 1 = 10
    expect(ipCost(skill({ level: 0 }))).toBe(10);
  });

  it("level 1 → cost 10", () => {
    expect(ipCost(skill({ level: 1 }))).toBe(10);
  });

  it("level 2 → cost 20", () => {
    expect(ipCost(skill({ level: 2 }))).toBe(20);
  });

  it("level 3 → cost 30", () => {
    expect(ipCost(skill({ level: 3 }))).toBe(30);
  });

  it("level 5 → cost 50", () => {
    expect(ipCost(skill({ level: 5 }))).toBe(50);
  });

  it("level 10 → cost 100", () => {
    expect(ipCost(skill({ level: 10 }))).toBe(100);
  });

  it("level 0 and negative level both produce cost 10 (clamped to 1)", () => {
    expect(ipCost(skill({ level: 0  }))).toBe(10);
    expect(ipCost(skill({ level: -1 }))).toBe(10);
    expect(ipCost(skill({ level: -5 }))).toBe(10);
  });
});

describe("ipCost — diffMod variants", () => {
  it("diffMod=2: level 1 → 10 * 2 = 20", () => {
    expect(ipCost(skill({ level: 1, diffMod: 2 }))).toBe(20);
  });

  it("diffMod=2: level 5 → 50 * 2 = 100", () => {
    expect(ipCost(skill({ level: 5, diffMod: 2 }))).toBe(100);
  });

  it("diffMod=3: level 4 → 40 * 3 = 120", () => {
    expect(ipCost(skill({ level: 4, diffMod: 3 }))).toBe(120);
  });

  it("diffMod=0 is clamped to 1: level 3, diffMod=0 → 30", () => {
    // Math.max(1, 0) = 1 as mult
    expect(ipCost(skill({ level: 3, diffMod: 0 }))).toBe(30);
  });

  it("negative diffMod is clamped to 1", () => {
    expect(ipCost(skill({ level: 3, diffMod: -2 }))).toBe(30);
  });

  it("diffMod=1 (explicit) behaves same as absent", () => {
    expect(ipCost(skill({ level: 3, diffMod: 1 }))).toBe(30);
  });
});

describe("ipCost — edge cases / missing data", () => {
  it("missing system.level → treated as 0 → cost 10", () => {
    expect(ipCost({ type: "skill", system: {} })).toBe(10);
  });

  it("string level coerces correctly", () => {
    expect(ipCost(skill({ level: "4" }))).toBe(40);
  });

  it("null skill → level=0, diffMod=1 → cost 10", () => {
    expect(ipCost(null)).toBe(10);
  });

  it("undefined skill → cost 10", () => {
    expect(ipCost(undefined)).toBe(10);
  });

  it("empty object → cost 10", () => {
    expect(ipCost({})).toBe(10);
  });

  it("cost is always a positive integer multiple of 10 for integer levels ≥ 0", () => {
    for (const level of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const cost = ipCost(skill({ level }));
      expect(cost).toBeGreaterThan(0);
      expect(cost % 10).toBe(0);
    }
  });
});

// ─── ipLockState ─────────────────────────────────────────────────────────────
//
// In Node: game.settings.get throws → ipSkillLockMode() returns "owner" (default).
// With a plain actor (no getFlag): owner=false, gm=false → locked=false.
// With a mock actor supplying flags via getFlag: lock flags are read correctly.

describe("ipLockState — Node environment (mode defaults to 'owner')", () => {
  it("plain actor (no getFlag) → owner=false, gm=false, mode='owner', locked=false", () => {
    const result = ipLockState(actor());
    expect(result.owner).toBe(false);
    expect(result.gm).toBe(false);
    expect(result.mode).toBe("owner");
    expect(result.locked).toBe(false);
  });

  it("actor with ipOwnerLock=true → owner=true, locked=true (mode=owner)", () => {
    const result = ipLockState(actor({ ownerLock: true }));
    expect(result.owner).toBe(true);
    expect(result.locked).toBe(true);
  });

  it("actor with ipOwnerLock=false → owner=false, locked=false", () => {
    const result = ipLockState(actor({ ownerLock: false }));
    expect(result.owner).toBe(false);
    expect(result.locked).toBe(false);
  });

  it("actor with only ipGmLock=true → owner=false, gm=true, locked=false (mode=owner ignores gmLock)", () => {
    // In "owner" mode: locked = owner (not gm)
    const result = ipLockState(actor({ gmLock: true }));
    expect(result.gm).toBe(true);
    expect(result.owner).toBe(false);
    expect(result.locked).toBe(false);  // mode=owner only looks at owner flag
  });

  it("null actor → owner=false, gm=false, locked=false", () => {
    const result = ipLockState(null);
    expect(result.owner).toBe(false);
    expect(result.gm).toBe(false);
    expect(result.locked).toBe(false);
  });

  it("returns all four expected keys", () => {
    const result = ipLockState(actor());
    expect(result).toHaveProperty("owner");
    expect(result).toHaveProperty("gm");
    expect(result).toHaveProperty("mode");
    expect(result).toHaveProperty("locked");
  });
});

// ─── canEditSkillLevels ───────────────────────────────────────────────────────
//
// In Node: ipEnabled() = (ipSystem() !== "disabled") = ("disabled" !== "disabled") = false.
// When IP system is disabled, canEditSkillLevels always returns true (no lock applies).

describe("canEditSkillLevels — Node environment (ipEnabled() = false → always true)", () => {
  it("plain actor → true (IP system disabled in Node)", () => {
    expect(canEditSkillLevels(actor())).toBe(true);
  });

  it("locked actor → still true because IP system is off in Node", () => {
    expect(canEditSkillLevels(actor({ ownerLock: true }))).toBe(true);
  });

  it("null actor → true", () => {
    expect(canEditSkillLevels(null)).toBe(true);
  });
});
