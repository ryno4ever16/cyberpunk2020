/**
 * vehicle-missile-flight.js — Phase 5f-2: stateful multi-turn missile flight.
 *
 * A guided missile is a hidden, scalable Token (a reusable "Missile" proxy actor) carrying its
 * flight state in flags. Each combat round it advances toward its target (auto-advance); on the
 * impact round it rolls its guidance to-hit and, on a hit, resolves through the unified dispatcher.
 * A "Missiles in Flight" list is injected into the Combat Tracker. Detection-gated reveal and the
 * Incoming-Missile reaction card (countermeasures / evade / intercept) arrive in 5f-3.
 */

import { mmEnabled } from "../settings.js";
import { missileSpeed, turnsToImpact, resolveMissileToHit, resolvePaintHit, countermeasureModifier, interceptResult, electronicDetect, visualDetectDV } from "./vehicle-missiles.js";
import { pixelsToMeters } from "./vehicle-grid.js";

const SCOPE = "cyberpunk2020";
const MISSILE_IMG = "systems/cyberpunk2020/img/missile.webp";
// ⚠ PLACEHOLDER ART: missile.webp points diagonally on a solid background. This offset rotates the
// sprite so the nose roughly faces its heading; tune it in-engine. MUST be replaced before release
// with a north-pointing, transparent sprite (then set this to 0). See vehicle-combat-design memory.
const MISSILE_ART_OFFSET = 135;

/** Reusable hidden proxy actor that hosts all missile tokens (avoids per-missile actor clutter). */
async function _ensureMissileActor() {
  let a = game.actors?.find(x => x.getFlag?.(SCOPE, "missileProxy"));
  if (!a) a = await Actor.create({ name: "Missile", type: "npc", img: MISSILE_IMG, flags: { [SCOPE]: { missileProxy: true } } });
  return a;
}

const _gridSize = (scene) => Number(scene?.grid?.size) || 100;
/** Centre of a TokenDocument in pixels (document fields only — no reliance on a rendered placeable). */
function _docCenter(doc, gs) { return { x: doc.x + (doc.width * gs) / 2, y: doc.y + (doc.height * gs) / 2 }; }
const _headingDeg = (from, to) => Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;

/**
 * Launch a guided missile toward a target token. Spawns a hidden missile token at the shooter,
 * stores the flight + to-hit state, and computes turns-to-impact from distance ÷ missile speed.
 * @returns {Promise<TokenDocument|null>}
 */
