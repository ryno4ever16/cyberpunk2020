/**
 * Unit tests for pure/near-pure functions in module/combat/save-rolls.js.
 *
 * Covered:
 *   - getStunThreshold(actor)   — BT minus wound penalty, floored at 1
 *   - getDeathThreshold(actor)  — BT minus mortalLevel, floored at 0
 *
 * These two functions are the only exports that are pure with respect to plain
 * actor-like objects.  The taser-penalty helper inside getStunThreshold calls
 * game.settings.get (try/catch → returns enabled=true) then actor.getFlag?.()
 * which is undefined on a plain object → returns 0.  So no Foundry globals affect
 * the output when using plain actor mocks.
 *
 * Skipped (Foundry dependencies — game/socket/canvas/ChatMessage):
 *   - registerSaveRollHandlers — registers Hooks + socket + document click listeners
 *   - postStunSavePrompt       — ChatMessage.create
 *   - postDeathSavePrompt      — ChatMessage.create
 *   - postSavePrompts          — game.actors.get, ChatMessage.create
 *   - executeStunSave          — game.actors.get, Roll, ChatMessage
 *   - executeDeathSave         — game.actors.get, Roll, ChatMessage
 *   - executeStabilize         — foundry.applications.api.DialogV2
 *   - applyAcidDotState        — actor.setFlag (async, writes to Foundry)
 *   - applyFireDotState        — actor.setFlag (async, writes to Foundry)
 *   - applyDotFromPayload      — game.settings.get (no fallback for enabled gate)
 *   - updateTaserState         — actor.setFlag (async)
 */

import { describe, it, expect } from "vitest";
import {
  getStunThreshold,
  getDeathThreshold,
} from "../../module/combat/save-rolls.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a minimal actor-like plain object.
 *
 * getStunThreshold uses:
 *   actor.stunThreshold()  — optional; falls back to bt − woundPenalty + 1
 *   actor.system.stats.bt.total  — body type
 *   actor.woundState?.()  — wound state (0-10); absent = 0
 *   actor.getFlag?.()  — taser state; absent = no penalty
 *
 * getDeathThreshold uses:
 *   actor.system.stats.bt.total
 *   actor.woundState?.()  — absent defaults to 4 inside getDeathThreshold
 */
function makeActor({ bt = 0, woundState = undefined } = {}) {
  const a = {
    system: { stats: { bt: { total: bt } } },
  };
  if (woundState !== undefined) {
    a.woundState = () => woundState;
  }
  return a;
}

// ─── getStunThreshold ─────────────────────────────────────────────────────────
//
// CP2020 p.99: Stun Threshold = Body Type − wound penalty, min 1.
// Wound penalties (stun table):
//   Uninjured (0): 0   Light (1): 0   Serious (2): -1   Critical (3): -2
//   Mortal 0 (4): -3   Mortal 1 (5): -4   ...   Mortal 6 (10): -9
//
// The code's fallback path is:
//   bt − (woundState − 1) + 1 = bt − woundState + 2
//
// Wait — re-reading the code:
//   Math.max(1, (Number(actor.system?.stats?.bt?.total) || 0) − (actor.woundState?.() ?? 0) + 1)
// So: bt − woundState + 1, min 1.
//
// For woundState=0 (Uninjured):  threshold = bt − 0 + 1 = bt + 1  — NOT the penalty table.
// This fallback formula does NOT implement the "Light=0, Serious=-1" table; it uses a
// continuous bt − woundState + 1 formula. The table is only applied when actor.stunThreshold()
// is overridden.  We test what the code ACTUALLY does.

