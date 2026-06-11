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

import { warheadProfile, shellTravelTurns, indirectToHitNumber, indirectToHitBonus, indirectLanding,
         bombDirectPen, diveBombAimBonus, bombFallTurns, bombLanding } from "./vehicle-indirect.js";
import { resolveAreaShot } from "./vehicle-area.js";
import { openSingletonDialog } from "../utils.js";
import { pxPerMeter, metersToUnits, metersPerUnit } from "./vehicle-grid.js";
import { gridDistanceBetween } from "../combat/rangefinding.js";

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
    t: "circle", x: origin.x, y: origin.y, direction: 0, distance: Math.max(0.5, metersToUnits(scene, radiusM)),
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

/* ------------------------------ Fire dialogs (5g-3 / 5g-4) ------------------------------ */

const _ppm = pxPerMeter;   // unit-aware pixels-per-metre (see vehicle-grid.js)
const _center = (t) => t?.center ?? { x: t?.x, y: t?.y };
const _num = (root, id) => Number(root.querySelector(id)?.value) || 0;
const _chk = (root, id) => !!root.querySelector(id)?.checked;

/** The firing token: the selected token of this vehicle, else any of its tokens. */
function _firerTokenOf(actor) {
  return (canvas?.tokens?.controlled ?? []).find(t => t.actor?.id === actor.id)
      ?? canvas?.tokens?.placeables?.find(t => t.actor?.id === actor.id) ?? null;
}

/** Shell/warhead choices for a weapon: the base HE round plus any authored shellVariants. */
function _shellOptions(w, wName) {
  const base = { name: `${wName} (HE)`, pen: Number(w.penetration) || 0, burst: Number(w.burst) || 0, warhead: w.heat ? "heat" : (w.hiEx ? "" : ""), ap: !!w.ap };
  const variants = (Array.isArray(w.shellVariants) ? w.shellVariants : []).map(v => ({
    name: v.name || "shell", pen: Number(v.pen) || 0, burst: Number(v.burst) || 0,
    warhead: v.warhead || (v.heat ? "heat" : ""), ap: !!v.ap,
  }));
  return [base, ...variants];
}

const _shellSelect = (shells, id) => `<select id="${id}">${shells.map((s, i) => `<option value="${i}">${s.name} · Pen ${s.pen}${s.burst ? ` · ${s.burst}m burst` : ""}${s.warhead ? ` · ${s.warhead}` : ""}</option>`).join("")}</select>`;

/**
 * Indirect / artillery fire (MM p.8). A guided helper: roll the spotter-corrected To-Hit (25, or 10
 * once ranged in), deviate on a miss by missedBy × (range/100) m, and drop the warhead burst at the
 * landing point. Shell travel time is narrated. Aim point = the single targeted token.
 */
