/**
 * Unit tests for module/shop/supplements.js — supplement classification + canonicity
 * gating for the Shopping catalog. The module is fully pure (zero imports), so EVERY
 * export is tested:
 *   - classifySupplement       — raw source string → { supplement, canon }
 *   - knownOfficialSupplements — sorted unique official supplement names
 *   - knownNoncanonSources     — sorted unique non-canon/homebrew source names
 *   - shortSupplement          — abbreviated badge label (falls back to full name)
 *   - sourceState              — { present, enabledForPlayers } under a config
 *   - isVisibleTo              — GM/player visibility for a supplement
 *
 * Skipped: nothing — no Foundry-dependent exports in this module.
 */

import { describe, it, expect } from "vitest";
import {
  classifySupplement,
  knownOfficialSupplements,
  knownNoncanonSources,
  shortSupplement,
  sourceState,
  isVisibleTo,
} from "../../module/shop/supplements.js";

// ─── classifySupplement ───────────────────────────────────────────────────────

describe("classifySupplement", () => {
  it("treats empty / missing / literal-'undefined' sources as Untagged core", () => {
    for (const raw of ["", undefined, null, "undefined", "null"]) {
      expect(classifySupplement(raw)).toEqual({ supplement: "Untagged", canon: "core" });
    }
  });

  it("classifies cross-system sources as noncanon", () => {
    expect(classifySupplement("Shadowrun core")).toEqual({ supplement: "Shadowrun", canon: "noncanon" });
    expect(classifySupplement("When Gravity Fails")).toEqual({ supplement: "When Gravity Fails", canon: "noncanon" });
  });

  it("classifies URLs and www. sources as Other online (noncanon)", () => {
    expect(classifySupplement("http://example.com")).toEqual({ supplement: "Other online", canon: "noncanon" });
    expect(classifySupplement("www.foo.com")).toEqual({ supplement: "Other online", canon: "noncanon" });
  });

  it("matches Solo of Fortune 2 BEFORE Solo of Fortune (more specific first)", () => {
    expect(classifySupplement("Solo of Fortune 2")).toEqual({ supplement: "Solo of Fortune 2", canon: "official" });
    expect(classifySupplement("Solo of Fortune")).toEqual({ supplement: "Solo of Fortune", canon: "official" });
  });

  it("classifies Maximum Metal as official", () => {
    expect(classifySupplement("Maximum Metal")).toEqual({ supplement: "Maximum Metal", canon: "official" });
  });

  it("resolves Chromebook volumes from Chromebook / Chrome / Chr + digit", () => {
    expect(classifySupplement("Chromebook 1")).toEqual({ supplement: "Chromebook 1", canon: "official" });
    expect(classifySupplement("Chrome 2")).toEqual({ supplement: "Chromebook 2", canon: "official" });
    expect(classifySupplement("Chr 3")).toEqual({ supplement: "Chromebook 3", canon: "official" });
  });

  it("un-numbered Chromebook falls to the generic Chromebook rule", () => {
    expect(classifySupplement("Chromebook")).toEqual({ supplement: "Chromebook", canon: "official" });
  });

  it("maps Corpbook and Corporate Report to the same supplement", () => {
    expect(classifySupplement("Corpbook 2")).toEqual({ supplement: "Corporate Report", canon: "official" });
    expect(classifySupplement("Corporate Report")).toEqual({ supplement: "Corporate Report", canon: "official" });
  });

  it("maps Reference Book and Cyberpunk 2020 to Core", () => {
    expect(classifySupplement("Reference Book")).toEqual({ supplement: "Cyberpunk 2020 (Core)", canon: "core" });
    expect(classifySupplement("Cyberpunk 2020")).toEqual({ supplement: "Cyberpunk 2020 (Core)", canon: "core" });
  });

  it("unrecognized text falls back to Untagged core", () => {
    expect(classifySupplement("some unrecognized text")).toEqual({ supplement: "Untagged", canon: "core" });
  });
});

// ─── knownOfficialSupplements ─────────────────────────────────────────────────

