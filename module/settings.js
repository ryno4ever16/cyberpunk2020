const SCOPE = "cyberpunk2020";

/** Master Maximum Metal toggle. When OFF (default), every MM-overlay feature falls back to Core CP2020. */
export function mmEnabled() {
  try { return !!game.settings.get(SCOPE, "mmEnabled"); } catch { return false; }
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
  game.settings.register("cyberpunk2020", "ammoBuyButtonEnabled", {
    name: "SETTINGS.AmmoBuyButtonEnabled",
    hint: "SETTINGS.AmmoBuyButtonEnabledHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

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

  // --- Combat automation first-run notice (hidden) ---
  game.settings.register("cyberpunk2020", "automationMigrationShown", {
    name: "Combat Automation: Migration Notice Shown",
    scope: "world",
    config: false,
    type: Boolean,
    default: false,
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

  // --- Optional rules: Head Hit & Limb Loss ---
  game.settings.register("cyberpunk2020", "headHitDoubling", {
    name: "Combat: Head Hit Doubles Damage",
    hint: "When enabled, a hit to the Head doubles the FINAL damage — after armor (SP) and BTM are applied. RAW: 'A head hit always doubles damage' (CP2020 p.103, the optional 'He Shrugs Off Head Hits' rule); the book gives no timing, so the wound that actually gets through is what doubles. Disable for groups that skip this rule.",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register("cyberpunk2020", "limbLossEnabled", {
    name: "Combat: Limb Loss & Head Wound Checks",
    hint: "When enabled, a single hit dealing more than 8 net damage to a limb triggers an immediate Death Save at Mortal 0 (severed/crushed). A head wound of the same severity kills automatically (CP2020 p.103 RAW).",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register("cyberpunk2020", "suppressiveFireSaves", {
    name: "Combat: Suppressive Fire Zone & Evasion",
    hint: "When enabled, suppressive fire automatically places a ray template (fire zone) on the canvas and prompts all tokens within it to roll an Evasion check: Athletics + REF + 1d10 vs DC = rounds / zone width (CP2020 p.101 RAW). Failures take 1d6 random hits.",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // --- Combat Tracker: per-turn saves ---
  game.settings.register("cyberpunk2020", "autoDeathSavePerTurn", {
    name: "Combat: Death Save Each Turn (Mortal)",
    hint: "When enabled, unstabilized Mortal characters are automatically prompted to make a Death Save at the start of each of their turns in the combat tracker (CP2020 p.105 RAW).",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register("cyberpunk2020", "autoSaveRePrompt", {
    name: "Combat: Stun Save Recovery Each Turn",
    hint: "When enabled, unconscious/stunned characters are automatically prompted to roll a Stun Save recovery check at the start of each of their turns in the combat tracker (CP2020 p.104 RAW).",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // --- Optional rules: Layer rule system (Core vs Chromebook 4) ---
  game.settings.register("cyberpunk2020", "layerRuleSystem", {
    name: "Armor: Layer Rule System",
    hint: "Core (CP2020 p.99 errata New Rule 1): max 3 layers, max 1 hard per location, EV +1/+2 for 2nd/3rd layer. Chromebook 4 (CB4 p.67): clothing weight categories (Light/Medium/Heavy) with separate EV penalties for over-layering by body area (Torso vs Legs). The two systems are mutually exclusive.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "Core":          "Core (New Rule 1 per CP2020 errata)",
      "Chromebook 4":  "Chromebook 4 Clothing Layers",
    },
    default: "Core",
  });

  // --- Optional rules: New Rule 1 EV enforcement ---
  game.settings.register("cyberpunk2020", "applyLayerEVPenalty", {
    name: "Armor: Apply Layer EV Penalties (New Rule 1)",
    hint: "When enabled, the 2nd armor layer at any location adds +1 EV and the 3rd adds an additional +2 EV to the REF penalty (CP2020 errata New Rule 1). Skinweave receives no penalty.",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // --- Combat Automation: Dodge / Parry active defense ---
  game.settings.register("cyberpunk2020", "activeDodgeParryEnabled", {
    name: "Combat: Active Dodge & Parry Declarations",
    hint: "When enabled, 🛡 Dodge and ⛨ Parry buttons appear in the combat tracker. Dodge (active combatant): −2 to attacker's melee roll this round; clears on next turn. Parry (any combatant, reactive): blocks the next incoming melee attack; consumed on use. (CP2020 p.102 RAW.)",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // --- Combat Automation: Aim accumulation tracking ---
  game.settings.register("cyberpunk2020", "aimTrackingEnabled", {
    name: "Combat: Aim Accumulation Tracking",
    hint: "When enabled, a Take Aim (🎯) button appears in the combat tracker for the active combatant. Each click accumulates +1 aim round (max 3) stored on the actor. The attack modifier dialog is automatically pre-filled with the saved aim count. Aim resets when the actor fires. (CP2020 p.99 RAW: +1 per consecutive aim round, max +3.)",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // --- Combat Automation: Wait for Turn ---
  game.settings.register("cyberpunk2020", "waitForTurnEnabled", {
    name: "Combat: Wait for Turn Button",
    hint: "When enabled, a Wait (⏸) button appears in the combat tracker for the active combatant. Clicking it sets their initiative just below the current minimum and advances to the next combatant, so they act last this round. Since CP2020 re-rolls initiative each round, this is a temporary deferral. (CP2020 p.98 RAW.)",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // --- Combat Automation: Special martial arts hit effects ---
  game.settings.register("cyberpunk2020", "specialMeleeEffectsEnabled", {
    name: "Combat: Martial Arts Special Hit Effects",
    hint: "When enabled, successful Hold/Grapple attacks set a status flag on the target with turn-start reminders; Choke deals 1d6 HP damage per turn + forces a Stun Save; Throw/Sweep post knockdown announcements; Escape removes all hold/grapple/choke flags. (CP2020 p.100–102 RAW.)",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // --- Combat Automation: Gas grenade cloud ---
  game.settings.register("cyberpunk2020", "gasGrenadeCloudEnabled", {
    name: "Combat: Gas Grenade Cloud & Per-Turn Saves",
    hint: "When enabled, weapons loaded with gas ammo (effectTypes: ['Gas'] on ammo item) place a green circle MeasuredTemplate on the canvas. All tokens within the cloud are prompted to make Stun Saves each turn. Cloud persists for dotTurns turns then auto-deletes. (CP2020 p.107 area weapon rules.)",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register("cyberpunk2020", "gasCloudAutoMove", {
    name: "Combat: Gas Cloud Auto-Drift (Wind)",
    hint: "When enabled, the gas cloud template drifts 2m in a random direction each turn to simulate wind movement (CP2020 p.107). When disabled, the GM may reposition the template manually.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  // --- Combat Automation: Taser cumulative save penalty ---
  game.settings.register("cyberpunk2020", "taserCumPenaltyEnabled", {
    name: "Combat: Taser Cumulative Save Penalty",
    hint: "When enabled, each successive taser hit within a 3-turn window reduces the target's Stun Save threshold by the ammo item's stunSaveMod value (default −2 per hit). The penalty accumulates: 2nd hit −2, 3rd hit −4, etc. (CP2020 p.101 RAW.)",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // --- Combat Automation: Acid armor DOT ---
  game.settings.register("cyberpunk2020", "acidArmorDotEnabled", {
    name: "Combat: Acid Weapon Armor Degradation",
    hint: "When enabled, weapons loaded with acid ammo (dotEnabled on ammo item) degrade the target's armor SP at the hit location by the dotDamageFormula roll (default 1d6) per turn for dotTurns turns. SP is reduced from the outermost layer inward. (CP2020 acid weapon rules.)",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // --- Combat Automation: Acid DOT stacking behavior ---
  game.settings.register("cyberpunk2020", "acidDotStackMode", {
    name: "Combat: Acid DOT Multiple-Hit Behavior",
    hint: "Controls what happens when a target is hit by acid while an acid effect is already active. Stack: extends the remaining turns at the same location. Reset: overwrites the previous effect (timer restarts). Separate: both effects run concurrently with independent timers.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "stack":    "Stack (extend duration at same location)",
      "reset":    "Reset (overwrite previous effect)",
      "separate": "Separate (concurrent independent timers)",
    },
    default: "stack",
  });

  // --- Combat Automation: Fire / Incendiary DOT ---
  game.settings.register("cyberpunk2020", "fireDotEnabled", {
    name: "Combat: Incendiary Burn Damage",
    hint: "When enabled, weapons loaded with incendiary/API ammo set the target on fire: the dotDamageFormula roll (default 1d6) is applied as HP damage at the hit location each turn for dotTurns turns, with a Stun Save each turn. Unlike acid, fire burns the target, not their armor.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // --- Combat Automation: Fire DOT stacking behavior ---
  game.settings.register("cyberpunk2020", "fireDotStackMode", {
    name: "Combat: Fire DOT Multiple-Hit Behavior",
    hint: "Controls what happens when a target is set on fire while already burning. Stack: extends the remaining turns at the same location. Reset: overwrites the previous fire (timer restarts). Separate: both fires run concurrently with independent timers.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      "stack":    "Stack (extend duration at same location)",
      "reset":    "Reset (overwrite previous fire)",
      "separate": "Separate (concurrent independent timers)",
    },
    default: "stack",
  });

  // --- Combat Automation: Multi-action penalty ---
  game.settings.register("cyberpunk2020", "multiActionPenaltyEnabled", {
    name: "Combat: Multi-Action Penalty",
    hint: "When enabled, each action taken beyond the first in a round applies a cumulative −3 penalty to all rolls that round. A badge in the combat tracker shows the current action count and live penalty. (CP2020 p.105 RAW.)",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register("cyberpunk2020", "multiActionAutoTrack", {
    name: "Combat: Multi-Action Auto-Tracking",
    hint: "When enabled, weapon fire and tracker button clicks (Aim, Dodge, Parry) automatically increment the action counter. When disabled, only the manual ➕ button in the tracker changes the count — useful for tables that prefer full manual control.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // --- Optional rules: Armor Layers ---
  game.settings.register("cyberpunk2020", "damageLayersEnabled", {
    name: "Armor: Show Layer Compliance Panel",
    hint: "Displays a per-location armor layer summary on the Combat tab, showing layer order, hard/soft classification, RAW limit warnings (max 3 layers, max 1 hard), and extra EV penalties per New Rule 1.",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // --- Character: Cyberpsychosis tracking (CP2020 p.73) ---
  game.settings.register("cyberpunk2020", "cyberpsychosisTracking", {
    name: "Character: Cyberpsychosis Tracking",
    hint: "Derives a cyberpsychosis state from the character's current Empathy (after humanity loss from cyberware): EMP 3 = cold, 2 = withdrawn, 1 = sociopathic, 0 or less = cyberpsycho (CP2020 p.73). Shown on the Cyberware tab. Humanity loss itself is always tracked; this only controls the derived state readout.",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // --- Combat: Detailed crippling injuries (Listen Up, optional) ---
  game.settings.register("cyberpunk2020", "limbCripplingDetailed", {
    name: "Combat: Detailed Crippling Injuries (Listen Up)",
    hint: "Optional grittier limb rule from Listen Up You Primitive Screwheads. Limb damage is DOUBLED (post-armor, before BTM); 6–12 net to a limb cripples it (unusable), 13+ destroys it (needs replacement). Replaces the Core flat '>8 = severed' limb branch when on. Requires 'Limb Loss & Head Wound Checks' to be enabled. Default OFF (Core rules).",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // --- Combat: Hit-location chat display (Core table) ---
  game.settings.register("cyberpunk2020", "hitLocationCoreDisplay", {
    name: "Combat: Show Hit Location (Core Table)",
    hint: "When on (default), the chat shows which body part each hit struck, using the standard Core rulebook chart (head, torso, arms, legs). Can't be combined with W4RST4R's Limb Rules, which has its own chart — turning that model on switches this off.",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
    onChange: (value) => {
      if (!game.user?.isGM) return;
      try {
        if (value && game.settings.get("cyberpunk2020", "w4rst4rLimbRules")) {
          game.settings.set("cyberpunk2020", "hitLocationCoreDisplay", false);
          ui.notifications?.warn?.("Core hit-location display can't be combined with W4RST4R's Limb Rules (it uses its own location table).");
        }
      } catch (e) { /* settings not ready */ }
    },
  });

  // --- Combat: W4RST4R's Limb Rules (alternate limb model) ---
  game.settings.register("cyberpunk2020", "w4rst4rLimbRules", {
    name: "Combat: W4RST4R's Limb Rules (alternate limb model)",
    hint: "An alternate set of limb-injury rules. When a single hit deals more than 8 damage to an arm or leg the limb is disabled; more than 12 severs it — in either case the character must make a Death Save to survive. A head hit over 8 is instantly fatal. It also uses its own hit-location chart that adds the groin. Turning this on replaces the standard limb rules. Default OFF.",
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
    name: "Combat: Shotgun & Flechette Spread",
    hint: "When enabled, ammo whose Spread Mode is not 'single' (buckshot, flechette) fires a widening pattern (Close 1m/Med 2m/Long 3m by default) with range-banded damage. Everyone in the straight path takes the hit. Only affects ammo explicitly configured for spread, so normal weapons are unchanged. (CP2020 p.108.)",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // --- Combat: Explosions & grenades (CP2020 p.108) ---
  game.settings.register("cyberpunk2020", "explosivesEnabled", {
    name: "Combat: Explosions & Grenades",
    hint: "When enabled, ammo whose Effect Types include 'Explosive' detonates as an area-effect blast: a circular zone of radius blastRadius, with range-banded damage falloff (blastMultipliers) outward from the center. Every token in the blast takes damage through the normal pipeline. Only affects ammo configured as Explosive. (CP2020 p.108.)",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // --- Combat: Area-effect cover occlusion ---
  game.settings.register("cyberpunk2020", "areaEffectOcclusion", {
    name: "Combat: Area-Effect Cover Blocks (walls)",
    hint: "When enabled, a token shielded by a wall between it and the blast center (or the shooter, for spread) is exempt from area-effect damage — intervening cover blocks the pattern/blast (CP2020 p.108). Requires walls placed on the scene; disable if your tables don't map cover with walls.",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // --- Vehicles (Core CP2020 "Vehicles in FNFF", p.112) — available WITHOUT Maximum Metal ---
  // These two are core vehicle automation; they default ON and work under the Core ruleset on their
  // own. They live above the Maximum Metal header so they stay configurable when MM is off.
  game.settings.register("cyberpunk2020", "vehicleControlEnabled", {
    name: "Vehicles: Movement & Control Rolls",
    hint: "When enabled, vehicles get a 🎲 Control Roll button (sheet header) and the game.cyberpunk.vehicles.controlRoll API. It opens a dialog to roll REF + Driving/Pilot + 1d10 vs a Difficulty Value (Simple 15 / Difficult 20 / Very Difficult 25), and on failure rolls the Control Loss (Core p.112) or Failure (Maximum Metal p.10) table — whichever the active ruleset selects. Works in Core mode without Maximum Metal. Default ON.",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  game.settings.register("cyberpunk2020", "vehicleDamageEnabled", {
    name: "Vehicles: Damage Resolver",
    hint: "When enabled, vehicles get a 💥 Damage button (sheet header) and the game.cyberpunk.vehicles.applyDamage API. Core (p.112) subtracts SP and reduces SDP; Maximum Metal (p.4-6) compares Penetration to Armor Value, rolls the Surface/Minor/Major/Catastrophic damage table, then a hit location with fuel-fire / ammo-cookoff / crew-damage effects (and honors a Damage Control system). The active branch follows the ruleset (Core when Maximum Metal is off). Default ON.",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: true,
  });

  // ===================== MAXIMUM METAL (master + overlay) =====================
  // Master switch. Everything registered from here down belongs to the Maximum Metal layer; the
  // renderSettingsConfig hook (end of this function) groups them under a "Maximum Metal" header.
  game.settings.register("cyberpunk2020", "mmEnabled", {
    name: "Maximum Metal: Enable Maximum Metal",
    hint: "Master switch for the Maximum Metal military-hardware layer. When OFF (default), vehicles use only the Core 'Vehicles in FNFF' rules (CP2020 p.112) and every MM-only feature is disabled: the Penetration/Armor-Value resolver, composite armor, personnel-vs-anti-vehicle (p.8), area weapons, missiles, the 5-facing vehicle sheet, and the Maximum Metal weapon compendium seeding. Turn ON for the detailed military system. The settings below belong to Maximum Metal.",
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
    name: "Vehicles: Rule System",
    hint: "Core = the simple Vehicles-in-FNFF rules (Control Roll vs DV 15/20/25, SP−SDP damage, crash = speed/20 × weight). Maximum Metal = the detailed military system (Penetration vs Armor Value, Surface/Minor/Major/Catastrophic damage, hit-location & crit tables, ACPA). The vehicle sheet shows a single SP in Core mode and all five facings under Maximum Metal.",
    scope:   "world",
    config:  true,
    type:    String,
    choices: {
      "Core":         "Core (simple — Vehicles in FNFF, p.112)",
      "MaximumMetal": "Maximum Metal (detailed — Penetration/Armor Value)",
    },
    default: "Core",
  });

  // --- Vehicles: Weapon mount arc enforcement (Phase 5) ---
  game.settings.register("cyberpunk2020", "vehicleArcEnforcement", {
    name: "Vehicles: Weapon Mount Arc Enforcement",
    hint: "How a weapon mount's firing arc (turret 360° / front / side / rear) is enforced when the target lies outside it. Token facing defines 'front' — rotate a vehicle with Ctrl+scroll (Foundry's 0° points north). Free (default): the Fire dialog only WARNS that the target is outside the mount's arc; you can still fire (GM discretion). Strict: an out-of-arc shot is blocked until the mount can bear — rotate the firing vehicle to face the target, or use a turret. Applies to all vehicle/ACPA weapon mounts, missiles included.",
    scope:   "world",
    config:  true,
    type:    String,
    choices: {
      "free":   "Free (warn only — discretionary override, default)",
      "strict": "Strict (block out-of-arc shots — keep mounts within bounds)",
    },
    default: "free",
  });

  // --- Combat: Detailed explosives / HEP concussion (Listen Up, optional) ---
  game.settings.register("cyberpunk2020", "explosivesDetailed", {
    name: "Combat: Detailed Explosives — HEP Concussion (Listen Up)",
    hint: "Optional grittier blast model from Listen Up You Primitive Screwheads (p.105). Explosion concussion is treated as HEP: armor SP does NOT protect (BTM still applies), half the damage that gets through is permanent and half is stun (a Stun Save is always prompted), and soft armor at the hit location loses 2 SP. If the ammo also has blastShrapnel, each target additionally takes a normal-armor 1d10 shrapnel hit. Default OFF (Core blast = damage through normal armor).",
    scope:   "world",
    config:  true,
    type:    Boolean,
    default: false,
  });

  // --- Maximum Metal: in-list section header + master gating of the MM sub-settings ---
  Hooks.on("renderSettingsConfig", (app, html) => {
    const root = html instanceof jQuery ? html[0] : (Array.isArray(html) ? html[0] : html);
    if (!root?.querySelector) return;
    const MM_KEYS = ["mmEnabled", "vehicleRuleSystem", "vehicleArcEnforcement"];
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
      header.textContent = "Maximum Metal";
      header.style.cssText = "margin-top:14px;border-top:2px solid var(--color-border-light-primary);padding-top:8px;";
      first.parentNode.insertBefore(header, first);
    }
    // Keep the MM groups consecutive under the header.
    let anchor = first;
    for (const g of groups.slice(1)) { if (anchor.nextElementSibling !== g) anchor.parentNode.insertBefore(g, anchor.nextElementSibling); anchor = g; }
    // Grey out / disable the MM sub-settings when the master is off; live-update when it's toggled.
    const subGroups = groups.slice(1);
    const setEnabled = (on) => { for (const g of subGroups) { g.style.opacity = on ? "" : "0.5"; g.querySelectorAll("input,select,button,textarea").forEach(el => { el.disabled = !on; }); } };
    setEnabled(mmEnabled());
    const masterInput = first.querySelector(`[name="${SCOPE}.mmEnabled"]`);
    masterInput?.addEventListener("change", () => setEnabled(!!masterInput.checked));
  });

  // --- Maximum Metal: hide the MM weapon compendium from the sidebar when MM is off ---
  Hooks.on("renderCompendiumDirectory", (app, html) => {
    const root = html instanceof jQuery ? html[0] : (Array.isArray(html) ? html[0] : html);
    if (!root?.querySelector || mmEnabled()) return;          // MM on → show it normally
    const li = root.querySelector(`[data-pack="${SCOPE}.vehicle-weapons"]`);
    if (li) li.style.display = "none";
  });

}