export async function openIndirectFireDialog(actor, mount = {}) {
  if (!actor || actor.type !== "vehicle") return null;
  if (!_enabled("vehicleDamageEnabled")) { ui.notifications?.warn?.("Vehicle damage automation is disabled in the settings."); return null; }
  const item = mount.itemId ? actor.items.get(mount.itemId) : null;
  const w = item?.system ?? {};
  const wName = item?.name ?? mount.name ?? "artillery";
  const shells = _shellOptions(w, wName);
  const kind = (w.weaponClass === "artillery") ? "artillery" : "mortar";   // 600 vs 400 m/turn

  const targets = [...(game.user?.targets ?? [])];
  const targetTok = targets.length === 1 ? targets[0] : null;
  if (!targetTok) { ui.notifications?.warn?.("Target the impact point (a token at the target's location) before firing indirect."); return null; }
  const firerTok = _firerTokenOf(actor);
  const scene = targetTok.document?.parent ?? canvas?.scene;
  const rangeAuto = (firerTok && targetTok)
    ? (() => { try { return Math.round(gridDistanceBetween(firerTok.center, targetTok.center) * metersPerUnit(scene)); } catch { return Number(w.range) || 0; } })()
    : (Number(w.range) || 0);

  const content = `
<div class="cyberpunk vehicle-fire-dialog" style="display:flex;flex-direction:column;gap:4px;">
  <div style="opacity:0.7;font-size:0.85em;">${actor.name} fires <b>${wName}</b> indirect at <b>${targetTok.name}</b>. A spotter corrects fire; on a miss the shell scatters from the aim point.</div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;">
    <label>Spotter HW <input type="number" id="cp-if-shw" value="0" style="width:44px;"></label>
    <label>Spotter INT <input type="number" id="cp-if-sint" value="0" style="width:44px;"></label>
    <label>Firer HW <input type="number" id="cp-if-fhw" value="0" style="width:44px;"></label>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <label>Range (m) <input type="number" id="cp-if-range" value="${rangeAuto}" style="width:64px;"></label>
    <label><input type="checkbox" id="cp-if-ranged"> Already ranged in (To-Hit 10)</label>
  </div>
  <label>Shell ${_shellSelect(shells, "cp-if-shell")}</label>
  <fieldset style="border:1px solid var(--color-border-light-tertiary);padding:4px 6px;">
    <legend style="font-size:0.8em;">Spotter modifiers (MM p.8)</legend>
    <label><input type="checkbox" id="cp-if-distract"> Spotter distracted (−10)</label>
    <label style="margin-left:8px;"><input type="checkbox" id="cp-if-optics"> Computer optics (+10)</label><br>
    <label><input type="checkbox" id="cp-if-link"> Cyberlinked (+5)</label>
    <label style="margin-left:8px;"><input type="checkbox" id="cp-if-dark"> Darkness (−3)</label>
    <label style="margin-left:8px;">Other <input type="number" id="cp-if-other" value="0" style="width:44px;"></label>
  </fieldset>
</div>`;

  const dialog = new foundry.applications.api.DialogV2({
    window: { title: `💥 Indirect Fire — ${actor.name}` },
    content,
    buttons: [
      {
        action: "fire",
        label: "💥 Fire for Effect",
        default: true,
        callback: async (ev, btn, dlg) => {
          const root = dlg.element;
          const shell = shells[_num(root, "#cp-if-shell")] ?? shells[0];
          const mods = (_chk(root, "#cp-if-distract") ? -10 : 0) + (_chk(root, "#cp-if-optics") ? 10 : 0)
                     + (_chk(root, "#cp-if-link") ? 5 : 0) + (_chk(root, "#cp-if-dark") ? -3 : 0) + _num(root, "#cp-if-other");
          const bonus = indirectToHitBonus({ spotterHW: _num(root, "#cp-if-shw"), spotterINT: _num(root, "#cp-if-sint"), firerHW: _num(root, "#cp-if-fhw"), mods });
          const tn = indirectToHitNumber({ alreadyRangedIn: _chk(root, "#cp-if-ranged") });
          const rangeM = _num(root, "#cp-if-range");
          const d10 = (await new Roll("1d10").evaluate()).total;
          const dir = (await new Roll("1d10").evaluate()).total;
          const total = d10 + bonus;
          const land = indirectLanding({ aim: _center(targetTok), rangeM, toHitTotal: total, toHitNumber: tn, d10dir: dir, ppm: _ppm(scene) });
          await resolveWarheadBurst({ firerToken: firerTok, origin: land.point, warhead: shell.warhead, pen: shell.pen, burstM: shell.burst, payload: { weaponName: shell.name, ap: shell.ap, range: "normal" }, scene });
          const travel = shellTravelTurns(rangeM, kind);
          const verdict = land.hit
            ? `<span style="color:#3ad13a;font-weight:bold;">ON TARGET</span> (1d10 ${d10} + ${bonus} = ${total} vs ${tn})`
            : `<span style="color:#e0a020;font-weight:bold;">SCATTER</span> ${Math.round(land.deviationM)}m (missed by ${land.missedBy}; 1d10 ${d10} + ${bonus} = ${total} vs ${tn})`;
          await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `${actor.name} — ${shell.name} (indirect)`, content:
            `<div class="cyberpunk vehicle-fire-result"><h3>💥 ${shell.name}</h3><div>${verdict}</div><div style="opacity:0.8;font-size:0.85em;margin-top:2px;">Shell travel ≈ <b>${travel}</b> turn${travel !== 1 ? "s" : ""} (${kind === "artillery" ? "600" : "400"} m/turn).</div></div>` });
        },
      },
      { action: "cancel", label: "Cancel" },
    ],
  });
  return openSingletonDialog(`vehicle-indirect:${actor.id}`, () => dialog);
}

/**
 * Bombing (MM p.9). To-Hit 25; dive-bombing adds aim (+1/turn beyond the first, max +3) and the
 * aircraft's speed (faster fall). A direct hit multiplies Penetration ×5; a miss deviates by
 * missedBy × 10 × (height/100) m. Aim point = the single targeted token.
 */
