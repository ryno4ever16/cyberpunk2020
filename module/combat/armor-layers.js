/**
 * armor-layers.js  —  module/combat/armor-layers.js
 *
 * Armor layer system — two modes:
 *
 * AUTO MODE (default):
 *   Armor pieces are ordered inside-out automatically by type and SP:
 *   1. Cyberware armor (Skinweave, subdermal, bodyplating) — always innermost base
 *   2. Soft armor (Kevlar, flak, light jacket) — ordered by SP ascending
 *   3. Hard armor (Metal gear, body armor, rigid plates) — ordered by SP ascending
 *
 *   Within each tier, lower-SP pieces go inside higher-SP pieces because
 *   the proportional armor formula rewards layering similar-SP pieces
 *   (difference 0-4 gives +5 bonus). Auto-ordering maximises the bonus by
 *   pairing pieces of similar SP, soft inside hard.
 *
 *   This matches real-world practice: shirt under vest under plate carrier.
 *
 * MANUAL MODE (optional):
 *   When any layer slot in system.armorLayers is populated for a location,
 *   that location uses the manually assigned order instead of auto-ordering.
 *   Unassigned items are appended after the manual layers in SP order.
 *
 * ARCHITECTURE:
 *   actor.js maxLayeredSP() already implements proportional armor (CP2020 p.99)
 *   and runs on every actor render to compute displayed SP. This module adds:
 *     - getArmorContributors() — which items cover a location, in layer order
 *       (used by DamageApplicator for targeted ablation)
 *     - getAutoLayerOrder() — sorted item list for display in the UI
 *
 * COVER SP:
 *   Cover is treated as an outermost layer in DamageApplicator.resolveHitMath,
 *   combined via _combineSP(armorSP, coverSP). Cover has no slot in this module.
 *
 * DATA MODEL:
 *   system.armorLayers per location: ["itemId1", "itemId2", ...]
 *   Empty array = auto-ordering for that location.
 *   Cyberware armor is never put in these slots.
 */

// ---------------------------------------------------------------------------
// Armor type and order classification
// ---------------------------------------------------------------------------

/**
 * Determine whether an armor item is "hard" (rigid) or "soft" (flexible).
 * Uses the armorType field if explicitly set on the item.
 * Falls back to name heuristics, then encumbrance.
 *
 * CP2020 soft examples: cloth, leather, Kevlar, t-shirt, flak vest, flak pants,
 *   light/medium/heavy jacket, body suit, nylon
 * CP2020 hard examples: metal gear, body armor, full body armor, plate
 */
function getArmorHardness(armorItem) {
  const explicit = armorItem.system?.armorType;
  if (explicit === "hard" || explicit === "soft") return explicit;

  const name = (armorItem.name ?? "").toLowerCase();
  if (/metal gear|body armor|full body|plate|rigid|hard armor|bodyplating/.test(name)) return "hard";
  if (/shirt|vest|jacket|flak|kevlar|nylon|cloth|leather|suit|bodysuit|soft/.test(name)) return "soft";

  // Encumbrance heuristic: EV ≥ 2 = typically hard
  return (Number(armorItem.system?.encumbrance) || 0) >= 2 ? "hard" : "soft";
}

/**
 * Within a hardness tier, determine a sub-ordering priority.
 * Lower number = closer to the body (inner).
 *
 * Naming conventions for common layering order (inside → outside):
 *   Shirt/T-shirt      → 0 (innermost of soft)
 *   Vest/Kevlar/Nylon  → 1
 *   Light jacket       → 2
 *   Medium/Heavy jacket→ 3 (outermost of soft before hard)
 *   Light plate/armor  → 4 (innermost hard)
 *   Metal gear/full    → 5 (outermost hard)
 */