export async function launchMissile({ scene: sceneArg, shooterToken, targetToken, missile = {} } = {}) {
  if (!mmEnabled()) { ui.notifications?.warn?.("Maximum Metal is disabled — enable it in the settings to fire guided missiles."); return null; }
  const scene = sceneArg ?? canvas?.scene;
  if (!scene || !shooterToken || !targetToken) { ui.notifications?.warn?.("Missile launch needs both the firer and the target on the canvas."); return null; }
  const sDoc = shooterToken.document ?? shooterToken;
  const tDoc = targetToken.document ?? targetToken;
  const gs = _gridSize(scene);
  const proxy = await _ensureMissileActor();

  const sc = _docCenter(sDoc, gs), tc = _docCenter(tDoc, gs);
  const distM = pixelsToMeters(scene, Math.hypot(tc.x - sc.x, tc.y - sc.y));
  const speed = missileSpeed(missile.guidance, missile.speed);
  const tti = turnsToImpact(distM, speed);

  const flight = {
    shooterTokenId: sDoc.id, shooterActorId: sDoc.actorId ?? null,
    targetTokenId: tDoc.id, targetActorId: tDoc.actorId ?? null,
    guidance: missile.guidance ?? "semiActive", homingMethod: missile.homingMethod ?? "radar",
    penetration: Number(missile.penetration) || 0, ap: !!missile.ap, heat: !!missile.heat, hefPenetrator: !!missile.hefPenetrator,
    weaponName: missile.weaponName ?? "missile",
    operatorBonus: Number(missile.operatorBonus) || 0, missileSkill: Number(missile.missileSkill) || 0,
    targetNumber: Number(missile.targetNumber) || 0,
    speed, turnsToImpact: tti, totalTurns: tti, detected: false,
    difficultyMods: 0, intercepted: null, reactions: [], launchRound: game.combat?.round ?? 0,
    // Was it launched during an active encounter? If not, the first combat round ADOPTS it (re-baselines
    // its flight) instead of resolving it on the spot — so an out-of-combat missile carries into combat.
    combatAdopted: !!game.combat?.started,
  };

  const [tok] = await scene.createEmbeddedDocuments("Token", [{
    name: flight.weaponName, actorId: proxy.id, actorLink: false,
    x: sc.x - gs * 0.25, y: sc.y - gs * 0.25, width: 0.5, height: 0.5,
    texture: { src: MISSILE_IMG }, rotation: _headingDeg(sc, tc) + MISSILE_ART_OFFSET,
    hidden: true, disposition: -1,
    flags: { [SCOPE]: { missile: flight } },
  }]);

  // A missile only flies on combat-round changes; out of combat it needs the manual ▶ control.
  const inCombat = !!game.combat?.started;
  const noCombatHint = inCombat ? "" :
    `<div style="margin-top:4px;font-size:0.82em;color:#e0a020;">⚠ No active encounter — start one for automatic flight, or advance the missile manually with ▶ in the <b>Missiles in Flight</b> panel (Combat tab).</div>`;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: shooterToken.actor ?? undefined }),
    content: `<div class="cyberpunk save-prompt"><h3>🚀 ${flight.weaponName} launched</h3><div class="save-info">${sDoc.name ?? "Firer"} → ${tDoc.name ?? "target"}. Impact in <b>${tti}</b> turn${tti !== 1 ? "s" : ""} (${flight.guidance}).</div>${noCombatHint}</div>`,
  });
  if (!inCombat) ui.notifications?.info?.("Missile launched — start an encounter for better missile controls, or advance it manually in the Combat tab's Missiles in Flight panel.");
  await _tryDetect(tok, scene);   // can the target spot it now? (sensors auto / Notice-Awareness)
  ui.combat?.render();
  return tok;
}

/** Advance ONE in-flight missile a single step: move toward its target, or resolve on impact.
 *  When `round` is a combat round number, a not-yet-adopted (out-of-combat) missile is ADOPTED into
 *  the encounter — re-baselined to this round and held for one round — rather than advanced/resolved. */
async function _stepMissile(mt, scene, gs, round = null) {
  const f = mt?.flags?.[SCOPE]?.missile;
  if (!f) return;
  if (round !== null && f.combatAdopted === false) {
    await mt.update({ [`flags.${SCOPE}.missile.combatAdopted`]: true, [`flags.${SCOPE}.missile.launchRound`]: round });
    return;   // give it its full remaining flight inside the encounter; don't consume a turn now
  }
  const targetDoc = scene.tokens.get(f.targetTokenId);
  if (!targetDoc) { await mt.delete().catch(() => {}); return; }   // target gone → missile lost
  if (!f.detected) await _tryDetect(mt, scene);    // retry detection while inbound
  const tti = Number(f.turnsToImpact) || 1;
  const tc = _docCenter(targetDoc, gs);
  if (tti <= 1) {
    await _resolveMissileImpact(f, targetDoc, scene, gs);
    await mt.delete().catch(() => {});
  } else {
    const cur = { x: mt.x + (mt.width * gs) / 2, y: mt.y + (mt.height * gs) / 2 };
    const nx = mt.x + (tc.x - cur.x) / tti, ny = mt.y + (tc.y - cur.y) / tti;
    await mt.update({ x: nx, y: ny, rotation: _headingDeg(cur, tc) + MISSILE_ART_OFFSET, [`flags.${SCOPE}.missile.turnsToImpact`]: tti - 1 });
  }
}

/** Advance every in-flight missile one combat round; resolve those reaching impact. (Active GM.)
 *  Pass the current combat `round` so missiles launched outside combat are adopted, not resolved. */
export async function advanceMissiles(scene = canvas?.scene, round = null) {
  if (!scene) return;
  const gs = _gridSize(scene);
  const missiles = scene.tokens.filter(t => t.flags?.[SCOPE]?.missile);
  for (const mt of missiles) await _stepMissile(mt, scene, gs, round);
  ui.combat?.render();
}