describe("getStunThreshold — plain actor (fallback formula: bt − woundState + 1)", () => {
  it("BT=5, uninjured (woundState=0) → 5 − 0 + 1 = 6", () => {
    expect(getStunThreshold(makeActor({ bt: 5, woundState: 0 }))).toBe(6);
  });

  it("BT=8, uninjured (woundState=0) → 9", () => {
    expect(getStunThreshold(makeActor({ bt: 8, woundState: 0 }))).toBe(9);
  });

  it("BT=5, woundState=2 → 5 − 2 + 1 = 4", () => {
    expect(getStunThreshold(makeActor({ bt: 5, woundState: 2 }))).toBe(4);
  });

  it("BT=5, woundState=4 (Mortal 0) → 5 − 4 + 1 = 2", () => {
    expect(getStunThreshold(makeActor({ bt: 5, woundState: 4 }))).toBe(2);
  });

  it("BT=3, woundState=4 → 3 − 4 + 1 = 0 → floored to 1", () => {
    expect(getStunThreshold(makeActor({ bt: 3, woundState: 4 }))).toBe(1);
  });

  it("BT=2, woundState=10 (Mortal 6) → 2 − 10 + 1 = −7 → floored to 1", () => {
    expect(getStunThreshold(makeActor({ bt: 2, woundState: 10 }))).toBe(1);
  });

  it("BT=0 → floored to 1", () => {
    expect(getStunThreshold(makeActor({ bt: 0, woundState: 0 }))).toBe(1);
  });

  it("negative BT → floored to 1", () => {
    expect(getStunThreshold(makeActor({ bt: -5, woundState: 0 }))).toBe(1);
  });

  it("woundState absent → defaults to 0 (via ?? 0)", () => {
    // No woundState function on plain object → bt − 0 + 1 = bt + 1
    const a = { system: { stats: { bt: { total: 6 } } } };
    expect(getStunThreshold(a)).toBe(7);
  });

  it("uses actor.stunThreshold() when present instead of formula", () => {
    const a = makeActor({ bt: 5, woundState: 0 });
    a.stunThreshold = () => 3;   // custom override; should return 3 (still ≥ 1)
    expect(getStunThreshold(a)).toBe(3);
  });

  it("actor.stunThreshold() returning 0 is floored to 1", () => {
    const a = makeActor({ bt: 5 });
    a.stunThreshold = () => 0;
    expect(getStunThreshold(a)).toBe(1);
  });

  it("minimum is always 1, never 0 or negative", () => {
    for (const bt of [0, 1, 2]) {
      for (const ws of [8, 9, 10]) {
        expect(getStunThreshold(makeActor({ bt, woundState: ws }))).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

// ─── getDeathThreshold ───────────────────────────────────────────────────────
//
// CP2020 p.99: Death Threshold = BT − mortalLevel, floored at 0.
// mortalLevel = woundState − 4, capped 0..6.
// woundState < 4 → mortalLevel = 0 → threshold = BT (but death saves only matter at Mortal).
// woundState = 4 (Mortal 0): threshold = BT − 0 = BT
// woundState = 5 (Mortal 1): threshold = BT − 1
// woundState = 10 (Mortal 6): threshold = BT − 6
// woundState = 11 → capped at 6, still BT − 6
// Threshold 0: automatic death (no roll can succeed).

describe("getDeathThreshold (CP2020 p.99)", () => {
  it("Mortal 0 (woundState=4): threshold = BT − 0 = BT", () => {
    expect(getDeathThreshold(makeActor({ bt: 7, woundState: 4 }))).toBe(7);
  });

  it("Mortal 1 (woundState=5): threshold = BT − 1", () => {
    expect(getDeathThreshold(makeActor({ bt: 7, woundState: 5 }))).toBe(6);
  });

  it("Mortal 2 (woundState=6): threshold = BT − 2", () => {
    expect(getDeathThreshold(makeActor({ bt: 7, woundState: 6 }))).toBe(5);
  });

  it("Mortal 3 (woundState=7): threshold = BT − 3", () => {
    expect(getDeathThreshold(makeActor({ bt: 7, woundState: 7 }))).toBe(4);
  });

  it("Mortal 4 (woundState=8): threshold = BT − 4", () => {
    expect(getDeathThreshold(makeActor({ bt: 7, woundState: 8 }))).toBe(3);
  });

  it("Mortal 5 (woundState=9): threshold = BT − 5", () => {
    expect(getDeathThreshold(makeActor({ bt: 7, woundState: 9 }))).toBe(2);
  });

  it("Mortal 6 (woundState=10): threshold = BT − 6", () => {
    expect(getDeathThreshold(makeActor({ bt: 7, woundState: 10 }))).toBe(1);
  });

  it("Mortal 6 cap: woundState=11 still gives BT − 6 (cap at mortalLevel=6)", () => {
    expect(getDeathThreshold(makeActor({ bt: 7, woundState: 11 }))).toBe(1);
  });

  it("threshold cannot go below 0 (floored)", () => {
    // BT=3, Mortal 6 → 3 − 6 = −3 → floored to 0
    expect(getDeathThreshold(makeActor({ bt: 3, woundState: 10 }))).toBe(0);
  });

  it("threshold 0 means automatic death (BT ≤ mortalLevel)", () => {
    expect(getDeathThreshold(makeActor({ bt: 0, woundState: 4 }))).toBe(0);
    expect(getDeathThreshold(makeActor({ bt: 1, woundState: 5 }))).toBe(0);
    expect(getDeathThreshold(makeActor({ bt: 6, woundState: 10 }))).toBe(0);
  });

  it("BT=0 always gives threshold 0 regardless of wound state", () => {
    expect(getDeathThreshold(makeActor({ bt: 0, woundState: 4 }))).toBe(0);
    expect(getDeathThreshold(makeActor({ bt: 0, woundState: 10 }))).toBe(0);
  });

  it("woundState < 4 (pre-Mortal): mortalLevel clamped to 0, threshold = BT", () => {
    expect(getDeathThreshold(makeActor({ bt: 5, woundState: 0 }))).toBe(5);
    expect(getDeathThreshold(makeActor({ bt: 5, woundState: 3 }))).toBe(5);
  });

  it("woundState absent → defaults to 4 (woundState?.() ?? 4) → mortalLevel=0", () => {
    // Plain object: woundState method absent → undefined → ?? 4 → mortalLevel = 0
    const a = { system: { stats: { bt: { total: 6 } } } };
    expect(getDeathThreshold(a)).toBe(6);
  });

  it("threshold is always ≥ 0 (never negative)", () => {
    for (const bt of [0, 1, 2, 3]) {
      for (const ws of [4, 5, 6, 7, 8, 9, 10]) {
        expect(getDeathThreshold(makeActor({ bt, woundState: ws }))).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("BT=10 (max mortal) Mortal 6 → threshold = 4", () => {
    expect(getDeathThreshold(makeActor({ bt: 10, woundState: 10 }))).toBe(4);
  });
});
