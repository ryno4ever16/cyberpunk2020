/**
 * Unit tests for module/combat/armor-layers.js.
 *
 * Covers:
 *   - getArmorHardness  — explicit armorType, name heuristics, encumbrance fallback
 *   - getAutoLayerOrder — inside-out sort: soft before hard, then by priority/SP
 *   - getArmorContributors — which items cover a location; manual vs auto ordering
 *
 * The module has no top-level Foundry globals and imports cleanly under Node.
 *
 * Note on getArmorContributors:
 *   It reads actor.items.contents (not actor.items as an array).  We supply
 *   { items: { contents: [...] }, system: { armorLayers: {} } } to match.
 *   All item `.id` values must be plain strings so Set/Map lookups work.
 */

import { describe, it, expect } from "vitest";
import {
  getArmorHardness,
  getAutoLayerOrder,
  getArmorContributors,
} from "../../module/combat/armor-layers.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _idCounter = 0;

/**
 * Build a minimal armor item plain object.
 * coverage: { [locationKey]: { stoppingPower: number } }
 */
function armorItem({
  id = `armor-${++_idCounter}`,
  name = "Generic Armor",
  armorType = undefined,
  encumbrance = 0,
  coverage = {},
  equipped = true,
} = {}) {
  return {
    id,
    type: "armor",
    name,
    system: {
      equipped,
      ...(armorType !== undefined ? { armorType } : {}),
      encumbrance,
      coverage,
    },
  };
}

/**
 * Build a minimal cyberware armor item.
 * CyberWorkType.Locations: { [locationKey]: number (SP) }
 * CyberWorkType.Types: ["Armor"]
 */
function cwArmorItem({
  id = `cw-${++_idCounter}`,
  name = "Skinweave",
  locations = {},
  equipped = true,
} = {}) {
  return {
    id,
    type: "cyberware",
    name,
    system: {
      equipped,
      CyberWorkType: {
        Types: ["Armor"],
        Locations: locations,
      },
    },
  };
}

/**
 * Build a minimal actor-like plain object for getArmorContributors.
 * armorLayers: { [locationKey]: string[] }  (empty array = auto mode)
 */
function actor({ items = [], armorLayers = {} } = {}) {
  return {
    items: { contents: items },
    system: { armorLayers },
  };
}

// ─── getArmorHardness ─────────────────────────────────────────────────────────

describe("getArmorHardness — explicit armorType field", () => {
  it("returns 'hard' when armorType is 'hard'", () => {
    expect(getArmorHardness(armorItem({ armorType: "hard" }))).toBe("hard");
  });

  it("returns 'soft' when armorType is 'soft'", () => {
    expect(getArmorHardness(armorItem({ armorType: "soft" }))).toBe("soft");
  });

  it("ignores armorType='unknown' and falls through to name heuristics", () => {
    // 'unknown' is neither 'hard' nor 'soft', so name/encumbrance decides
    const result = getArmorHardness(armorItem({ armorType: "unknown", name: "Kevlar Vest" }));
    expect(result).toBe("soft");
  });
});

describe("getArmorHardness — name heuristics (no explicit armorType)", () => {
  it("'metal gear' → hard", () => {
    expect(getArmorHardness(armorItem({ name: "Metal Gear" }))).toBe("hard");
  });

  it("'body armor' → hard", () => {
    expect(getArmorHardness(armorItem({ name: "Light Body Armor" }))).toBe("hard");
  });

  it("'full body armor' → hard", () => {
    expect(getArmorHardness(armorItem({ name: "Full Body Armor" }))).toBe("hard");
  });

  it("'plate' → hard", () => {
    expect(getArmorHardness(armorItem({ name: "Chest Plate" }))).toBe("hard");
  });

  it("'rigid' → hard", () => {
    expect(getArmorHardness(armorItem({ name: "Rigid Shield" }))).toBe("hard");
  });

  it("'hard armor' → hard", () => {
    expect(getArmorHardness(armorItem({ name: "Hard Armor Vest" }))).toBe("hard");
  });

  it("'bodyplating' → hard", () => {
    expect(getArmorHardness(armorItem({ name: "Bodyplating" }))).toBe("hard");
  });

  it("'t-shirt' → soft", () => {
    expect(getArmorHardness(armorItem({ name: "T-Shirt" }))).toBe("soft");
  });

  it("'vest' → soft", () => {
    expect(getArmorHardness(armorItem({ name: "Nylon Vest" }))).toBe("soft");
  });

  it("'kevlar' → soft", () => {
    expect(getArmorHardness(armorItem({ name: "Kevlar Vest" }))).toBe("soft");
  });

  it("'jacket' → soft", () => {
    expect(getArmorHardness(armorItem({ name: "Leather Jacket" }))).toBe("soft");
  });

  it("'flak' → soft", () => {
    expect(getArmorHardness(armorItem({ name: "Flak Vest" }))).toBe("soft");
  });

  it("'nylon' → soft", () => {
    expect(getArmorHardness(armorItem({ name: "Nylon Mesh" }))).toBe("soft");
  });

  it("'cloth' → soft", () => {
    expect(getArmorHardness(armorItem({ name: "Cloth Underlayer" }))).toBe("soft");
  });

  it("'leather' → soft", () => {
    expect(getArmorHardness(armorItem({ name: "Leather Suit" }))).toBe("soft");
  });

  it("'suit' / 'bodysuit' → soft", () => {
    expect(getArmorHardness(armorItem({ name: "Body Suit" }))).toBe("soft");
  });
});