/** Advance a SINGLE missile one step by token id — the manual control for out-of-combat play. */
export async function advanceOneMissile(scene, tokenId) {
  const sc = scene ?? canvas?.scene;
  const mt = sc?.tokens?.get(tokenId);
  if (!sc || !mt) return;
  await _stepMissile(mt, sc, _gridSize(sc));
  ui.combat?.render();
}

async function _resolveMissileImpact(f, targetDoc, scene, gs) {
  const target = targetDoc.actor;
  const d10 = (await new Roll("1d10").evaluate()).total;
  const dm = Number(f.difficultyMods) || 0;   // accumulated countermeasure / evade +Difficulty
  const hit = f.guidance === "paint"
    ? resolvePaintHit(d10)
    : resolveMissileToHit({ guidance: f.guidance, d10, operatorBonus: f.operatorBonus, missileSkill: f.missileSkill, targetNumber: f.targetNumber, difficultyMods: dm }).hit;

  if (!hit || !target) {
    await ChatMessage.create({ content: `<div class="cyberpunk save-prompt"><h3>🚀 ${f.weaponName} — MISS</h3><div class="save-info">at ${targetDoc.name ?? "target"}${dm ? ` (countermeasures +${dm})` : ""}.</div></div>` });
    return;
  }
  // An AGAMS/AEAMS that detonated the missile in its burst range halves damage & Penetration.
  const burst = f.intercepted === "burst";
  const pen = burst ? Math.ceil((Number(f.penetration) || 0) / 2) : (Number(f.penetration) || 0);
  const { dispatchAttack, detectFacingFromTokens } = await import("./vehicle-targeting.js");
  const shooterDoc = scene.tokens.get(f.shooterTokenId);
  const facing = (shooterDoc?.object && targetDoc.object) ? detectFacingFromTokens(shooterDoc.object, targetDoc.object) : "front";
  await dispatchAttack({
    scale: "penetration", penetration: pen, ap: f.ap, heat: f.heat, hefPenetrator: f.hefPenetrator,
    weaponName: f.weaponName + (burst ? " (intercepted, ½)" : ""), facing, targetTokenId: targetDoc.id,
  }, target);
}

/**
 * Attempt to detect an inbound missile for its target (MM p.10). Sensors auto-detect (90%); else a
 * Notice/Awareness test (Awareness + Combat Sense + 1d10 vs DV 20). On success reveal the token and
 * post the reaction card. Detection is PERCEPTION (auto); the reactions on the card are deliberate.
 */
async function _tryDetect(mt, scene) {
  const f = mt.flags?.[SCOPE]?.missile;
  if (!f || f.detected) return false;
  const targetDoc = scene.tokens.get(f.targetTokenId);
  const target = targetDoc?.actor;
  if (!target) return false;
  let detected = false, how = "";
  if (target.system?.sensors) {
    detected = electronicDetect((await new Roll("1d10").evaluate()).total);
    how = detected ? "detected on sensors" : "";
  } else {
    const aware = Number(target.getSkillVal?.("Awareness") ?? 0) || 0;
    const cs = Number(target.getSkillVal?.("Combat Sense") ?? target.getSkillVal?.("CombatSense") ?? 0) || 0;
    const roll = (await new Roll("1d10").evaluate()).total;
    detected = (roll + aware + cs) >= visualDetectDV("inFlight");
    how = detected ? `spotted (Awareness ${aware} + CS ${cs} + 1d10 ${roll} ≥ 20)` : "";
  }
  if (!detected) return false;
  await mt.update({ hidden: false, [`flags.${SCOPE}.missile.detected`]: true });
  await _postIncomingCard(mt, f, targetDoc, how);
  return true;
}

/** The best +Difficulty an available countermeasure imposes on the missile's homing method. */
function _bestCountermeasure(cms = [], method = "radar") {
  let cm = null, mod = 0;
  for (const c of (cms ?? [])) { const m = countermeasureModifier([c], method); if (m > mod) { mod = m; cm = c; } }
  return { cm, mod };
}

