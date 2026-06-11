import { weaponTypes, rangedAttackTypes, meleeAttackTypes, fireModes, ranges, rangeDCs, rangeResolve, strengthDamageBonus, getMartialActionBonus, martialActions, isFnff2Enabled, getFnff2DamageBonusSymbol, FNFF2_ONLY_MARTIAL_ART_IDS, MARTIAL_ART_ID_BY_KEY, martialArtDisplayName, isEnergyAttackType } from "../lookups.js"
import { Multiroll, makeD10Roll } from "../dice.js"
import { localize, localizeParam, rollLocation, cwHasType, cwIsEnabled, isFumbleRoll, buildRangedCombatFumbleData, buildSkillFumbleData, clamp } from "../utils.js";
import { createCyberpunkChatMessage } from "../compat.js";

/** @extends {Item} */
export class CyberpunkItem extends Item {

  /**
   * Cyberpunk 2020: any fractional damage is rounded down
   * Also clamp at 0 to avoid negative damage showing up in chat
   * @param {number} total
   * @returns {number}
   */
  static _floorDamageTotal(total) {
    const n = Number(total);
    if (!Number.isFinite(n)) return 0;

    if (n <= 0) return 0;

    return Math.max(1, Math.floor(n));
  }

  /**
   * Build an inline-roll anchor that shows dice results on hover (via cp-inline-roll handler).
   * Click-to-reroll is disabled globally by the system.
   * @param {number} value
   * @param {Roll} roll
   * @param {string} extraClasses
  */
  static _inlineRollHtml(value, roll, extraClasses = "") {
    const v = Number(value);
    if (!Number.isFinite(v)) return String(value ?? "");
    if (!roll || typeof roll !== "object") return String(v);

    try {
      const data = (typeof roll.toJSON === "function") ? roll.toJSON() : roll;
      const json = encodeURIComponent(JSON.stringify(data));
      const cls = String(extraClasses || "").trim();
      return `<a class="inline-roll inline-result cp-inline-roll roll-result roll ${cls}" data-roll="${json}">${v}</a>`;
    } catch (e) {
      return String(v);
    }
  }

  /** @override */
  async _preCreate(data, options, user) {
    await super._preCreate(data, options, user);

    try {
      if (this.type === "skill") {
        const id = data?._id || this._id;
        if (id && FNFF2_ONLY_MARTIAL_ART_IDS.has(id) && !isFnff2Enabled()) {
          ui?.notifications?.warn(game.i18n.localize("CYBERPUNK.FNFF2SkillDisabledWarn"));
          throw new Error("FNFF2-only Martial Arts skill cannot be added while FNFF2 is disabled.");
        }
      }
    } catch (e) {
      throw e;
    }
  }

  prepareData() {
    super.prepareData();

    switch(this.type) {
      case "weapon":
        this._prepareWeaponData(this.system);
        break;
      case "armor":
        this._prepareArmorData(this.system);
        break;
    }
  }
  _getWeaponSystem() {
    if (this.type === "weapon") return this.system;
    const cwt = this.system?.CyberWorkType;
    if (this.type === "cyberware" && cwHasType(cwt, "Weapon")) {
      if (!cwIsEnabled(this)) return {};
      return cwt.Weapon || {};
    }
    return this.system;
  }

  async __setWeaponField(field, value) {
    if (this.type === "weapon") {
      return await this.update({[`system.${field}`]: value});
    }
    const cwt = this.system?.CyberWorkType;
    if (this.type === "cyberware" && cwHasType(this, "Weapon")) {
      return await this.update({[`system.CyberWorkType.Weapon.${field}`]: value});
    }
    return null;
  }

  /**
   * Apply linked-ammo damage modifiers to one shot's base damage.
   * rawDamageMult scales the base weapon damage (e.g. AP/Rubber = ×0.5); bonusDamageFormula
   * adds extra dice (e.g. Incendiary +1d6). Result is floored per CP2020 (min 1 if > 0).
   * No-op (returns the input, floored) when no ammo is linked or mults are neutral.
   * @param {number} baseDamage  Already-rolled base weapon damage for this shot
   * @param {object} rollData
   * @returns {Promise<number>}
   */
  async _applyAmmoDamage(baseDamage, rollData = {}) {
    const { rawDamageMult, bonusDamageFormula } = this._getAmmoProps();
    let total = (Number(baseDamage) || 0) * (Number(rawDamageMult) || 1);
    const bonus = String(bonusDamageFormula || "").trim();
    if (bonus) {
      try {
        const bonusRoll = await new Roll(bonus, rollData).evaluate();
        total += Number(bonusRoll.total) || 0;
      } catch (err) {
        console.warn("CP2020 | Invalid ammo bonusDamageFormula:", bonus, err);
      }
    }
    return CyberpunkItem._floorDamageTotal(total);
  }

  // ── Magazine "round pool" ─────────────────────────────────────────────────
  // A weapon fires from its MAGAZINE (system.shotsLeft). The magazine is filled
  // from a linked ammo Item in inventory by reloading (see modifiers.js). The fire
  // modes read the magazine via _roundPool() and write the remainder via
  // _setRoundPool(). With ammo tracking ON, an empty magazine blocks firing; with
  // tracking OFF ("Free Fire") reloads are free.

  /** True when the owning actor tracks ammo (default ON when the flag is unset). */
  _ammoTrackingOn() {
    return (this.actor?.getFlag?.("cyberpunk2020", "ammoTracking") ?? true) === true;
  }

  /** The linked ammo Item owned by the actor, or null. */
  _linkedAmmoItem() {
    if (!this.actor) return null;
    const sys = this._getWeaponSystem ? this._getWeaponSystem() : this.system;
    const id = String(sys?.ammoItemId ?? "");
    if (!id) return null;
    const it = this.actor.items.get(id);
    return (it && it.type === "ammo") ? it : null;
  }

  /** Rounds currently in the magazine. */
  _roundPool() {
    const sys = this._getWeaponSystem ? this._getWeaponSystem() : this.system;
    return Number(sys?.shotsLeft) || 0;
  }

  /** Write the remaining rounds back to the magazine. */
  async _setRoundPool(remaining) {
    const n = Math.max(0, Math.floor(Number(remaining) || 0));
    await this.__setWeaponField("shotsLeft", n);
  }

  /** Returns just the payload-relevant subset of _getAmmoProps() for weaponFired hook emissions. */
  _getAmmoPayload() {
    const p = this._getAmmoProps();
    const {
      ap, armorMultSoft, armorMultHard, penDamageMult, stunSaveOnHit, stunSaveMod,
      dotEnabled, dotTurns, dotDamageFormula, dotType, effectTypes, blastRadius,
      blastFullDamageWithin, blastZones, blastMultipliers, blastShrapnel,
      spreadMode, spreadWidthShort, spreadWidthMedium, spreadWidthLong,
      spreadDamageShort, spreadDamageMedium, spreadDamageLong,
    } = p;
    return {
      ap, armorMultSoft, armorMultHard, penDamageMult, stunSaveOnHit, stunSaveMod,
      dotEnabled, dotTurns, dotDamageFormula, dotType, effectTypes, blastRadius,
      blastFullDamageWithin, blastZones, blastMultipliers, blastShrapnel,
      spreadMode, spreadWidthShort, spreadWidthMedium, spreadWidthLong,
      spreadDamageShort, spreadDamageMedium, spreadDamageLong,
    };
  }