export async function openBombDialog(actor, mount = {}) {
  if (!actor || actor.type !== "vehicle") return null;
  if (!_enabled("vehicleDamageEnabled")) { ui.notifications?.warn?.("Vehicle damage automation is disabled in the settings."); return null; }
  const item = mount.itemId ? actor.items.get(mount.itemId) : null;
  const w = item?.system ?? {};
  const wName = item?.name ?? mount.name ?? "bomb";
  const shells = _shellOptions(w, wName);

  const targets = [...(game.user?.targets ?? [])];
  const targetTok = targets.length === 1 ? targets[0] : null;
  if (!targetTok) { ui.notifications?.warn?.("Target the aiming point (a token at the target's location) before bombing."); return null; }
  const firerTok = _firerTokenOf(actor);
  const scene = targetTok.document?.parent ?? canvas?.scene;

  const content = `
<div class="cyberpunk vehicle-fire-dialog" style="display:flex;flex-direction:column;gap:4px;">
  <div style="opacity:0.7;font-size:0.85em;">${actor.name} drops <b>${wName}</b> on <b>${targetTok.name}</b>. A direct hit multiplies Penetration ×5; a miss scatters with altitude.</div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
    <label>Drop height (m) <input type="number" id="cp-bm-height" value="500" style="width:64px;"></label>
    <label>Dive turns <input type="number" id="cp-bm-dive" value="0" style="width:44px;" title="Turns spent diving at the target; each beyond the first adds +1 to-hit (max +3) and speeds the fall."></label>
    <label>Aircraft speed (m/turn) <input type="number" id="cp-bm-speed" value="0" style="width:64px;" title="Power-dive speed; the bomb inherits it (halving each turn to the 175 m/turn floor)."></label>
  </div>
  <label>Bomb ${_shellSelect(shells, "cp-bm-shell")}</label>
  <label>Other to-hit mods <input type="number" id="cp-bm-other" value="0" style="width:44px;"></label>
</div>`;

  const dialog = new foundry.applications.api.DialogV2({
    window: { title: `🛩 Bombing — ${actor.name}` },
    content,
    buttons: [
      {
        action: "drop",
        label: "🛩 Drop",
        default: true,
        callback: async (ev, btn, dlg) => {
          const root = dlg.element;
          const shell = shells[_num(root, "#cp-bm-shell")] ?? shells[0];
          const heightM = _num(root, "#cp-bm-height");
          const diveTurns = _num(root, "#cp-bm-dive");
          const diveSpeed = _num(root, "#cp-bm-speed");
          const aim = diveBombAimBonus(diveTurns);
          const mods = aim + _num(root, "#cp-bm-other");
          const tn = 25;
          const d10 = (await new Roll("1d10").evaluate()).total;
          const dir = (await new Roll("1d10").evaluate()).total;
          const total = d10 + mods;
          const land = bombLanding({ aim: _center(targetTok), heightM, toHitTotal: total, toHitNumber: tn, d10dir: dir, ppm: _ppm(scene) });
          // A direct hit multiplies the warhead's Penetration ×5 (MM p.9). The burst carries that.
          const pen = land.hit ? bombDirectPen(shell.pen) : shell.pen;
          await resolveWarheadBurst({ firerToken: firerTok, origin: land.point, warhead: shell.warhead, pen, burstM: shell.burst, payload: { weaponName: shell.name, ap: shell.ap, range: "normal" }, scene });
          const fall = bombFallTurns(heightM, { diveSpeed: diveTurns > 0 ? diveSpeed : 0 });
          const verdict = land.hit
            ? `<span style="color:#ff3030;font-weight:bold;">DIRECT HIT ×5</span> (1d10 ${d10} + ${mods} = ${total} vs ${tn}) — Pen ${pen}`
            : `<span style="color:#e0a020;font-weight:bold;">MISS</span>, scatters ${Math.round(land.deviationM)}m (missed by ${land.missedBy})`;
          await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `${actor.name} — ${shell.name} (bomb)`, content:
            `<div class="cyberpunk vehicle-fire-result"><h3>🛩 ${shell.name}</h3><div>${verdict}</div><div style="opacity:0.8;font-size:0.85em;margin-top:2px;">Falls ≈ <b>${fall}</b> turn${fall !== 1 ? "s" : ""}${diveTurns > 0 && diveSpeed > 175 ? " (dive)" : ""}${aim ? ` · dive aim +${aim}` : ""}.</div></div>` });
        },
      },
      { action: "cancel", label: "Cancel" },
    ],
  });
  return openSingletonDialog(`vehicle-bomb:${actor.id}`, () => dialog);
}