/** Consolidated "Incoming Missile" card — the defender's deliberate reactions (whispered to owner+GM). */
async function _postIncomingCard(mt, f, targetDoc, how = "") {
  const target = targetDoc?.actor;
  const sceneId = targetDoc?.parent?.id ?? canvas?.scene?.id ?? "";
  const best = _bestCountermeasure(target?.system?.countermeasures ?? [], f.homingMethod);
  const hasAM = !!target?.system?.antiMissile;
  const btn = (cls, label) => `<button class="${cls}" data-token-id="${mt.id}" data-scene-id="${sceneId}" style="margin:2px 2px 0 0;">${label}</button>`;
  const whisper = target ? game.users.filter(u => u.isGM || target.testUserPermission(u, "OWNER")).map(u => u.id) : undefined;
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: target ?? undefined }),
    whisper,
    content: `
<div class="cyberpunk save-prompt">
  <h3>🚨 Incoming Missile — ${targetDoc?.name ?? "target"}</h3>
  <div class="save-info"><b>${f.weaponName}</b> · ${f.guidance} / ${f.homingMethod} · impact in <b>${f.turnsToImpact}</b> turn(s).${how ? ` <span style="opacity:0.75;">${how}.</span>` : ""}</div>
  <div class="save-buttons" style="margin-top:6px;">
    ${best.cm ? btn("cp-missile-cm", `🎆 Deploy ${best.cm} (+${best.mod})`) : `<span style="opacity:0.6;font-size:0.85em;">No countermeasure vs ${f.homingMethod}. </span>`}
    ${btn("cp-missile-evade", "↪ Evade (+2)")}
    ${hasAM ? btn("cp-missile-intercept", "🛡 Anti-Missile") : ""}
  </div>
</div>`,
  });
}

/** Apply a deliberate reaction to an in-flight missile. (Applied by the GM / a permitted client.) */
async function _applyMissileReaction(tokenId, kind) {
  const scene = canvas?.scene;
  const mt = scene?.tokens?.get(tokenId);
  const f = mt?.flags?.[SCOPE]?.missile;
  if (!mt || !f) return;
  const target = scene.tokens.get(f.targetTokenId)?.actor;

  if (kind === "intercept") {
    const res = interceptResult((await new Roll("1d10").evaluate()).total, 0);
    if (res.outcome === "destroyed") {
      await ChatMessage.create({ content: `<div class="cyberpunk save-prompt"><h3>🛡 Anti-missile — ${f.weaponName} DESTROYED</h3></div>` });
      await mt.delete().catch(() => {});
    } else if (res.outcome === "burst") {
      await mt.update({ [`flags.${SCOPE}.missile.intercepted`]: "burst" });
      await ChatMessage.create({ content: `<div class="cyberpunk save-prompt"><h3>🛡 Anti-missile — detonated early</h3><div class="save-info">${f.weaponName} will hit at HALF damage & Penetration.</div></div>` });
    } else {
      await ChatMessage.create({ content: `<div class="cyberpunk save-prompt"><h3>🛡 Anti-missile — MISSED</h3><div class="save-info">${f.weaponName} still inbound.</div></div>` });
    }
    return;
  }

  let add = 0, label = "";
  if (kind === "evade") { add = 2; label = "Evasive maneuver (+2)"; }
  else {
    const best = _bestCountermeasure(target?.system?.countermeasures ?? [], f.homingMethod);
    if (!best.cm) { ui.notifications?.warn?.("No countermeasure defeats this missile's homing method."); return; }
    add = best.mod; label = `${best.cm} (+${best.mod})`;
  }
  const cur = Number(f.difficultyMods) || 0;
  await mt.update({ [`flags.${SCOPE}.missile.difficultyMods`]: cur + add });
  await ChatMessage.create({ content: `<div class="cyberpunk save-prompt"><h3>🎆 Countermeasure — ${label}</h3><div class="save-info">vs ${f.weaponName}: to-hit Difficulty now +${cur + add}.</div></div>` });
}

