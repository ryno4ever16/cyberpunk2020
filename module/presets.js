/**
 * Settings presets — 4 additive playstyle tiers (Manual / Standard / By the Book / Maximum Crunch).
 *
 * One green-lit click sets a coherent bundle of world settings instead of asking a new GM to wade
 * through the ~50-toggle list. Tiers stack: each is the previous one plus a clean delta. The data here
 * (the resolved per-tier value maps + the "notable feature" diff) is PURE and unit-tested; the apply /
 * undo wrappers read & write game.settings (impure). The picker UI lives in dialog/preset-picker.js.
 *
 * NOT touched by any preset (a GM/per-user choice): permissions, client display prefs, GM content/
 * pricing (shopBuySource, shopAllowHomebrew, ammoBlackhandsPricing, hitLocationCoreDisplay), the IP &
 * DoT fine-tuning, and all config:false stores. Spec: repo-root PRESETS-SPEC.md.
 */

const SCOPE = "cyberpunk2020";

// MANUAL = every preset-controlled setting at its "off / Core" value. Its KEYS define the full universe
// a preset touches; the deltas below only override.
const MANUAL = {
  // Combat automation — all off
  damageAutoApply: false, autoRangefinding: false, autoDeathSavePerTurn: false, autoSaveRePrompt: false,
  activeDodgeParryEnabled: false, aimTrackingEnabled: false, waitForTurnEnabled: false, fumbleTableEnabled: false,
  multiActionPenaltyEnabled: false, multiActionAutoTrack: false, limbLossEnabled: false, suppressiveFireSaves: false,
  shotgunSpreadEnabled: false, explosivesEnabled: false, areaEffectOcclusion: false, gasGrenadeCloudEnabled: false,
  taserCumPenaltyEnabled: false, acidArmorDotEnabled: false, fireDotEnabled: false, specialMeleeEffectsEnabled: false,
  // Subsystems — Shopping + Improvement-Point (RAW) tracking are ON at EVERY tier: both are ignorable
  // if unused (the Model-A neglect detector keeps RAW IP safe as a default), so they belong in the
  // baseline rather than a tier upgrade. Vehicles stay off until Standard. ipHideUI is a separate
  // manual GM presence choice that presets never touch.
  shoppingEnabled: true, vehicleControlEnabled: false, vehicleDamageEnabled: false, ipRawTracking: true,
  // Bookkeeping rules + supplements — off / Core
  restrictMovementOncePerTurn: false, damageAblation: false, damageLayersEnabled: false, applyLayerEVPenalty: false,
  layerRuleSystem: "Core", mmEnabled: false, vehicleRuleSystem: "Core", vehicleArmorDamageEnabled: false,
  vehicleMoraleEnabled: false, vehicleArcEnforcement: "free", reloadByMagazines: false, fnff2Enabled: false,
  explosivesDetailed: false,
  // Universal baseline (same in every tier; Crunch overrides limbModel)
  headHitDoubling: true, damageArmorMode: "full", limbModel: "core",
};

// STANDARD = Manual + full combat automation on + core subsystems. (Shopping + RAW IP are already on
// from Manual — they're ignorable subsystems available at every tier.)
const STANDARD_DELTA = {
  damageAutoApply: true, autoRangefinding: true, autoDeathSavePerTurn: true, autoSaveRePrompt: true,
  activeDodgeParryEnabled: true, aimTrackingEnabled: true, waitForTurnEnabled: true, fumbleTableEnabled: true,
  multiActionPenaltyEnabled: true, multiActionAutoTrack: true, limbLossEnabled: true, suppressiveFireSaves: true,
  shotgunSpreadEnabled: true, explosivesEnabled: true, areaEffectOcclusion: true, gasGrenadeCloudEnabled: true,
  taserCumPenaltyEnabled: true, acidArmorDotEnabled: true, fireDotEnabled: true, specialMeleeEffectsEnabled: true,
  vehicleControlEnabled: true, vehicleDamageEnabled: true,
};

// BY THE BOOK = Standard + the divisive-but-faithful bookkeeping rules. (IP is already RAW from Standard.)
const BYBOOK_DELTA = {
  restrictMovementOncePerTurn: true, damageAblation: true, damageLayersEnabled: true, applyLayerEVPenalty: true,
};

// MAXIMUM CRUNCH = By the Book + the supplement layer (Maximum Metal + Listen Up + ammo/layer crunch).
const CRUNCH_DELTA = {
  mmEnabled: true, vehicleRuleSystem: "MaximumMetal", vehicleArmorDamageEnabled: true, vehicleMoraleEnabled: true,
  vehicleArcEnforcement: "strict", limbModel: "listenup", explosivesDetailed: true, fnff2Enabled: true,
  layerRuleSystem: "Chromebook 4", reloadByMagazines: true,
};

const MANUAL_MAP   = { ...MANUAL };
const STANDARD_MAP = { ...MANUAL_MAP, ...STANDARD_DELTA };
const BYBOOK_MAP   = { ...STANDARD_MAP, ...BYBOOK_DELTA };
const CRUNCH_MAP   = { ...BYBOOK_MAP, ...CRUNCH_DELTA };

