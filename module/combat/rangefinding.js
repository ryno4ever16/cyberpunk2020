/**
 * rangefinding.js  —  module/combat/rangefinding.js
 *
 * Automated range category determination from token distance.
 *
 * CP2020 range definitions (p.99):
 *   Point Blank: touching to 1m
 *   Close:       up to 1/4 of weapon's Long range
 *   Medium:      up to 1/2 of weapon's Long range
 *   Long:        up to the weapon's listed range
 *   Extreme:     up to 2× the weapon's listed range
 *
 * Weapon Long ranges (p.99):
 *   Handguns:     50m
 *   SMGs:         150m
 *   Shotguns:     50m
 *   Rifles:       400m
 *   Melee:        1m (melee range)
 *
 * Hit number modifiers per range (p.99):
 *   Point Blank: 10  Close: 15  Medium: 20  Long: 25  Extreme: 30
 *
 * In Foundry VTT:
 *   canvas.grid.measureDistance(pos1, pos2) returns distance in the scene's
 *   distance unit (configured per scene, typically meters or feet).
 *   canvas.scene.dimensions.distance = units per grid square.
 *
 * Usage: called from item.js attack flow when autoRangefinding setting is on.
 */

export const RANGE_CATEGORIES = {
  POINT_BLANK: "pointBlank",
  CLOSE:       "close",
  MEDIUM:      "medium",
  LONG:        "long",
  EXTREME:     "extreme",
  OUT_OF_RANGE: "outOfRange",
};

// Hit number per range (p.99)
export const RANGE_HIT_NUMBERS = {
  pointBlank: 10,
  close:      15,
  medium:     20,
  long:       25,
  extreme:    30,
};

// Weapon type to Long range in meters (p.99 WEAPON RANGES table)
// The `range` field on each weapon item is its Long range in meters.
const WEAPON_TYPE_DEFAULT_RANGES = {
  Pistol:   50,
  SMG:      150,
  Shotgun:  50,
  Rifle:    400,
  Heavy:    400,
  Melee:    1,
  Bow:      150,
  Exotic:   20,
};

/**
 * Get the long range (in meters) for a weapon item.
 * Uses item.system.range if set; falls back to weapon type default.
 * @param {Item} weaponItem
 * @returns {number}  Long range in meters
 */
export function getWeaponLongRange(weaponItem) {
  const fromItem = Number(weaponItem.system?.range);
  if (fromItem && fromItem > 0) return fromItem;
  const wtype = weaponItem.system?.weaponType || "";
  return WEAPON_TYPE_DEFAULT_RANGES[wtype] ?? 50;
}

/**
 * Determine range category from a distance (in meters) and weapon long range.
 * @param {number} distanceMeters
 * @param {number} longRange       Weapon's full/Long range in meters
 * @returns {string}               One of RANGE_CATEGORIES values
 */
export function getRangeCategory(distanceMeters, longRange) {
  if (distanceMeters <= 1)                    return RANGE_CATEGORIES.POINT_BLANK;
  if (distanceMeters <= longRange / 4)        return RANGE_CATEGORIES.CLOSE;
  if (distanceMeters <= longRange / 2)        return RANGE_CATEGORIES.MEDIUM;
  if (distanceMeters <= longRange)            return RANGE_CATEGORIES.LONG;
  if (distanceMeters <= longRange * 2)        return RANGE_CATEGORIES.EXTREME;
  return RANGE_CATEGORIES.OUT_OF_RANGE;
}

/**
 * Measure the distance in meters between two canvas tokens.
 * Uses Foundry's canvas.grid.measureDistance.
 *
 * @param {Token} attackerToken
 * @param {Token} targetToken
 * @returns {number}  Distance in the scene's distance unit (assumed meters)
 */
export function measureTokenDistance(attackerToken, targetToken) {
  if (!canvas?.grid) return Infinity;

  // Use token center positions
  const from = { x: attackerToken.x + attackerToken.w / 2, y: attackerToken.y + attackerToken.h / 2 };
  const to   = { x: targetToken.x   + targetToken.w   / 2, y: targetToken.y   + targetToken.h   / 2 };

  const ray = new Ray(from, to);
  const distances = canvas.grid.measureDistances([{ ray }], { gridSpaces: true });
  return distances[0] ?? Infinity;
}

/**
 * Get the full range result for an attack.
 * Called from item.js when autoRangefinding is enabled.
 *
 * @param {Item}  weaponItem
 * @param {Token} attackerToken
 * @param {Token} targetToken
 * @returns {{
 *   category: string,
 *   hitNumber: number,
 *   distanceMeters: number,
 *   longRange: number,
 *   label: string,
 * }}
 */
export function resolveAttackRange(weaponItem, attackerToken, targetToken) {
  const longRange     = getWeaponLongRange(weaponItem);
  const distanceMeters = measureTokenDistance(attackerToken, targetToken);
  const category      = getRangeCategory(distanceMeters, longRange);
  const hitNumber     = RANGE_HIT_NUMBERS[category] ?? 25;

  const LABELS = {
    pointBlank:  "Point Blank",
    close:       "Close",
    medium:      "Medium",
    long:        "Long",
    extreme:     "Extreme",
    outOfRange:  "Out of Range",
  };

  return {
    category,
    hitNumber,
    distanceMeters: Math.round(distanceMeters * 10) / 10,
    longRange,
    label: LABELS[category] ?? category,
  };
}
