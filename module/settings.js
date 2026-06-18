import { localize } from "./utils.js";

const SCOPE = "cyberpunk2020";

/** Master Maximum Metal toggle. When OFF (default), every MM-overlay feature falls back to Core CP2020. */
export function mmEnabled() {
  try { return !!game.settings.get(SCOPE, "mmEnabled"); } catch { return false; }
}

/** Reputation + Facedown feature (CP2020 p.54). On by default; tables that skip Rep can hide the panel. */
export function reputationEnabled() {
  try { return game.settings.get(SCOPE, "reputationEnabled") !== false; } catch { return true; }
}

/** The active vehicle ruleset, gated by the master MM toggle: forces "Core" whenever MM is off. */
export function effectiveVehicleRuleSystem() {
  try { return mmEnabled() ? (game.settings.get(SCOPE, "vehicleRuleSystem") || "Core") : "Core"; }
  catch { return "Core"; }
}

/** Mount-arc enforcement: "free" (warn-but-allow, default) or "strict" (block out-of-arc shots). */
export function vehicleArcEnforcement() {
  try { return game.settings.get(SCOPE, "vehicleArcEnforcement") || "free"; } catch { return "free"; }
}

// --- Shopping / economy ---------------------------------------------------
/** Master toggle for the Shopping feature (Shop button + purchases). Off by default (opt-in). */
export function shoppingEnabled() {
  // Defer the whole shop surface (sidebar cart, catalog, Services tab, drag-to-buy) to the
  // Cyberpunk 2020: Augmented Edition module when it is active, so the two don't double up.
  if (globalThis.game?.modules?.get?.("cp2020-augmented")?.active) return false;
  try { return game.settings.get(SCOPE, "shoppingEnabled") === true; } catch { return false; }
}

/** Whether the current user may purchase. GMs always may; players only when allowed by the setting. */
export function canShop() {
  if (game.user?.isGM) return true;
  try { return game.settings.get(SCOPE, "playersCanShop") !== false; } catch { return true; }
}

/** Player buy source when buying directly: "catalog" (full compendia) or "shops" (published shops only). */
export function shopBuySource() {
  try { return game.settings.get(SCOPE, "shopBuySource") || "catalog"; } catch { return "catalog"; }
}

/**
 * Per-supplement visibility OVERRIDES for the full catalog, as a map { supplementName: true|false }
 * (true = force-show, false = force-hide). Un-listed supplements fall back to their category default
 * (Core/official/untagged shown; community/non-canon hidden). Managed from the catalog UI.
 */
export function shopSupplementOverrides() {
  try { return game.settings.get(SCOPE, "shopSupplementOverrides") || {}; } catch { return {}; }
}

/** Master gate: are homebrew (non-canon/community) sources allowed in play at all? (System settings.) */
export function shopAllowHomebrew() {
  try { return game.settings.get(SCOPE, "shopAllowHomebrew") === true; } catch { return false; }
}

/** Per-source enable map { supplementName: true } for players (GM-curated from the shop). */
export function shopEnabledSources() {
  try { return game.settings.get(SCOPE, "shopEnabledSources") || {}; } catch { return {}; }
}

/** Per-user toggle: show the item source/supplement badge in the shop (default on). */
export function shopShowSource() {
  try { return game.settings.get(SCOPE, "shopShowSource") !== false; } catch { return true; }
}

/** Bundled config for the supplement-visibility helpers in shop/supplements.js. */
export function shopSourceConfig() {
  return { allowHomebrew: shopAllowHomebrew(), enabledSources: shopEnabledSources() };
}

// --- IP (Improvement Points) tracker ([[ip-tracker-design]]) ---------------
/** IP system mode: "disabled" (default — free skill editing) / "simple" (single pool) / "raw" (per-skill tracker). */
export function ipSystem() {
  try { return game.settings.get(SCOPE, "ipSystem") || "disabled"; } catch { return "disabled"; }
}
/** Whether the IP system is active at all. */
export function ipEnabled() {
  // Stand the system IP feature down when "Cyberpunk 2020: Augmented Edition" is active — it owns the
  // IP layer (storing IP in module flags), so the system's own IP UI/logic must not show stale data.
  if (globalThis.game?.modules?.get?.("cp2020-augmented")?.active) return false;
  return ipSystem() !== "disabled";
}

