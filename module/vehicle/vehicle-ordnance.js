/**
 * vehicle-ordnance.js — Phase 5g-2: warhead burst resolution (the stateful wrapper over the pure
 * 5g-1 math). Given a landing point and a warhead, it places the burst, applies the right effect to
 * everything inside, and reuses the existing personnel systems:
 *   HE / HEAT / cluster → Penetration burst through the unified 5c dispatcher (Pen vs Armor / p.8)
 *   White Phosphorus     → no Penetration; sets everything in the burst alight (fire DOT / onFire)
 *   Chemical / smoke      → no Penetration; leaves a lingering gas cloud (the per-turn gas handler)
 *
 * The geometry, deviation and warhead transforms are PURE in vehicle-indirect.js; this file only
 * places documents and calls the proven fire-DOT / gas-cloud machinery.
 */

import { warheadProfile } from "./vehicle-indirect.js";
import { resolveAreaShot } from "./vehicle-area.js";

const SCOPE = "cyberpunk2020";

const _enabled = (key, dflt = true) => { try { return game.settings.get(SCOPE, key); } catch { return dflt; } };

/** Set a single token alight: personnel via the fire DOT, vehicles via the onFire flag. */
async function _ignite(actor, dot = {}) {
  if (!actor) return;
  if (actor.type === "vehicle") {
    try { await actor.update({ "system.onFire": true }); } catch { /* non-fatal */ }
    return;
  }
  if (!_enabled("fireDotEnabled")) return;
  const { applyFireDotState } = await import("../combat/save-rolls.js");
  await applyFireDotState(actor, "Torso", Number(dot.turns) || 10, String(dot.formula || "3d6"));
}

/** Leave a lingering gas/smoke cloud that the existing per-turn gas handler will run saves for. */
async function _placeGasCloud(scene, origin, radiusM, weaponName) {
  if (!_enabled("gasGrenadeCloudEnabled")) return null;
  const td = {
    t: "circle", x: origin.x, y: origin.y, direction: 0, distance: Math.max(0.5, Number(radiusM) || 0),
    fillColor: "#88ff44", borderColor: "#44aa22",
    flags: { [SCOPE]: {
      isGasCloud: true, turnsLeft: 3, stunSaveMod: 0,
      createdRound: game.combat?.round ?? 0, weaponName: weaponName || "Chemical Shell", vehicleArea: true,
    } },
  };
  try { const [doc] = await scene.createEmbeddedDocuments("MeasuredTemplate", [td]); return doc; }
  catch (err) { console.warn("Cyberpunk2020 | gas cloud placement failed", err); return null; }
}

/**
 * Resolve a warhead landing at `origin` (pixel point on the active scene). Reuses the 5e burst for the
 * Penetration warheads, then applies White-Phosphorus ignition / chemical cloud as needed.
 * @param {object}   p
 * @param {Token}    [p.firerToken]  excluded from its own burst
 * @param {{x,y}}    p.origin        landing point (already deviated by the caller)
 * @param {string}   p.warhead       "heat" | "wp" | "cluster" | "chemical" | "" (plain HE)
 * @param {number}   p.pen           base Penetration
 * @param {number}   p.burstM        base burst radius (metres)
 * @param {object}   [p.payload]     extra dispatch fields (range, goodShotSteps, ap, weaponName, …)
 * @returns {Promise<{struck:Actor[], tokens:number, profile:object}>}
 */
export async function resolveWarheadBurst({ firerToken = null, origin, warhead = "", pen = 0, burstM = 0, payload = {}, scene: sceneArg = null } = {}) {
  const scene = sceneArg ?? canvas?.scene;
  if (!scene || !origin) return { struck: [], tokens: 0, profile: null };
  const profile = warheadProfile(warhead, { pen, burstM });
  const shape = { type: "circle", radiusM: profile.burstM };

  // Penetration warheads (HE / HEAT / cluster): blast everyone through the dispatcher.
  if (profile.pen > 0) {
    const res = await resolveAreaShot({
      firerToken, origin, shape, scene,
      payload: { ...payload, scale: "penetration", penetration: profile.pen, heat: !!profile.heat || !!payload.heat },
    });
    return { ...res, profile };
  }

  // White Phosphorus: find everyone in the burst (no Pen) and set them alight.
  if (profile.dot) {
    const res = await resolveAreaShot({ firerToken, origin, shape, payload, skipDispatch: true, scene });
    for (const tok of res.inside ?? []) await _ignite(tok.actor, profile.dot);
    await ChatMessage.create({ content: `<div class="cyberpunk save-prompt"><h3>🔥 White Phosphorus burst</h3><div class="save-info">${(res.inside ?? []).length} target(s) set alight (${profile.dot.formula}/turn).</div></div>` });
    return { struck: (res.inside ?? []).map(t => t.actor), tokens: (res.inside ?? []).length, profile };
  }

  // Chemical / smoke: drop a lingering cloud at the landing point.
  if (profile.gas) {
    await _placeGasCloud(scene, origin, profile.burstM, payload.weaponName);
    await ChatMessage.create({ content: `<div class="cyberpunk save-prompt"><h3>☠ Chemical burst</h3><div class="save-info">A ${profile.burstM}m cloud settles over the impact.</div></div>` });
    return { struck: [], tokens: 0, profile };
  }

  // Plain HE with no Pen left (degenerate) — just place the visual.
  const res = await resolveAreaShot({ firerToken, origin, shape, payload, skipDispatch: true, scene });
  return { ...res, profile };
}
