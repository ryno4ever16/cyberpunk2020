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

import { acpaAreaSOP, chassisStats, realityInterface, reflexControl, acpaReflexMod, acpaEffectiveRef, acpaArmorWeight, acpaArmorCost, acpaSib } from "../vehicle/vehicle-acpa.js";

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
      // Reputation (CP2020 p.54): GM-set social standing; can be NEGATIVE (cowardice/infamy). Feeds the
      // Facedown roll (1d10 + COOL + Rep) and Recognition checks. Additive — existing actors load with 0.
      reputation: numberField(0),
      events: stringField(""),
      family: stringField(""),
      style: stringField(""),
      motivations: stringField(""),
      notes: htmlField(""),

      // Core actor data. Kept as ObjectField because the system mutates these
      // structures during prepareData and older worlds may contain legacy shapes.
      stats: objectField(DEFAULT_STATS),
      ip: numberField(0),
      // IP tracker (feature [[ip-tracker-design]]): the Simple-mode single IP pool (RAW mode banks
      // IP per-skill instead). Additive — existing actors load with 0; no migration needed.
      ipPool: numberField(0),
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
 * (Round-7) The `shop` Actor type was RETIRED — custom shops are now world-settings data, not Actors.
 * See module/shop/shops.js (ShopDef) + [[shopping-design]]. Legacy shop actors are migrated to
 * ShopDefs and deleted by migrateShopActorsToDefs() on first GM ready.
 */

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
      vehicleType: stringField("car"),   // FREE TEXT name/flavor (the sheet offers datalist suggestions)
      // Movement class — drives the aircraft loss-table branch (isAircraft reads THIS, not the type
      // name, so a custom/renamed/localized type can't silently mis-flag a flier). ground|air|water.
      locomotion:  stringField("ground"),
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
      reactiveArmor: booleanField(false),    // explosive tiles: 1d10 (2-10) halves shaped-charge Pen, degrades w/ hits (MM p.23)
      reactiveHits:  numberField(0),         // shaped/HE hits absorbed; −1 to the deflect roll per 2; reset by "Replace"
      sensors:       booleanField(false),    // radar/detectors: auto-detect inbound missiles (90%)
      antiMissile:   booleanField(false),    // AGAMS/AEAMS: can attempt to shoot down inbound missiles
      fireControl:   numberField(0),
      countermeasures: arrayField(stringField(), []),
      weaponMounts:    arrayField(null, []),   // [{ name, penetration, rof, shots, range, arc, ammoType }]

      // Status (set by the damage resolver in later phases)
      onFire:         booleanField(false),
      immobilized:    booleanField(false),
      damagedSystems: arrayField(stringField(), []),

      // ACPA combat status (Maximum Metal p.55-56) — written by the powered-armor damage resolver.
      // Additive: existing actors get the schema defaults on load (no migration / relaunch needed).
      strDamage:    numberField(0),    // accumulated Suit STR loss from criticals
      refDamage:    numberField(0),    // accumulated Suit REF loss (already ÷2 per the chart)
      powerHours:   numberField(24),   // remaining power-cell life in hours (24h default)
      coolingTimer: numberField(0),    // minutes until heatstroke (0 = cooling OK)
      heatstrokeLevel: numberField(0), // 0 = none; ≥1 escalating Stun-save level after build-up (Serious→…)
      interfaceOut: numberField(0),    // rounds the interface/electronics are out
      seizeUp:      numberField(0),    // rounds a body area is seized up

      // ACPA frame structure (Maximum Metal p.61): CURRENT per-area frame SOP (damage tracked by the
      // powered-armor resolver). Max + chassis stats are DERIVED from chassis STR below.
      frameSOP:    objectField({ head: 0, rArm: 0, lArm: 0, rLeg: 0, lLeg: 0, torso: 0 }),

      // ACPA build selections (Maximum Metal p.64-65). Additive — existing actors get these defaults
      // on load (no migration / relaunch). Defaults are the neutral military baseline: Full-HUD
      // Wideband (SIB 0, so no surprise to existing suits) + Advanced reflex/control (full REF, max 10).
      realityInterface: stringField("FULL_HUD_WIDEBAND"),
      reflexControl:    stringField("ADVANCED"),
      commandComputer:  booleanField(false),   // C3: +1 initiative/awareness while linked (integrable with any)
      pilotId:          stringField(""),        // linked pilot character actor (its REF + takes overflow damage)
      pilotRef:         numberField(0),         // fallback pilot base REF when no pilot actor is linked
      trooperCapacity:  numberField(114),       // pilot+gear weight set aside for SIB (114 std; Russian 136; elite 80-91)
      systemsWeight:    numberField(0),          // aggregate weight of mounted systems (D-4d computes this; manual for now)

      // Derived (recomputed each prepare; stored so they're available to templates/rolls)
      armorValue: objectField({ front: 0, side: 0, rear: 0, top: 0, bottom: 0 }),
      bodyValue:  numberField(0),
      destroyed:  booleanField(false),
      // ACPA-derived frame stats (from chassis STR via the Chassis Inventory Table).
      frameSOPMax: objectField({ head: 0, rArm: 0, lArm: 0, rLeg: 0, lLeg: 0, torso: 0 }),
      toughness:   numberField(0),    // damage-reduction Toughness Mod (negative)
      damMod:      stringField(""),   // linear-frame melee Damage Mod (display)
      lift:        numberField(0),
      carry:       numberField(0),
      // ACPA-derived interface/reflex stats (from the Reality Interface + Reflex/Control selections).
      dfb:          numberField(0),    // Direct-Fire Bonus — to-hit mod when the suit fires its weapons
      interfaceSib: numberField(0),    // Reality Interface's contribution to the suit's Initiative Bonus
      interfaceSop: numberField(0),    // Reality Interface SOP (build budget)
      maxRef:       numberField(10),   // operating-REF cap from the Reflex/Control system
      refMod:       numberField(0),    // REF modifier from the Reflex/Control system
      effectiveRef: numberField(0),    // clamp(pilotRef + refMod, 0..maxRef) − refDamage
      // ACPA-derived weight + initiative (from the Armor Inventory + SIB derivation, MM p.61-62).
      armorWeight:  numberField(0),    // armor-shell weight (kg) from the chosen shell SP
      armorCost:    numberField(0),    // armor-shell cost (eb) from the chosen shell SP
      mountedSystemsWeight: numberField(0),  // summed weight of embedded acpaSystem Items
      mountedSystemsCost:   numberField(0),  // summed cost of embedded acpaSystem Items
      totalWeight:  numberField(0),    // total fully-loaded weight (chassis + armor + trooper + systems)
      buildCost:    numberField(0),    // total build cost (chassis + armor + interface + reflex + systems)
      sib:          numberField(0),    // Suit Initiative Bonus = round(cap ÷ totalWeight) − 1 + interface SIB

      notes: htmlField("")
    };
  }

  static migrateData(source) {
    source ??= {};
    if (hasOwn(source, "sp"))  source.sp  = mergeDefaults(source.sp,  { front: 0, side: 0, rear: 0, top: 0, bottom: 0 });
    if (hasOwn(source, "sdp")) source.sdp = mergeDefaults(source.sdp, { value: 0, max: 0 });
    // One-time backfill: derive the movement class from the legacy free-text vehicleType so existing
    // aircraft keep their (stall/spin) loss-table branch once isAircraft stops reading the name.
    if (!hasOwn(source, "locomotion") && hasOwn(source, "vehicleType")) {
      const t = String(source.vehicleType ?? "").toLowerCase();
      source.locomotion = /av-|\bav\b|rotor|osprey|heli|plane|jet|airship|gyro|aerodyne|dirigible|wing/.test(t) ? "air"
        : /boat|ship|barge|hovercraft|submar|yacht|naval|dinghy/.test(t) ? "water"
        : "ground";
    }
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

    // ACPA frame derivations (Maximum Metal p.61-62): per-area frame SOP max + Chassis Inventory stats.
    if (this.isACPA) {
      const str = Number(this.str) || 0;
      this.frameSOPMax = acpaAreaSOP(str);
      const cs = chassisStats(str);
      this.toughness = cs.toughness;
      this.damMod = cs.damMod;
      this.lift = cs.lift;
      this.carry = cs.carry;

      // Reality Interface + Reflex/Control derivations (Maximum Metal p.64-65).
      const ri = realityInterface(this.realityInterface);
      const rc = reflexControl(this.reflexControl);
      this.dfb = ri.dfb;
      this.interfaceSib = ri.sib;
      this.interfaceSop = ri.sop;
      this.maxRef = rc.maxRef;
      // Basic control on a military STR42+ frame is stricter (REF−3 not −2) — acpaReflexMod handles it.
      this.refMod = acpaReflexMod(this.reflexControl, str);
      // A linked pilot actor supplies the base REF; otherwise the manual pilotRef field is the fallback.
      let pilotRef = Number(this.pilotRef) || 0;
      try {
        if (this.pilotId) {
          const pilot = game.actors?.get(this.pilotId);
          const r = Number(pilot?.system?.stats?.ref?.total);
          if (Number.isFinite(r)) pilotRef = r;
        }
      } catch (e) { /* actors not ready */ }
      this.effectiveRef = acpaEffectiveRef({
        pilotRef, refMod: this.refMod, maxRef: rc.maxRef, refDamage: this.refDamage
      });

      // Weight budget + Suit Initiative Bonus (Maximum Metal p.61-62). Total loaded weight = chassis
      // + armor shell + Trooper capacity + interface + mounted systems (+1kg for a Command Computer).
      const armorSP = Number(this.sp?.front) || 0;
      this.armorWeight = acpaArmorWeight(armorSP);
      this.armorCost = acpaArmorCost(armorSP);
      const trooper = Number(this.trooperCapacity) || 0;
      const sysW = Number(this.systemsWeight) || 0;
      const cmdW = this.commandComputer ? 1 : 0;
      // Sum embedded acpaSystem Items (prepared by now) for the mounted-systems weight + cost.
      let mountedSystemsWeight = 0, mountedSystemsCost = 0;
      const items = this.parent?.items;
      if (items) for (const it of items) if (it.type === "acpaSystem") {
        mountedSystemsWeight += Number(it.system?.weight) || 0;
        mountedSystemsCost   += Number(it.system?.cost)   || 0;
      }
      this.mountedSystemsWeight = mountedSystemsWeight;
      this.mountedSystemsCost = mountedSystemsCost;
      this.totalWeight = cs.weight + this.armorWeight + trooper + ri.weight + mountedSystemsWeight + sysW + cmdW;
      this.sib = acpaSib({ chassisCapacity: cs.lift, totalWeight: this.totalWeight, interfaceSib: ri.sib });
      // Total build cost (chassis + armor shell + interface + reflex/control + Command Computer + systems).
      this.buildCost = (Number(cs.cost) || 0) + this.armorCost + (Number(ri.cost) || 0) + (Number(rc.cost) || 0)
        + (this.commandComputer ? 5000 : 0) + mountedSystemsCost;
    }
  }
}