describe("knownOfficialSupplements", () => {
  it("returns a sorted, de-duplicated array", () => {
    const names = knownOfficialSupplements();
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
  });

  it("includes the known official books and excludes non-canon sources", () => {
    const names = knownOfficialSupplements();
    expect(names).toContain("Maximum Metal");
    expect(names).toContain("Chromebook 1");
    expect(names).toContain("Chromebook 4");
    expect(names).toContain("Solo of Fortune");
    expect(names).toContain("Corporate Report");
    expect(names).not.toContain("Shadowrun");
  });
});

// ─── knownNoncanonSources ─────────────────────────────────────────────────────

describe("knownNoncanonSources", () => {
  it("returns a sorted, de-duplicated array", () => {
    const names = knownNoncanonSources();
    expect(names).toEqual([...names].sort());
    expect(new Set(names).size).toBe(names.length);
  });

  it("includes the known non-canon sources and excludes official books", () => {
    const names = knownNoncanonSources();
    expect(names).toContain("Shadowrun");
    expect(names).toContain("When Gravity Fails");
    expect(names).toContain("Other online");
    expect(names).toContain("Datafortress 2020");
    expect(names).toContain("Blackhammer Project");
    expect(names).not.toContain("Maximum Metal");
  });
});

// ─── shortSupplement ──────────────────────────────────────────────────────────

describe("shortSupplement", () => {
  it("abbreviates the long / common names", () => {
    expect(shortSupplement("Cyberpunk 2020 (Core)")).toBe("Core");
    expect(shortSupplement("Maximum Metal")).toBe("Max Metal");
    expect(shortSupplement("Solo of Fortune 2")).toBe("SoF 2");
  });

  it("returns unmapped names unchanged", () => {
    expect(shortSupplement("Wildside")).toBe("Wildside");
  });
});

// ─── sourceState ──────────────────────────────────────────────────────────────

describe("sourceState", () => {
  it("core is always present + enabled for players, regardless of cfg", () => {
    expect(sourceState("Cyberpunk 2020 (Core)", "core", {})).toEqual({ present: true, enabledForPlayers: true });
    expect(sourceState("Untagged", "core", { allowHomebrew: false, enabledSources: {} }))
      .toEqual({ present: true, enabledForPlayers: true });
  });

  it("official is always present; player-enabled only when toggled in cfg", () => {
    expect(sourceState("Maximum Metal", "official", {}))
      .toEqual({ present: true, enabledForPlayers: false });
    expect(sourceState("Maximum Metal", "official", { enabledSources: { "Maximum Metal": true } }))
      .toEqual({ present: true, enabledForPlayers: true });
  });

  it("noncanon is absent entirely without allowHomebrew", () => {
    expect(sourceState("Shadowrun", "noncanon", {}))
      .toEqual({ present: false, enabledForPlayers: false });
    expect(sourceState("Shadowrun", "noncanon", { allowHomebrew: false }))
      .toEqual({ present: false, enabledForPlayers: false });
  });

  it("noncanon with allowHomebrew behaves like official (per-source toggle)", () => {
    expect(sourceState("Shadowrun", "noncanon", { allowHomebrew: true }))
      .toEqual({ present: true, enabledForPlayers: false });
    expect(sourceState("Shadowrun", "noncanon", { allowHomebrew: true, enabledSources: { Shadowrun: true } }))
      .toEqual({ present: true, enabledForPlayers: true });
  });
});

// ─── isVisibleTo ──────────────────────────────────────────────────────────────

describe("isVisibleTo", () => {
  it("core content is visible to players with no config", () => {
    expect(isVisibleTo("Core gear", "core", {}, false)).toBe(true);
  });

  it("official content is GM-only until enabled for players", () => {
    expect(isVisibleTo("Maximum Metal", "official", {}, false)).toBe(false);
    expect(isVisibleTo("Maximum Metal", "official", {}, true)).toBe(true);
  });

  it("noncanon content is hidden even from the GM until allowHomebrew", () => {
    expect(isVisibleTo("Shadowrun", "noncanon", {}, true)).toBe(false);
  });

  it("noncanon content enabled under allowHomebrew is visible to players", () => {
    expect(isVisibleTo("Shadowrun", "noncanon", { allowHomebrew: true, enabledSources: { Shadowrun: true } }, false))
      .toBe(true);
  });
});