/** The 4 tiers, in additive order. `settings` is the fully-resolved value map for that tier. */
export const PRESETS = [
  { id: "manual",   labelKey: "PresetManual",         descKey: "PresetManualDesc",         settings: MANUAL_MAP },
  { id: "standard", labelKey: "PresetStandard",       descKey: "PresetStandardDesc",       settings: STANDARD_MAP },
  { id: "bythebook", labelKey: "PresetByTheBook",     descKey: "PresetByTheBookDesc",      settings: BYBOOK_MAP },
  { id: "crunch",   labelKey: "PresetMaximumCrunch",  descKey: "PresetMaximumCrunchDesc",  settings: CRUNCH_MAP },
];

/** Notable ACTIVE features a preset can switch on, named in the confirm dialog (esp. silent ones). */
const NOTABLE = [
  { id: "autoApply",    key: "damageAutoApply",            on: (v) => v === true,      nameKey: "PresetFeatureAutoApply" },
  { id: "rawIp",        key: "ipRawTracking",              on: (v) => v === true,      nameKey: "PresetFeatureRawIp" },
  { id: "maximumMetal", key: "mmEnabled",                  on: (v) => v === true,      nameKey: "PresetFeatureMaximumMetal" },
  { id: "limbLoss",     key: "limbLossEnabled",            on: (v) => v === true,      nameKey: "PresetFeatureLimbLoss" },
  { id: "layers",       key: "damageLayersEnabled",        on: (v) => v === true,      nameKey: "PresetFeatureLayers" },
  { id: "ablation",     key: "damageAblation",             on: (v) => v === true,      nameKey: "PresetFeatureAblation" },
  { id: "restrictMove", key: "restrictMovementOncePerTurn", on: (v) => v === true,     nameKey: "PresetFeatureRestrictMove" },
  { id: "listenUp",     key: "limbModel",                  on: (v) => v === "listenup", nameKey: "PresetFeatureListenUp" },
  { id: "shopping",     key: "shoppingEnabled",            on: (v) => v === true,      nameKey: "PresetFeatureShopping" },
  { id: "vehicles",     key: "vehicleControlEnabled",      on: (v) => v === true,      nameKey: "PresetFeatureVehicles" },
];

/** PURE: the resolved value map for a tier id, or null. */
export function resolvePreset(id) {
  return PRESETS.find((p) => p.id === id)?.settings ?? null;
}

/** Every setting key a preset controls (the snapshot/undo universe). */
export function presetKeys() {
  return Object.keys(MANUAL_MAP);
}

/**
 * PURE: diff a tier against a plain { key: value } map of CURRENT values.
 * @returns {{changed:string[], featuresOn:{id:string,nameKey:string}[]}} keys that change, and the
 *   notable active features going from off→on (for the confirm dialog).
 */
export function presetChanges(id, current = {}) {
  const target = resolvePreset(id);
  if (!target) return { changed: [], featuresOn: [] };
  const changed = Object.keys(target).filter((k) => current[k] !== target[k]);
  const featuresOn = NOTABLE
    .filter((f) => f.on(target[f.key]) && !f.on(current[f.key]))
    .map((f) => ({ id: f.id, nameKey: f.nameKey }));
  return { changed, featuresOn };
}

/** IMPURE: read every preset-controlled setting's current value into a plain map. */
export function currentSettings() {
  const cur = {};
  for (const k of presetKeys()) {
    try { cur[k] = game.settings.get(SCOPE, k); } catch (e) { cur[k] = undefined; }
  }
  return cur;
}

/**
 * IMPURE: apply a tier. Snapshots EVERY touched key's prior value first (for exact undo), then writes
 * only the ones that differ. Safe-per-key (a failed write is logged, not fatal).
 * @returns {Promise<?{presetId:string, snapshot:Object}>} the snapshot for undoPreset(), or null.
 */
export async function applyPreset(id) {
  const target = resolvePreset(id);
  if (!target) return null;
  const snapshot = {};
  for (const [k, v] of Object.entries(target)) {
    let cur;
    try { cur = game.settings.get(SCOPE, k); } catch (e) { cur = undefined; }
    snapshot[k] = cur;
    if (cur !== v) {
      try { await game.settings.set(SCOPE, k, v); }
      catch (e) { console.error(`Cyberpunk2020 | preset "${id}" failed to set ${k}`, e); }
    }
  }
  return { presetId: id, snapshot };
}

/** IMPURE: restore a snapshot taken by applyPreset (one-step undo). */
export async function undoPreset(snapshot) {
  if (!snapshot) return;
  for (const [k, v] of Object.entries(snapshot)) {
    if (v === undefined) continue;
    let cur;
    try { cur = game.settings.get(SCOPE, k); } catch (e) { cur = undefined; }
    if (cur !== v) {
      try { await game.settings.set(SCOPE, k, v); }
      catch (e) { console.error(`Cyberpunk2020 | preset undo failed to restore ${k}`, e); }
    }
  }
}
