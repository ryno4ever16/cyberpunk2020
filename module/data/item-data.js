import {
  arrayField,
  booleanField,
  htmlField,
  mergeDefaults,
  normalizeArray,
  normalizeBoolean,
  normalizeNumber,
  numberField,
  objectField,
  stringField
} from "./schema-helpers.js";

const COMMON_DEFAULTS = {
  flavor: "",
  notes: "",
  cost: 0,
  weight: 0,
  equipped: true,
  source: ""
};

const DEFAULT_RANGE_DAMAGES = {
  pointBlank: "",
  close: "",
  medium: "",
  far: "",
  short: "",
  extreme: ""
};

const DEFAULT_COVERAGE = {
  Head: false,
  Torso: false,
  lArm: false,
  rArm: false,
  lLeg: false,
  rLeg: false
};

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function isDeletionOperator(value) {
  if (!value || typeof value !== "object") return false;

  const ForcedDeletion = globalThis.foundry?.data?.operators?.ForcedDeletion;
  if (typeof ForcedDeletion === "function" && value instanceof ForcedDeletion) return true;

  const DeleteField = globalThis.foundry?.data?.operations?.DeleteField;
  if (typeof DeleteField === "function" && value instanceof DeleteField) return true;

  const ctorName = value.constructor?.name;
  return ctorName === "ForcedDeletion" || ctorName === "DeleteField";
}

function normalizeNumberIfPresent(source, key, fallback = 0) {
  if (hasOwn(source, key)) source[key] = normalizeNumber(source[key], fallback);
}

function normalizeBooleanIfPresent(source, key, fallback = false) {
  if (hasOwn(source, key)) source[key] = normalizeBoolean(source[key], fallback);
}

function normalizeArrayIfPresent(source, key, fallback = []) {
  if (hasOwn(source, key)) source[key] = normalizeArray(source[key], fallback);
}

// Attack types that imply full-auto capability in the existing data.
const AUTO_ATTACK_TYPES = new Set(["Auto", "Autoshotgun", "Autofire"]);

/**
 * Derive fire-mode capability flags from a weapon's attackType when they aren't set yet.
 * Existing data already encodes auto capability via attackType, so this gives every legacy
 * weapon a sensible default. Pure semi-auto weapons that should burst (e.g. M16A4) default to
 * non-burst and must be flagged per item. Once set, the stored flags are respected.
 */
function deriveFireCapability(source) {
  if (!source || typeof source !== "object") return;
  if (!hasOwn(source, "fullAutoCapable") || source.fullAutoCapable === null) {
    source.fullAutoCapable = AUTO_ATTACK_TYPES.has(source.attackType);
  } else {
    source.fullAutoCapable = normalizeBoolean(source.fullAutoCapable, false);
  }
  if (!hasOwn(source, "burstCapable") || source.burstCapable === null) {
    source.burstCapable = source.fullAutoCapable === true;
  } else {
    source.burstCapable = normalizeBoolean(source.burstCapable, false);
  }
}

const DEFAULT_WEAPON = {
  weaponType: "Pistol",
  accuracy: 0,
  concealability: "P",
  availability: "common",
  ammoType: "9mm",
  ammoItemId: "",
  loadedAmmoId: "",
  loadedAmmo: {},
  damage: "2d6+1",
  rangeDamages: DEFAULT_RANGE_DAMAGES,
  ap: false,
  isEdged: false,
  shotsLeft: 12,
  shots: 12,
  rof: 2,
  // Fire-mode capability. fullAutoCapable enables Full Auto + Suppressive; burstCapable enables
  // 3-Round Burst. Semi-auto is always available. Some weapons burst but can't full-auto (M16A4).
  fullAutoCapable: false,
  burstCapable: false,
  reliability: "ST",
  range: 50,
  attackType: "",
  attackSkill: "ref"
};

