import { DEFAULT_HIT_LOCATIONS, DEFAULT_SDP, DEFAULT_STATS } from "../constants.js";

import {
  arrayField,
  booleanField,
  clone,
  htmlField,
  mergeDefaults,
  numberField,
  objectField,
  stringField
} from "./schema-helpers.js";

function hasOwn(source, key) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

class CyberpunkBaseActorData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      // Character identity / lifepath
      points: numberField(75),
      role: objectField({
        value: "rocker",
        choices: ["solo", "rocker", "netrunner", "media", "nomad", "fixer", "cop", "corp", "techie", "medtechie"]
      }),
      age: numberField(35),
      humanity: numberField(50),
      events: stringField(""),
      family: stringField(""),
      style: stringField(""),
      motivations: stringField(""),
      notes: htmlField(""),

      // Core actor data. Kept as ObjectField because the system mutates these
      // structures during prepareData and older worlds may contain legacy shapes.
      stats: objectField(DEFAULT_STATS),
      ip: numberField(0),
      skills: objectField({}),
      hitLocations: objectField(DEFAULT_HIT_LOCATIONS),
      hitLocLookup: objectField({}),
      sdp: objectField(DEFAULT_SDP),
      damage: numberField(0),

      // Inventory / UI state
      eurobucks: numberField(0),
      carryWeight: numberField(0),
      skillsSortedBy: stringField("Name"),
      sortedSkillIDs: arrayField(),
      transient: objectField({ skillFilter: "" }),

      // Roll modifiers stored by the current sheet implementation
      initiativeMod: numberField(0),
      initiativeImplantMod: numberField(0),
      CombatSenseMod: numberField(0),
      StunDeathMod: numberField(0),
      _cwChecks: objectField({ saveStun: 0 }),

      // Netrunning fields are top-level in the current templates and sheet code.
      // stringField rather than filePathField: stored values from old worlds may lack
      // a file extension, and FilePathField validation would block actor loading entirely.
      icon: stringField(""),
      deckModel: stringField(""),
      interface: numberField(0),
      cpu: numberField(0),
      speed: numberField(0),
      strength: numberField(0),
      dataWall: numberField(0),
      ramMax: numberField(0),
      ramUsed: numberField(0),
      deckType: stringField(""),
      hasElectrodes: booleanField(false),
      hasKeyboard: booleanField(false),
      hasScreen: booleanField(false),
      hasPrinter: booleanField(false),
      hasChipReader: booleanField(false),
      hasVoxBox: booleanField(false),
      hasScanner: booleanField(false),
      hasExtraChip: booleanField(false),
      activePrograms: arrayField()
    };
  }

  static migrateData(source) {
    source ??= {};

    // Foundry v14 also calls TypeDataModel.migrateData for partial update diffs.
    // Therefore this method must only rewrite keys that are present in the
    // source diff. Required full-document defaults come from defineSchema().

    // Some legacy template applications stored nested template wrapper keys.
    if (source.stats?.stats) source.stats = source.stats.stats;
    if (source.hitLocations?.hitLocations) {
      if (!hasOwn(source, "sdp") && source.hitLocations.sdp) source.sdp = source.hitLocations.sdp;
      source.hitLocations = source.hitLocations.hitLocations;
    }
    if (source.gear?.eurobucks !== undefined && !hasOwn(source, "eurobucks")) {
      source.eurobucks = source.gear.eurobucks;
    }
    if (source.netrun) {
      for (const [key, value] of Object.entries(source.netrun)) {
        if (!hasOwn(source, key)) source[key] = value;
      }
    }
    if (source.icon && typeof source.icon === "object") {
      source.icon = source.icon.default ?? "";
    }

    if (hasOwn(source, "stats")) source.stats = mergeDefaults(source.stats, DEFAULT_STATS);
    if (hasOwn(source, "hitLocations")) source.hitLocations = mergeDefaults(source.hitLocations, DEFAULT_HIT_LOCATIONS);
    if (hasOwn(source, "sdp")) source.sdp = mergeDefaults(source.sdp, DEFAULT_SDP);
    if (hasOwn(source, "skills")) source.skills ??= {};
    if (hasOwn(source, "hitLocLookup")) source.hitLocLookup ??= {};
    if (hasOwn(source, "sortedSkillIDs")) source.sortedSkillIDs = Array.isArray(source.sortedSkillIDs) ? source.sortedSkillIDs : [];
    if (hasOwn(source, "activePrograms")) source.activePrograms = Array.isArray(source.activePrograms) ? source.activePrograms : [];
    if (hasOwn(source, "transient")) source.transient = mergeDefaults(source.transient, { skillFilter: "" });
    if (hasOwn(source, "_cwChecks")) source._cwChecks = mergeDefaults(source._cwChecks, { saveStun: 0 });
    if (hasOwn(source, "skillsSortedBy")) source.skillsSortedBy ||= "Name";
    if (hasOwn(source, "icon")) source.icon ??= "";
    if (hasOwn(source, "notes")) source.notes ??= "";

    return super.migrateData(source);
  }

  prepareBaseData() {
    super.prepareBaseData();
    this.stats ??= clone(DEFAULT_STATS);
    this.hitLocations ??= clone(DEFAULT_HIT_LOCATIONS);
    this.sdp ??= clone(DEFAULT_SDP);
  }
}

