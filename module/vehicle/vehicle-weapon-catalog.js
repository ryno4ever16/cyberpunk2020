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
  // Shell variants cover the artillery ammunition types (MM p.21): the warhead drives the resolver
  // (cluster/chemical ×3 the burst; WP burns; AP doubles Pen and drops the burst, howitzers only).
  {
    name: "105mm Howitzer", img: ICON,
    system: {
      weaponClass: "artillery", mountType: "fixed", arc: "front",
      wa: 1, penetration: 6, hiEx: true, burst: 6,
      rof: 1, shots: 1, range: 17000, reliability: "VR",
      space: 6, cost: 100000, source: SOURCE,
      shellVariants: [
        { name: "105mm AP", pen: 12, burst: 0, ap: true },                  // ×2 Pen on the 105mm, Burst 0
        { name: "105mm WP", pen: 0, burst: 6, warhead: "wp" },              // burn DOT, no Pen
        { name: "105mm Cluster", pen: 4, burst: 6, warhead: "cluster" },    // ×3 burst (→18m), Pen 4
        { name: "105mm Chemical", pen: 0, burst: 6, warhead: "chemical" }   // ×3 burst (→18m), gas cloud
      ]
    }
  },
  // D — Bomb (direct hit ×5 Pen). 250-lb GP bomb (MM p.22: WA −3, Pen 6, 16m burst).
  {
    name: "250-lb Bomb", img: ICON,
    system: {
      weaponClass: "bomb", mountType: "pod", arc: "front",
      wa: -3, penetration: 6, hiEx: true, burst: 16,
      rof: 1, shots: 1, range: 0, reliability: "VR",
      space: 3, cost: 600, source: SOURCE,
      shellVariants: [
        { name: "250-lb Cluster", pen: 4, burst: 16, warhead: "cluster" },   // ×3 burst, Pen 4
        { name: "250-lb Anti-Tank", pen: 6, burst: 4, warhead: "heat", heat: true, ap: true },
        { name: "250-lb Incendiary", pen: 0, burst: 16, warhead: "wp" }      // fire (reuses WP ignition)
      ]
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
  },

  // ───────────────────────── ACPA weapon roster (Maximum Metal charts, Appendix A p.95-96) ─────────────────────────
  // Each carries its own SP/SOP (ACPA mounting + per-weapon hit tracking). `area` defaults to torso;
  // re-assign it on the suit. ROF "N OR M" → rof N (high) / rofAlt M.

  // Heavy MGs & rifle (p.95).
  { name: "12.7mm Heavy MG", img: ICON, system: {
      weaponClass: "directFire", mountType: "articulated", arc: "front", wa: 1,
      penetration: 3, damage: "6D10", rof: 10, rofAlt: 5, shots: 100, range: 550, reliability: "VR",
      space: 2, cost: 2000, sp: 25, sop: 30, area: "rArm", source: SOURCE } },
  { name: "14.5mm Heavy MG", img: ICON, system: {
      weaponClass: "directFire", mountType: "articulated", arc: "front", wa: 0,
      penetration: 4, damage: "7D10", rof: 5, rofAlt: 3, shots: 100, range: 550, reliability: "VR",
      space: 3, cost: 4000, sp: 20, sop: 15, area: "rArm", source: SOURCE } },
  { name: "4mm Railgun", img: ICON, system: {
      weaponClass: "directFire", mountType: "articulated", arc: "front", wa: 3,
      penetration: 7, damage: "5D10+10AP", ap: true, rof: 1, shots: 5, range: 1500, reliability: "ST",
      space: 2, cost: 12000, sp: 15, sop: 10, area: "rArm", source: SOURCE } },

  // ACPA cannon (p.96).
  { name: "BCL-20 ACPA Cannon", img: ICON, system: {
      weaponClass: "directFire", mountType: "articulated", arc: "front", wa: 1,
      penetration: 4, damage: "9D10", rof: 2, shots: 20, range: 550, reliability: "VR",
      space: 2, cost: 2700, sp: 25, sop: 35, area: "rArm", source: SOURCE } },
  { name: "27-30mm Autocannon", img: ICON, system: {
      weaponClass: "directFire", mountType: "articulated", arc: "front", wa: 0,
      penetration: 5, damage: "9D10", rof: 10, shots: 50, range: 600, reliability: "VR",
      space: 3, cost: 4000, sp: 30, sop: 30, area: "rArm", source: SOURCE } },
  { name: "EMG-83 Improved Railgun", img: ICON, system: {
      weaponClass: "directFire", mountType: "articulated", arc: "front", wa: 2,
      penetration: 7, damage: "5D10+10AP", ap: true, rof: 1, shots: 10, range: 1000, reliability: "ST",
      space: 3, cost: 17500, sp: 25, sop: 15, area: "rArm", source: SOURCE } },
  { name: "75mm Recoilless", img: ICON, system: {
      weaponClass: "directFire", mountType: "articulated", arc: "front", wa: 0,
      penetration: 8, damage: "8D10AP", ap: true, heat: true, rof: 1, shots: 4, range: 500, reliability: "VR",
      space: 2, cost: 15000, sp: 15, sop: 20, area: "rArm", source: SOURCE } },

  // Rockets (p.96) — unguided HE (range-immune), burst.
  { name: "IFAR Rocket", img: ICON, system: {
      weaponClass: "rocket", mountType: "pod", arc: "front", wa: -2,
      penetration: 4, damage: "8D10", hiEx: true, burst: 6, rof: 1, shots: 1, range: 500, reliability: "VR",
      space: 2, cost: 200, sp: 20, sop: 30, area: "torso", source: SOURCE } },
  { name: "IFAR 6-Pod", img: ICON, system: {
      weaponClass: "rocket", mountType: "pod", arc: "front", wa: -2,
      penetration: 4, damage: "8D10", hiEx: true, burst: 6, rof: 1, shots: 6, range: 500, reliability: "VR",
      space: 4, cost: 4200, sp: 20, sop: 105, area: "torso", source: SOURCE } },
  { name: "LAW-III", img: ICON, system: {
      weaponClass: "rocket", mountType: "pod", arc: "front", wa: -2,
      penetration: 4, damage: "4D10AP", ap: true, heat: true, burst: 2, rof: 1, shots: 1, range: 200, reliability: "VR",
      space: 1, cost: 300, sp: 20, sop: 10, area: "torso", source: SOURCE } },

  // Guided missiles (p.96) — HEAT, paint/active.
  { name: "Light ATGM", img: ICON, system: {
      weaponClass: "missile", mountType: "pod", arc: "front", guidance: "paint", homingMethod: "laser", wa: 2,
      penetration: 12, damage: "12D10AP", ap: true, heat: true, burst: 4, rof: 1, shots: 1, range: 1000, minRange: 100, reliability: "VR",
      space: 2, cost: 3000, sp: 20, sop: 20, area: "torso", source: SOURCE } },
  { name: "Spectre ATGM", img: ICON, system: {
      weaponClass: "missile", mountType: "pod", arc: "front", guidance: "active", homingMethod: "radar", guidanceSkill: 15, wa: 0,
      penetration: 18, damage: "18D10AP", ap: true, heat: true, burst: 4, rof: 1, shots: 1, range: 3000, minRange: 300, reliability: "VR",
      space: 2, cost: 10000, sp: 20, sop: 25, area: "torso", source: SOURCE } },

  // Grenade launchers (p.96) — burst HE (standard grenade defaults; swap shells for other warheads).
  { name: "Tsunami 25mm Grenade Launcher", img: ICON, system: {
      weaponClass: "burst", mountType: "articulated", arc: "front", wa: 0,
      penetration: 4, damage: "", hiEx: true, burst: 5, rof: 3, rofAlt: 1, shots: 20, range: 1500, reliability: "VR",
      space: 1, cost: 1700, sp: 20, sop: 25, area: "rArm", source: SOURCE } },
  { name: "40mm Auto-Grenade Launcher", img: ICON, system: {
      weaponClass: "burst", mountType: "articulated", arc: "front", wa: 1,
      penetration: 4, damage: "", hiEx: true, burst: 5, rof: 20, rofAlt: 3, shots: 50, range: 1600, reliability: "VR",
      space: 2, cost: 2500, sp: 25, sop: 30, area: "rArm", source: SOURCE } },

  // Beam (p.95) — special escalating damage; modelled as a high-Pen direct-fire energy weapon.
  { name: "\"Photon\" Assault Cannon", img: ICON, system: {
      weaponClass: "special", mountType: "articulated", arc: "front", wa: 2,
      penetration: 6, damage: "10D6AP", ap: true, rof: 2, shots: 30, range: 300, reliability: "ST",
      space: 3, cost: 80000, sp: 15, sop: 10, area: "rArm", source: SOURCE } },

  // Melee (p.95) — ACPA hand weapons (used via the melee dialog; tracked here for mounting + SOP).
  { name: "Retractable Mono-PA Sword", img: ICON, system: {
      weaponClass: "melee", mountType: "articulated", arc: "front", wa: 1,
      penetration: 6, damage: "4D6AP", ap: true, rof: 1, shots: 1, range: 2, reliability: "VR",
      space: 1, cost: 2000, sp: 0, sop: 15, area: "rArm", source: SOURCE } },
  { name: "Large Power Saw", img: ICON, system: {
      weaponClass: "melee", mountType: "articulated", arc: "front", wa: -2,
      penetration: 6, damage: "8D6AP", ap: true, rof: 1, shots: 1, range: 2, reliability: "ST",
      space: 1, cost: 1250, sp: 20, sop: 25, area: "rArm", source: SOURCE } }
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
    // Idempotent by name: seeds the catalog and back-fills any newly added entries (e.g. when the
    // catalog gains a weapon like the 250-lb Bomb) without duplicating ones already present. Use
    // game.cyberpunk.vehicles.seedWeapons({ force: true }) to also refresh existing entries' stats.
    await seedVehicleWeaponCompendium();
  } catch (err) {
    console.warn("Cyberpunk2020 | ensureVehicleWeaponSeed failed", err);
  }
}
