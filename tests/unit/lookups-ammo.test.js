/**
 * Unit tests for the ammo/caliber helpers in module/lookups.js that are NOT already covered
 * by tests/unit/lookups.test.js.
 *
 * Already covered in lookups.test.js (DO NOT DUPLICATE):
 *   - normalizeCaliber       — blank/null/alias/passthrough/trim
 *   - caliberMatches         — wildcard / match / mismatch / alias resolution
 *   - AMMO_COST_CLASSES      — key presence, core/blackhands shape
 *   - AMMO_MODIFIERS         — standard costMult, AP / HP armor mults, brassCased multiplier
 *   - CALIBERS               — 9mm/5.56/7.62 costClass spot-checks; all-have-label+costClass
 *
 * Covered here (ammo helpers not yet tested):
 *   - AMMO_MODIFIERS         — deeper value checks: api, dualPurpose, rubber, flechette, safety
 *   - AMMO_COST_CLASSES      — specific numeric box/price values for each class (Core + Blackhands)
 *   - CALIBERS               — comprehensive costClass checks across all caliber entries
 *   - getCalibers            — merges built-in CALIBERS with custom-calibers setting
 *   - getCaliberBox          — returns box+price for a caliber, honours Blackhands box setting
 *   - getModifierCostMult    — returns correct cost multiplier, honours Blackhands brass setting
 *   - getAmmoBoxPrice        — price = box.price × modifierMult (rounded)
 *
 * Skipped (impure but covered above or impossible under Node without full shim):
 *   - isFnff2Enabled, getMartialActionBonus, martialOptions, martialActionGroups
 *   - rangedModifiers  — calls weapon.__getFireModes
 *   - defaultHitLocations — uses foundry.utils if present
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  AMMO_MODIFIERS,
  AMMO_COST_CLASSES,
  CALIBERS,
  getCalibers,
  getCaliberBox,
  getModifierCostMult,
  getAmmoBoxPrice,
} from "../../module/lookups.js";

// ─── game shim ────────────────────────────────────────────────────────────────
// getCaliberBox, getModifierCostMult, getAmmoBoxPrice, and getCalibers all call
// game.settings.get without a try/catch (getCalibers wraps in try/catch, but the
// box/modifier helpers call _ammoSetting which uses try/catch to default to false).
// We set up a minimal shim so the tests drive the non-Blackhands (core) path by
// default, and individual tests can override specific keys.

let _savedGame;
let _ammoUseBlackhandsBoxes = false;
let _ammoUseBlackhandsBrass = false;
let _customCalibers = null;

beforeAll(() => {
  _savedGame = globalThis.game;
  globalThis.game = {
    settings: {
      get: (_scope, key) => {
        if (key === "ammoUseBlackhandsBoxes") return _ammoUseBlackhandsBoxes;
        if (key === "ammoUseBlackhandsBrass") return _ammoUseBlackhandsBrass;
        if (key === "customCalibers") {
          if (_customCalibers) return _customCalibers;
          throw new Error("setting not registered");
        }
        throw new Error(`unknown setting: ${key}`);
      }
    }
  };
});

afterAll(() => {
  globalThis.game = _savedGame;
});

// ─── AMMO_MODIFIERS — deeper value checks ─────────────────────────────────────

describe("AMMO_MODIFIERS — api (Armor-Piercing Incendiary)", () => {
  it("has costMult 4", () => {
    expect(AMMO_MODIFIERS.api.costMult).toBe(4);
  });

  it("halves soft and hard armor (same as AP)", () => {
    expect(AMMO_MODIFIERS.api.mech.armorMultSoft).toBe(0.5);
    expect(AMMO_MODIFIERS.api.mech.armorMultHard).toBe(0.5);
  });

  it("has DoT fire effect enabled", () => {
    expect(AMMO_MODIFIERS.api.mech.dotEnabled).toBe(true);
    expect(AMMO_MODIFIERS.api.mech.dotType).toBe("fire");
    expect(AMMO_MODIFIERS.api.mech.dotTurns).toBe(2);
    expect(typeof AMMO_MODIFIERS.api.mech.dotDamageFormula).toBe("string");
    expect(AMMO_MODIFIERS.api.mech.dotDamageFormula.length).toBeGreaterThan(0);
  });
});

describe("AMMO_MODIFIERS — dualPurpose", () => {
  it("has costMult 4", () => {
    expect(AMMO_MODIFIERS.dualPurpose.costMult).toBe(4);
  });

  it("halves both armor multipliers", () => {
    expect(AMMO_MODIFIERS.dualPurpose.mech.armorMultSoft).toBe(0.5);
    expect(AMMO_MODIFIERS.dualPurpose.mech.armorMultHard).toBe(0.5);
  });
});

describe("AMMO_MODIFIERS — rubber", () => {
  it("has a cost multiplier less than 1 (cheap)", () => {
    expect(AMMO_MODIFIERS.rubber.costMult).toBeLessThan(1);
    expect(AMMO_MODIFIERS.rubber.costMult).toBeGreaterThan(0);
  });

  it("does NOT halve armor (full effectiveness)", () => {
    expect(AMMO_MODIFIERS.rubber.mech.armorMultSoft).toBe(1);
    expect(AMMO_MODIFIERS.rubber.mech.armorMultHard).toBe(1);
  });

  it("applies stun save on hit", () => {
    expect(AMMO_MODIFIERS.rubber.mech.stunSaveOnHit).toBe(true);
  });

  it("penDamageMult is 0.5 (reduced penetration damage)", () => {
    expect(AMMO_MODIFIERS.rubber.mech.penDamageMult).toBe(0.5);
  });
});

describe("AMMO_MODIFIERS — flechette", () => {
  it("has costMult 5 (expensive specialty round)", () => {
    expect(AMMO_MODIFIERS.flechette.costMult).toBe(5);
  });

  it("greatly reduces armor effectiveness (0.25)", () => {
    expect(AMMO_MODIFIERS.flechette.mech.armorMultSoft).toBe(0.25);
    expect(AMMO_MODIFIERS.flechette.mech.armorMultHard).toBe(0.25);
  });

  it("has spreadMode flechette", () => {
    expect(AMMO_MODIFIERS.flechette.mech.spreadMode).toBe("flechette");
  });
});

describe("AMMO_MODIFIERS — safety", () => {
  it("has costMult 6 (most expensive modifier)", () => {
    expect(AMMO_MODIFIERS.safety.costMult).toBe(6);
  });

  it("doubles armor against safety rounds", () => {
    expect(AMMO_MODIFIERS.safety.mech.armorMultSoft).toBe(2);
    expect(AMMO_MODIFIERS.safety.mech.armorMultHard).toBe(2);
  });

  it("penDamageMult is 3 (high damage if it penetrates)", () => {
    expect(AMMO_MODIFIERS.safety.mech.penDamageMult).toBe(3);
  });
});

describe("AMMO_MODIFIERS — hollowPoint (deeper checks)", () => {
  it("costMult is 1.125", () => {
    expect(AMMO_MODIFIERS.hollowPoint.costMult).toBe(1.125);
  });

  it("penDamageMult is 1.5", () => {
    expect(AMMO_MODIFIERS.hollowPoint.mech.penDamageMult).toBe(1.5);
  });
});

describe("AMMO_MODIFIERS — AP (deeper checks)", () => {
  it("costMult is 3", () => {
    expect(AMMO_MODIFIERS.ap.costMult).toBe(3);
  });

  it("penDamageMult is 0.5", () => {
    expect(AMMO_MODIFIERS.ap.mech.penDamageMult).toBe(0.5);
  });
});

describe("AMMO_MODIFIERS — standard (deeper checks)", () => {
  it("all mech multipliers are 1", () => {
    expect(AMMO_MODIFIERS.standard.mech.armorMultSoft).toBe(1);
    expect(AMMO_MODIFIERS.standard.mech.armorMultHard).toBe(1);
    expect(AMMO_MODIFIERS.standard.mech.penDamageMult).toBe(1);
  });

  it("bonusDamageFormula is empty string", () => {
    expect(AMMO_MODIFIERS.standard.mech.bonusDamageFormula).toBe("");
  });
});

// ─── AMMO_COST_CLASSES — specific numeric values ──────────────────────────────

describe("AMMO_COST_CLASSES — Core numeric values", () => {
  it("lightPistol: 100 rounds / 15eb", () => {
    expect(AMMO_COST_CLASSES.lightPistol.core.box).toBe(100);
    expect(AMMO_COST_CLASSES.lightPistol.core.price).toBe(15);
  });

  it("mediumPistol Core: 50 rounds / 15eb", () => {
    expect(AMMO_COST_CLASSES.mediumPistol.core.box).toBe(50);
    expect(AMMO_COST_CLASSES.mediumPistol.core.price).toBe(15);
  });

  it("heavyPistol Core: 50 rounds / 18eb", () => {
    expect(AMMO_COST_CLASSES.heavyPistol.core.box).toBe(50);
    expect(AMMO_COST_CLASSES.heavyPistol.core.price).toBe(18);
  });

  it("veryHeavyPistol Core: 50 rounds / 20eb", () => {
    expect(AMMO_COST_CLASSES.veryHeavyPistol.core.box).toBe(50);
    expect(AMMO_COST_CLASSES.veryHeavyPistol.core.price).toBe(20);
  });

  it("assaultRifle Core: 100 rounds / 40eb", () => {
    expect(AMMO_COST_CLASSES.assaultRifle.core.box).toBe(100);
    expect(AMMO_COST_CLASSES.assaultRifle.core.price).toBe(40);
  });

  it("shotgun: 12 rounds / 15eb (same Core and Blackhands)", () => {
    expect(AMMO_COST_CLASSES.shotgun.core.box).toBe(12);
    expect(AMMO_COST_CLASSES.shotgun.core.price).toBe(15);
    expect(AMMO_COST_CLASSES.shotgun.blackhands.box).toBe(12);
    expect(AMMO_COST_CLASSES.shotgun.blackhands.price).toBe(15);
  });

  it("cannon20mm: 1 round / 25eb", () => {
    expect(AMMO_COST_CLASSES.cannon20mm.core.box).toBe(1);
    expect(AMMO_COST_CLASSES.cannon20mm.core.price).toBe(25);
  });

  it("none: 1 round / 0eb (no cost)", () => {
    expect(AMMO_COST_CLASSES.none.core.box).toBe(1);
    expect(AMMO_COST_CLASSES.none.core.price).toBe(0);
    expect(AMMO_COST_CLASSES.none.blackhands.box).toBe(1);
    expect(AMMO_COST_CLASSES.none.blackhands.price).toBe(0);
  });
});

describe("AMMO_COST_CLASSES — Blackhands vs Core differences", () => {
  it("mediumPistol Blackhands doubles box and price vs Core", () => {
    const c = AMMO_COST_CLASSES.mediumPistol;
    expect(c.blackhands.box).toBe(c.core.box * 2);
    expect(c.blackhands.price).toBe(c.core.price * 2);
  });

  it("heavyPistol Blackhands doubles box and price vs Core", () => {
    const c = AMMO_COST_CLASSES.heavyPistol;
    expect(c.blackhands.box).toBe(c.core.box * 2);
    expect(c.blackhands.price).toBe(c.core.price * 2);
  });

  it("veryHeavyPistol Blackhands doubles box and price vs Core", () => {
    const c = AMMO_COST_CLASSES.veryHeavyPistol;
    expect(c.blackhands.box).toBe(c.core.box * 2);
    expect(c.blackhands.price).toBe(c.core.price * 2);
  });

  it("assaultRifle is the same in both editions", () => {
    const c = AMMO_COST_CLASSES.assaultRifle;
    expect(c.blackhands.box).toBe(c.core.box);
    expect(c.blackhands.price).toBe(c.core.price);
  });

  it("lightPistol is the same in both editions", () => {
    const c = AMMO_COST_CLASSES.lightPistol;
    expect(c.blackhands.box).toBe(c.core.box);
    expect(c.blackhands.price).toBe(c.core.price);
  });
});

// ─── CALIBERS — comprehensive costClass checks ────────────────────────────────

describe("CALIBERS — costClass assignments", () => {
  it("light pistol calibers", () => {
    for (const id of [".22", ".25", ".38", "5mm", "6mm"]) {
      expect(CALIBERS[id]?.costClass).toBe("lightPistol");
    }
  });

  it("medium pistol calibers", () => {
    for (const id of ["9mm", ".45"]) {
      expect(CALIBERS[id]?.costClass).toBe("mediumPistol");
    }
  });

  it("heavy pistol calibers", () => {
    for (const id of [".357", "10mm", "11mm"]) {
      expect(CALIBERS[id]?.costClass).toBe("heavyPistol");
    }
  });

  it("very heavy pistol calibers", () => {
    for (const id of [".44", "12mm"]) {
      expect(CALIBERS[id]?.costClass).toBe("veryHeavyPistol");
    }
  });

  it("assault rifle calibers (NATO 7.62 and Soviet 7.62sov are distinct entries)", () => {
    for (const id of ["5.56", "7.62", "7.62sov", "30-06"]) {
      expect(CALIBERS[id]?.costClass).toBe("assaultRifle");
    }
    // Soviet and NATO are different entries (not aliases)
    expect(CALIBERS["7.62"].label).toContain("NATO");
    expect(CALIBERS["7.62sov"].label).toContain("Soviet");
  });

  it("shotgun caliber", () => {
    expect(CALIBERS["00"]?.costClass).toBe("shotgun");
  });

  it("cannon caliber", () => {
    expect(CALIBERS["20mm"]?.costClass).toBe("cannon20mm");
  });

  it("specialty calibers (arrow, bolt, airgun, needle, napalm)", () => {
    expect(CALIBERS["Arrow"]?.costClass).toBe("arrows");
    expect(CALIBERS["Bolt"]?.costClass).toBe("crossbow");
    expect(CALIBERS["Airgun"]?.costClass).toBe("airgun");
    expect(CALIBERS["Needle"]?.costClass).toBe("needlegun");
    expect(CALIBERS["Napalm"]?.costClass).toBe("flamethrower");
  });

  it("all CALIBERS entries have non-empty label and a valid costClass key", () => {
    for (const [id, cal] of Object.entries(CALIBERS)) {
      expect(cal.label.length, `${id} has empty label`).toBeGreaterThan(0);
      expect(AMMO_COST_CLASSES, `${id}.costClass=${cal.costClass} missing from AMMO_COST_CLASSES`).toHaveProperty(cal.costClass);
    }
  });
});

// ─── getCalibers ──────────────────────────────────────────────────────────────

describe("getCalibers", () => {
  it("returns at least all built-in CALIBERS when no custom ones exist", () => {
    // _customCalibers = null → game.settings.get throws → getCalibers catches → {}
    _customCalibers = null;
    const result = getCalibers();
    for (const id of Object.keys(CALIBERS)) {
      expect(result).toHaveProperty(id);
    }
  });

  it("merges custom calibers on top of built-ins", () => {
    _customCalibers = { "myCustom": { label: "Custom", costClass: "lightPistol" } };
    const result = getCalibers();
    expect(result).toHaveProperty("myCustom");
    expect(result["myCustom"].label).toBe("Custom");
    // Built-ins still present
    expect(result).toHaveProperty("9mm");
    _customCalibers = null;
  });

  it("custom calibers can override built-in calibers", () => {
    _customCalibers = { "9mm": { label: "Custom 9mm", costClass: "heavyPistol" } };
    const result = getCalibers();
    expect(result["9mm"].costClass).toBe("heavyPistol");
    _customCalibers = null;
  });

  it("returns plain CALIBERS when settings throw (error recovery)", () => {
    // null → getCalibers catches the thrown error and returns {} for custom → built-ins only
    _customCalibers = null;
    const result = getCalibers();
    expect(Object.keys(result).length).toBeGreaterThanOrEqual(Object.keys(CALIBERS).length);
  });
});

// ─── getCaliberBox ────────────────────────────────────────────────────────────

describe("getCaliberBox — Core path (ammoUseBlackhandsBoxes=false)", () => {
  it("9mm → mediumPistol Core: 50 rounds, 15eb", () => {
    _ammoUseBlackhandsBoxes = false;
    const result = getCaliberBox("9mm");
    expect(result.box).toBe(50);
    expect(result.price).toBe(15);
  });

  it("5.56 → assaultRifle Core: 100 rounds, 40eb", () => {
    _ammoUseBlackhandsBoxes = false;
    const result = getCaliberBox("5.56");
    expect(result.box).toBe(100);
    expect(result.price).toBe(40);
  });

  it("00 Buck → shotgun Core: 12 rounds, 15eb", () => {
    _ammoUseBlackhandsBoxes = false;
    const result = getCaliberBox("00");
    expect(result.box).toBe(12);
    expect(result.price).toBe(15);
  });

  it("unknown caliber falls back to 'none' class: 1 round, 0eb", () => {
    _ammoUseBlackhandsBoxes = false;
    const result = getCaliberBox("unknownXXX");
    expect(result.box).toBe(1);
    expect(result.price).toBe(0);
  });
});

describe("getCaliberBox — Blackhands path (ammoUseBlackhandsBoxes=true)", () => {
  it("9mm → mediumPistol Blackhands: 100 rounds, 30eb", () => {
    _ammoUseBlackhandsBoxes = true;
    const result = getCaliberBox("9mm");
    expect(result.box).toBe(100);
    expect(result.price).toBe(30);
    _ammoUseBlackhandsBoxes = false;
  });

  it("assaultRifle same in Blackhands as Core: 100 rounds, 40eb", () => {
    _ammoUseBlackhandsBoxes = true;
    const result = getCaliberBox("5.56");
    expect(result.box).toBe(100);
    expect(result.price).toBe(40);
    _ammoUseBlackhandsBoxes = false;
  });
});

// ─── getModifierCostMult ──────────────────────────────────────────────────────

describe("getModifierCostMult — Core/default brass path", () => {
  it("standard → 1", () => {
    _ammoUseBlackhandsBrass = false;
    expect(getModifierCostMult("standard")).toBe(1);
  });

  it("ap → 3", () => {
    expect(getModifierCostMult("ap")).toBe(3);
  });

  it("hollowPoint → 1.125", () => {
    expect(getModifierCostMult("hollowPoint")).toBe(1.125);
  });

  it("brassCased → costMult (2) when Blackhands brass is off", () => {
    _ammoUseBlackhandsBrass = false;
    expect(getModifierCostMult("brassCased")).toBe(2);
  });

  it("flechette → 5", () => {
    expect(getModifierCostMult("flechette")).toBe(5);
  });

  it("safety → 6", () => {
    expect(getModifierCostMult("safety")).toBe(6);
  });

  it("rubber → 0.333", () => {
    expect(getModifierCostMult("rubber")).toBeCloseTo(0.333, 3);
  });

  it("unknown modifier falls back to standard costMult of 1", () => {
    expect(getModifierCostMult("unknownLoad")).toBe(1);
  });
});

describe("getModifierCostMult — Blackhands brass path", () => {
  it("brassCased → costMultBlackhands (3) when Blackhands brass is on", () => {
    _ammoUseBlackhandsBrass = true;
    expect(getModifierCostMult("brassCased")).toBe(3);
    _ammoUseBlackhandsBrass = false;
  });

  it("standard (no costMultBlackhands) still returns 1 even with Blackhands brass on", () => {
    _ammoUseBlackhandsBrass = true;
    expect(getModifierCostMult("standard")).toBe(1);
    _ammoUseBlackhandsBrass = false;
  });
});

// ─── getAmmoBoxPrice ──────────────────────────────────────────────────────────

describe("getAmmoBoxPrice", () => {
  it("standard 9mm: 15eb (15 × 1)", () => {
    _ammoUseBlackhandsBoxes = false;
    _ammoUseBlackhandsBrass = false;
    expect(getAmmoBoxPrice("9mm", "standard")).toBe(15);
  });

  it("AP 9mm: 45eb (15 × 3)", () => {
    expect(getAmmoBoxPrice("9mm", "ap")).toBe(45);
  });

  it("HP 9mm: rounds 15 × 1.125 = 17 (Math.round(16.875))", () => {
    expect(getAmmoBoxPrice("9mm", "hollowPoint")).toBe(Math.round(15 * 1.125));
  });

  it("standard assault rifle: 40eb (100 rounds × 40/100... wait — price is per-box not per-round)", () => {
    // AMMO_COST_CLASSES.assaultRifle.core.price = 40 (box price), costMult=1 → 40
    expect(getAmmoBoxPrice("5.56", "standard")).toBe(40);
  });

  it("AP assault rifle: 120eb (40 × 3)", () => {
    expect(getAmmoBoxPrice("5.56", "ap")).toBe(120);
  });

  it("unknown caliber + standard → 0eb (none class, price=0)", () => {
    expect(getAmmoBoxPrice("unknownXXX", "standard")).toBe(0);
  });

  it("result is always an integer (Math.round applied)", () => {
    const result = getAmmoBoxPrice("9mm", "hollowPoint");
    expect(Number.isInteger(result)).toBe(true);
  });
});