  /**
   * Read armor-interaction and secondary-effect properties from the linked ammo item (if any).
   * Returns: { ap, armorMultSoft, armorMultHard, accuracyMod, rawDamageMult,
   *            stunSaveOnHit, stunSaveMod, dotEnabled, dotTurns, dotDamageFormula }
   * Falls back to weapon-level ap if no ammo item is linked.
   *
   * armorMultSoft/Hard < 1 means the armor's SP is reduced for that armor type.
   * ap = true is a convenience alias for both mults ≤ 0.5 (standard AP rounds).
   */
  _getAmmoProps() {
    const sys = this._getWeaponSystem ? this._getWeaponSystem() : this.system;
    const weaponAP   = Boolean(sys?.ap);

    const noEffects = {
      stunSaveOnHit: false, stunSaveMod: 0, dotEnabled: false, dotTurns: 0, dotDamageFormula: "", dotType: "acid",
      effectTypes: ["None"], blastRadius: 0,
      blastFullDamageWithin: 1, blastZones: 4, blastMultipliers: [0.5, 0.25, 0.125, 0.0625], blastShrapnel: false,
      spreadMode: "single", spreadWidthShort: 1, spreadWidthMedium: 2, spreadWidthLong: 3,
      spreadDamageShort: "", spreadDamageMedium: "", spreadDamageLong: "",
    };
    const fallback = () => ({ ap: weaponAP, armorMultSoft: weaponAP ? 0.5 : 1.0, armorMultHard: weaponAP ? 0.5 : 1.0, accuracyMod: 0, rawDamageMult: 1.0, penDamageMult: 1.0, ...noEffects });

    // Resolve the rounds actually IN the magazine. Priority:
    //   1. live loaded item (loadedAmmoId)   — reflects current edits to that item
    //   2. loaded snapshot (loadedAmmo)      — preserves the profile if the source was deleted
    //   3. selected ammo item (ammoItemId)   — free fire / legacy weapons not yet reloaded
    let ammoSys = null;
    const loadedId   = String(sys?.loadedAmmoId ?? "");
    const selectedId = String(sys?.ammoItemId  ?? "");
    const loadedSnap = sys?.loadedAmmo;

    if (this.actor && loadedId) {
      const it = this.actor.items.get(loadedId);
      if (it && it.type === "ammo") ammoSys = it.system;
    }
    // Snapshot is only a fallback for a loaded-but-deleted source — never used once unloaded
    // (loadedAmmoId cleared), so an orphaned snapshot can't drive damage on an empty magazine.
    if (!ammoSys && loadedId && loadedSnap && typeof loadedSnap === "object" && loadedSnap.system && Object.keys(loadedSnap).length) {
      ammoSys = loadedSnap.system;
    }
    if (!ammoSys && this.actor && selectedId) {
      const it = this.actor.items.get(selectedId);
      if (it && it.type === "ammo") ammoSys = it.system;
    }

    if (!ammoSys) return fallback();

    const soft  = Number(ammoSys?.armorMultSoft  ?? 1.0);
    const hard  = Number(ammoSys?.armorMultHard  ?? 1.0);
    const acc   = Number(ammoSys?.accuracyMod    ?? 0);
    const dmgM  = Number(ammoSys?.rawDamageMult  ?? 1.0);
    const penM  = Number(ammoSys?.penDamageMult  ?? 1.0);
    const effects = {
      stunSaveOnHit:    Boolean(ammoSys?.stunSaveOnHit),
      stunSaveMod:      Number(ammoSys?.stunSaveMod       ?? 0),
      dotEnabled:       Boolean(ammoSys?.dotEnabled),
      dotTurns:         Number(ammoSys?.dotTurns          ?? 0),
      dotDamageFormula: String(ammoSys?.dotDamageFormula  ?? ""),
      dotType:          String(ammoSys?.dotType           ?? "acid"),
      effectTypes:      Array.isArray(ammoSys?.effectTypes) ? ammoSys.effectTypes : ["None"],
      blastRadius:      Number(ammoSys?.blastRadius        ?? 0),
      blastFullDamageWithin: Number(ammoSys?.blastFullDamageWithin ?? 1),
      blastZones:       Number(ammoSys?.blastZones        ?? 4),
      blastMultipliers: Array.isArray(ammoSys?.blastMultipliers) ? ammoSys.blastMultipliers : [0.5, 0.25, 0.125, 0.0625],
      blastShrapnel:    Boolean(ammoSys?.blastShrapnel),
      spreadMode:       String(ammoSys?.spreadMode        ?? "single"),
      spreadWidthShort:  Number(ammoSys?.spreadWidthShort  ?? 1),
      spreadWidthMedium: Number(ammoSys?.spreadWidthMedium ?? 2),
      spreadWidthLong:   Number(ammoSys?.spreadWidthLong   ?? 3),
      spreadDamageShort:  String(ammoSys?.spreadDamageShort  ?? ""),
      spreadDamageMedium: String(ammoSys?.spreadDamageMedium ?? ""),
      spreadDamageLong:   String(ammoSys?.spreadDamageLong   ?? ""),
    };

    // If both mults are EXACTLY 0.5 (symmetric — standard AP rounds), use the ap flag path.
    // This routes through resolveHitMath's spUsed halving and avoids double-halving when both
    // ap=true and armorMultSoft 0.5 are active. Sub-half mults (e.g. flechette armor ×¼) must
    // NOT use this shortcut — they take the mult path below so the true quarter is applied.
    if (soft === 0.5 && hard === 0.5) {
      return { ap: true, armorMultSoft: 1.0, armorMultHard: 1.0, accuracyMod: acc, rawDamageMult: dmgM, penDamageMult: penM, ...effects };
    }
    // Asymmetric mults (e.g. hollow point: better vs soft, worse vs hard) — use mult path, ap=false
    return { ap: false, armorMultSoft: soft, armorMultHard: hard, accuracyMod: acc, rawDamageMult: dmgM, penDamageMult: penM, ...effects };
  }

  isRanged() {
    const sys = this._getWeaponSystem();
    const type = String(sys?.weaponType || "").toLowerCase();
    const atk  = sys?.attackType;
    const isMeleeByType = type === "melee";
    const isMeleeByAtk  = atk && Object.values(meleeAttackTypes).includes(atk);
    return !(isMeleeByType || isMeleeByAtk);
  }

  /** Beam/energy weapon (laser, microwave): recharges instead of consuming ammo. See isEnergyAttackType. */
  isEnergyWeapon() {
    const sys = this._getWeaponSystem ? this._getWeaponSystem() : this.system;
    return isEnergyAttackType(sys?.attackType);
  }

  /**
   * Firearms for the “point-blank” rule
   * We are deliberately excluding Exotic weapons here, as they include lasers, microwaves, etc
  */
  _isFirearm() {
    const sys = this._getWeaponSystem();
    const wt = sys?.weaponType;
    return [
      weaponTypes.pistol,
      weaponTypes.submachinegun,
      weaponTypes.shotgun,
      weaponTypes.rifle,
      weaponTypes.heavy
    ].includes(wt);
  }

  _shouldMaximizePointBlankDamage(attackMods) {
    return this.isRanged() && this._isFirearm() && attackMods?.range === ranges.pointBlank;
  }
  
  _prepareWeaponData(data) {
    
  }

