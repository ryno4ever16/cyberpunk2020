/**
 * Unit tests for pure exported functions in module/compat.js.
 *
 * Tested (pure given globalThis.game / globalThis.HTMLElement):
 *   - getFoundryMajorVersion — reads game.release.generation, falls back to
 *                              parsing the leading integer of game.release.version
 *                              ?? game.version, else 0
 *   - isFoundryV13           — getFoundryMajorVersion() === 13
 *   - isFoundryV14Plus       — getFoundryMajorVersion() >= 14
 *   - getHtmlElement         — unwraps an HTMLElement from app/jQuery/array wrappers;
 *                              in Node (no globalThis.HTMLElement) the instanceof
 *                              checks are all false, so it falls through to the
 *                              `html?.querySelector ? html : null` duck-type branch
 *
 * Skipped (need a real DOM / ProseMirror editor elements):
 *   - getRichEditorElement, getRichEditorHTML, saveRichEditorHTML
 *     — query <prose-mirror> custom elements via querySelector/matches on live DOM
 *
 * Skipped (Foundry runtime: Item / ChatMessage / Roll / game.settings):
 *   - itemFromDropData                                  — Item.implementation.fromDropData
 *   - getRollMode, getMessageMode (and the get*RollMode / get*MessageMode wrappers)
 *     — read CONST.DICE_ROLL_MODES / game.settings (defaults)
 *   - getGMUserIds                                      — ChatMessage.getWhisperRecipients
 *   - evaluateCyberpunkRoll                             — Roll evaluation
 *   - createCyberpunkChatMessage, rollToCyberpunkChatMessage, createCyberpunkRollCard
 *     — ChatMessage.create / Roll#toMessage
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  getFoundryMajorVersion,
  isFoundryV13,
  isFoundryV14Plus,
  getHtmlElement,
} from "../../module/compat.js";

// ─── getFoundryMajorVersion / isFoundryV13 / isFoundryV14Plus ────────────────

describe("getFoundryMajorVersion and version predicates", () => {
  beforeEach(() => {
    delete globalThis.game;
  });

  afterAll(() => {
    delete globalThis.game;
  });

  it("reads release.generation 13 → v13 true, v14+ false", () => {
    globalThis.game = { release: { generation: 13 } };
    expect(getFoundryMajorVersion()).toBe(13);
    expect(isFoundryV13()).toBe(true);
    expect(isFoundryV14Plus()).toBe(false);
  });

  it("reads release.generation 14 → v13 false, v14+ true", () => {
    globalThis.game = { release: { generation: 14 } };
    expect(getFoundryMajorVersion()).toBe(14);
    expect(isFoundryV13()).toBe(false);
    expect(isFoundryV14Plus()).toBe(true);
  });

  it("reads release.generation 16 → v14+ true", () => {
    globalThis.game = { release: { generation: 16 } };
    expect(getFoundryMajorVersion()).toBe(16);
    expect(isFoundryV14Plus()).toBe(true);
  });

  it("falls back to release.version when generation is not > 0", () => {
    globalThis.game = { release: { generation: 0, version: "13.350" } };
    expect(getFoundryMajorVersion()).toBe(13);
  });

  it("falls back to game.version when there is no release object", () => {
    globalThis.game = { version: "14.2" };
    expect(getFoundryMajorVersion()).toBe(14);
  });

  it("returns 0 (and both predicates false) when globalThis.game is undefined", () => {
    // beforeEach already deleted globalThis.game
    expect(getFoundryMajorVersion()).toBe(0);
    expect(isFoundryV13()).toBe(false);
    expect(isFoundryV14Plus()).toBe(false);
  });
});

// ─── getHtmlElement ───────────────────────────────────────────────────────────
// In the Node test environment globalThis.HTMLElement is undefined, so every
// instanceof check inside getHtmlElement is false; only the final
// `html?.querySelector ? html : null` duck-type branch can return non-null.

describe("getHtmlElement (Node: no HTMLElement constructor)", () => {
  it("sanity: the Node environment has no HTMLElement", () => {
    expect(globalThis.HTMLElement).toBeUndefined();
  });

  it("returns null for null and undefined", () => {
    expect(getHtmlElement(null)).toBeNull();
    expect(getHtmlElement(undefined)).toBeNull();
  });

  it("returns null for a plain object with no querySelector", () => {
    expect(getHtmlElement({})).toBeNull();
  });

  it("returns the same object when it duck-types querySelector", () => {
    const fake = { querySelector() {} };
    expect(getHtmlElement(fake)).toBe(fake);
  });

  it("returns null for an array (Array.isArray branch finds no HTMLElement)", () => {
    expect(getHtmlElement(["x", "y"])).toBeNull();
  });
});
