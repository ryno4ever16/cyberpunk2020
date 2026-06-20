import { getHtmlElement } from "./compat.js";
import { localize } from "./utils.js";

const SCOPE = "cyberpunk2020";

/**
 * Phase-2 settings organizer — enhances Foundry's NATIVE System Settings page (no parallel app, no
 * config:false flips): inserts labelled section headers, reorders each section's settings contiguously,
 * and master-gates sub-options (grey + disable while their master toggle is off, live-updating). This
 * generalizes the original Maximum-Metal renderSettingsConfig hook into one data-driven mechanism, so
 * a human edits a list instead of N bespoke hooks. Everything is wrapped so a DOM hiccup can never
 * break the settings page (it just renders unorganized).
 *
 * Headers use CYBERPUNK.Section* i18n keys (via localize). Master-gating reuses the .cp-mm-disabled
 * class. config:false stores and the preset-menu button are left untouched (only registered settings
 * with a [name="cyberpunk2020.<key>"] control are moved).
 */

// Display order of the sections + the settings in each (registered keys only; absent ones are skipped).
const SECTIONS = [
  { key: "SectionDamage", keys: [
    "damageArmorMode", "damageAutoApply", "damageAblation", "headHitDoubling", "limbLossEnabled",
    "limbModel", "hitLocationCoreDisplay",
  ] },
  { key: "SectionArmorLayers", keys: ["damageLayersEnabled", "applyLayerEVPenalty", "layerRuleSystem"] },
  { key: "SectionCombatAutomation", keys: [
    "autoRangefinding", "activeDodgeParryEnabled", "aimTrackingEnabled", "waitForTurnEnabled",
    "specialMeleeEffectsEnabled", "multiActionPenaltyEnabled", "multiActionAutoTrack",
    "suppressiveFireSaves", "autoDeathSavePerTurn", "autoSaveRePrompt", "restrictMovementOncePerTurn",
  ] },
  { key: "SectionWeaponEffects", keys: [
    "shotgunSpreadEnabled", "explosivesEnabled", "explosivesDetailed", "areaEffectOcclusion",
    "gasGrenadeCloudEnabled", "gasCloudAutoMove", "taserCumPenaltyEnabled", "acidArmorDotEnabled",
    "acidDotStackMode", "fireDotEnabled", "fireDotStackMode",
  ] },
  { key: "SectionOptionalRules", keys: ["fumbleTableEnabled", "autoFumbleOnlyJam", "reloadByMagazines", "fnff2Enabled"] },
  { key: "SectionImprovementPoints", keys: [
    "ipRawTracking", "ipAwardModel", "ipAutoBaselineAmount", "ipThrottle", "ipSkillLockMode",
    "ipHideUI", "ipShowPending",
  ] },
  { key: "SectionShopping", keys: ["shoppingEnabled", "playersCanShop", "shopBuySource", "shopAllowHomebrew", "ammoBlackhandsPricing", "shopShowSource"] },
  { key: "SectionVehicles", keys: ["vehicleControlEnabled", "vehicleDamageEnabled", "mmEnabled", "vehicleRuleSystem", "vehicleArmorDamageEnabled", "vehicleMoraleEnabled", "vehicleArcEnforcement"] },
  { key: "SectionAccess", keys: ["playersCanBuyAmmo", "playersCanEditCyberwareHumanity"] },
  { key: "SectionDisplay", keys: ["trainedSkillsFirst"] },
];

// master toggle → the sub-settings that only matter when it's on (greyed + disabled while it's off).
const MASTERS = {
  mmEnabled:                 ["vehicleRuleSystem", "vehicleArmorDamageEnabled", "vehicleMoraleEnabled", "vehicleArcEnforcement"],
  ipRawTracking:             ["ipAwardModel", "ipAutoBaselineAmount", "ipThrottle", "ipSkillLockMode"],
  shoppingEnabled:           ["playersCanShop", "shopBuySource", "shopAllowHomebrew", "shopShowSource"],
  damageLayersEnabled:       ["applyLayerEVPenalty", "layerRuleSystem"],
  explosivesEnabled:         ["explosivesDetailed", "areaEffectOcclusion"],
  gasGrenadeCloudEnabled:    ["gasCloudAutoMove"],
  acidArmorDotEnabled:       ["acidDotStackMode"],
  fireDotEnabled:            ["fireDotStackMode"],
  fumbleTableEnabled:        ["autoFumbleOnlyJam"],
  multiActionPenaltyEnabled: ["multiActionAutoTrack"],
};

/** Organize the rendered System Settings page (called from the renderSettingsConfig hook). */
export function enhanceSettingsConfig(html) {
  try {
    const root = getHtmlElement(html);
    if (!root?.querySelector) return;
    const groupOf = (k) => {
      const el = root.querySelector(`[name="${SCOPE}.${k}"], [data-setting-id="${SCOPE}.${k}"]`);
      return el?.closest(".form-group") ?? el?.closest(".setting") ?? null;
    };

    // 1. Build the ordered [header, ...groups] sequence for each present section.
    const sequence = [];
    for (const section of SECTIONS) {
      const groups = section.keys.map(groupOf).filter(Boolean);
      if (!groups.length) continue;
      let header = root.querySelector(`.cp-settings-header[data-cp-section="${section.key}"]`);
      if (!header) {
        header = document.createElement("h3");
        header.className = "cp-settings-header";
        header.dataset.cpSection = section.key;
        header.textContent = localize(section.key);
      }
      sequence.push(header, ...groups);
    }
    if (!sequence.length) return;

    // 2. Reorder: place the sequence in order, starting right after whatever currently precedes our
    //    first setting group (keeps the system header + the preset-menu button at the top untouched).
    const firstGroup = SECTIONS.flatMap((s) => s.keys).map(groupOf).find(Boolean);
    const container = firstGroup?.parentNode;
    if (!container) return;
    let cursor = firstGroup.previousSibling;
    for (const node of sequence) {
      const ref = cursor ? cursor.nextSibling : container.firstChild;
      if (node !== ref) container.insertBefore(node, ref);
      cursor = node;
    }

    // 3. Master-gating: grey + disable each master's sub-settings while it's off; live-update on change.
    for (const [master, subs] of Object.entries(MASTERS)) {
      const masterInput = groupOf(master)?.querySelector(`[name="${SCOPE}.${master}"]`);
      if (!masterInput || masterInput.dataset.cpGateBound === "1") continue;
      const subGroups = subs.map(groupOf).filter(Boolean);
      if (!subGroups.length) continue;
      const setEnabled = (on) => {
        for (const g of subGroups) {
          g.classList.toggle("cp-mm-disabled", !on);
          g.querySelectorAll("input,select,button,textarea").forEach((el) => { el.disabled = !on; });
        }
      };
      setEnabled(!!masterInput.checked);
      masterInput.addEventListener("change", () => setEnabled(!!masterInput.checked));
      masterInput.dataset.cpGateBound = "1";
    }
  } catch (err) {
    console.warn("Cyberpunk2020 | settings-config organizer failed (settings still usable)", err);
  }
}