  _prepareArmorData(system) {
    // If new owner and armor covers this many areas or more, delete armor coverage areas the owner does not have
    const COVERAGE_CLEANSE_THRESHOLD = 20;

    let skipReform = false;
    // Sometimes this just BREAKS
    try {
      let idCheck = this.actor.id;
    }
    catch {
      skipReform = true;
    }

    let nowOwned = !system.lastOwnerId && this.actor;
    let changedHands = system.lastOwnerId !== undefined && system.lastOwnerId != this.actor.id;
    if(!skipReform && (nowOwned || changedHands)) {
      system.lastOwnerId = this.actor.id;
      let ownerLocs = this.actor.system.hitLocations;
      
      // Time to morph the armor to its new owner!
      // I just want this here so people can armor up giant robotic snakes if they want, y'know? or mechs.
      // ...I am fully aware this is overkill effort for most games.
      let areasCovered = Object.keys(system.coverage).length;
      let cleanseAreas = areasCovered > COVERAGE_CLEANSE_THRESHOLD;
      if(cleanseAreas) {
        // Remove any extra areas
        // This is so that armors can't be made bigger indefinitely. No idea why players might do that, but hey.
        for(let armorArea in system.coverage) {
          if(!ownerLocs[armorArea]) {
            console.warn(`ARMOR MORPH: The new owner of this armor (${this.actor.name}) does not have a ${armorArea}. Removing the area from the armor.`)
            delete system.coverage.armorArea;
          }
        }
      }
      
      // Add any areas the owner has but the armor doesn't.
      for(let ownerLoc in ownerLocs) {
        if(!system.coverage[ownerLoc]) {
          system.coverage[ownerLoc] = {
            stoppingPower: 0,
            ablation: 0
          }
        }
      }
    }
  }

  /**
   * Handle clickable rolls.
   * @param {Event} event   The originating click event
   * @private
   */
  roll() {
    switch (this.type) {
      case "weapon":
        this.__weaponRoll();
        break;
      case "cyberware":
        if (cwHasType(this, "Weapon")) {
          if (!cwIsEnabled(this)) {
            ui?.notifications?.warn(game.i18n.localize("CYBERPUNK.CWT_WeaponDisabled"));
            break;
          }
          this.__weaponRoll();
        }
        break;
      default:
        break;
    }
  }

    _isAutoWeapon(sys) {
    const atk = sys?.attackType;
    return atk === rangedAttackTypes.auto || atk === rangedAttackTypes.autoshotgun;
  }

  async _maybeApplyRangedFumble(attackRoll) {
    if (!game.settings.get("cyberpunk2020", "fumbleTableEnabled")) return null;
    if (!isFumbleRoll(attackRoll)) return null;

    const sys = this._getWeaponSystem();
    const isAuto = this._isAutoWeapon(sys);
    const autoOnlyJam = !!game.settings.get("cyberpunk2020", "autoFumbleOnlyJam");

    const data = await buildRangedCombatFumbleData({
      item: this,
      attackRoll,
      isAutoWeapon: isAuto,
      autoOnlyJam
    });

    return {
      fumble: { title: data.title, html: data.html },
      forceMiss: true,
      outcome: data.outcome
    };
  }

  // Get the roll modifiers to add when given a certain set of modifiers
  __shootModTerms({
    aimRounds,
    ambush,
    blinded,
    dualWield,
    fastDraw,
    hipfire,
    ricochet,
    running,
    targetArea,
    turningToFace,
    range,
    fireMode,
    autoRounds,
    extraMod
  }) {
    const sys = this._getWeaponSystem ? this._getWeaponSystem() : this.system;
    let terms = []
    if(!!targetArea) {
      terms.push(-4);
    }
    // Man I want language macros here...
    if(aimRounds && aimRounds > 0) {
      terms.push(aimRounds);
    }
    if(ambush) {
      terms.push(5);
    }
    if(blinded) {
      terms.push(-3);
    }
    if(dualWield) {
      terms.push(-3);
    }
    if(fastDraw) {
      terms.push(-3);
    }
    if(hipfire) {
      terms.push(-2);
    }
    if(ricochet) {
      terms.push(-5);
    }
    if(running) {
      terms.push(-3);
    }
    if(turningToFace) {
      terms.push(-2);
    }

    // Range on its own doesn't actually apply a modifier - it only affects to-hit rolls. But it does affect certain fire modes.
    // For now assume full auto = all bullets; spray and pray
    // +1/-1 per 10 bullets fired. + if close, - if medium onwards.
    // Friend's copy of the rulebook states penalties/bonus for all except point blank
    if(fireMode === fireModes.fullAuto) {
      const available = this._roundPool();
      const rof = Number(sys.rof) || 0;
      // Player may choose to fire fewer than the full ROF; recoil scales with rounds actually fired.
      const requested = Number(autoRounds);
      const cap = (Number.isFinite(requested) && requested > 0) ? Math.min(requested, rof) : rof;
      const bullets = Math.min(available, cap);
      // If close range, add, else subtract
      let multiplier = 
          (range === ranges.close) ? 1 
        : (range === ranges.pointBlank) ? 0 
        : -1;
      terms.push(multiplier * Math.floor(bullets/10))
    }

    // +3 mod for 3-round-burst at close or medium range
    if(fireMode === fireModes.threeRoundBurst
      && (range === ranges.close || range === ranges.medium)) {
        terms.push(+3);
    }

    // We always want to push extraMod, making it explicit it's ALWAYS there even with 0
    terms.push(extraMod || 0);

    return terms;
  }

  // Melee mods are a lot...simpler? I could maybe add swept or something, or opponent dodging. That'll be best once choosing targets is done
  __meleeModTerms({extraMod}) {
    const n = Number(extraMod);
    return Number.isFinite(n) && n !== 0 ? [n] : [];
  }

  // Now, this is gonna have to ask the player for different things depending on the weapon
  // Apply modifiers first? p99 in book
  // Crit fail jam roll

  // p106
  // Automatic weapon? choose between 3-round burst, full-auto and suppressive fire
  // 3-round = 1 target
  // full-auto = as many targets as you wish cos screw you
  // Suppressive fire? choose an area. save is rof/width area, minimum 2m

  // Laser? How much of the charge are you using?
  // Microwaver? regular attack, though includes path, but also roll on microwaver table

  // Area effect. Miss? Roll direction, roll meters away
  // Shotgun? Width depends on distance from character
  // Grenades have fixed width. Throw up to 10xBOD
  // Gas? Wind effect. Dear lord.