/** IP award model: "manual" (RAW GM-per-use, default) / "autoBaseline" (GM-marked success → +N). */
export function ipAwardModel() {
  try { return game.settings.get(SCOPE, "ipAwardModel") || "manual"; } catch { return "manual"; }
}
/** IP auto-granted per GM-marked success when the award model is autoBaseline (default 1). */
export function ipAutoBaselineAmount() {
  try { const n = Number(game.settings.get(SCOPE, "ipAutoBaselineAmount")); return Number.isFinite(n) ? n : 1; } catch { return 1; }
}
/** Anti-grind throttle: "off" (default) / "hardcap" (1/skill/apply-cycle) / "diminishing" (halving). */
export function ipThrottle() {
  try { return game.settings.get(SCOPE, "ipThrottle") || "off"; } catch { return "off"; }
}
/** Skill-lock control mode: "owner" (default) / "gm" / "mutual" (two-tier). */
export function ipSkillLockMode() {
  try { return game.settings.get(SCOPE, "ipSkillLockMode") || "owner"; } catch { return "owner"; }
}
/** Per-user toggle: show the GM-only "pending IP" pip on skill rows (default on). */
export function ipShowPending() {
  try { return game.settings.get(SCOPE, "ipShowPending") !== false; } catch { return true; }
}

