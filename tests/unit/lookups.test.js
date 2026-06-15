/**
 * Unit tests for pure exported functions in module/lookups.js.
 *
 * Skipped (not pure / need Foundry):
 *   - getCalibers, getCaliberBox, getModifierCostMult, getAmmoBoxPrice  — call game.settings
 *   - isFnff2Enabled                                                    — calls game.settings
 *   - martialOptions, martialActionGroups                               — call isFnff2Enabled (localized lists)
 *   - rangedModifiers                                                   — calls weapon.__getFireModes
 *   - defaultHitLocations (via cloneSystemDefault)                      — uses foundry.utils if present
 *
 * getMartialActionBonus IS tested below. It calls isFnff2Enabled(), which reads a BARE
 * `game` global (`game?.settings?.get(...)`) — an undeclared `game` throws ReferenceError,
 * so we stub globalThis.game.settings.get for these tests (returning false = core rules by
 * default; one test returns true to exercise the FNFF2 branch).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  btmFromBT,
  strengthDamageBonus,
  isEnergyAttackType,
  normalizeCaliber,
  caliberMatches,
  isFnff2OnlyMartialArtKey,
  isFnff2OnlyMartialArtId,
  martialArtDisplayName,
  getFnff2DamageBonusSymbol,
  getMartialActionBonus,
  getStatNames,
  MARTIAL_BONUS_ACTIONS,
  martialActionBonusesCore,
  martialActionBonusesFNFF2,
  rangeDCs,
  rangeResolve,
  AMMO_COST_CLASSES,
  AMMO_MODIFIERS,
  CALIBERS,
  MARTIAL_ART_ID_BY_KEY,
  MARTIAL_ART_KEY_BY_ID,
  MARTIAL_ART_PREFIX_RE,
  isMartialArtSkillItem,
  ANATOMY_IMAGES,
  DEFAULT_ANATOMY_KEY,
  W4RST4R_AREA_LOOKUP,
  defaultAreaLookup,
  rangedModifiers,
  martialOptions,
  meleeBonkOptions,
} from "../../module/lookups.js";

// ─── btmFromBT ────────────────────────────────────────────────────────────────

describe("btmFromBT", () => {
  it("returns 0 for body <= 2", () => {
    expect(btmFromBT(1)).toBe(0);
    expect(btmFromBT(2)).toBe(0);
    expect(btmFromBT(0)).toBe(0);
    expect(btmFromBT(-5)).toBe(0);
  });

  it("returns 1 for weak body (3-4)", () => {
    expect(btmFromBT(3)).toBe(1);
    expect(btmFromBT(4)).toBe(1);
  });

  it("returns 2 for average body (5-7)", () => {
    expect(btmFromBT(5)).toBe(2);
    expect(btmFromBT(6)).toBe(2);
    expect(btmFromBT(7)).toBe(2);
  });

  it("returns 3 for strong body (8-9)", () => {
    expect(btmFromBT(8)).toBe(3);
    expect(btmFromBT(9)).toBe(3);
  });

  it("returns 4 for very strong body (10)", () => {
    expect(btmFromBT(10)).toBe(4);
  });

  it("returns 5 for superhuman body (>10)", () => {
    expect(btmFromBT(11)).toBe(5);
    expect(btmFromBT(15)).toBe(5);
    expect(btmFromBT(100)).toBe(5);
  });
});

// ─── strengthDamageBonus ─────────────────────────────────────────────────────

describe("strengthDamageBonus", () => {
  // btm range 0-4 → btm - 2
  it("returns btm - 2 for body 0..10 (btm < 5)", () => {
    // btm=0, bt<=2 → 0-2 = -2
    expect(strengthDamageBonus(1)).toBe(-2);
    expect(strengthDamageBonus(2)).toBe(-2);
    // btm=1 (bt 3-4) → 1-2 = -1
    expect(strengthDamageBonus(3)).toBe(-1);
    expect(strengthDamageBonus(4)).toBe(-1);
    // btm=2 (bt 5-7) → 0
    expect(strengthDamageBonus(5)).toBe(0);
    expect(strengthDamageBonus(7)).toBe(0);
    // btm=3 (bt 8-9) → 1
    expect(strengthDamageBonus(8)).toBe(1);
    expect(strengthDamageBonus(9)).toBe(1);
    // btm=4 (bt 10) → 2
    expect(strengthDamageBonus(10)).toBe(2);
  });

  it("returns 4 for superhuman body 11-12", () => {
    expect(strengthDamageBonus(11)).toBe(4);
    expect(strengthDamageBonus(12)).toBe(4);
  });

  it("returns 6 for superhuman body 13-14", () => {
    expect(strengthDamageBonus(13)).toBe(6);
    expect(strengthDamageBonus(14)).toBe(6);
  });

  it("returns 8 for superhuman body >= 15", () => {
    expect(strengthDamageBonus(15)).toBe(8);
    expect(strengthDamageBonus(20)).toBe(8);
  });
});

// ─── isEnergyAttackType ───────────────────────────────────────────────────────

describe("isEnergyAttackType", () => {
  it("returns true for laser (any case)", () => {
    expect(isEnergyAttackType("laser")).toBe(true);
    expect(isEnergyAttackType("Laser")).toBe(true);
    expect(isEnergyAttackType("LASER")).toBe(true);
  });

  it("returns true for microwave (any case)", () => {
    expect(isEnergyAttackType("microwave")).toBe(true);
    expect(isEnergyAttackType("Microwave")).toBe(true);
  });

  it("returns false for other types", () => {
    expect(isEnergyAttackType("SemiAuto")).toBe(false);
    expect(isEnergyAttackType("Auto")).toBe(false);
    expect(isEnergyAttackType("Grenade")).toBe(false);
    expect(isEnergyAttackType("")).toBe(false);
  });

  it("handles null/undefined gracefully", () => {
    expect(isEnergyAttackType(null)).toBe(false);
    expect(isEnergyAttackType(undefined)).toBe(false);
  });
});

// ─── normalizeCaliber ─────────────────────────────────────────────────────────

describe("normalizeCaliber", () => {
  it("returns empty string for empty/null/undefined", () => {
    expect(normalizeCaliber("")).toBe("");
    expect(normalizeCaliber(null)).toBe("");
    expect(normalizeCaliber(undefined)).toBe("");
    expect(normalizeCaliber("  ")).toBe("");
  });

  it("resolves known typo aliases", () => {
    expect(normalizeCaliber("7.56")).toBe("7.62");
    expect(normalizeCaliber("7.565")).toBe("7.62sov");
    expect(normalizeCaliber("7.62s")).toBe("7.62sov");
    expect(normalizeCaliber("7.62S")).toBe("7.62sov");
  });

  it("passes through standard calibers unchanged", () => {
    expect(normalizeCaliber("9mm")).toBe("9mm");
    expect(normalizeCaliber("7.62")).toBe("7.62");
    expect(normalizeCaliber(".45")).toBe(".45");
    expect(normalizeCaliber("5.56")).toBe("5.56");
  });

  it("trims whitespace before lookup", () => {
    expect(normalizeCaliber("  9mm  ")).toBe("9mm");
  });
});

// ─── caliberMatches ───────────────────────────────────────────────────────────

describe("caliberMatches", () => {
  it("blank ammo caliber is a wildcard (matches any weapon)", () => {
    expect(caliberMatches("9mm", "")).toBe(true);
    expect(caliberMatches("9mm", null)).toBe(true);
    expect(caliberMatches("9mm", undefined)).toBe(true);
    expect(caliberMatches(".45", "   ")).toBe(true);
  });

  it("matching calibers return true", () => {
    expect(caliberMatches("9mm", "9mm")).toBe(true);
    expect(caliberMatches(".45", ".45")).toBe(true);
  });

  it("mismatched calibers return false", () => {
    expect(caliberMatches("9mm", ".45")).toBe(false);
    expect(caliberMatches(".357", "9mm")).toBe(false);
  });

  it("resolves aliases on both sides", () => {
    // weapon stored as "7.56" (typo), ammo as "7.62" — should match
    expect(caliberMatches("7.56", "7.62")).toBe(true);
    // ammo stored as "7.565" (Soviet typo) matches weapon "7.62sov"
    expect(caliberMatches("7.62sov", "7.565")).toBe(true);
    // Soviet vs NATO should not match
    expect(caliberMatches("7.62", "7.62sov")).toBe(false);
  });
});

// ─── FNFF2 martial art key/id checks ─────────────────────────────────────────

describe("isFnff2OnlyMartialArtKey", () => {
  it("returns true for FNFF2-only styles", () => {
    expect(isFnff2OnlyMartialArtKey("Martial Arts: ArasakaTe")).toBe(true);
    expect(isFnff2OnlyMartialArtKey("Martial Arts: GunFu")).toBe(true);
    expect(isFnff2OnlyMartialArtKey("Martial Arts: Ninjutsu")).toBe(true);
    expect(isFnff2OnlyMartialArtKey("Martial Arts: WingChung")).toBe(true);
  });

  it("returns false for Core-ruleset styles", () => {
    expect(isFnff2OnlyMartialArtKey("Martial Arts: Karate")).toBe(false);
    expect(isFnff2OnlyMartialArtKey("Martial Arts: Boxing")).toBe(false);
    expect(isFnff2OnlyMartialArtKey("Martial Arts: Aikido")).toBe(false);
  });

  it("returns false for unknown keys", () => {
    expect(isFnff2OnlyMartialArtKey("Brawling")).toBe(false);
    expect(isFnff2OnlyMartialArtKey("")).toBe(false);
    expect(isFnff2OnlyMartialArtKey(null)).toBe(false);
  });
});

describe("isFnff2OnlyMartialArtId", () => {
  it("returns true for known FNFF2-only style IDs", () => {
    const arasakaTeId = MARTIAL_ART_ID_BY_KEY["Martial Arts: ArasakaTe"];
    expect(isFnff2OnlyMartialArtId(arasakaTeId)).toBe(true);
    const gunFuId = MARTIAL_ART_ID_BY_KEY["Martial Arts: GunFu"];
    expect(isFnff2OnlyMartialArtId(gunFuId)).toBe(true);
  });

  it("returns false for Core-style IDs", () => {
    const karateId = MARTIAL_ART_ID_BY_KEY["Martial Arts: Karate"];
    expect(isFnff2OnlyMartialArtId(karateId)).toBe(false);
  });

  it("returns false for unknown IDs", () => {
    expect(isFnff2OnlyMartialArtId("unknown-id")).toBe(false);
    expect(isFnff2OnlyMartialArtId(null)).toBe(false);
  });
});

// ─── martialArtDisplayName ────────────────────────────────────────────────────

describe("martialArtDisplayName", () => {
  it("strips the 'Martial Arts:' prefix", () => {
    expect(martialArtDisplayName("Martial Arts: Karate")).toBe("Karate");
    expect(martialArtDisplayName("Martial Arts: Boxing")).toBe("Boxing");
  });

  it("strips trailing (N) IP-difficulty tag", () => {
    expect(martialArtDisplayName("Martial Arts: Karate(2)")).toBe("Karate");
    expect(martialArtDisplayName("Martial Arts: ThaiKickBoxing (3)")).toBe("ThaiKickBoxing");
  });

  it("strips '~' markers", () => {
    expect(martialArtDisplayName("~Karate")).toBe("Karate");
    expect(martialArtDisplayName("Martial Arts: ~Boxing~")).toBe("Boxing");
  });

  it("handles case-insensitive prefix", () => {
    expect(martialArtDisplayName("martial arts: Judo")).toBe("Judo");
    expect(martialArtDisplayName("MARTIAL ARTS: Savate")).toBe("Savate");
  });

  it("collapses extra whitespace", () => {
    expect(martialArtDisplayName("Martial  Arts:   Capoeira  ")).toBe("Capoeira");
  });

  it("handles null/undefined gracefully", () => {
    expect(martialArtDisplayName(null)).toBe("");
    expect(martialArtDisplayName(undefined)).toBe("");
  });

  it("returns non-martial-art names as-is (after tilde/whitespace strip)", () => {
    expect(martialArtDisplayName("Brawling")).toBe("Brawling");
  });
});

// ─── getFnff2DamageBonusSymbol ────────────────────────────────────────────────

describe("getFnff2DamageBonusSymbol", () => {
  it("returns known symbols for defined actions", () => {
    expect(getFnff2DamageBonusSymbol("Strike")).toBe("*");
    expect(getFnff2DamageBonusSymbol("Punch")).toBe("*");
    expect(getFnff2DamageBonusSymbol("Kick")).toBe("*");
    expect(getFnff2DamageBonusSymbol("Disarm")).toBe("%");
    expect(getFnff2DamageBonusSymbol("SweepTrip")).toBe("$");
    expect(getFnff2DamageBonusSymbol("BlockParry")).toBe("@");
    expect(getFnff2DamageBonusSymbol("Dodge")).toBe("@");
    expect(getFnff2DamageBonusSymbol("Grapple")).toBe("%");
    expect(getFnff2DamageBonusSymbol("Throw")).toBe("*");
    expect(getFnff2DamageBonusSymbol("Hold")).toBe("$");
    expect(getFnff2DamageBonusSymbol("Choke")).toBe("*");
    expect(getFnff2DamageBonusSymbol("Escape")).toBe("@");
    expect(getFnff2DamageBonusSymbol("Ram")).toBe("*");
  });

  it("returns '*' as default for unknown actions", () => {
    expect(getFnff2DamageBonusSymbol("Unknown")).toBe("*");
    expect(getFnff2DamageBonusSymbol(null)).toBe("*");
    expect(getFnff2DamageBonusSymbol("")).toBe("*");
  });
});

// ─── isMartialArtSkillItem ────────────────────────────────────────────────────

describe("isMartialArtSkillItem", () => {
  it("returns false for non-skill items", () => {
    expect(isMartialArtSkillItem({ type: "weapon", name: "Martial Arts: Karate" })).toBe(false);
    expect(isMartialArtSkillItem(null)).toBe(false);
    expect(isMartialArtSkillItem(undefined)).toBe(false);
  });

  it("returns true when system.isMartialArt is set", () => {
    expect(isMartialArtSkillItem({ type: "skill", name: "Aikido", system: { isMartialArt: true } })).toBe(true);
  });

  it("returns true for skill with 'Martial Arts:' prefix in name", () => {
    expect(isMartialArtSkillItem({ type: "skill", name: "Martial Arts: Karate" })).toBe(true);
    expect(isMartialArtSkillItem({ type: "skill", name: "martial arts: boxing" })).toBe(true);
    // spaced variant
    expect(isMartialArtSkillItem({ type: "skill", name: "Martial  Arts: Judo" })).toBe(true);
  });

  it("returns false for regular skills", () => {
    expect(isMartialArtSkillItem({ type: "skill", name: "Handgun" })).toBe(false);
    expect(isMartialArtSkillItem({ type: "skill", name: "Brawling" })).toBe(false);
  });
});

// ─── rangeDCs / rangeResolve constants ───────────────────────────────────────

describe("rangeDCs", () => {
  it("has correct DC values", () => {
    expect(rangeDCs["RangePointBlank"]).toBe(10);
    expect(rangeDCs["RangeClose"]).toBe(15);
    expect(rangeDCs["RangeMedium"]).toBe(20);
    expect(rangeDCs["RangeLong"]).toBe(25);
    expect(rangeDCs["RangeExtreme"]).toBe(30);
  });
});

describe("rangeResolve", () => {
  it("point blank always returns 1", () => {
    expect(rangeResolve["RangePointBlank"](100)).toBe(1);
  });

  it("close returns range/4", () => {
    expect(rangeResolve["RangeClose"](100)).toBe(25);
    expect(rangeResolve["RangeClose"](40)).toBe(10);
  });

  it("medium returns range/2", () => {
    expect(rangeResolve["RangeMedium"](100)).toBe(50);
  });

  it("long returns range exactly", () => {
    expect(rangeResolve["RangeLong"](100)).toBe(100);
  });

  it("extreme returns range*2", () => {
    expect(rangeResolve["RangeExtreme"](100)).toBe(200);
  });
});

// ─── Static lookup table sanity checks ───────────────────────────────────────

describe("MARTIAL_ART_ID_BY_KEY / MARTIAL_ART_KEY_BY_ID roundtrip", () => {
  it("every key resolves to a non-empty id", () => {
    for (const [key, id] of Object.entries(MARTIAL_ART_ID_BY_KEY)) {
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it("reverse lookup (KEY_BY_ID) is the inverse of ID_BY_KEY", () => {
    for (const [key, id] of Object.entries(MARTIAL_ART_ID_BY_KEY)) {
      expect(MARTIAL_ART_KEY_BY_ID[id]).toBe(key);
    }
  });
});

describe("defaultAreaLookup", () => {
  it("has entries for 1-10", () => {
    for (let i = 1; i <= 10; i++) {
      expect(typeof defaultAreaLookup[i]).toBe("string");
    }
  });

  it("Head is at 1", () => {
    expect(defaultAreaLookup[1]).toBe("Head");
  });

  it("Torso covers 2-4", () => {
    expect(defaultAreaLookup[2]).toBe("Torso");
    expect(defaultAreaLookup[3]).toBe("Torso");
    expect(defaultAreaLookup[4]).toBe("Torso");
  });
});

describe("W4RST4R_AREA_LOOKUP", () => {
  it("has entries for 1-10", () => {
    for (let i = 1; i <= 10; i++) {
      expect(typeof W4RST4R_AREA_LOOKUP[i]).toBe("string");
    }
  });

  it("1=Head, 10=Groin", () => {
    expect(W4RST4R_AREA_LOOKUP[1]).toBe("Head");
    expect(W4RST4R_AREA_LOOKUP[10]).toBe("Groin");
  });

  it("Torso covers 4-7", () => {
    for (let i = 4; i <= 7; i++) {
      expect(W4RST4R_AREA_LOOKUP[i]).toBe("Torso");
    }
  });
});

describe("AMMO_COST_CLASSES", () => {
  it("has expected caliber classes", () => {
    const classes = Object.keys(AMMO_COST_CLASSES);
    expect(classes).toContain("lightPistol");
    expect(classes).toContain("mediumPistol");
    expect(classes).toContain("heavyPistol");
    expect(classes).toContain("assaultRifle");
    expect(classes).toContain("shotgun");
    expect(classes).toContain("none");
  });

  it("all entries have core and blackhands sub-objects with box+price", () => {
    for (const [cls, entry] of Object.entries(AMMO_COST_CLASSES)) {
      expect(typeof entry.core.box).toBe("number");
      expect(typeof entry.core.price).toBe("number");
      expect(typeof entry.blackhands.box).toBe("number");
      expect(typeof entry.blackhands.price).toBe("number");
    }
  });
});

describe("AMMO_MODIFIERS", () => {
  it("standard load has costMult=1", () => {
    expect(AMMO_MODIFIERS.standard.costMult).toBe(1);
  });

  it("AP load halves armor mults", () => {
    expect(AMMO_MODIFIERS.ap.mech.armorMultSoft).toBe(0.5);
    expect(AMMO_MODIFIERS.ap.mech.armorMultHard).toBe(0.5);
  });

  it("hollow-point doubles armor mults", () => {
    expect(AMMO_MODIFIERS.hollowPoint.mech.armorMultSoft).toBe(2);
    expect(AMMO_MODIFIERS.hollowPoint.mech.armorMultHard).toBe(2);
  });

  it("brassCased has a blackhands multiplier", () => {
    expect(AMMO_MODIFIERS.brassCased.costMultBlackhands).toBeGreaterThan(AMMO_MODIFIERS.brassCased.costMult);
  });
});

describe("CALIBERS", () => {
  it("9mm maps to mediumPistol cost class", () => {
    expect(CALIBERS["9mm"].costClass).toBe("mediumPistol");
  });

  it("5.56 and 7.62 map to assaultRifle class", () => {
    expect(CALIBERS["5.56"].costClass).toBe("assaultRifle");
    expect(CALIBERS["7.62"].costClass).toBe("assaultRifle");
  });

  it("all entries have label and costClass", () => {
    for (const [id, cal] of Object.entries(CALIBERS)) {
      expect(typeof cal.label).toBe("string");
      expect(typeof cal.costClass).toBe("string");
    }
  });
});

describe("ANATOMY_IMAGES", () => {
  it("has male and female entries", () => {
    expect(ANATOMY_IMAGES).toHaveProperty("male");
    expect(ANATOMY_IMAGES).toHaveProperty("female");
  });

  it("each entry has label and src", () => {
    for (const [key, entry] of Object.entries(ANATOMY_IMAGES)) {
      expect(typeof entry.label).toBe("string");
      expect(typeof entry.src).toBe("string");
    }
  });

  it("DEFAULT_ANATOMY_KEY is a valid key", () => {
    expect(ANATOMY_IMAGES).toHaveProperty(DEFAULT_ANATOMY_KEY);
  });
});

// ─── getStatNames ─────────────────────────────────────────────────────────────

describe("getStatNames", () => {
  it("returns the nine CP2020 stat keys in order", () => {
    expect(getStatNames()).toEqual(["int", "ref", "tech", "cool", "attr", "luck", "ma", "bt", "emp"]);
  });

  it("returns a fresh copy each call (caller cannot mutate the frozen source)", () => {
    const a = getStatNames();
    const b = getStatNames();
    expect(a).not.toBe(b);
    a.push("xxx");
    expect(getStatNames()).toHaveLength(9); // source untouched
  });
});

// ─── getMartialActionBonus ────────────────────────────────────────────────────
// isFnff2Enabled() reads a bare `game` global, so we stub globalThis.game per test.
// Default stub returns false → CORE table; the last test flips it to true → FNFF2 table.

describe("getMartialActionBonus (CORE table by default)", () => {
  beforeEach(() => { globalThis.game = { settings: { get: () => false } }; });
  afterEach(() => { delete globalThis.game; });

  it("reads a built-in style's per-action bonus from the core table", () => {
    expect(getMartialActionBonus("Martial Arts: Karate", "Strike")).toBe(2);
    expect(getMartialActionBonus("Martial Arts: Karate", "Kick")).toBe(2);
    expect(getMartialActionBonus("Martial Arts: Judo", "Throw")).toBe(3);
  });

  it("returns 0 for an action the style has no bonus for, and for unknown/empty styles", () => {
    expect(getMartialActionBonus("Martial Arts: Karate", "Choke")).toBe(0); // Karate has no Choke (core)
    expect(getMartialActionBonus("Brawling", "Strike")).toBe(0);            // Brawling: {}
    expect(getMartialActionBonus("Martial Arts: Nonexistent", "Strike")).toBe(0);
  });

  it("lets a per-skill bonus override the built-in table", () => {
    expect(getMartialActionBonus("Martial Arts: Karate", "Strike", { Strike: 7 })).toBe(7);
    // Custom (non-built-in) style with only a per-skill map:
    expect(getMartialActionBonus("My Custom Style", "Kick", { Kick: 5 })).toBe(5);
  });

  it("ignores a zero/absent per-skill bonus and falls through to the table", () => {
    expect(getMartialActionBonus("Martial Arts: Karate", "Strike", { Strike: 0 })).toBe(2);
    expect(getMartialActionBonus("Martial Arts: Karate", "Strike", {})).toBe(2);
  });

  it("zeroes out FNFF2-only styles under core rules (unless explicitly overridden)", () => {
    // ArasakaTe is an FNFF2-only style; under core rules it contributes nothing...
    expect(getMartialActionBonus("Martial Arts: ArasakaTe", "Strike")).toBe(0);
    // ...but a per-skill override is honoured before the FNFF2-only gate.
    expect(getMartialActionBonus("Martial Arts: ArasakaTe", "Strike", { Strike: 9 })).toBe(9);
  });

  it("uses the FNFF2 table when fnff2 is enabled (stubbed game.settings)", () => {
    globalThis.game = { settings: { get: () => true } }; // afterEach deletes it
    // FNFF2 ArasakaTe is now live (Choke 2), and Karate gains a Punch bonus it lacks under core.
    expect(getMartialActionBonus("Martial Arts: ArasakaTe", "Choke")).toBe(2);
    expect(getMartialActionBonus("Martial Arts: Karate", "Punch")).toBe(2);
  });
});

// ─── saved attack options (pre-fill defaults) ─────────────────────────────────
// rangedModifiers/martialOptions/meleeBonkOptions accept an optional savedOptions arg so the
// attack dialog re-opens with the weapon's last-used choices. They take a weapon/actor only for
// fire-mode / trained-martial lists, which we stub. These tests pin both the restore behaviour and
// the backward-compatible default (no savedOptions → first/Brawling/NoCyberlimb), since the
// existing fire/martial call sites still invoke them without the arg.

const fakeRangedWeapon = (fireModes) => ({
  system: { range: 50 },
  __getFireModes: () => fireModes,
});
// martialOptions builds its style list from actor.trainedMartials() → { value, label }.
const fakeMartialActor = (trained = []) => ({ trainedMartials: () => trained });
// Pluck a field group entry by its localKey from the [[ ...fields ]] modifier-group shape.
const fieldByKey = (groups, localKey) => groups[0].find((f) => f.localKey === localKey);

describe("rangedModifiers — saved fire mode", () => {
  const modes = ["SemiAuto", "Auto", "ThreeRoundBurst"];

  it("defaults to the first fire mode when no saved options are given (backward compatible)", () => {
    const fm = fieldByKey(rangedModifiers(fakeRangedWeapon(modes), []), "FireMode");
    expect(fm.defaultValue).toBe("SemiAuto");
  });

  it("restores a saved fire mode that is still a valid choice", () => {
    const fm = fieldByKey(rangedModifiers(fakeRangedWeapon(modes), [], { fireMode: "Auto" }), "FireMode");
    expect(fm.defaultValue).toBe("Auto");
  });

  it("ignores a saved fire mode the weapon no longer offers (falls back to first)", () => {
    const fm = fieldByKey(rangedModifiers(fakeRangedWeapon(modes), [], { fireMode: "Suppressive" }), "FireMode");
    expect(fm.defaultValue).toBe("SemiAuto");
  });
});

describe("martialOptions — saved martial art + cyberlimb terminus", () => {
  const trained = [{ value: "Martial Arts: Karate", label: "Karate" }];

  it("defaults to Brawling / NoCyberlimb with no saved options (backward compatible)", () => {
    const groups = martialOptions(fakeMartialActor(trained));
    expect(fieldByKey(groups, "MartialArt").defaultValue).toBe("Brawling");
    expect(fieldByKey(groups, "CyberTerminus").defaultValue).toBe("NoCyberlimb");
  });

  it("restores a saved martial art that the actor is still trained in", () => {
    const groups = martialOptions(fakeMartialActor(trained), { martialArt: "Martial Arts: Karate" });
    expect(fieldByKey(groups, "MartialArt").defaultValue).toBe("Martial Arts: Karate");
  });

  it("ignores a saved martial art the actor no longer has (falls back to Brawling)", () => {
    const groups = martialOptions(fakeMartialActor(trained), { martialArt: "Martial Arts: Judo" });
    expect(fieldByKey(groups, "MartialArt").defaultValue).toBe("Brawling");
  });

  it("restores a saved cyberlimb terminus", () => {
    const groups = martialOptions(fakeMartialActor(trained), { cyberTerminus: "CyberTerminusX2" });
    expect(fieldByKey(groups, "CyberTerminus").defaultValue).toBe("CyberTerminusX2");
  });

  it("ignores an invalid saved cyberlimb terminus (falls back to NoCyberlimb)", () => {
    const groups = martialOptions(fakeMartialActor(trained), { cyberTerminus: "bogus" });
    expect(fieldByKey(groups, "CyberTerminus").defaultValue).toBe("NoCyberlimb");
  });
});

describe("meleeBonkOptions — saved cyberlimb terminus", () => {
  it("defaults to NoCyberlimb with no saved options (backward compatible)", () => {
    expect(fieldByKey(meleeBonkOptions(), "CyberTerminus").defaultValue).toBe("NoCyberlimb");
  });

  it("restores a saved cyberlimb terminus", () => {
    expect(fieldByKey(meleeBonkOptions({ cyberTerminus: "CyberTerminusX3" }), "CyberTerminus").defaultValue).toBe("CyberTerminusX3");
  });

  it("ignores an invalid saved cyberlimb terminus", () => {
    expect(fieldByKey(meleeBonkOptions({ cyberTerminus: "nope" }), "CyberTerminus").defaultValue).toBe("NoCyberlimb");
  });
});

// ─── martial bonus-table consistency ──────────────────────────────────────────

describe("martial bonus tables", () => {
  it("every action key in the core + FNFF2 tables is a declared MARTIAL_BONUS_ACTION", () => {
    const declared = new Set(MARTIAL_BONUS_ACTIONS);
    for (const table of [martialActionBonusesCore, martialActionBonusesFNFF2]) {
      for (const [, bonuses] of Object.entries(table)) {
        for (const action of Object.keys(bonuses)) {
          expect(declared.has(action), `${action} should be a declared MARTIAL_BONUS_ACTION`).toBe(true);
        }
      }
    }
  });
});