  // Let's just pretend the unusual ranged doesn't exist for now
  // Look into `modifiers.js` for the modifier obect
  __weaponRoll(attackMods, targetTokens) {
    if (this.type === "cyberware" && cwHasType(this, "Weapon") && !cwIsEnabled(this)) {
      ui?.notifications?.warn(game.i18n.localize("CYBERPUNK.CWT_WeaponDisabled"));
      return false;
    }

    let owner = this.actor;
    const system = this._getWeaponSystem();

    if (owner === null) {
      throw new Error("This item isn't owned by anyone.");
    }

    const isRanged = this.isRanged();

    // Per-actor ammo tracking (default ON). When ON, a ranged weapon can't fire with an
    // empty magazine — the player must reload (which draws from linked ammo inventory).
    // When OFF ("Free Fire"), ammo is ignored and the weapon always fires.
    if (this._ammoTrackingOn() && isRanged && this._roundPool() <= 0) {
      // Energy/beam weapons are depleted, not "out of ammo" — they recharge (reload) rather than reload rounds.
      ui.notifications.warn(localize(this.isEnergyWeapon() ? "NeedsRecharge" : "NoAmmo"));
      return false;
    }

    // Defense in depth: refuse fire modes this weapon isn't capable of. The dialog dropdown
    // already hides them, but this guards against macros / stale dialogs.
    if (isRanged && attackMods?.fireMode && !this.__getFireModes().includes(attackMods.fireMode)) {
      ui.notifications.warn(localize("FireModeNotCapable"));
      return false;
    }

    if (!isRanged) {
      if (system.attackType === meleeAttackTypes.martial) {
        return this.__martialBonk(attackMods);
      } else {
        return this.__meleeBonk(attackMods);
      }
    }

    // ---- Firemode-specific rolling. I may roll together some common aspects later ----
    // Full auto
    if(attackMods.fireMode === fireModes.fullAuto) {
      return this.__fullAuto(attackMods, targetTokens);
    }
    // Three-round burst. Shares... a lot in common with full auto actually
    else if(attackMods.fireMode === fireModes.threeRoundBurst) {
      return this.__threeRoundBurst(attackMods);
    }
    else if(attackMods.fireMode === fireModes.semiAuto) {
      return this.__semiAuto(attackMods);
    }
    else if(attackMods.fireMode === fireModes.suppressive) {
      return this.__suppressiveFire(attackMods);
    }
  }

  /**
   * True when this weapon can fire fully automatic (also enables Suppressive Fire).
   * attackType is the capability FLOOR: any weapon authored as Auto/Autoshotgun keeps full-auto
   * regardless of the stored flag (so pre-existing items never silently lose auto on upgrade).
   * The fullAutoCapable flag can additionally GRANT auto to a weapon whose attackType doesn't.
   * To make an auto weapon non-auto, change its attackType (the flag only adds capability).
   */
  _isFullAutoCapable(sys) {
    sys = sys ?? (this._getWeaponSystem ? this._getWeaponSystem() : this.system);
    if (sys?.attackType === rangedAttackTypes.auto || sys?.attackType === rangedAttackTypes.autoshotgun) return true;
    return sys?.fullAutoCapable === true;
  }

  /** True when this weapon can fire a 3-Round Burst. Full-auto weapons can always burst. */
  _isBurstCapable(sys) {
    sys = sys ?? (this._getWeaponSystem ? this._getWeaponSystem() : this.system);
    if (this._isFullAutoCapable(sys)) return true;
    return sys?.burstCapable === true;
  }

  __getFireModes() {
    const isWeaponDoc = this.type === "weapon" || (this.type === "cyberware" && cwHasType(this, "Weapon"));
    if (!isWeaponDoc) {
      console.error(`${this.name} is not a weapon, and therefore has no fire modes`);
      return [];
    }
    const sys = this._getWeaponSystem ? this._getWeaponSystem() : this.system;
    const modes = [];
    // Full Auto + Suppressive require full-auto capability; 3-Round Burst requires burst (or auto).
    // Semi-auto is always available. Non-automatic weapons are therefore limited to semi-auto.
    if (this._isFullAutoCapable(sys)) {
      modes.push(fireModes.fullAuto, fireModes.suppressive);
    }
    if (this._isBurstCapable(sys)) {
      modes.push(fireModes.threeRoundBurst);
    }
    modes.push(fireModes.semiAuto);
    return modes;
  }

  // Roll just the attack roll of a weapon, return it
  async attackRoll(attackMods) {
    if (this.type === "cyberware" && cwHasType(this, "Weapon") && !cwIsEnabled(this)) {
      ui?.notifications?.warn(game.i18n.localize("CYBERPUNK.CWT_WeaponDisabled"));
      return await new Roll("0").evaluate();
    }

    const system = this._getWeaponSystem();
    let isRanged = this.isRanged();

    let attackTerms = ["@stats.ref.total"];
    if(system.attackSkill) {
      attackTerms.push(`@attackSkill`);
    }
    if(isRanged) {
      attackTerms.push(...(this.__shootModTerms(attackMods)));
    }
    else {
      attackTerms.push(...(this.__meleeModTerms(attackMods)));
    }
    const weaponAccuracy = Number(system?.accuracy ?? 0) || 0;
    if (weaponAccuracy !== 0) {
      attackTerms.push("@weaponAccuracy");
    }

    // Linked-ammo accuracy modifier (ranged only).
    const ammoAccuracy = isRanged ? (Number(this._getAmmoProps?.().accuracyMod ?? 0) || 0) : 0;
    if (ammoAccuracy !== 0) {
      attackTerms.push("@ammoAccuracy");
    }

    const attackSkillKey = (system?.attackSkill ?? this.system?.attackSkill) || "";
    const attackSkillValRaw = this.actor?.getSkillVal?.(attackSkillKey);
    const attackSkillVal = Number.isFinite(Number(attackSkillValRaw)) ? Number(attackSkillValRaw) : 0;

    return await makeD10Roll(attackTerms, {
      stats: this.actor.system.stats,
      attackSkill: attackSkillVal,
      weaponAccuracy,
      ammoAccuracy
    }).evaluate();
  }

  /**
   * Fire an automatic weapon at full auto
   * @param {*} attackMods The modifiers for an attack. fireMode, ambush, etc - look in lookups.js for the specification of these
   * @returns 
   */
  async __fullAuto(attackMods, targetTokens) {
      const system = this._getWeaponSystem();
      // The kind of distance we're attacking at, so we can display Close: <50m or something like that
      let actualRangeBracket = rangeResolve[attackMods.range](system.range);
      let DC = rangeDCs[attackMods.range];
      let targetCount = targetTokens.length || attackMods.targetsCount || 1;
      const rollData = this.actor?.getRollData?.() ?? {};
      const maximizeDamage = this._shouldMaximizePointBlankDamage(attackMods);
      const maxDamageRoll = maximizeDamage
        ? await new Roll(system.damage, rollData).evaluate({ maximize: true })
        : null;
      const maxDamage = maximizeDamage
        ? CyberpunkItem._floorDamageTotal(maxDamageRoll.total)
        : null;
      
      // This is a somewhat flawed multi-target thing - given target tokens, we could calculate distance (& therefore penalty) for each, and apply damage to them
      let rolls = [];
      // Round pool: ammo inventory when tracking, else the magazine (Free Fire).
      let shotsLeft = this._roundPool();
      // Player may fire fewer than the full ROF. Cap the burst at the chosen rounds (1..rof).
      const maxRof = Number(system.rof) || 0;
      const requestedRounds = Number(attackMods.autoRounds);
      const effectiveRof = (Number.isFinite(requestedRounds) && requestedRounds > 0)
        ? Math.min(requestedRounds, maxRof)
        : maxRof;
      const perTarget = Math.max(1, Math.floor(effectiveRof / targetCount));
      for (let i = 0; i < targetCount; i++) {
          let attackRoll = await this.attackRoll(attackMods);

          const rangedFumble = await this._maybeApplyRangedFumble(attackRoll);

          let roundsFired = Math.min(shotsLeft, perTarget);

          if (rangedFumble) {
            roundsFired = Math.min(shotsLeft, 1);
          }

          if (rangedFumble?.outcome?.discharge) {
            shotsLeft = 0;
          } else {
            shotsLeft = Math.max(0, shotsLeft - roundsFired);
          }

          await this._setRoundPool(shotsLeft);

          let roundsHit = Math.min(roundsFired, attackRoll.total - DC);
          
          if (roundsHit < 0) {
              roundsHit = 0;
          }
          if (rangedFumble?.forceMiss) {
            roundsHit = 0;
          }
          let areaDamages = {};
          // Roll damage for each of the bullets that hit
          for (let i = 0; i < roundsHit; i++) {
              let location = (await rollLocation(attackMods.targetActor, attackMods.targetArea)).areaHit;
              if (!areaDamages[location]) {
                  areaDamages[location] = [];
              }
              const dmgRoll = maximizeDamage
                ? maxDamageRoll
                : await new Roll(system.damage, rollData).evaluate();

              const baseDmg = maximizeDamage
                ? maxDamage
                : CyberpunkItem._floorDamageTotal(dmgRoll.total);
              const dmg = await this._applyAmmoDamage(baseDmg, rollData);

              areaDamages[location].push({
                damage: dmg,
                damageHtml: CyberpunkItem._inlineRollHtml(dmg, dmgRoll, "damage")
              });
          }
          let templateData = {
              target: targetTokens[i] || undefined,
              range: attackMods.range,
              toHit: DC,
              attackRoll: attackRoll,
              fired: roundsFired,
              hits: roundsHit,
              hit: roundsHit > 0,
              areaDamages: areaDamages,
              locals: {
                  range: { range: actualRangeBracket }
              },
              fumble: rangedFumble?.fumble ?? null,
          };
          let roll = new Multiroll(`${localize("Autofire")}`, `${localize("Range")}: ${localizeParam(attackMods.range, {range: actualRangeBracket})}`);
          roll.execute(undefined, "systems/cyberpunk2020/templates/chat/multi-hit.hbs", templateData);
          // ── Damage automation ──────────────────────────────────────────────
          // Inner damage loop also uses 'i' but has exited; outer 'i' is valid.
          if (areaDamages && Object.keys(areaDamages).length > 0) {
              const tok = (targetTokens && targetTokens.length > i) ? targetTokens[i] : null;
              Hooks.callAll("cyberpunk2020.weaponFired", {
                  attackerId:    this.actor?.id ?? null,
                  weaponName:    this.name,
                  ...this._getAmmoPayload(),
                  areaDamages,
                  targetTokenId: tok?.id ?? null,
                  targetActorId: tok ? (canvas.tokens?.get(tok.id)?.actor?.id ?? null) : null,
              });
          }
          // ──────────────────────────────────────────────────────────────────
          rolls.push(roll);
      }
      return rolls;
  }

