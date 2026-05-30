/**
 * DamageApplicator.js  —  module/combat/DamageApplicator.js
 *
 * Damage resolution per CP2020 p.98-99.
 *
 * SEQUENCE (per rulebook):
 *   1. Subtract SP from raw damage (SP halved for AP rounds).
 *      Cover is combined with armor SP as the outermost layer first.
 *   2. If damage > SP: the bullet PENETRATED armor. (penetrates = true)
 *      The remaining damage after SP is passed to the dialog / apply step.
 *   3. BTM is applied ONLY at the moment HP is written to the character —
 *      NOT during the dialog preview. It is the character's toughness
 *      absorbing the impact, NOT a property of the armor.
 *      Min 1 HP if SP was penetrated (Swenson Rule, p.99).
 *
 * This module does NOT apply BTM. resolveHitMath returns damageAfterSP.
 * BTM is applied in DamageDialog._onApply (and in _autoApply).
 *
 * BTM TABLE (p.99/103): Very Weak=0  Weak=1  Avg=2  Strong=3  VStrong=4  Super=5
 * btmFromBT() in lookups.js returns positive integers. We SUBTRACT them.
 *
 * COVER SP:
 *   Combined with armor as the outermost layer via proportional table before
 *   AP halving. GM supplies it in DamageDialog; future canvas.walls automation
 *   will pre-fill it.
 */

import { getArmorContributors } from "./armor-layers.js";

export const ARMOR_MODES = {
  FULL:   "full",
  SIMPLE: "simple",
  NONE:   "none",
};

// ---------------------------------------------------------------------------
// Proportional armor table (CP2020 p.99) — single definition used everywhere
// ---------------------------------------------------------------------------
function _combineSP(a, b) {
  a = Number(a) || 0;
  b = Number(b) || 0;
  if (!a) return b;
  if (!b) return a;
  const diff = Math.abs(a - b);
  let mod;
  if      (diff >= 27) mod = 0;
  else if (diff >= 21) mod = 1;
  else if (diff >= 15) mod = 2;
  else if (diff >= 9)  mod = 3;
  else if (diff >= 5)  mod = 4;
  else                 mod = 5;
  return Math.max(a, b) + mod;
}

// ---------------------------------------------------------------------------
// Single-hit armor resolution (NO BTM — see module header)
// ---------------------------------------------------------------------------

/**
 * Resolve one hit against the current armor SP at a location.
 * Returns damageAfterSP — what remains after armor but BEFORE BTM.
 * BTM is applied separately at apply-time.
 *
 * @param {object}  p
 * @param {number}  p.currentSP   Effective armor SP at this location
 * @param {number}  p.rawDamage   Damage before any reduction
 * @param {boolean} p.ap          Armor-piercing (SP halved)
 * @param {string}  p.armorMode
 * @param {number}  p.coverSP     Outermost-layer cover SP (0 = none)
 * @returns {{ spFull, spUsed, damageAfterSP, penetrates }}
 */
function resolveHitMath({ currentSP, rawDamage, ap, armorMode, coverSP = 0 }) {
  let effectiveSP = currentSP;
  if (coverSP > 0 && armorMode !== ARMOR_MODES.NONE) {
    // Cover is the outermost layer — combined last (inside-out rule, p.99)
    effectiveSP = _combineSP(currentSP, coverSP);
  }

  const spFull = (armorMode === ARMOR_MODES.NONE) ? 0 : effectiveSP;
  const spUsed = (ap && armorMode !== ARMOR_MODES.NONE)
    ? Math.floor(spFull / 2)
    : spFull;

  const damageAfterSP = rawDamage - spUsed;
  const penetrates    = damageAfterSP > 0;

  return { spFull, spUsed, damageAfterSP, penetrates };
}

// ---------------------------------------------------------------------------
// Apply-time BTM calculation (called by DamageDialog and _autoApply)
// ---------------------------------------------------------------------------

/**
 * Apply BTM to after-SP damage. Called at apply-time, not during preview.
 * @param {number} damageAfterSP
 * @param {number} btm           Positive integer (0–5)
 * @param {boolean} penetrated   Whether the bullet got through armor
 * @returns {number}             Final HP damage
 */
export function applyBTM(damageAfterSP, btm, penetrated) {
  if (!penetrated) return 0;
  return Math.max(1, damageAfterSP - btm);
}

// ---------------------------------------------------------------------------
// Full burst application
// ---------------------------------------------------------------------------

/**
 * Apply a full areaDamages object to a target sequentially.
 * @param {object}  p
 * @param {Actor}   p.target
 * @param {object}  p.areaDamages
 * @param {boolean} p.ap
 * @param {string}  p.armorMode
 * @param {boolean} p.ablate
 * @param {number}  p.coverSP
 * @param {boolean} p.dryRun
 * @returns {Promise<object[]>}  Per-hit result objects (damageAfterSP NOT net HP)
 */