const DEFAULT_CYBERWARE = {
  ...COMMON_DEFAULTS,
  surgCode: "N",
  humanityCost: "1d6",
  cyberwareType: "",
  cyberwareSubtype: "",
  abbrev: "",
  humanityLoss: 0,
  MountZone: "",
  EffectMode: "Permanent",
  EffectActive: false,
  Module: {
    IsModule: false,
    AllowedParentCyberwareType: "",
    SlotsTaken: 0,
    ParentId: ""
  },
  CyberBodyType: {
    Type: "",
    Location: ""
  },
  CyberWorkType: {
    Type: "Descriptive",
    Stat: {},
    Skill: {},
    Checks: {},
    Locations: {},
    Encumbrance: 0,
    Penalties: {},
    Link: "",
    ItemId: "",
    OptionsAvailable: 0,
    SDP: 0,
    ChipSkills: {},
    ChipActive: false,
    Types: [],
    Weapon: {
      ...DEFAULT_WEAPON,
      shotsLeft: 0,
      shots: 0,
      rof: 0,
      range: 0
    }
  },
  slots: 0,
  spaces: 0,
  effectTypes: ["None"]
};

function commonSchema() {
  return {
    flavor: stringField(""),
    notes: htmlField(""),
    cost: numberField(0),
    weight: numberField(0),
    equipped: booleanField(true),
    source: stringField(""),
    lastOwnerId: stringField("")
  };
}

class CyberpunkBaseItemData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return commonSchema();
  }

  static migrateData(source) {
    source ??= {};

    if (hasOwn(source, "notes")) source.notes ??= "";
    if (hasOwn(source, "flavor")) source.flavor ??= "";
    if (hasOwn(source, "source")) source.source ??= "";
    normalizeBooleanIfPresent(source, "equipped", true);
    if (source.cost === null) source.cost = 0;
    if (source.weight === null) source.weight = 0;
    if (hasOwn(source, "lastOwnerId")) source.lastOwnerId ??= "";
    return super.migrateData(source);
  }
}

export class CyberpunkSkillData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      flavor: stringField(""),
      notes: htmlField(""),
      level: numberField(0),
      chipLevel: numberField(0),
      ip: numberField(0),
      IP: numberField(0),
      diffMod: numberField(1),
      isChipped: booleanField(false),
      autoChipped: booleanField(false),
      isRoleSkill: booleanField(false),
      trained: booleanField(false),
      stat: stringField("cool"),
      askMods: booleanField(false),
      // Martial arts: mark a skill as a martial art and give it per-action bonuses.
      // Lets users create custom styles without editing core lookup tables.
      isMartialArt: booleanField(false),
      martialBonuses: objectField({})
    };
  }

  static migrateData(source) {
    source ??= {};

    if (hasOwn(source, "notes")) source.notes ??= "";
    if (hasOwn(source, "flavor")) source.flavor ??= "";

    if (hasOwn(source, "IP") && !hasOwn(source, "ip")) source.ip = source.IP;
    if (hasOwn(source, "ip") && !hasOwn(source, "IP")) source.IP = source.ip;

    if (hasOwn(source, "level") || hasOwn(source, "value")) {
      source.level = normalizeNumber(source.level ?? source.value, 0);
    }
    normalizeNumberIfPresent(source, "chipLevel", 0);
    normalizeNumberIfPresent(source, "ip", 0);
    normalizeNumberIfPresent(source, "IP", hasOwn(source, "ip") ? source.ip : 0);
    normalizeNumberIfPresent(source, "diffMod", 1);

    if (hasOwn(source, "isChipped")) {
      source.isChipped = normalizeBoolean(source.isChipped, false);
    } else if (hasOwn(source, "chipped") && !isDeletionOperator(source.chipped)) {
      source.isChipped = normalizeBoolean(source.chipped, false);
    }
    if (hasOwn(source, "chipped") && !isDeletionOperator(source.chipped)) delete source.chipped;

    normalizeBooleanIfPresent(source, "isRoleSkill", false);
    normalizeBooleanIfPresent(source, "trained", false);
    normalizeBooleanIfPresent(source, "autoChipped", false);
    normalizeBooleanIfPresent(source, "askMods", false);
    normalizeBooleanIfPresent(source, "isMartialArt", false);
    if (hasOwn(source, "stat")) source.stat ||= "cool";
    return super.migrateData(source);
  }
}