/** Auto-advance missiles each combat round (active GM only) + inject the Missiles-in-Flight panel. */
export function registerMissileFlightHooks() {
  // Reaction buttons on the Incoming-Missile card (+ GM reveal from the tracker panel).
  document.addEventListener("click", async (ev) => {
    const cm = ev.target.closest?.(".cp-missile-cm");
    const ev2 = ev.target.closest?.(".cp-missile-evade");
    const ic = ev.target.closest?.(".cp-missile-intercept");
    const rv = ev.target.closest?.(".cp-missile-reveal");
    const st = ev.target.closest?.(".cp-missile-step");
    const btn = cm || ev2 || ic || rv || st;
    if (!btn || btn.disabled) return;
    ev.preventDefault();
    btn.disabled = true;
    const tokenId = btn.dataset.tokenId;
    if (cm) await _applyMissileReaction(tokenId, "countermeasure");
    else if (ev2) await _applyMissileReaction(tokenId, "evade");
    else if (ic) await _applyMissileReaction(tokenId, "intercept");
    else if (st) await advanceOneMissile(canvas?.scene, tokenId);
    else if (rv) {
      const mt = canvas?.scene?.tokens?.get(tokenId);
      const f = mt?.flags?.[SCOPE]?.missile;
      if (mt && f) { await mt.update({ hidden: false, [`flags.${SCOPE}.missile.detected`]: true }); await _postIncomingCard(mt, f, canvas.scene.tokens.get(f.targetTokenId), "revealed by GM"); }
    }
  });

  Hooks.on("updateCombat", async (combat, changed) => {
    if (!game.user?.isGM || game.users?.activeGM?.id !== game.user.id) return;
    if (changed.round === undefined) return;    // once per round
    await advanceMissiles(undefined, Number(combat.round) || 0);
  });

  Hooks.on("renderCombatTracker", (tracker, html) => {
    const root = html instanceof jQuery ? html[0] : (Array.isArray(html) ? html[0] : html);
    if (!root?.querySelector) return;
    root.querySelector(".cp-missiles-panel")?.remove();
    const scene = canvas?.scene;
    const missiles = scene ? scene.tokens.filter(t => t.flags?.[SCOPE]?.missile) : [];
    if (!missiles.length) return;
    const rows = missiles.map(mt => {
      const f = mt.flags[SCOPE].missile;
      const tgt = scene.tokens.get(f.targetTokenId)?.name ?? "?";
      const det = f.detected ? "" : (game.user.isGM
        ? ` <span style="opacity:0.6;">(undetected)</span> <button class="cp-missile-reveal" data-token-id="${mt.id}" title="Reveal this missile to its target (GM)" style="font-size:0.72em;padding:0 4px;">👁</button>`
        : ' <span style="opacity:0.6;">(undetected)</span>');
      const adv = game.user.isGM
        ? ` <button class="cp-missile-step" data-token-id="${mt.id}" title="Advance this missile one turn (manual)" style="font-size:0.72em;padding:0 4px;">▶</button>`
        : "";
      return `<li class="cp-missile-row" data-token-id="${mt.id}" style="cursor:pointer;font-size:0.82em;padding:2px 4px;">🚀 <b>${f.weaponName}</b> → ${tgt} · ${f.guidance} · <b>${f.turnsToImpact}</b>t${det}${adv}</li>`;
    }).join("");
    const panel = document.createElement("div");
    panel.className = "cp-missiles-panel";
    panel.innerHTML = `<h4 style="margin:6px 0 2px;border-top:1px solid var(--color-border-dark-tertiary);padding-top:4px;">🚀 Missiles in Flight</h4><ul style="list-style:none;margin:0;padding:0;">${rows}</ul>`;
    (root.querySelector("#combat-tracker") ?? root.querySelector(".combat-tracker") ?? root).appendChild(panel);
    panel.querySelectorAll(".cp-missile-row").forEach(el => el.addEventListener("click", (ev) => {
      if (ev.target.closest("button")) return;   // row buttons (reveal/advance) handle their own clicks
      const t = canvas?.tokens?.get(el.dataset.tokenId);
      if (t) { try { t.control({ releaseOthers: true }); canvas.animatePan({ x: t.center.x, y: t.center.y }); } catch {} }
    }));
  });
}