  async __threeRoundBurst(attackMods) {
      const system = this._getWeaponSystem();
      // The kind of distance we're attacking at, so we can display Close: <50m or something like that
      let actualRangeBracket = rangeResolve[attackMods.range](system.range);
      let DC = rangeDCs[attackMods.range];
      let attackRoll = await this.attackRoll(attackMods);
      const rangedFumble = await this._maybeApplyRangedFumble(attackRoll);
      const rollData = this.actor?.getRollData?.() ?? {};
      const maximizeDamage = this._shouldMaximizePointBlankDamage(attackMods);
      const maxDamageRoll = maximizeDamage
        ? await new Roll(system.damage, rollData).evaluate({ maximize: true })
        : null;
      const maxDamage = maximizeDamage
        ? CyberpunkItem._floorDamageTotal(maxDamageRoll.total)
        : null;

      const roundPool = this._roundPool();
      let roundsFired = Math.min(roundPool, system.rof, 3);
      if (rangedFumble) {
        roundsFired = Math.min(roundPool, 1);
      }
      let attackHits = attackRoll.total >= DC;
      if (rangedFumble?.forceMiss) {
        attackHits = false;
      }
      let areaDamages = {};
      let roundsHit;
      if (attackHits) {
          // In RAW this is 1d6/2, but this is functionally the same
          roundsHit = await new Roll("1d3").evaluate();
          for (let i = 0; i < roundsHit.total; i++) {
              let location = (await rollLocation(attackMods.targetActor, attackMods.targetArea)).areaHit;
              if (!areaDamages[location]) {
                  areaDamages[location] = [];
              }
              const dmgRoll = maximizeDamage
                ? maxDamageRoll
                : await new Roll(system.damage, rollData).evaluate();

              const baseDmg = maximizeDamage
                ? maxDamage
                : CyberpunkItem._floorDamageTotal(dmgRoll.total);
              const dmg = await this._applyAmmoDamage(baseDmg, rollData);

              areaDamages[location].push({
                damage: dmg,
                damageHtml: CyberpunkItem._inlineRollHtml(dmg, dmgRoll, "damage")
              });
          }
      }
      let templateData = {
          range: attackMods.range,
          toHit: DC,
          attackRoll: attackRoll,
          fired: roundsFired,
          hits: attackHits ? roundsHit.total : 0,
          hit: attackHits,
          areaDamages: areaDamages,
          locals: {range: { range: actualRangeBracket }},
          fumble: rangedFumble?.fumble ?? null,
      };
      let roll = new Multiroll(localize("ThreeRoundBurst"));
      roll.execute(undefined, "systems/cyberpunk2020/templates/chat/multi-hit.hbs", templateData);
      // ── Damage automation ────────────────────────────────────────────────
      // targetTokens not passed to __threeRoundBurst; resolved via chat button.
      if (attackHits && areaDamages && Object.keys(areaDamages).length > 0) {
          Hooks.callAll("cyberpunk2020.weaponFired", {
              attackerId:    this.actor?.id ?? null,
              weaponName:    this.name,
              ap:            Boolean(system.ap),
              areaDamages,
              targetTokenId: null,
              targetActorId: null,
          });
      }
      // ────────────────────────────────────────────────────────────────────
      if (rangedFumble?.outcome?.discharge) {
        await this._setRoundPool(0);
      } else {
        await this._setRoundPool(roundPool - roundsFired);
      }
      return roll;
  }

  async __suppressiveFire(mods = {}) {
    const sys = this._getWeaponSystem();
    const roundPool = this._roundPool();
    const rounds = clamp(Number(mods.roundsFired) || Number(sys.rof) || 0, 1, roundPool || 0);
    const width = Math.max(2, Number(mods.zoneWidth ?? 2));
    const targets = Math.max(1, Number(mods.targetsCount ?? 1));

    await this._setRoundPool(roundPool - rounds);

    const saveDC = Math.ceil(rounds / width);
    const dmgFormula = sys.damage || "1d6";
    const rollData = this.actor?.getRollData?.() ?? {};

    const results = [];
    for (let t = 0; t < targets; t++) {
      const hitsRoll = await new Roll("1d6").evaluate();
      const areaDamages = {};

      for (let i = 0; i < hitsRoll.total; i++) {
        const loc = (await rollLocation(mods.targetActor, mods.targetArea)).areaHit;
        const dmgRoll = await new Roll(dmgFormula, rollData).evaluate();
        const dmg = await this._applyAmmoDamage(CyberpunkItem._floorDamageTotal(dmgRoll.total), rollData);

        if (!areaDamages[loc]) areaDamages[loc] = [];

        areaDamages[loc].push({
          dmg,
          dmgHtml: CyberpunkItem._inlineRollHtml(dmg, dmgRoll, "damage")
        });
      }

      results.push({ hitsRoll, areaDamages });
    }

    const html = await (foundry?.applications?.handlebars?.renderTemplate ?? renderTemplate)(
      "systems/cyberpunk2020/templates/chat/suppressive.hbs",
      { weaponName: this.name, rounds, width, saveDC, dmgFormula, results }
    );

    await createCyberpunkChatMessage({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: html,
      flags : { cyberpunk2020: { fireMode: "suppressive" } }
    }, { useDefaultRollMode: true });

    // Emit hook so damage-hooks.js can draw the fire zone and prompt targets
    const attackerToken = canvas?.tokens?.placeables?.find(t => t.actor?.id === this.actor?.id) ?? null;
    Hooks.callAll("cyberpunk2020.suppressiveFire", {
      saveDC,
      dmgFormula,
      weaponName:       this.name,
      actorId:          this.actor?.id ?? null,
      attackerTokenId:  attackerToken?.id ?? null,
      zoneWidth:        width,
      weaponRange:      Number(sys.range ?? 50),
    });
  }