export class CyberpunkProgramData extends CyberpunkBaseItemData {
  static defineSchema() {
    return {
      ...commonSchema(),
      power: numberField(0),
      mu: numberField(0),
      programType: stringField(""),
      actionFormula: stringField("")
    };
  }
}

export class CyberpunkWeaponData extends CyberpunkBaseItemData {
  static defineSchema() {
    return {
      ...commonSchema(),
      weaponType: stringField(DEFAULT_WEAPON.weaponType),
      accuracy: numberField(DEFAULT_WEAPON.accuracy),
      concealability: stringField(DEFAULT_WEAPON.concealability),
      availability: stringField(DEFAULT_WEAPON.availability),
      ammoType: stringField(DEFAULT_WEAPON.ammoType),
      ammoItemId: stringField(DEFAULT_WEAPON.ammoItemId),
      // The ammo Item currently loaded in the magazine ("where it came from"), set on reload.
      // loadedAmmo is a snapshot of that item ({name, img, system}) so the loaded rounds keep
      // their damage profile and can be re-created on Unload even if the source item is deleted.
      loadedAmmoId: stringField(""),
      loadedAmmo: objectField({}),
      damage: stringField(DEFAULT_WEAPON.damage),
      rangeDamages: objectField(DEFAULT_RANGE_DAMAGES),
      ap: booleanField(DEFAULT_WEAPON.ap),
      isEdged: booleanField(DEFAULT_WEAPON.isEdged),
      shotsLeft: numberField(DEFAULT_WEAPON.shotsLeft),
      shots: numberField(DEFAULT_WEAPON.shots),
      rof: numberField(DEFAULT_WEAPON.rof),
      fullAutoCapable: booleanField(DEFAULT_WEAPON.fullAutoCapable),
      burstCapable: booleanField(DEFAULT_WEAPON.burstCapable),
      reliability: stringField(DEFAULT_WEAPON.reliability),
      range: numberField(DEFAULT_WEAPON.range),
      attackType: stringField(DEFAULT_WEAPON.attackType),
      attackSkill: stringField(DEFAULT_WEAPON.attackSkill),
      name: stringField("")
    };
  }

  static migrateData(source) {
    source ??= {};
    if (hasOwn(source, "rangeDamage") && !hasOwn(source, "rangeDamages")) {
      source.rangeDamages = source.rangeDamage;
      delete source.rangeDamage;
    }
    if (hasOwn(source, "rangeDamages")) source.rangeDamages = normalizeRangeDamages(source.rangeDamages);
    normalizeBooleanIfPresent(source, "ap", false);
    normalizeBooleanIfPresent(source, "isEdged", false);
    deriveFireCapability(source);
    return super.migrateData(source);
  }
}