export function registerSystemSettings() {
   /**
   * Track the system version upon which point a migration was last applied
   */
  game.settings.register("cyberpunk2020", "systemMigrationVersion", {
    name: "SETTINGS.SysMigration",
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  // Tracks the focused ammo-caliber cleanup (see migrate.js migrateAmmoCalibers). Self-gating,
  // separate from the main migration so it can run without a version bump. Not shown in the menu.
  game.settings.register("cyberpunk2020", "ammoCaliberMigration", {
    scope: "world",
    config: false,
    type: String,
    default: ""
  });

  game.settings.register("cyberpunk2020", "trainedSkillsFirst", {
    name: "SETTINGS.TrainedSkillsFirst",
    hint: "SETTINGS.TrainedSkillsFirstHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

    // --- Ammunition: purchasing access ---
  game.settings.register("cyberpunk2020", "playersCanBuyAmmo", {
    name: "SETTINGS.PlayersCanBuyAmmo",
    hint: "SETTINGS.PlayersCanBuyAmmoHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register("cyberpunk2020", "ammoLockerEnabled", {
    name: "SETTINGS.AmmoLockerEnabled",
    hint: "SETTINGS.AmmoLockerEnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

    // --- Ammunition: optional Blackhand's Guide pricing ---
  game.settings.register("cyberpunk2020", "ammoUseBlackhandsBoxes", {
    name: "SETTINGS.AmmoBlackhandsBoxes",
    hint: "SETTINGS.AmmoBlackhandsBoxesHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register("cyberpunk2020", "ammoUseBlackhandsBrass", {
    name: "SETTINGS.AmmoBlackhandsBrass",
    hint: "SETTINGS.AmmoBlackhandsBrassHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

    // --- Shopping / economy ---
  game.settings.register("cyberpunk2020", "shoppingEnabled", {
    name: "SETTINGS.ShoppingEnabled",
    hint: "SETTINGS.ShoppingEnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register("cyberpunk2020", "playersCanShop", {
    name: "SETTINGS.PlayersCanShop",
    hint: "SETTINGS.PlayersCanShopHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register("cyberpunk2020", "shopBuySource", {
    name: "SETTINGS.ShopBuySource",
    hint: "SETTINGS.ShopBuySourceHint",
    scope: "world",
    config: true,
    type: String,
    choices: { catalog: "SETTINGS.ShopBuySourceCatalog", shops: "SETTINGS.ShopBuySourceShops" },
    default: "catalog"
  });

    // Per-supplement catalog visibility overrides { name: true|false }. Un-listed = category default
    // (Core/official shown, community/non-canon hidden). GM-managed from the catalog UI.
  game.settings.register("cyberpunk2020", "shopSupplementOverrides", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

    // Master gate for homebrew (non-canon/community) content. The deliberate System-Settings step:
    // homebrew is absent from the shop entirely until this is on (then curated per-source in the shop).
  game.settings.register("cyberpunk2020", "shopAllowHomebrew", {
    name: "SETTINGS.ShopAllowHomebrew",
    hint: "SETTINGS.ShopAllowHomebrewHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

    // Per-source enable map { supplementName: true } for PLAYERS. GM-curated via in-shop controls.
  game.settings.register("cyberpunk2020", "shopEnabledSources", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

    // Per-user: show the item source/supplement badge in the shop (default on; each player can hide).
  game.settings.register("cyberpunk2020", "shopShowSource", {
    name: "SETTINGS.ShopShowSource",
    hint: "SETTINGS.ShopShowSourceHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

    // GM custom shops (round-7: shops are world DATA, not Actors). Map { [id]: ShopDef }. GM-written;
    // all clients read it. See module/shop/shops.js for the ShopDef shape + CRUD.
  game.settings.register("cyberpunk2020", "shops", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

    // One-time flag: the shop-Actor -> ShopDef migration has run in this world.
  game.settings.register("cyberpunk2020", "shopsMigrated", {
    scope: "world",
    config: false,
    type: Boolean,
    default: false
  });

    // --- IP (Improvement Points) tracker ---
  game.settings.register("cyberpunk2020", "ipSystem", {
    name: "SETTINGS.IpSystem",
    hint: "SETTINGS.IpSystemHint",
    scope: "world",
    config: true,
    type: String,
    choices: { disabled: "SETTINGS.IpSystemDisabled", simple: "SETTINGS.IpSystemSimple", raw: "SETTINGS.IpSystemRaw" },
    default: "disabled"
  });

  game.settings.register("cyberpunk2020", "ipAwardModel", {
    name: "SETTINGS.IpAwardModel",
    hint: "SETTINGS.IpAwardModelHint",
    scope: "world",
    config: true,
    type: String,
    choices: { manual: "SETTINGS.IpAwardManual", autoBaseline: "SETTINGS.IpAwardAuto" },
    default: "manual"
  });

  game.settings.register("cyberpunk2020", "ipAutoBaselineAmount", {
    name: "SETTINGS.IpAutoBaselineAmount",
    hint: "SETTINGS.IpAutoBaselineAmountHint",
    scope: "world",
    config: true,
    type: Number,
    default: 1
  });

  game.settings.register("cyberpunk2020", "ipThrottle", {
    name: "SETTINGS.IpThrottle",
    hint: "SETTINGS.IpThrottleHint",
    scope: "world",
    config: true,
    type: String,
    choices: { off: "SETTINGS.IpThrottleOff", hardcap: "SETTINGS.IpThrottleHardcap", diminishing: "SETTINGS.IpThrottleDiminishing" },
    default: "off"
  });

  game.settings.register("cyberpunk2020", "ipSkillLockMode", {
    name: "SETTINGS.IpSkillLockMode",
    hint: "SETTINGS.IpSkillLockModeHint",
    scope: "world",
    config: true,
    type: String,
    choices: { owner: "SETTINGS.IpSkillLockOwner", gm: "SETTINGS.IpSkillLockGm", mutual: "SETTINGS.IpSkillLockMutual" },
    default: "owner"
  });

  game.settings.register("cyberpunk2020", "ipShowPending", {
    name: "SETTINGS.IpShowPending",
    hint: "SETTINGS.IpShowPendingHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

    // IP auto-queue of skill rolls awaiting a GM IP decision (GM working list). Not shown in the menu.
  game.settings.register("cyberpunk2020", "ipQueue", {
    scope: "world",
    config: false,
    type: Array,
    default: []
  });

    // Per-skill IP awards within the current Apply cycle, for the throttle. Not shown in the menu.
  game.settings.register("cyberpunk2020", "ipThrottleCounts", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

    // GM-defined custom calibers: { id: { label, costClass } }. Not shown in the menu.
  game.settings.register("cyberpunk2020", "customCalibers", {
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });

    // --- Optional rules: Fumble Table ---
  game.settings.register("cyberpunk2020", "fumbleTableEnabled", {
    name: "SETTINGS.FumbleTableEnabled",
    hint: "SETTINGS.FumbleTableEnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register("cyberpunk2020", "autoFumbleOnlyJam", {
    name: "SETTINGS.AutoFumbleOnlyJam",
    hint: "SETTINGS.AutoFumbleOnlyJamHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  // --- Optional rules: Reload ---
  game.settings.register("cyberpunk2020", "reloadByMagazines", {
    name: "SETTINGS.ReloadByMagazines",
    hint: "SETTINGS.ReloadByMagazinesHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  // --- Optional rules: Friday Night Fistfight 2 ---
  game.settings.register("cyberpunk2020", "fnff2Enabled", {
    name: "SETTINGS.FNFF2Enabled",
    hint: "SETTINGS.FNFF2EnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  // --- Setup / What's New notice ---
  // The notice shows for the GM on every load until they tick "Don't show this again" (or untick this
  // here to bring it back). Replaces the old one-time `automationMigrationShown` flag so the expanded
  // notice reaches users who already dismissed the original.
  game.settings.register("cyberpunk2020", "automationNoticeHide", {
    name: "SETTINGS.AutomationNoticeHide",
    hint: "SETTINGS.AutomationNoticeHideHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  // --- Damage Automation ---
  game.settings.register("cyberpunk2020", "damageArmorMode", {
    name: "SETTINGS.DamageArmorMode",
    hint: "SETTINGS.DamageArmorModeHint",
    scope:   "world",
    config:  true,
    type:    String,
    choices: {
      "full":   "SETTINGS.DamageArmorModeChoiceFull",
      "simple": "SETTINGS.DamageArmorModeChoiceSimple",
      "none":   "SETTINGS.DamageArmorModeChoiceNone",
    },
    default: "full",
  });

  game.settings.register("cyberpunk2020", "damageAblation", {
    name: "SETTINGS.DamageAblation",
    hint: "SETTINGS.DamageAblationHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  game.settings.register("cyberpunk2020", "damageAutoApply", {
    name: "SETTINGS.DamageAutoApply",
    hint: "SETTINGS.DamageAutoApplyHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // --- Combat Automation ---
  game.settings.register("cyberpunk2020", "autoRangefinding", {
    name: "SETTINGS.AutoRangefinding",
    hint: "SETTINGS.AutoRangefindingHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // --- Reputation + Facedown (CP2020 p.54) ---
  game.settings.register("cyberpunk2020", "reputationEnabled", {
    name: "SETTINGS.ReputationEnabled",
    hint: "SETTINGS.ReputationEnabledHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // --- Optional rules: Head Hit & Limb Loss ---
  game.settings.register("cyberpunk2020", "headHitDoubling", {
    name: "SETTINGS.HeadHitDoubling",
    hint: "SETTINGS.HeadHitDoublingHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register("cyberpunk2020", "limbLossEnabled", {
    name: "SETTINGS.LimbLossEnabled",
    hint: "SETTINGS.LimbLossEnabledHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  game.settings.register("cyberpunk2020", "suppressiveFireSaves", {
    name: "SETTINGS.SuppressiveFireSaves",
    hint: "SETTINGS.SuppressiveFireSavesHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // --- Combat Tracker: per-turn saves ---
  game.settings.register("cyberpunk2020", "autoDeathSavePerTurn", {
    name: "SETTINGS.AutoDeathSavePerTurn",
    hint: "SETTINGS.AutoDeathSavePerTurnHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  game.settings.register("cyberpunk2020", "autoSaveRePrompt", {
    name: "SETTINGS.AutoSaveRePrompt",
    hint: "SETTINGS.AutoSaveRePromptHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // --- Optional rules: Layer rule system (Core vs Chromebook 4) ---
  game.settings.register("cyberpunk2020", "layerRuleSystem", {
    name: "SETTINGS.LayerRuleSystem",
    hint: "SETTINGS.LayerRuleSystemHint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "Core":          "SETTINGS.LayerRuleSystemChoiceCore",
      "Chromebook 4":  "SETTINGS.LayerRuleSystemChoiceChromebook4",
    },
    default: "Core",
  });

  // --- Optional rules: New Rule 1 EV enforcement ---
  game.settings.register("cyberpunk2020", "applyLayerEVPenalty", {
    name: "SETTINGS.ApplyLayerEVPenalty",
    hint: "SETTINGS.ApplyLayerEVPenaltyHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // --- Combat Automation: Dodge / Parry active defense ---
  game.settings.register("cyberpunk2020", "activeDodgeParryEnabled", {
    name: "SETTINGS.ActiveDodgeParryEnabled",
    hint: "SETTINGS.ActiveDodgeParryEnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // --- Combat Automation: Aim accumulation tracking ---
  game.settings.register("cyberpunk2020", "aimTrackingEnabled", {
    name: "SETTINGS.AimTrackingEnabled",
    hint: "SETTINGS.AimTrackingEnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // --- Combat Automation: Wait for Turn ---
  game.settings.register("cyberpunk2020", "waitForTurnEnabled", {
    name: "SETTINGS.WaitForTurnEnabled",
    hint: "SETTINGS.WaitForTurnEnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // --- Combat Automation: Special martial arts hit effects ---
  game.settings.register("cyberpunk2020", "specialMeleeEffectsEnabled", {
    name: "SETTINGS.SpecialMeleeEffectsEnabled",
    hint: "SETTINGS.SpecialMeleeEffectsEnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // --- Combat Automation: Gas grenade cloud ---
  game.settings.register("cyberpunk2020", "gasGrenadeCloudEnabled", {
    name: "SETTINGS.GasGrenadeCloudEnabled",
    hint: "SETTINGS.GasGrenadeCloudEnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register("cyberpunk2020", "gasCloudAutoMove", {
    name: "SETTINGS.GasCloudAutoMove",
    hint: "SETTINGS.GasCloudAutoMoveHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // --- Combat Automation: Taser cumulative save penalty ---
  game.settings.register("cyberpunk2020", "taserCumPenaltyEnabled", {
    name: "SETTINGS.TaserCumPenaltyEnabled",
    hint: "SETTINGS.TaserCumPenaltyEnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // --- Combat Automation: Acid armor DOT ---
  game.settings.register("cyberpunk2020", "acidArmorDotEnabled", {
    name: "SETTINGS.AcidArmorDotEnabled",
    hint: "SETTINGS.AcidArmorDotEnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // --- Combat Automation: Acid DOT stacking behavior ---
  game.settings.register("cyberpunk2020", "acidDotStackMode", {
    name: "SETTINGS.AcidDotStackMode",
    hint: "SETTINGS.AcidDotStackModeHint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "stack":    "SETTINGS.AcidDotStackModeChoiceStack",
      "reset":    "SETTINGS.AcidDotStackModeChoiceReset",
      "separate": "SETTINGS.AcidDotStackModeChoiceSeparate",
    },
    default: "stack",
  });

  // --- Combat Automation: Fire / Incendiary DOT ---
  game.settings.register("cyberpunk2020", "fireDotEnabled", {
    name: "SETTINGS.FireDotEnabled",
    hint: "SETTINGS.FireDotEnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // --- Combat Automation: Fire DOT stacking behavior ---
  game.settings.register("cyberpunk2020", "fireDotStackMode", {
    name: "SETTINGS.FireDotStackMode",
    hint: "SETTINGS.FireDotStackModeHint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "stack":    "SETTINGS.FireDotStackModeChoiceStack",
      "reset":    "SETTINGS.FireDotStackModeChoiceReset",
      "separate": "SETTINGS.FireDotStackModeChoiceSeparate",
    },
    default: "stack",
  });

  // --- Combat Automation: Multi-action penalty ---
  game.settings.register("cyberpunk2020", "multiActionPenaltyEnabled", {
    name: "SETTINGS.MultiActionPenaltyEnabled",
    hint: "SETTINGS.MultiActionPenaltyEnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register("cyberpunk2020", "multiActionAutoTrack", {
    name: "SETTINGS.MultiActionAutoTrack",
    hint: "SETTINGS.MultiActionAutoTrackHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  // --- Combat: optional movement restriction (CP2020 p.99) ---
  game.settings.register("cyberpunk2020", "restrictMovementOncePerTurn", {
    name: "SETTINGS.RestrictMovementOncePerTurn",
    hint: "SETTINGS.RestrictMovementOncePerTurnHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  // --- Optional rules: Armor Layers ---
  game.settings.register("cyberpunk2020", "damageLayersEnabled", {
    name: "SETTINGS.DamageLayersEnabled",
    hint: "SETTINGS.DamageLayersEnabledHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // --- Character: Cyberpsychosis tracking (CP2020 p.73) ---
  game.settings.register("cyberpunk2020", "cyberpsychosisTracking", {
    name: "SETTINGS.CyberpsychosisTracking",
    hint: "SETTINGS.CyberpsychosisTrackingHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // --- Combat: Detailed crippling injuries (Listen Up, optional) ---
  game.settings.register("cyberpunk2020", "limbCripplingDetailed", {
    name: "SETTINGS.LimbCripplingDetailed",
    hint: "SETTINGS.LimbCripplingDetailedHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // --- Combat: Hit-location chat display (Core table) ---
  game.settings.register("cyberpunk2020", "hitLocationCoreDisplay", {
    name: "SETTINGS.HitLocationCoreDisplay",
    hint: "SETTINGS.HitLocationCoreDisplayHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
    onChange: (value) => {
      if (!game.user?.isGM) return;
      try {
        if (value && game.settings.get("cyberpunk2020", "w4rst4rLimbRules")) {
          game.settings.set("cyberpunk2020", "hitLocationCoreDisplay", false);
          ui.notifications?.warn?.(localize("HitLocCoreVsW4rstar"));
        }
      } catch (e) { /* settings not ready */ }
    },
  });

  // --- Combat: W4RST4R's Limb Rules (alternate limb model) ---
  game.settings.register("cyberpunk2020", "w4rst4rLimbRules", {
    name: "SETTINGS.W4rst4rLimbRules",
    hint: "SETTINGS.W4rst4rLimbRulesHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
    onChange: (value) => {
      if (!game.user?.isGM) return;
      try {
        if (value) {
          if (game.settings.get("cyberpunk2020", "hitLocationCoreDisplay")) game.settings.set("cyberpunk2020", "hitLocationCoreDisplay", false);
          if (game.settings.get("cyberpunk2020", "limbCripplingDetailed")) game.settings.set("cyberpunk2020", "limbCripplingDetailed", false);
        }
      } catch (e) { /* settings not ready */ }
    },
  });

  // --- Combat: Shotgun / flechette spread (CP2020 p.108) ---
  game.settings.register("cyberpunk2020", "shotgunSpreadEnabled", {
    name: "SETTINGS.ShotgunSpreadEnabled",
    hint: "SETTINGS.ShotgunSpreadEnabledHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // --- Combat: Explosions & grenades (CP2020 p.108) ---
  game.settings.register("cyberpunk2020", "explosivesEnabled", {
    name: "SETTINGS.ExplosivesEnabled",
    hint: "SETTINGS.ExplosivesEnabledHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // --- Combat: Area-effect cover occlusion ---
  game.settings.register("cyberpunk2020", "areaEffectOcclusion", {
    name: "SETTINGS.AreaEffectOcclusion",
    hint: "SETTINGS.AreaEffectOcclusionHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // --- Vehicles (Core CP2020 "Vehicles in FNFF", p.112) — available WITHOUT Maximum Metal ---
  // These two are core vehicle automation; they default ON and work under the Core ruleset on their
  // own. They live above the Maximum Metal header so they stay configurable when MM is off.
  game.settings.register("cyberpunk2020", "vehicleControlEnabled", {
    name: "SETTINGS.VehicleControlEnabled",
    hint: "SETTINGS.VehicleControlEnabledHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register("cyberpunk2020", "vehicleDamageEnabled", {
    name: "SETTINGS.VehicleDamageEnabled",
    hint: "SETTINGS.VehicleDamageEnabledHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // ===================== MAXIMUM METAL (master + overlay) =====================
  // Master switch. Everything registered from here down belongs to the Maximum Metal layer; the
  // renderSettingsConfig hook (end of this function) groups them under a "Maximum Metal" header.
  game.settings.register("cyberpunk2020", "mmEnabled", {
    name: "SETTINGS.MmEnabled",
    hint: "SETTINGS.MmEnabledHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
    onChange: () => {
      // Live-apply the MM hide/show: refresh the compendium sidebar + any open vehicle sheets.
      try { ui.compendium?.render(); } catch (e) { /* sidebar not ready */ }
      try { for (const a of game.actors) if (a.type === "vehicle" && a.sheet?.rendered) a.sheet.render(false); } catch (e) { /* no actors */ }
    },
  });

  // --- Vehicles: which ruleset the vehicle resolver uses ---
  game.settings.register("cyberpunk2020", "vehicleRuleSystem", {
    name: "SETTINGS.VehicleRuleSystem",
    hint: "SETTINGS.VehicleRuleSystemHint",
    scope:   "world",
    config:  true,
    type:    String,
    choices: {
      "Core":         "SETTINGS.VehicleRuleSystemChoiceCore",
      "MaximumMetal": "SETTINGS.VehicleRuleSystemChoiceMaximumMetal",
    },
    default: "Core",
  });

  // --- Maximum Metal optional rule: Armor Damage via Penetration (errata p.107) ---
  game.settings.register("cyberpunk2020", "vehicleArmorDamageEnabled", {
    name: "SETTINGS.VehicleArmorDamageEnabled",
    hint: "SETTINGS.VehicleArmorDamageEnabledHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // --- Maximum Metal optional rule: Crew Morale (MM optional) ---
  game.settings.register("cyberpunk2020", "vehicleMoraleEnabled", {
    name: "SETTINGS.VehicleMoraleEnabled",
    hint: "SETTINGS.VehicleMoraleEnabledHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // --- Vehicles: Weapon mount arc enforcement (Phase 5) ---
  game.settings.register("cyberpunk2020", "vehicleArcEnforcement", {
    name: "SETTINGS.VehicleArcEnforcement",
    hint: "SETTINGS.VehicleArcEnforcementHint",
    scope:   "world",
    config:  true,
    type:    String,
    choices: {
      "free":   "SETTINGS.VehicleArcEnforcementChoiceFree",
      "strict": "SETTINGS.VehicleArcEnforcementChoiceStrict",
    },
    default: "free",
  });

  // --- Combat: Detailed explosives / HEP concussion (Listen Up, optional) ---
  game.settings.register("cyberpunk2020", "explosivesDetailed", {
    name: "SETTINGS.ExplosivesDetailed",
    hint: "SETTINGS.ExplosivesDetailedHint",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // --- Maximum Metal: in-list section header + master gating of the MM sub-settings ---
  Hooks.on("renderSettingsConfig", (app, html) => {
    const root = html instanceof jQuery ? html[0] : (Array.isArray(html) ? html[0] : html);
    if (!root?.querySelector) return;
    const MM_KEYS = ["mmEnabled", "vehicleRuleSystem", "vehicleArmorDamageEnabled", "vehicleMoraleEnabled", "vehicleArcEnforcement"];
    const groupOf = (k) => {
      const el = root.querySelector(`[name="${SCOPE}.${k}"], [data-setting-id="${SCOPE}.${k}"]`);
      return el?.closest(".form-group") ?? el?.closest(".setting") ?? null;
    };
    const groups = MM_KEYS.map(groupOf).filter(Boolean);
    if (!groups.length) return;
    const first = groups[0];
    if (!first.previousElementSibling?.classList?.contains("cp-mm-header")) {
      const header = document.createElement("h3");
      header.className = "cp-mm-header";
      header.textContent = localize("Vehicle.SystemMM");
      first.parentNode.insertBefore(header, first);
    }
    // Keep the MM groups consecutive under the header.
    let anchor = first;
    for (const g of groups.slice(1)) { if (anchor.nextElementSibling !== g) anchor.parentNode.insertBefore(g, anchor.nextElementSibling); anchor = g; }
    // Grey out / disable the MM sub-settings when the master is off; live-update when it's toggled.
    const subGroups = groups.slice(1);
    const setEnabled = (on) => { for (const g of subGroups) { g.classList.toggle("cp-mm-disabled", !on); g.querySelectorAll("input,select,button,textarea").forEach(el => { el.disabled = !on; }); } };
    setEnabled(mmEnabled());
    const masterInput = first.querySelector(`[name="${SCOPE}.mmEnabled"]`);
    masterInput?.addEventListener("change", () => setEnabled(!!masterInput.checked));
  });

  // --- Maximum Metal: hide the MM weapon compendium from the sidebar when MM is off ---
  Hooks.on("renderCompendiumDirectory", (app, html) => {
    const root = html instanceof jQuery ? html[0] : (Array.isArray(html) ? html[0] : html);
    if (!root?.querySelector || mmEnabled()) return;          // MM on → show it normally
    const li = root.querySelector(`[data-pack="${SCOPE}.vehicle-weapons"]`);
    if (li) li.classList.add("cp-hidden");
  });

}