function getLayerPriority(armorItem) {
  const name = (armorItem.name ?? "").toLowerCase();
  if (/t-shirt|tshirt|shirt/.test(name)) return 0;
  if (/kevlar|nylon|vest|flak vest|under/.test(name)) return 1;
  if (/light.*jacket|lt.*jacket/.test(name)) return 2;
  if (/medium.*jacket|heavy.*jacket|jacket/.test(name)) return 3;
  if (/flak pants|flak/.test(name)) return 1;
  if (/light.*armor|light.*plate/.test(name)) return 4;
  if (/metal gear|full body|body armor/.test(name)) return 5;
  // Fall back to SP: lower SP = thinner = more likely inner
  return Number(
    Math.max(...Object.values(armorItem.system?.coverage ?? {}).map(c => Number(c?.stoppingPower) || 0))
  ) / 100;
}

/**
 * Sort equipped armor items at a location into inside-out order.
 * Order: soft (by priority, then SP) → hard (by priority, then SP).
 * This matches real-world layering: thin/soft closest to body, rigid outermost.
 *
 * @param {Item[]} armorItems   Equipped armor items covering this location
 * @returns {Item[]}            Sorted inside-out
 */
export function getAutoLayerOrder(armorItems) {
  const sorted = [...armorItems].sort((a, b) => {
    const hardA = getArmorHardness(a) === "hard" ? 1 : 0;
    const hardB = getArmorHardness(b) === "hard" ? 1 : 0;
    if (hardA !== hardB) return hardA - hardB; // soft before hard
    const prioA = getLayerPriority(a);
    const prioB = getLayerPriority(b);
    if (prioA !== prioB) return prioA - prioB;
    // Final tiebreaker: lower SP = inner
    const spA = Math.max(...Object.values(a.system?.coverage ?? {}).map(c => Number(c?.stoppingPower) || 0));
    const spB = Math.max(...Object.values(b.system?.coverage ?? {}).map(c => Number(c?.stoppingPower) || 0));
    return spA - spB;
  });
  return sorted;
}

// ---------------------------------------------------------------------------
// getArmorContributors — for ablation targeting
// ---------------------------------------------------------------------------

/**
 * Return armor items contributing SP at a location, in layer order.
 * If manual layers are assigned for this location, uses that order.
 * Otherwise uses auto-ordering.
 *
 * @param {Actor}  actor
 * @param {string} locationKey   e.g. "Head", "Torso", "lArm"
 * @returns {{
 *   orderedLayers: Item[],   inside-out, assigned or auto-ordered
 *   cwItems:       Item[],   cyberware armor at this location (always innermost)
 * }}
 */
export function getArmorContributors(actor, locationKey) {
  const allItems = actor.items.contents;

  const equippedArmor = allItems.filter(i => i.type === "armor" && i.system.equipped);
  const cwArmorItems  = allItems.filter(i => {
    if (i.type !== "cyberware" || !i.system.equipped) return false;
    const cwt   = i.system?.CyberWorkType;
    if (!cwt) return false;
    const types = Array.isArray(cwt.Types) ? cwt.Types : (cwt.Type ? [cwt.Type] : []);
    return types.includes("Armor");
  });

  const coversSP = (item) =>
    (Number(item.system?.coverage?.[locationKey]?.stoppingPower) || 0) > 0;
  const cwCovers = (cw) =>
    (Number(cw.system?.CyberWorkType?.Locations?.[locationKey]) || 0) > 0;

  const coveringArmor = equippedArmor.filter(coversSP);

  // Check for manual layer assignments at this location
  const manualSlots = actor.system.armorLayers?.[locationKey] ?? [];
  const hasManualAssignment = manualSlots.some(id => id && id !== "");

  let orderedLayers;
  if (hasManualAssignment) {
    // Manual order: assigned items first, then unassigned in auto order
    const assignedIds = new Set(manualSlots.filter(Boolean));
    const manual = manualSlots
      .filter(Boolean)
      .map(id => coveringArmor.find(a => a.id === id) ?? null)
      .filter(Boolean);
    const unassigned = coveringArmor.filter(a => !assignedIds.has(a.id));
    orderedLayers = [...manual, ...getAutoLayerOrder(unassigned)];
  } else {
    orderedLayers = getAutoLayerOrder(coveringArmor);
  }

  return {
    orderedLayers,
    cwItems: cwArmorItems.filter(cwCovers),
    // keep for backward compat with any callers using .unassigned
    get unassigned() { return []; },
  };
}