export class CyberpunkAmmoData extends CyberpunkBaseItemData {
  static defineSchema() {
    return {
      ...commonSchema(),
      ammoType: stringField(""),
      // Two-axis ammo: caliber (what a weapon accepts) + modifier (load: standard/AP/HP/...).
      // The modifier seeds the mechanical fields below (editable per item); see lookups.js.
      caliber: stringField(""),
      modifier: stringField("standard"),
      quantity: numberField(0),
      // Economy: a "box" of ammo bought with eurobucks. boxSize rounds for boxCost eb.
      // qtyLocked guards manual quantity edits (the field is the magazine economy's ledger);
      // unlock with the lock toggle on the sheet to override by hand.
      boxSize: numberField(0),
      boxCost: numberField(0),
      qtyLocked: booleanField(true),
      armorMultSoft: numberField(1),
      armorMultHard: numberField(1),
      rawDamageMult: numberField(1),
      penDamageMult: numberField(1),
      bonusDamageFormula: stringField(""),
      accuracyMod: numberField(0),
      stunSaveOnHit: booleanField(false),
      stunSaveMod: numberField(0),
      dotEnabled: booleanField(false),
      dotTurns: numberField(0),
      dotDamageFormula: stringField(""),
      // Which damage-over-time mechanic this round triggers: "acid" degrades armor SP,
      // "fire" burns HP (incendiary). Default "acid" preserves prior behavior of dotEnabled.
      dotType: stringField("acid"),
      blastRadius: numberField(0),
      blastFullDamageWithin: numberField(1),
      blastZones: numberField(4),
      blastShrapnel: booleanField(false),
      blastMultipliers: arrayField(null, [0.5, 0.25, 0.125, 0.0625]),
      spreadMode: stringField("single"),
      spreadDistance: numberField(0),
      spreadDamageShort: stringField(""),
      spreadDamageMedium: stringField(""),
      spreadDamageLong: stringField(""),
      spreadWidthShort: numberField(1),
      spreadWidthMedium: numberField(2),
      spreadWidthLong: numberField(3),
      effectTypes: arrayField(null, ["None"])
    };
  }

  static migrateData(source) {
    source ??= {};
    normalizeArrayIfPresent(source, "effectTypes", ["None"]);
    normalizeArrayIfPresent(source, "blastMultipliers", [0.5, 0.25, 0.125, 0.0625]);
    normalizeBooleanIfPresent(source, "stunSaveOnHit", false);
    normalizeBooleanIfPresent(source, "dotEnabled", false);
    normalizeBooleanIfPresent(source, "blastShrapnel", false);
    normalizeNumberIfPresent(source, "boxSize", 0);
    normalizeNumberIfPresent(source, "boxCost", 0);
    normalizeBooleanIfPresent(source, "qtyLocked", true);
    if (hasOwn(source, "modifier")) source.modifier ||= "standard";
    if (hasOwn(source, "caliber")) source.caliber ??= "";
    if (hasOwn(source, "dotType")) source.dotType ||= "acid";
    return super.migrateData(source);
  }
}

export class CyberpunkArmorData extends CyberpunkBaseItemData {
  static defineSchema() {
    return {
      ...commonSchema(),
      coverage: objectField(DEFAULT_COVERAGE),
      encumbrance: numberField(0),
      armorType: stringField(""),
      // Chromebook 4 clothing weight category (p.67). "Light", "Medium", "Heavy", or "" (pure armor, not clothing)
      clothingWeight: stringField("")
    };
  }

  static migrateData(source) {
    source ??= {};
    if (hasOwn(source, "coverage")) source.coverage = mergeDefaults(source.coverage, DEFAULT_COVERAGE);
    if (hasOwn(source, "clothingWeight")) source.clothingWeight ??= "";
    return super.migrateData(source);
  }
}

export class CyberpunkCyberwareData extends CyberpunkBaseItemData {
  static defineSchema() {
    return {
      ...commonSchema(),
      surgCode: stringField(DEFAULT_CYBERWARE.surgCode),
      humanityCost: stringField(DEFAULT_CYBERWARE.humanityCost),
      cyberwareType: stringField(""),
      cyberwareSubtype: stringField(""),
      abbrev: stringField(""),
      humanityLoss: numberField(0),
      MountZone: stringField(""),
      EffectMode: stringField("Permanent"),
      EffectActive: booleanField(false),
      Module: objectField(DEFAULT_CYBERWARE.Module),
      CyberBodyType: objectField(DEFAULT_CYBERWARE.CyberBodyType),
      CyberWorkType: objectField(DEFAULT_CYBERWARE.CyberWorkType),
      slots: numberField(0),
      spaces: numberField(0),
      cwTypeLabel: stringField(""),
      cwSubtypeLabel: stringField(""),
      effectTypes: arrayField(null, ["None"])
    };
  }

