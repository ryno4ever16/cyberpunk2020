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

  game.settings.register("cyberpunk2020", "trainedSkillsFirst", {
    name: "SETTINGS.TrainedSkillsFirst",
    hint: "SETTINGS.TrainedSkillsFirstHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
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

  // --- Damage Automation ---
  game.settings.register("cyberpunk2020", "damageArmorMode", {
    name: "Damage: Armor Mode",
    hint: "How armor SP is applied when calculating damage. Full = SP + ablation per RAW. Simple = SP subtracted, no ablation. None = armor ignored (BTM still applies).",
    scope:   "world",
    config:  true,
    type:    String,
    choices: {
      "full":   "Full (SP + Ablation)",
      "simple": "Simple (SP only)",
      "none":   "None (no armor)",
    },
    default: "full",
  });

  game.settings.register("cyberpunk2020", "damageAblation", {
    name: "Damage: Ablate Armor on Hit",
    hint: "When enabled, armor SP at the hit location is reduced by 1 for each penetrating hit (RAW).",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register("cyberpunk2020", "damageAutoApply", {
    name: "Damage: Auto-Apply Without Dialog",
    hint: "When enabled, damage is applied to the target immediately when a targeted weapon fires, without showing the confirmation dialog.",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // --- Combat Automation ---
  game.settings.register("cyberpunk2020", "autoRangefinding", {
    name: "Combat: Automated Rangefinding",
    hint: "When enabled, the range category (Point Blank / Close / Medium / Long / Extreme) is automatically determined from the distance between the attacking and target tokens on the canvas, using the scene's configured distance units. The attack modifier is set accordingly. Requires a targeted token.",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

}