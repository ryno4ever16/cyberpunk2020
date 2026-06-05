/**
 * vehicle-weapon-catalog.js — Phase 5b seed catalog for Maximum Metal vehicle weapons.
 *
 * Engine-first build: one VERIFIED representative weapon per resolution class (A–F), checked
 * against the MM stat tables. The full ~80-weapon catalog is authored later as a dedicated pass.
 * Each entry's Penetration is the parenthetical (n) read directly from the book (MM p.4/17/19/20).
 *
 * Tests import SEED_VEHICLE_WEAPONS directly to create Items; seedVehicleWeaponCompendium()
 * populates the "Vehicle Weapons (MM)" compendium (idempotent) so GMs can drag them onto vehicles.
 */

import { mmEnabled } from "../settings.js";

const ICON = "icons/svg/explosion.svg";
const SOURCE = "Maximum Metal";

/** The seed weapons. system fields match CyberpunkVehicleWeaponData (item-data.js). */
export const SEED_VEHICLE_WEAPONS = [
  // A — Direct-fire ballistic. 20-25mm autocannon (MM p.17: 8D10, Pen 4, ROF 10, 800m).
  {
    name: "20mm Autocannon", img: ICON,
    system: {
      weaponClass: "directFire", mountType: "turret", arc: "turret",
      wa: 0, penetration: 4, damage: "8D10", ap: false,
      rof: 10, shots: 100, range: 800, reliability: "VR",
      space: 1, cost: 3000, source: SOURCE
    }
  },
  // B — Direct HE/HEAT (burst via shell variants). 105mm Cannon (MM p.17: Pen 10; Hi-Ex 6/6m; HEAT 11*/2m).
  {
    name: "105mm Cannon", img: ICON,
    system: {
      weaponClass: "directFire", mountType: "turret", arc: "turret",
      wa: 1, penetration: 10, damage: "", rof: 1, shots: 1, range: 1000, reliability: "ST",
      space: 10, cost: 250000, source: SOURCE,
      shellVariants: [
        { name: "Hi-Ex (105mm)", pen: 6, burst: 6, hiEx: true },
        { name: "HEAT (105mm)", pen: 11, burst: 2, heat: true, ap: true }
      ]
    }
  },
  // C — Unguided rocket (HE, range-immune, burst). 2.75" Rocket (MM p.19: 8D10, Pen 4, 6m burst, 500m).
  {
    name: "2.75\" Rocket", img: ICON,
    system: {
      weaponClass: "rocket", mountType: "pod", arc: "front",
      wa: -2, penetration: 4, damage: "8D10", hiEx: true, burst: 6,
      rof: 1, shots: 1, range: 500, reliability: "VR",
      space: 1, cost: 200, source: SOURCE
    }
  },
  // D — Guided missile (paint guidance, HEAT). Hellfire (MM p.19: Pen 21*, 4m burst, 3000m, paint).
  {
    name: "Hellfire", img: ICON,
    system: {
      weaponClass: "missile", mountType: "pod", arc: "front", guidance: "paint", homingMethod: "laser",
      wa: 0, penetration: 21, damage: "20D10AP", heat: true, ap: true, burst: 4,
      rof: 1, shots: 1, range: 3000, minRange: 300, reliability: "VR",
      space: 1, cost: 10000, source: SOURCE
    }
  },
  // E — Artillery / indirect (HE, burst). 105mm Howitzer (MM p.20: WA +1, Pen 6, 6m burst, 17000m).
  {
    name: "105mm Howitzer", img: ICON,
    system: {
      weaponClass: "artillery", mountType: "fixed", arc: "front",
      wa: 1, penetration: 6, hiEx: true, burst: 6,
      rof: 1, shots: 1, range: 17000, reliability: "VR",
      space: 6, cost: 100000, source: SOURCE
    }
  },
  // F — Cone / scatter-pack (ACPA). BRP Ripple Flechette Pack (MM p.73: WA +4, Pen 3 AP, 60° cone, 24 proj, 15m).
  {
    name: "BRP Ripple Flechette Pack", img: ICON,
    system: {
      weaponClass: "cone", mountType: "open", arc: "front",
      wa: 4, penetration: 3, damage: "3D10AP", ap: true,
      coneAngle: 60, projectiles: 24, rof: 1, shots: 6, range: 15, reliability: "VR",
      space: 1, cost: 500, source: SOURCE
    }
  }
];

const PACK_ID = "cyberpunk2020.vehicle-weapons";

/**
 * Populate the Vehicle Weapons (MM) compendium from the seed catalog. Idempotent — creates only
 * entries whose name isn't already present (unless force). GM-only (configure/unlock requires it).
 * @returns {Promise<{ok:boolean, created?:number, reason?:string}>}
 */
export async function seedVehicleWeaponCompendium({ force = false } = {}) {
  const pack = game.packs?.get(PACK_ID);
  if (!pack) return { ok: false, reason: "pack-missing" };
  if (!game.user?.isGM) return { ok: false, reason: "not-gm" };

  const wasLocked = !!pack.locked;
  try {
    if (wasLocked) await pack.configure({ locked: false });
    const index = await pack.getIndex();
    const existing = new Set(index.map(e => e.name));
    const toCreate = SEED_VEHICLE_WEAPONS
      .filter(w => force || !existing.has(w.name))
      .map(w => ({ name: w.name, type: "vehicleWeapon", img: w.img, system: w.system }));
    if (toCreate.length) await Item.createDocuments(toCreate, { pack: pack.collection });
    return { ok: true, created: toCreate.length };
  } catch (err) {
    console.warn("Cyberpunk2020 | vehicle-weapon compendium seed failed", err);
    return { ok: false, reason: "error" };
  } finally {
    if (wasLocked) await pack.configure({ locked: true }).catch(() => {});
  }
}

/** Ready-time one-shot: seed the compendium if it exists and is empty. Active GM only. */
export async function ensureVehicleWeaponSeed() {
  if (!mmEnabled()) return;                                   // Maximum Metal off → don't seed the MM compendium
  if (!game.user?.isGM || game.users?.activeGM?.id !== game.user.id) return;
  const pack = game.packs?.get(PACK_ID);
  if (!pack) return;
  try {
    const index = await pack.getIndex();
    if (index.size === 0) await seedVehicleWeaponCompendium();
  } catch (err) {
    console.warn("Cyberpunk2020 | ensureVehicleWeaponSeed failed", err);
  }
}