  static migrateData(source) {
    source ??= {};
    normalizeNumberIfPresent(source, "humanityLoss", 0);
    normalizeBooleanIfPresent(source, "EffectActive", false);
    normalizeArrayIfPresent(source, "effectTypes", ["None"]);

    if (hasOwn(source, "Module")) {
      normalizeBooleanIfPresent(source.Module, "IsModule", false);
      normalizeNumberIfPresent(source.Module, "SlotsTaken", 0);
    }

    if (hasOwn(source, "CyberWorkType")) {
      const cwt = source.CyberWorkType ?? {};
      if (hasOwn(cwt, "Types") || hasOwn(cwt, "Type")) {
        cwt.Types = normalizeArray(cwt.Types?.length ? cwt.Types : cwt.Type, []);
      }
      normalizeBooleanIfPresent(cwt, "ChipActive", false);
      normalizeNumberIfPresent(cwt, "Encumbrance", 0);
      normalizeNumberIfPresent(cwt, "OptionsAvailable", 0);
      normalizeNumberIfPresent(cwt, "SDP", 0);

      if (hasOwn(cwt, "Weapon")) {
        const weapon = cwt.Weapon ?? {};
        if (hasOwn(weapon, "rangeDamage") && !hasOwn(weapon, "rangeDamages")) {
          weapon.rangeDamages = weapon.rangeDamage;
          delete weapon.rangeDamage;
        }
        if (hasOwn(weapon, "rangeDamages")) weapon.rangeDamages = normalizeRangeDamages(weapon.rangeDamages);
        normalizeBooleanIfPresent(weapon, "ap", false);
        deriveFireCapability(weapon);
        cwt.Weapon = weapon;
      }

      source.CyberWorkType = cwt;
    }

    return super.migrateData(source);
  }
}

export class CyberpunkVehicleData extends CyberpunkBaseItemData {
  static defineSchema() {
    return {
      ...commonSchema(),
      sdp: objectField({ value: 0, max: 0 }),
      sp: numberField(10),
      passengers: numberField(4),
      speed: objectField({ value: 0, max: 0, maneuver: 0, acceleration: 0 }),
      maneuverability: objectField({ value: 0, condition: "" }),
      fuel: objectField({ type: "", efficiency: 0, max: 0, value: 0 })
    };
  }
}

/**
 * Maximum Metal vehicle/ACPA weapon (Phase 5b). A catalogued Item dragged onto a vehicle actor;
 * the vehicle's "mounts" are its embedded vehicleWeapon Items. Fields come straight from the MM
 * stat-block format (SKILL · WA · DAMAGE(PEN) · #SHOTS · ROF · REL · RANGE · BURST), MM p.4/17/19/20/22.
 * Penetration is given DIRECTLY by the book (no derivation). See [[maximum-metal-reference]] §6.
 */
