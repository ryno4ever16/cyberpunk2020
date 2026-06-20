/**
 * Unit tests for the PURE preset logic in module/presets.js (no game.settings / game.i18n).
 *   - PRESETS: 4 tiers in additive order, each resolving to a full value map over the same key set.
 *   - per-tier value spot-checks against the authoritative spec (PRESETS-SPEC.md).
 *   - presetChanges(): the diff (changed keys + notable features going off→on) against a current map.
 * The impure applyPreset/undoPreset/currentSettings wrappers are covered by the rig probe instead.
 */
import { describe, it, expect } from "vitest";
import { PRESETS, resolvePreset, presetKeys, presetChanges } from "../../module/presets.js";

describe("PRESETS structure", () => {
  it("has the 4 tiers in additive order", () => {
    expect(PRESETS.map((p) => p.id)).toEqual(["manual", "standard", "bythebook", "crunch"]);
  });

  it("every tier resolves to a map over the identical key set (additive, no stray keys)", () => {
    const keys = presetKeys().slice().sort();
    for (const p of PRESETS) {
      expect(Object.keys(p.settings).slice().sort(), `tier ${p.id} key set`).toEqual(keys);
    }
  });

  it("each tier carries a label + description key", () => {
    for (const p of PRESETS) {
      expect(p.labelKey, p.id).toBeTruthy();
      expect(p.descKey, p.id).toBeTruthy();
    }
  });
});

describe("per-tier values (authoritative spec)", () => {
  const M = resolvePreset("manual");
  const S = resolvePreset("standard");
  const B = resolvePreset("bythebook");
  const C = resolvePreset("crunch");

  it("universal baseline is identical across tiers", () => {
    for (const t of [M, S, B, C]) {
      expect(t.headHitDoubling).toBe(true);
      expect(t.damageArmorMode).toBe("full");
    }
  });

  it("Manual: everything off, IP disabled, Core", () => {
    expect(M.damageAutoApply).toBe(false);
    expect(M.limbLossEnabled).toBe(false);
    expect(M.shoppingEnabled).toBe(false);
    expect(M.vehicleControlEnabled).toBe(false);
    expect(M.ipRawTracking).toBe(false);
    expect(M.mmEnabled).toBe(false);
    expect(M.limbModel).toBe("core");
  });

  it("Standard: full combat automation (incl. RAW combat rules) + subsystems + RAW IP; bookkeeping OFF", () => {
    // full automation on
    for (const k of [
      "damageAutoApply", "autoRangefinding", "autoDeathSavePerTurn", "autoSaveRePrompt",
      "activeDodgeParryEnabled", "aimTrackingEnabled", "waitForTurnEnabled", "fumbleTableEnabled",
      "multiActionPenaltyEnabled", "multiActionAutoTrack", "limbLossEnabled", "suppressiveFireSaves",
      "shotgunSpreadEnabled", "explosivesEnabled", "areaEffectOcclusion", "gasGrenadeCloudEnabled",
      "taserCumPenaltyEnabled", "acidArmorDotEnabled", "fireDotEnabled", "specialMeleeEffectsEnabled",
    ]) expect(S[k], `Standard.${k}`).toBe(true);
    expect(S.shoppingEnabled).toBe(true);
    expect(S.vehicleControlEnabled).toBe(true);
    expect(S.vehicleDamageEnabled).toBe(true);
    expect(S.ipRawTracking).toBe(true);
    // bookkeeping delta deliberately still off in Standard
    expect(S.restrictMovementOncePerTurn).toBe(false);
    expect(S.damageAblation).toBe(false);
    expect(S.damageLayersEnabled).toBe(false);
    expect(S.applyLayerEVPenalty).toBe(false);
    expect(S.mmEnabled).toBe(false);
    expect(S.limbModel).toBe("core");
  });

  it("By the Book: Standard + bookkeeping + RAW IP, no supplements", () => {
    expect(B.restrictMovementOncePerTurn).toBe(true);
    expect(B.damageAblation).toBe(true);
    expect(B.damageLayersEnabled).toBe(true);
    expect(B.applyLayerEVPenalty).toBe(true);
    expect(B.ipRawTracking).toBe(true);   // inherited from Standard
    expect(B.limbLossEnabled).toBe(true);      // inherited from Standard
    expect(B.layerRuleSystem).toBe("Core");    // Core layer math, not Chromebook 4
    expect(B.mmEnabled).toBe(false);
    expect(B.limbModel).toBe("core");
  });

  it("Maximum Crunch: By the Book + Maximum Metal + Listen Up + ammo/layer crunch", () => {
    expect(C.mmEnabled).toBe(true);
    expect(C.vehicleRuleSystem).toBe("MaximumMetal");
    expect(C.vehicleArmorDamageEnabled).toBe(true);
    expect(C.vehicleMoraleEnabled).toBe(true);
    expect(C.vehicleArcEnforcement).toBe("strict");
    expect(C.limbModel).toBe("listenup");
    expect(C.explosivesDetailed).toBe(true);
    expect(C.fnff2Enabled).toBe(true);
    expect(C.layerRuleSystem).toBe("Chromebook 4");
    expect(C.reloadByMagazines).toBe(true);
    expect(C.ipRawTracking).toBe(true);        // inherited
  });
});

describe("presetChanges (pure diff)", () => {
  it("unknown id → empty diff", () => {
    expect(presetChanges("nope", {})).toEqual({ changed: [], featuresOn: [] });
  });

  it("same tier vs its own resolved map → no changes", () => {
    const res = presetChanges("standard", resolvePreset("standard"));
    expect(res.changed).toEqual([]);
    expect(res.featuresOn).toEqual([]);
  });

  it("Manual → Standard: names auto-apply/RAW IP/shopping/vehicles", () => {
    const res = presetChanges("standard", resolvePreset("manual"));
    const ids = res.featuresOn.map((f) => f.id);
    expect(ids).toContain("autoApply");
    expect(ids).toContain("limbLoss");
    expect(ids).toContain("rawIp");            // Standard now defaults to RAW IP
    expect(ids).toContain("shopping");
    expect(ids).toContain("vehicles");
    expect(ids).not.toContain("maximumMetal");
    expect(res.changed.length).toBeGreaterThan(0);
  });

  it("Standard → By the Book: names layers + ablation + restrict-move, NOT raw IP (already on)", () => {
    const res = presetChanges("bythebook", resolvePreset("standard"));
    const ids = res.featuresOn.map((f) => f.id);
    expect(ids).toContain("layers");
    expect(ids).toContain("ablation");
    expect(ids).toContain("restrictMove");
    expect(ids).not.toContain("rawIp");        // already raw in Standard
    expect(ids).not.toContain("autoApply");    // already on in Standard
  });

  it("By the Book → Maximum Crunch: names Maximum Metal + Listen Up", () => {
    const res = presetChanges("crunch", resolvePreset("bythebook"));
    const ids = res.featuresOn.map((f) => f.id);
    expect(ids).toContain("maximumMetal");
    expect(ids).toContain("listenUp");
    expect(ids).not.toContain("rawIp");        // already raw in By the Book
  });

  it("every featuresOn entry carries a nameKey for the confirm dialog", () => {
    for (const f of presetChanges("crunch", resolvePreset("manual")).featuresOn) {
      expect(f.nameKey, f.id).toBeTruthy();
    }
  });
});