  async __semiAuto(attackMods) {
      const system = this._getWeaponSystem();
      
      // The range we're shooting at
      let DC = rangeDCs[attackMods.range];
      let attackRoll = await this.attackRoll(attackMods);
      const rangedFumble = await this._maybeApplyRangedFumble(attackRoll);
      const rollData = this.actor?.getRollData?.() ?? {};
      const maximizeDamage = this._shouldMaximizePointBlankDamage(attackMods);
      const damageRoll = await new Roll(system.damage, rollData).evaluate({ maximize: maximizeDamage });
      const dmg = await this._applyAmmoDamage(CyberpunkItem._floorDamageTotal(damageRoll.total), rollData);
      let locationRoll = await rollLocation(attackMods.targetActor, attackMods.targetArea);
      let actualRangeBracket = rangeResolve[attackMods.range](system.range);
      let attackHits = attackRoll.total >= DC;
      if (rangedFumble?.forceMiss) {
        attackHits = false;
      }
      const roundPool = this._roundPool();
      const roundsFired = Math.min(roundPool, 1);
      let location = locationRoll.areaHit;
      let areaDamages = {};
      
      if (attackHits) {
          if (!areaDamages[location]) {
              areaDamages[location] = [];
          }
          areaDamages[location].push({
            damage: dmg,
            damageHtml: CyberpunkItem._inlineRollHtml(dmg, damageRoll, "damage"),
          });
      }
      
      let templateData = {
        range: attackMods.range,
        toHit: DC,
        attackRoll: attackRoll,
        fired: roundsFired,
        hits: attackHits ? 1 : 0,
        hit: attackHits,
        areaDamages: areaDamages,
        fumble: rangedFumble?.fumble ?? null,
        locals: {
            range: { range: actualRangeBracket }
        }
      };

      let roll = new Multiroll(localize("SemiAuto"));
      roll.execute(undefined, "systems/cyberpunk2020/templates/chat/multi-hit.hbs", templateData);
      // ── Damage automation ────────────────────────────────────────────────
      // targetTokens not passed to __semiAuto; resolved via chat button.
      if (attackHits && areaDamages && Object.keys(areaDamages).length > 0) {
          Hooks.callAll("cyberpunk2020.weaponFired", {
              attackerId:    this.actor?.id ?? null,
              weaponName:    this.name,
              ap:            Boolean(system.ap),
              areaDamages,
              targetTokenId: null,
              targetActorId: null,
          });
      }
      // ────────────────────────────────────────────────────────────────────

      if (rangedFumble?.outcome?.discharge) {
        await this._setRoundPool(0);
      } else {
        await this._setRoundPool(roundPool - roundsFired);
      }

      return roll;
  }

  /**
  /**
   * T4-B: Apply special martial arts status effects after a successful hit.
   * Handles: Throw/SweepTrip (knockdown), Hold (restrained), Grapple, Choke (DOT), Escape.
   */
  static async _applyMartialHitEffects(action, targetActor, attackerActor) {
    const enabled = (() => { try { return game.settings.get("cyberpunk2020", "specialMeleeEffectsEnabled"); } catch { return true; } })();
    if (!enabled) return;
    const tName = targetActor?.name ?? "Target";
    const aName = attackerActor?.name ?? "Attacker";

    if (action === martialActions.throw) {
      await ChatMessage.create({
        content: `<div class="cyberpunk save-prompt"><h3>⬇ Knockdown — ${tName}</h3><div><b>${tName}</b> is knocked prone by Throw. Must spend one action to stand up before acting normally. (CP2020 p.100)</div></div>`,
        speaker: ChatMessage.getSpeaker({ actor: targetActor }),
      });
    }

    if (action === martialActions.sweepTrip) {
      await ChatMessage.create({
        content: `<div class="cyberpunk save-prompt"><h3>⬇ Knockdown — ${tName}</h3><div><b>${tName}</b> is knocked prone by Sweep/Trip. Must spend one action to stand up before acting normally. (CP2020 p.100)</div></div>`,
        speaker: ChatMessage.getSpeaker({ actor: targetActor }),
      });
    }

    if (action === martialActions.hold) {
      await targetActor.setFlag("cyberpunk2020", "heldBy", attackerActor?.id ?? "").catch(() => {});
      await ChatMessage.create({
        content: `<div class="cyberpunk save-prompt"><h3>🤜 Held — ${tName}</h3><div><b>${tName}</b> is held by <b>${aName}</b>. Target can only attempt Escape (contested roll). (CP2020 p.100)</div></div>`,
        speaker: ChatMessage.getSpeaker({ actor: targetActor }),
      });
    }

    if (action === martialActions.grapple) {
      await targetActor.setFlag("cyberpunk2020", "grappledBy", attackerActor?.id ?? "").catch(() => {});
      await ChatMessage.create({
        content: `<div class="cyberpunk save-prompt"><h3>🤜 Grappled — ${tName}</h3><div><b>${tName}</b> is grappled by <b>${aName}</b>. Grapple: attacker can Hold, Choke, or Throw on subsequent turns as a free action. (CP2020 p.100–102)</div></div>`,
        speaker: ChatMessage.getSpeaker({ actor: targetActor }),
      });
    }

    if (action === martialActions.choke) {
      await targetActor.setFlag("cyberpunk2020", "chokeState", { formula: "1d6" }).catch(() => {});
      await ChatMessage.create({
        content: `<div class="cyberpunk save-prompt"><h3>🫁 Choke — ${tName}</h3><div><b>${tName}</b> is being choked by <b>${aName}</b>. Takes 1d6 damage per turn and must pass Stun Save each turn or fall unconscious. (CP2020 p.100)</div></div>`,
        speaker: ChatMessage.getSpeaker({ actor: targetActor }),
      });
    }

    if (action === martialActions.escape) {
      await targetActor.unsetFlag("cyberpunk2020", "heldBy").catch(() => {});
      await targetActor.unsetFlag("cyberpunk2020", "grappledBy").catch(() => {});
      await targetActor.unsetFlag("cyberpunk2020", "chokeState").catch(() => {});
      await ChatMessage.create({
        content: `<div class="cyberpunk save-prompt"><h3>🏃 Escaped — ${tName}</h3><div><b>${tName}</b> breaks free from the hold/grapple/choke.</div></div>`,
        speaker: ChatMessage.getSpeaker({ actor: targetActor }),
      });
    }
  }