export class CyberpunkVehicleWeaponData extends CyberpunkBaseItemData {
  static defineSchema() {
    return {
      ...commonSchema(),
      // Classification — drives the resolution archetype (MM weapon classes A–H).
      weaponClass: stringField("directFire"),  // directFire|burst|rocket|missile|artillery|bomb|cone|melee|special
      mountType:   stringField("turret"),       // turret|fixed|articulated|open|pintle|pod|juryRigged
      arc:         stringField("turret"),       // turret(360)|front|side|rear — firing arc
      // To-hit.
      wa:          numberField(0),               // Weapon Accuracy modifier
      // Damage scale. MM lists Vehicle Penetration directly; `damage` dice kept for vs-personnel (p.8 alt).
      penetration: numberField(0),
      damage:      stringField(""),
      ap:          booleanField(false),
      heat:        booleanField(false),          // shaped-charge: range-immune; Composite Armor halves Pen
      hiEx:        booleanField(false),          // high-explosive: range-immune
      highDensityAP: booleanField(false),        // errata p.105: full damage through armor like HEAT
      burst:       numberField(0),               // burst radius in meters (0 = none)
      // Rate / ammo.
      rof:         numberField(1),
      rofAlt:      numberField(0),               // variable ROF ("30 OR 5" → rof 30, rofAlt 5; 0 = none)
      shots:       numberField(1),
      shotsLeft:   numberField(1),
      // Range.
      range:       numberField(0),
      minRange:    numberField(0),               // missiles: 1/10 Long range
      reliability: stringField("VR"),
      // Guided weapons (class D).
      guidance:      stringField("none"),        // none|semiActive|active|paint
      guidanceSkill: numberField(0),             // active missile's own Skill (+15/+20)
      homingMethod:  stringField("radar"),       // radar|thermal|optical|laser — which countermeasures defeat it
      // Cone weapons (class F scatter-packs).
      coneAngle:   numberField(0),               // degrees (60/120/180)
      projectiles: numberField(0),
      // Shell / warhead variants (selected at fire time). Each: {name, pen, burst, ap, heat, hiEx, damage}.
      shellVariants: arrayField(null, []),
      activeShell:   stringField(""),            // selected variant name ("" = base stats)
      // Construction.
      space:       numberField(0)
    };
  }

  static migrateData(source) {
    source ??= {};
    normalizeBooleanIfPresent(source, "ap", false);
    normalizeBooleanIfPresent(source, "heat", false);
    normalizeBooleanIfPresent(source, "hiEx", false);
    normalizeBooleanIfPresent(source, "highDensityAP", false);
    normalizeArrayIfPresent(source, "shellVariants", []);
    return super.migrateData(source);
  }
}

export class CyberpunkMiscData extends CyberpunkBaseItemData {}

/**
 * ACPA non-weapon system (Maximum Metal p.61-79). A utility / sensor / movement / defensive / safety
 * device mounted in a powered-armor body area. Carries its own SOP (so a hit can knock out this one
 * system), its build budget (weight/spaces/cost/SP), and where it sits (area + internal/external mount).
 * Offensive systems are vehicleWeapon Items, not this type. `weight`/`cost` come from commonSchema.
 */
export class CyberpunkAcpaSystemData extends CyberpunkBaseItemData {
  static defineSchema() {
    return {
      ...commonSchema(),
      category:   stringField("utility"),    // utility|sensor|movement|defensive|safety
      area:       stringField("torso"),      // head|rArm|lArm|rLeg|lLeg|torso — body-area placement
      mount:      stringField("internal"),   // internal(enclosed)|external(unprotected)|either|retract
      spaces:     numberField(0),            // spaces consumed in its area
      sp:         numberField(0),            // intrinsic SP (external / retractable items)
      sop:        numberField(0),            // structural points (0 → derive 3×SP at runtime)
      sopDamage:  numberField(0),            // accumulated SOP damage (per-system tracking)
      destroyed:  booleanField(false),
      catalogKey: stringField("")            // links back to ACPA_SYSTEMS (blank = custom)
    };
  }

  static migrateData(source) {
    source ??= {};
    normalizeBooleanIfPresent(source, "destroyed", false);
    return super.migrateData(source);
  }
}

function normalizeRangeDamages(value) {
  if (Array.isArray(value)) {
    return mergeDefaults({ pointBlank: value[0] ?? "" }, DEFAULT_RANGE_DAMAGES);
  }
  if (typeof value === "string" || typeof value === "number") {
    return mergeDefaults({ pointBlank: String(value) }, DEFAULT_RANGE_DAMAGES);
  }
  return mergeDefaults(value, DEFAULT_RANGE_DAMAGES);
}