export async function applyAreaDamages({ target, areaDamages, ap, armorMode, ablate, coverSP = 0, dryRun = false }) {
  const results = [];
  const btm = Number(target.system.stats?.bt?.modifier) || 0;

  const liveSP = {};
  const getLiveSP = (key) => {
    if (liveSP[key] !== undefined) return liveSP[key];
    liveSP[key] = Number(target.system.hitLocations?.[key]?.stoppingPower) || 0;
    return liveSP[key];
  };

  const allHits = [];
  for (const [location, hits] of Object.entries(areaDamages)) {
    for (const hit of hits) {
      allHits.push({ location, rawDamage: Number(hit.damage) || 0 });
    }
  }

  for (const { location, rawDamage } of allHits) {
    const currentSP = getLiveSP(location);
    const { spFull, spUsed, damageAfterSP, penetrates } = resolveHitMath({
      currentSP, rawDamage, ap, armorMode, coverSP,
    });

    // BTM applied at this point — after SP, before HP track
    const netDamage = applyBTM(damageAfterSP, btm, penetrates);

    results.push({ location, rawDamage, spFull, spUsed, damageAfterSP, btm, netDamage, penetrates });

    if (!dryRun) {
      if (netDamage > 0) {
        const current = Number(target.system.damage) || 0;
        await target.update(
          { "system.damage": current + netDamage },
          { render: false, fromCyberpunkDamageSystem: true }
        );
      }

      if (ablate && armorMode === ARMOR_MODES.FULL && penetrates && netDamage > 0) {
        await _ablateLocation(target, location);
        liveSP[location] = _deriveLiveSP(target, location);
      }
    }
  }

  if (!dryRun) target.sheet?.render(false);
  return results;
}

// ---------------------------------------------------------------------------
// Dry-run paths — these return damageAfterSP (pre-BTM) for dialog display
// ---------------------------------------------------------------------------

/** Async dry-run for auto-apply path. */
export async function resolveAreaDamages({ target, areaDamages, ap, armorMode, coverSP = 0 }) {
  return applyAreaDamages({ target, areaDamages, ap, armorMode, ablate: false, coverSP, dryRun: true });
}

/**
 * Synchronous dry-run. Returns per-hit results with damageAfterSP (pre-BTM).
 * The dialog displays damageAfterSP in the preview and applies BTM at click-time.
 */
export function resolveAreaDamagesSync({ target, areaDamages, ap, armorMode, coverSP = 0 }) {
  const results = [];
  const liveSP  = {};

  const getLiveSP = (key) => {
    if (liveSP[key] !== undefined) return liveSP[key];
    liveSP[key] = Number(target.system.hitLocations?.[key]?.stoppingPower) || 0;
    return liveSP[key];
  };

  for (const [location, hits] of Object.entries(areaDamages)) {
    for (const hit of hits) {
      const rawDamage = Number(hit.damage) || 0;
      const currentSP = getLiveSP(location);
      const { spFull, spUsed, damageAfterSP, penetrates } = resolveHitMath({
        currentSP, rawDamage, ap, armorMode, coverSP,
      });

      results.push({ location, rawDamage, spFull, spUsed, damageAfterSP, penetrates });

      // Simulate SP degradation for next bullet (staged penetration)
      if (penetrates && damageAfterSP > 0) {
        liveSP[location] = Math.max(0, currentSP - 1);
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Ablation helpers
// ---------------------------------------------------------------------------

async function _ablateLocation(target, location) {
  const contributors = getArmorContributors(target, location);
  const toAblate = [...contributors.orderedLayers, ...contributors.unassigned];

  const updates = [];
  for (const item of toAblate) {
    const liveItem = target.items.get(item.id);
    if (!liveItem) continue;
    const itemSP = Number(liveItem.system?.coverage?.[location]?.stoppingPower) || 0;
    if (itemSP <= 0) continue;
    // Full coverage object write — dot-notation paths may wipe the DataModel
    const fullCoverage = foundry.utils.deepClone(liveItem.system.coverage || {});
    if (!fullCoverage[location]) fullCoverage[location] = {};
    fullCoverage[location].stoppingPower = Math.max(0, itemSP - 1);
    updates.push({ _id: liveItem.id, "system.coverage": fullCoverage });
  }

  if (updates.length > 0) {
    await target.updateEmbeddedDocuments("Item", updates, { render: false });
  }
}

function _deriveLiveSP(target, location) {
  const contributors = getArmorContributors(target, location);
  const allItems = [...contributors.cwItems, ...contributors.orderedLayers, ...contributors.unassigned];
  const sps = allItems.map(item => {
    if (item.type === "cyberware") {
      return Number(item.system?.CyberWorkType?.Locations?.[location]) || 0;
    }
    return Number(item.system?.coverage?.[location]?.stoppingPower) || 0;
  }).filter(sp => sp > 0);
  if (!sps.length) return 0;
  return sps.reduce((acc, sp) => _combineSP(acc, sp), 0);
}