describe("getArmorHardness — encumbrance fallback (no name match)", () => {
  it("encumbrance < 2 → soft", () => {
    expect(getArmorHardness(armorItem({ name: "Unknown Piece", encumbrance: 1 }))).toBe("soft");
  });

  it("encumbrance = 0 → soft", () => {
    expect(getArmorHardness(armorItem({ name: "Unknown Piece", encumbrance: 0 }))).toBe("soft");
  });

  it("encumbrance ≥ 2 → hard", () => {
    expect(getArmorHardness(armorItem({ name: "Unknown Piece", encumbrance: 2 }))).toBe("hard");
    expect(getArmorHardness(armorItem({ name: "Unknown Piece", encumbrance: 5 }))).toBe("hard");
  });

  it("missing system → treated as EV=0 → soft", () => {
    expect(getArmorHardness({ name: "Bare Padding" })).toBe("soft");
  });
});

// ─── getAutoLayerOrder ────────────────────────────────────────────────────────

describe("getAutoLayerOrder", () => {
  it("returns an empty array for no items", () => {
    expect(getAutoLayerOrder([])).toEqual([]);
  });

  it("returns a single item unchanged", () => {
    const item = armorItem({ name: "Kevlar Vest" });
    const result = getAutoLayerOrder([item]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(item);
  });

  it("soft item sorts before hard item (inside-out)", () => {
    const soft = armorItem({ name: "Kevlar Vest" });   // soft
    const hard = armorItem({ name: "Body Armor" });     // hard
    const result = getAutoLayerOrder([hard, soft]);
    expect(result[0]).toBe(soft);
    expect(result[1]).toBe(hard);
  });

  it("two soft items are both returned (order determined by priority/SP)", () => {
    const shirt  = armorItem({ name: "T-Shirt",    coverage: { Torso: { stoppingPower: 3 } } });
    const jacket = armorItem({ name: "Leather Jacket", coverage: { Torso: { stoppingPower: 8 } } });
    const result = getAutoLayerOrder([jacket, shirt]);
    // shirt has lower priority (0) than jacket (3) → shirt innermost
    expect(result[0]).toBe(shirt);
    expect(result[1]).toBe(jacket);
  });

  it("within same hardness and priority, lower SP sorts first (inner layer)", () => {
    // Two unrecognized-name items: priority falls back to SP/100 fraction.
    // Use explicit armorType to control hardness; names must not match any priority regex
    // (avoid: shirt, t-shirt, kevlar, nylon, vest, flak, under, jacket, plate, armor, metal, gear).
    const thin = armorItem({
      name: "Ballistic Wrap A",
      armorType: "soft",
      coverage: { Torso: { stoppingPower: 5 } },
    });
    const thick = armorItem({
      name: "Ballistic Wrap B",
      armorType: "soft",
      coverage: { Torso: { stoppingPower: 15 } },
    });
    // thin: priority = 5/100 = 0.05; thick: priority = 15/100 = 0.15
    // lower priority = inner → thin first
    const result = getAutoLayerOrder([thick, thin]);
    expect(result[0]).toBe(thin);
    expect(result[1]).toBe(thick);
  });

  it("does not mutate the input array", () => {
    const hard = armorItem({ name: "Body Armor" });
    const soft = armorItem({ name: "Kevlar Vest" });
    const input = [hard, soft];
    getAutoLayerOrder(input);
    expect(input[0]).toBe(hard);
    expect(input[1]).toBe(soft);
  });

  it("three-item mixed sort: soft(low) → soft(high) → hard", () => {
    const shirt = armorItem({ name: "T-Shirt",     coverage: { Torso: { stoppingPower: 2 } } });
    const vest  = armorItem({ name: "Kevlar Vest", coverage: { Torso: { stoppingPower: 10 } } });
    const plate = armorItem({ name: "Metal Gear",  coverage: { Torso: { stoppingPower: 18 } } });
    const result = getAutoLayerOrder([plate, vest, shirt]);
    // shirt (soft, priority 0) → vest (soft, priority 1) → plate (hard, priority 5)
    expect(result[0]).toBe(shirt);
    expect(result[1]).toBe(vest);
    expect(result[2]).toBe(plate);
  });
});

// ─── getArmorContributors ─────────────────────────────────────────────────────

describe("getArmorContributors", () => {
  it("returns empty orderedLayers and cwItems when actor has no items", () => {
    const a = actor();
    const { orderedLayers, cwItems } = getArmorContributors(a, "Torso");
    expect(orderedLayers).toEqual([]);
    expect(cwItems).toEqual([]);
  });

  it("returns item that covers the queried location", () => {
    const vest = armorItem({
      name: "Kevlar Vest",
      coverage: { Torso: { stoppingPower: 10 } },
    });
    const a = actor({ items: [vest] });
    const { orderedLayers } = getArmorContributors(a, "Torso");
    expect(orderedLayers).toHaveLength(1);
    expect(orderedLayers[0]).toBe(vest);
  });

  it("does NOT include item that covers a different location", () => {
    const helmet = armorItem({
      name: "Helmet",
      coverage: { Head: { stoppingPower: 8 } },
    });
    const a = actor({ items: [helmet] });
    const { orderedLayers } = getArmorContributors(a, "Torso");
    expect(orderedLayers).toHaveLength(0);
  });

  it("does NOT include unequipped armor at the location", () => {
    const vest = armorItem({
      name: "Kevlar Vest",
      coverage: { Torso: { stoppingPower: 10 } },
      equipped: false,
    });
    const a = actor({ items: [vest] });
    const { orderedLayers } = getArmorContributors(a, "Torso");
    expect(orderedLayers).toHaveLength(0);
  });

  it("includes cyberware armor that covers the location in cwItems", () => {
    const sw = cwArmorItem({ name: "Skinweave", locations: { Torso: 4 } });
    const a = actor({ items: [sw] });
    const { orderedLayers, cwItems } = getArmorContributors(a, "Torso");
    expect(orderedLayers).toHaveLength(0);  // cw is NOT in orderedLayers
    expect(cwItems).toHaveLength(1);
    expect(cwItems[0]).toBe(sw);
  });

  it("cyberware not covering the location is not in cwItems", () => {
    const sw = cwArmorItem({ name: "Skinweave", locations: { Head: 4 } });
    const a = actor({ items: [sw] });
    const { cwItems } = getArmorContributors(a, "Torso");
    expect(cwItems).toHaveLength(0);
  });

  it("uses auto-ordering when armorLayers is empty for that location", () => {
    const shirt = armorItem({
      id: "shirt-1", name: "T-Shirt",
      coverage: { Torso: { stoppingPower: 3 } },
    });
    const plate = armorItem({
      id: "plate-1", name: "Body Armor",
      coverage: { Torso: { stoppingPower: 18 } },
    });
    const a = actor({ items: [plate, shirt], armorLayers: { Torso: [] } });
    const { orderedLayers } = getArmorContributors(a, "Torso");
    // Auto-order: shirt (soft) before plate (hard)
    expect(orderedLayers[0]).toBe(shirt);
    expect(orderedLayers[1]).toBe(plate);
  });

  it("respects manual layer order when armorLayers assigns slots", () => {
    const shirt = armorItem({
      id: "shirt-2", name: "T-Shirt",
      coverage: { Torso: { stoppingPower: 3 } },
    });
    const plate = armorItem({
      id: "plate-2", name: "Body Armor",
      coverage: { Torso: { stoppingPower: 18 } },
    });
    // Manual order: plate first (outer), shirt second — reversed from auto
    const a = actor({
      items: [shirt, plate],
      armorLayers: { Torso: ["plate-2", "shirt-2"] },
    });
    const { orderedLayers } = getArmorContributors(a, "Torso");
    expect(orderedLayers[0]).toBe(plate);
    expect(orderedLayers[1]).toBe(shirt);
  });

  it("unassigned items are appended after manual slots in auto order", () => {
    const shirt = armorItem({
      id: "shirt-3", name: "T-Shirt",
      coverage: { Torso: { stoppingPower: 3 } },
    });
    const vest = armorItem({
      id: "vest-3", name: "Kevlar Vest",
      coverage: { Torso: { stoppingPower: 10 } },
    });
    const plate = armorItem({
      id: "plate-3", name: "Body Armor",
      coverage: { Torso: { stoppingPower: 18 } },
    });
    // Manual: only vest assigned; shirt + plate are unassigned → auto-appended
    const a = actor({
      items: [plate, shirt, vest],
      armorLayers: { Torso: ["vest-3"] },
    });
    const { orderedLayers } = getArmorContributors(a, "Torso");
    // vest first (manual), then auto-ordered remainder: shirt (soft) before plate (hard)
    expect(orderedLayers[0]).toBe(vest);
    expect(orderedLayers[1]).toBe(shirt);
    expect(orderedLayers[2]).toBe(plate);
  });

  it("zero-SP coverage does not count as covering a location", () => {
    // stoppingPower: 0 should NOT be included (coversSP returns false)
    const decor = armorItem({
      name: "Decorative Plate",
      coverage: { Torso: { stoppingPower: 0 } },
    });
    const a = actor({ items: [decor] });
    const { orderedLayers } = getArmorContributors(a, "Torso");
    expect(orderedLayers).toHaveLength(0);
  });
});