export class CyberpunkCharacterData extends CyberpunkBaseActorData {}
export class CyberpunkNpcData extends CyberpunkBaseActorData {}

/**
 * Vehicle / ACPA actor (CP2020 Core "Vehicles in FNFF" p.112 + Maximum Metal).
 * Standalone schema — vehicles have no stats/skills/hitLocations. Armor is stored per
 * facing (Core uses `front` as its single SP); Maximum Metal needs all five for flank rules.
 * Derived Armor Value (SP/20) and Body Value (SDP/20, or STR/20 for ACPA) are recomputed
 * in prepareDerivedData. Canvas link to the art Tile lives in flags, not the schema.
 */
export class CyberpunkVehicleActorData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    return {
      vehicleType: stringField("car"),   // car/sportscar/limo/AV-4/AV-6/AV-7/cycle/truck/rotor/osprey/boat/tank/APC/acpa
      isACPA:      booleanField(false),
      str:         numberField(0),        // ACPA chassis STR — drives Body Value when isACPA

      // Armor SP per facing. Core mode edits only `front` (its single SP).
      sp:  objectField({ front: 0, side: 0, rear: 0, top: 0, bottom: 0 }),
      // Structure (no hit locations in the simple system).
      sdp: objectField({ value: 0, max: 0 }),

      // Movement
      topSpeed:   numberField(0),
      safeSpeed:  numberField(0),
      acc:        numberField(0),
      dec:        numberField(0),
      controlMod: numberField(0),

      // Crew
      crewSlots:      numberField(1),
      passengerSlots: numberField(0),

      // Systems
      vehicleLink:   booleanField(false),
      damageControl: booleanField(false),
      compositeArmor: booleanField(false),   // halves shaped-charge (HEAT) Penetration (MM p.23)
      sensors:       booleanField(false),    // radar/detectors: auto-detect inbound missiles (90%)
      antiMissile:   booleanField(false),    // AGAMS/AEAMS: can attempt to shoot down inbound missiles
      fireControl:   numberField(0),
      countermeasures: arrayField(stringField(), []),
      weaponMounts:    arrayField(null, []),   // [{ name, penetration, rof, shots, range, arc, ammoType }]

      // Status (set by the damage resolver in later phases)
      onFire:         booleanField(false),
      immobilized:    booleanField(false),
      damagedSystems: arrayField(stringField(), []),

      // Derived (recomputed each prepare; stored so they're available to templates/rolls)
      armorValue: objectField({ front: 0, side: 0, rear: 0, top: 0, bottom: 0 }),
      bodyValue:  numberField(0),
      destroyed:  booleanField(false),

      notes: htmlField("")
    };
  }

  static migrateData(source) {
    source ??= {};
    if (hasOwn(source, "sp"))  source.sp  = mergeDefaults(source.sp,  { front: 0, side: 0, rear: 0, top: 0, bottom: 0 });
    if (hasOwn(source, "sdp")) source.sdp = mergeDefaults(source.sdp, { value: 0, max: 0 });
    return super.migrateData(source);
  }

  prepareDerivedData() {
    super.prepareDerivedData();
    const av = (sp) => Math.round((Number(sp) || 0) / 20);   // Armor Value = SP/20 (MM p.4)
    const sp = this.sp ?? {};
    this.armorValue = {
      front: av(sp.front), side: av(sp.side), rear: av(sp.rear), top: av(sp.top), bottom: av(sp.bottom)
    };
    // Body Value = SDP/20; ACPA uses chassis STR as its SDP source.
    const sdpMax = this.isACPA ? (Number(this.str) || 0) : (Number(this.sdp?.max) || 0);
    this.bodyValue = Math.round(sdpMax / 20);
    this.destroyed = sdpMax > 0 && (Number(this.sdp?.value) || 0) <= 0;
  }
}