  /**
   * Roll the defender's contested melee defense.
   * RAW: defender uses the HIGHEST applicable skill — Melee, Fencing, Brawling, Dodge,
   * Athletics, or any Martial Arts (CP2020 p.102).
   * Returns { roll, total, skillName, ref }.
   */
  static async _rollMeleeDefense(targetActor) {
    const ref = Number(targetActor.system?.stats?.ref?.total) || 0;

    // Standard defense skills
    const CANDIDATES = ["Melee", "Fencing", "Brawling", "Dodge", "Athletics"];
    let best = { name: "No Skill", val: 0 };
    for (const sk of CANDIDATES) {
      const val = Number(targetActor.getSkillVal?.(sk) ?? 0);
      if (val > best.val) best = { name: sk, val };
    }
    // Check all martial arts the defender has trained (built-in and custom)
    for (const m of (targetActor.trainedMartials?.() ?? [])) {
      const val = Number(targetActor.getSkillVal?.(m.value) ?? 0);
      if (val > best.val) best = { name: m.label, val };
    }

    const roll = await new Roll("1d10 + @ref + @skill", { ref, skill: best.val }).evaluate();
    return { roll, total: roll.total, skillName: best.name, skillVal: best.val, ref };
  }

  async __meleeBonk(attackMods) {
      // Just doesn't have a DC - is contested instead
      let attackRoll = await this.attackRoll(attackMods);

      // Take into account the CyberTerminus modifier for damage
      const system = this._getWeaponSystem ? this._getWeaponSystem() : this.system;
      let damageFormula = `${system.damage}+@strengthBonus`;
      if (attackMods.cyberTerminus) {
          switch (attackMods.cyberTerminus) {
              case "CyberTerminusX2":
                  damageFormula = `(${damageFormula})*2`;
                  break;
              case "CyberTerminusX3":
                  damageFormula = `(${damageFormula})*3`;
                  break;
              case "NoCyberlimb":
              default:
                  break;
          }
      }
      let damageRoll = await new Roll(damageFormula, {
          strengthBonus: strengthDamageBonus(this.actor.system.stats.bt.total)
      }).evaluate();

      // CP2020: any fractional damage is rounded down
      damageRoll._total = CyberpunkItem._floorDamageTotal(damageRoll.total);

      let locationRoll = await rollLocation(attackMods.targetActor, attackMods.targetArea);

      let fumble = null;
      if (game.settings.get("cyberpunk2020", "fumbleTableEnabled") && isFumbleRoll(attackRoll)) {
        fumble = await buildSkillFumbleData({
          skill: { system: { stat: "ref" } },
          roll: attackRoll
        });
      }

      let bigRoll = new Multiroll(this.name, this.system.flavor)
        .addRoll(attackRoll, { name: localize("Attack") })
        .addRoll(damageRoll, { name: localize("Damage") })
        .addRoll(locationRoll.roll, { name: localize("Location"), flavor: locationRoll.areaHit });

      // Contested melee resolution.
      // Exactly one targeted token → roll defense, compare totals, emit damage hook only on attacker win.
      // No target (or multiple) → PATH B always shows Apply Damage button (GM adjudicates the hit).
      const _meleeSys  = this._getWeaponSystem ? this._getWeaponSystem() : this.system;
      const _meleeAP   = Boolean(_meleeSys?.ap);
      const _meleeEdge = Boolean(_meleeSys?.isEdged);
      const _meleeTarget = (game.user?.targets?.size === 1) ? game.user.targets.first() : null;
      const _meleeTargetActor = _meleeTarget?.actor ?? null;
      if (_meleeTargetActor && locationRoll.areaHit) {
        const defInfo = await CyberpunkItem._rollMeleeDefense(_meleeTargetActor);
        // T4-C: Dodge adds +2 to effective defense total; Parry blocks the attack outright
        const _meleeDodgeBonus = (_meleeTargetActor.getFlag("cyberpunk2020", "dodging") ? 2 : 0);
        const _meleeIsParrying = !!_meleeTargetActor.getFlag("cyberpunk2020", "parrying");
        const defLabel = `${defInfo.skillName} ${defInfo.skillVal} (REF ${defInfo.ref})`
          + (_meleeDodgeBonus > 0 ? ` +${_meleeDodgeBonus} Dodge` : "")
          + (_meleeIsParrying ? " [PARRY — blocked]" : "");
        bigRoll.addRoll(defInfo.roll, { name: `${_meleeTargetActor.name} Defends`, flavor: defLabel });
        const attackHits = !_meleeIsParrying && (attackRoll.total > defInfo.total + _meleeDodgeBonus);
        if (_meleeIsParrying) _meleeTargetActor.unsetFlag("cyberpunk2020", "parrying").catch(() => {});
        if (attackHits) {
          Hooks.callAll("cyberpunk2020.weaponFired", {
            areaDamages: { [locationRoll.areaHit]: [{ damage: damageRoll.total }] },
            ap: _meleeAP,
            edged: _meleeEdge,
            targetTokenId: _meleeTarget.id,
            targetActorId: _meleeTargetActor.id,
          });
        }
      } else if (locationRoll.areaHit) {
        Hooks.callAll("cyberpunk2020.weaponFired", {
          areaDamages: { [locationRoll.areaHit]: [{ damage: damageRoll.total }] },
          ap: _meleeAP,
          edged: _meleeEdge,
        });
      }

      bigRoll.defaultExecute({ img: this.img, fumble });
      return bigRoll;
  }
  async __martialBonk(attackMods) {
    let actor = this.actor;
    let system = actor.system;
    // Action being done, eg strike, block etc. The action is chosen by the combat-tab button that
    // launched this attack and injected into attackMods; default to Strike if a caller omits it.
    let action = attackMods.action || martialActions.strike;
    let martialArt = attackMods.martialArt;

    // Will be something this line once I add the martial arts bonuses. None for brawling, remember
    // let martialBonus = this.actor?.skills.MartialArts[martialArt].bonuses[action];
    let isMartial = martialArt != "Brawling";
    let keyTechniqueBonus = 0;
    let martialSkillLevel = actor.getSkillVal(martialArt);
    let flavor = game.i18n.has(`CYBERPUNK.${action + "Text"}`) ? localize(action + "Text") : "";

    // Resolve the backing skill so custom styles can supply per-action bonuses and a clean title.
    const maSkill = actor.getMartialArtSkill?.(martialArt) ?? null;
    const skillBonuses = maSkill?.system?.martialBonuses ?? null;
    const martialTitle = (martialArt === "Brawling")
      ? localize("SkillBrawling")
      : (maSkill ? martialArtDisplayName(maSkill.name)
                 : (game.i18n.has(`CYBERPUNK.Skill${martialArt}`) ? localize("Skill" + martialArt) : martialArt));

    let results = new Multiroll(localizeParam("MartialTitle", {action: localize(action), martialArt: martialTitle}), flavor);

    // All martial arts are contested
    // Bonus for a specific action from the selected martial art (per-skill bonuses override the table)
    const actionBonus = getMartialActionBonus(martialArt, action, skillBonuses);

    // Additional modifier from the dialog
    const extraMod = Number(attackMods.extraMod || 0);

    // FNFF2: Martial Damage Bonus rules
    const fnff2 = isFnff2Enabled();

    let martialDamageBonusValue = 0;

    if (isMartial) {
      if (!fnff2) {
        martialDamageBonusValue = martialSkillLevel;
      } else {
        const symbol = getFnff2DamageBonusSymbol(action);

        const isKeyVariant = actionBonus > 0;

        const levelForDamage =
          (martialArt === "Martial Arts: PanzerFaust")
            ? Math.floor(martialSkillLevel * 1.5)
            : martialSkillLevel;

        // * — damage bonus works (if Key Variant)
        // $ — works only if Key Variant
        // % / ‘@’ — do not give damage bonus from MA level
        if ((symbol === "*" || symbol === "$") && isKeyVariant) {
          martialDamageBonusValue = levelForDamage;
        } else {
          martialDamageBonusValue = 0;
        }
      }
    }
    // Martial arts throw formula: reflex + skill level + special technique + action bonus + additional mod
    // If the reception is performed through a weapon item (including cyber weapons), we take its WA
    const sysForAcc = this._getWeaponSystem ? this._getWeaponSystem() : this.system;
    const weaponAccuracy = Number(sysForAcc?.accuracy ?? 0) || 0;

    let attackRoll = new Roll(
      `1d10x10 + @stats.ref.total + @attackBonus + @keyTechniqueBonus + @actionBonus + @extraMod${weaponAccuracy !== 0 ? " + @weaponAccuracy" : ""}`, 
      {
        stats: system.stats,
        attackBonus: martialSkillLevel,
        keyTechniqueBonus: keyTechniqueBonus,
        actionBonus: actionBonus,
        extraMod: extraMod,
        weaponAccuracy
      }
    );
    results.addRoll(attackRoll, {name: "Attack"});

    // Base damage: if the weapon has a damage field, use it
    // Otherwise, fall back to the standard dice rolls for strikes/kicks/throws/chokes
    const sysWeapon = this._getWeaponSystem ? this._getWeaponSystem() : this.system;
    const baseWeaponDamage = (sysWeapon?.damage && String(sysWeapon.damage).trim()) ? String(sysWeapon.damage).trim() : "";
    let damageFormula = "";

    if (baseWeaponDamage) {
      damageFormula = `${baseWeaponDamage}+@strengthBonus+@martialDamageBonus`;
    } else if (action === martialActions.strike) {
      damageFormula = "1d3+@strengthBonus+@martialDamageBonus";
    } else if ([martialActions.kick, martialActions.throw, martialActions.choke].includes(action)) {
      damageFormula = "1d6+@strengthBonus+@martialDamageBonus";
    }

    // CyberTerminus modifier
    if (attackMods?.cyberTerminus) {
      switch (attackMods.cyberTerminus) {
        case "CyberTerminusX2":
          damageFormula = `(${damageFormula})*2`;
          break;
        case "CyberTerminusX3":
          damageFormula = `(${damageFormula})*3`;
          break;
        case "NoCyberlimb":
        default:
          break;
      }
    }

    if (damageFormula) {
      // Evaluate attack roll now so we can compare totals for contested resolution
      if (!attackRoll._evaluated) await attackRoll.evaluate();

      const loc = await rollLocation(attackMods.targetArea);
      results.addRoll(loc.roll, { name: localize("Location"), flavor: loc.areaHit });
      const damageRoll = await new Roll(damageFormula, {
        strengthBonus: strengthDamageBonus(system.stats.bt.total),
        martialDamageBonus: martialDamageBonusValue
      }).evaluate();

      // CP2020: any fractional damage is rounded down
      damageRoll._total = CyberpunkItem._floorDamageTotal(damageRoll.total);

      results.addRoll(damageRoll, { name: localize("Damage") });

      // Contested melee resolution (same logic as __meleeBonk).
      const _maSys  = this._getWeaponSystem ? this._getWeaponSystem() : this.system;
      const _maAP   = Boolean(_maSys?.ap);
      const _maEdge = Boolean(_maSys?.isEdged);
      const _maTarget = (game.user?.targets?.size === 1) ? game.user.targets.first() : null;
      const _maTargetActor = _maTarget?.actor ?? null;
      if (_maTargetActor && loc.areaHit) {
        const defInfo = await CyberpunkItem._rollMeleeDefense(_maTargetActor);
        // T4-C: Dodge adds +2 to effective defense total; Parry blocks the attack outright
        const _maDodgeBonus = (_maTargetActor.getFlag("cyberpunk2020", "dodging") ? 2 : 0);
        const _maIsParrying = !!_maTargetActor.getFlag("cyberpunk2020", "parrying");
        const defLabel = `${defInfo.skillName} ${defInfo.skillVal} (REF ${defInfo.ref})`
          + (_maDodgeBonus > 0 ? ` +${_maDodgeBonus} Dodge` : "")
          + (_maIsParrying ? " [PARRY — blocked]" : "");
        results.addRoll(defInfo.roll, { name: `${_maTargetActor.name} Defends`, flavor: defLabel });
        const attackHits = !_maIsParrying && (attackRoll.total > defInfo.total + _maDodgeBonus);
        if (_maIsParrying) _maTargetActor.unsetFlag("cyberpunk2020", "parrying").catch(() => {});
        if (attackHits) {
          Hooks.callAll("cyberpunk2020.weaponFired", {
            areaDamages: { [loc.areaHit]: [{ damage: damageRoll.total }] },
            ap: _maAP,
            edged: _maEdge,
            targetTokenId: _maTarget.id,
            targetActorId: _maTargetActor.id,
          });
          // T4-B: special MA effects for damage actions that hit
          await CyberpunkItem._applyMartialHitEffects(action, _maTargetActor, this.actor);
        }
      } else if (loc.areaHit) {
        Hooks.callAll("cyberpunk2020.weaponFired", {
          areaDamages: { [loc.areaHit]: [{ damage: damageRoll.total }] },
          ap: _maAP,
          edged: _maEdge,
        });
      }
    }
    if (!attackRoll._evaluated) {
      await attackRoll.evaluate();
    }

    // T4-B: non-damaging MA actions — add contested resolution and special effects
    const _t4bSpecialNoDataActions = [martialActions.hold, martialActions.grapple, martialActions.sweepTrip, martialActions.escape];
    const _t4bEnabled = (() => { try { return game.settings.get("cyberpunk2020", "specialMeleeEffectsEnabled"); } catch { return true; } })();
    if (_t4bEnabled && _t4bSpecialNoDataActions.includes(action)) {
      const _t4bTarget = (game.user?.targets?.size === 1) ? game.user.targets.first() : null;
      const _t4bTargetActor = _t4bTarget?.actor ?? null;
      if (_t4bTargetActor) {
        const _t4bDef = await CyberpunkItem._rollMeleeDefense(_t4bTargetActor);
        results.addRoll(_t4bDef.roll, { name: `${_t4bTargetActor.name} Defends`, flavor: `${_t4bDef.skillName} ${_t4bDef.skillVal} (REF ${_t4bDef.ref})` });
        const _t4bHits = attackRoll.total > _t4bDef.total;
        if (_t4bHits) {
          await CyberpunkItem._applyMartialHitEffects(action, _t4bTargetActor, this.actor);
        }
      }
    }

    let fumble = null;
    if (game.settings.get("cyberpunk2020", "fumbleTableEnabled") && isFumbleRoll(attackRoll)) {
      fumble = await buildSkillFumbleData({
        skill: { system: { stat: "ref" } },
        roll: attackRoll
      });
    }

    await results.defaultExecute({ img: this.img, fumble });
    return results;
  }

  /**
   * Accelerate a vehicle
   * @param {boolean} decelerate: Are we decelerating instead of accelerating?
   * @returns 
   */
  accel(decelerate = false) {
    if(this.type !== "vehicle")
      return;
    
    let speed = this.system.speed;
    let accelAdd = speed.acceleration * (decelerate ? -1 : 1);
    let newSpeed = clamp(speed.value + accelAdd, 0, speed.max);
    return this.update({
      "system.speed.value": newSpeed
    });
  }
}
