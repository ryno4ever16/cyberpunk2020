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
import { missileSpeed, turnsToImpact, resolveMissileToHit, resolvePaintHit } from "./vehicle-missiles.js";

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
const _gridDist = (scene) => Number(scene?.grid?.distance) || 1;
/** Centre of a TokenDocument in pixels (document fields only — no reliance on a rendered placeable). */
function _docCenter(doc, gs) { return { x: doc.x + (doc.width * gs) / 2, y: doc.y + (doc.height * gs) / 2 }; }
const _headingDeg = (from, to) => Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;

/**
 * Launch a guided missile toward a target token. Spawns a hidden missile token at the shooter,
 * stores the flight + to-hit state, and computes turns-to-impact from distance ÷ missile speed.
 * @returns {Promise<TokenDocument|null>}
 */
export async function launchMissile({ scene: sceneArg, shooterToken, targetToken, missile = {} } = {}) {
  if (!mmEnabled()) return null;
  const scene = sceneArg ?? canvas?.scene;
  if (!scene || !shooterToken || !targetToken) return null;
  const sDoc = shooterToken.document ?? shooterToken;
  const tDoc = targetToken.document ?? targetToken;
  const gs = _gridSize(scene);
  const proxy = await _ensureMissileActor();

  const sc = _docCenter(sDoc, gs), tc = _docCenter(tDoc, gs);
  const distM = (Math.hypot(tc.x - sc.x, tc.y - sc.y) / gs) * _gridDist(scene);
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
    speed, turnsToImpact: tti, totalTurns: tti, detected: false, launchRound: game.combat?.round ?? 0,
  };

  const [tok] = await scene.createEmbeddedDocuments("Token", [{
    name: flight.weaponName, actorId: proxy.id, actorLink: false,
    x: sc.x - gs * 0.25, y: sc.y - gs * 0.25, width: 0.5, height: 0.5,
    texture: { src: MISSILE_IMG }, rotation: _headingDeg(sc, tc) + MISSILE_ART_OFFSET,
    hidden: true, disposition: -1,
    flags: { [SCOPE]: { missile: flight } },
  }]);

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: shooterToken.actor ?? undefined }),
    content: `<div class="cyberpunk save-prompt"><h3>🚀 ${flight.weaponName} launched</h3><div class="save-info">${sDoc.name ?? "Firer"} → ${tDoc.name ?? "target"}. Impact in <b>${tti}</b> turn${tti !== 1 ? "s" : ""} (${flight.guidance}).</div></div>`,
  });
  ui.combat?.render();
  return tok;
}

/** Advance every in-flight missile one combat round; resolve those reaching impact. (Active GM.) */
export async function advanceMissiles(scene = canvas?.scene) {
  if (!scene) return;
  const gs = _gridSize(scene);
  const missiles = scene.tokens.filter(t => t.flags?.[SCOPE]?.missile);
  for (const mt of missiles) {
    const f = mt.flags[SCOPE].missile;
    const targetDoc = scene.tokens.get(f.targetTokenId);
    if (!targetDoc) { await mt.delete().catch(() => {}); continue; }   // target gone → missile lost
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
  ui.combat?.render();
}

async function _resolveMissileImpact(f, targetDoc, scene, gs) {
  const target = targetDoc.actor;
  const d10 = (await new Roll("1d10").evaluate()).total;
  const hit = f.guidance === "paint"
    ? resolvePaintHit(d10)
    : resolveMissileToHit({ guidance: f.guidance, d10, operatorBonus: f.operatorBonus, missileSkill: f.missileSkill, targetNumber: f.targetNumber }).hit;

  if (!hit || !target) {
    await ChatMessage.create({ content: `<div class="cyberpunk save-prompt"><h3>🚀 ${f.weaponName} — MISS</h3><div class="save-info">at ${targetDoc.name ?? "target"}.</div></div>` });
    return;
  }
  const { dispatchAttack, detectFacingFromTokens } = await import("./vehicle-targeting.js");
  const shooterDoc = scene.tokens.get(f.shooterTokenId);
  const facing = (shooterDoc?.object && targetDoc.object) ? detectFacingFromTokens(shooterDoc.object, targetDoc.object) : "front";
  await dispatchAttack({
    scale: "penetration", penetration: f.penetration, ap: f.ap, heat: f.heat, hefPenetrator: f.hefPenetrator,
    weaponName: f.weaponName, facing, targetTokenId: targetDoc.id,
  }, target);
}

/** Auto-advance missiles each combat round (active GM only) + inject the Missiles-in-Flight panel. */
export function registerMissileFlightHooks() {
  Hooks.on("updateCombat", async (combat, changed) => {
    if (!game.user?.isGM || game.users?.activeGM?.id !== game.user.id) return;
    if (changed.round === undefined) return;    // once per round
    await advanceMissiles();
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
      const det = f.detected ? "" : ' <span style="opacity:0.6;">(undetected)</span>';
      return `<li class="cp-missile-row" data-token-id="${mt.id}" style="cursor:pointer;font-size:0.82em;padding:2px 4px;">🚀 <b>${f.weaponName}</b> → ${tgt} · ${f.guidance} · <b>${f.turnsToImpact}</b>t${det}</li>`;
    }).join("");
    const panel = document.createElement("div");
    panel.className = "cp-missiles-panel";
    panel.innerHTML = `<h4 style="margin:6px 0 2px;border-top:1px solid var(--color-border-dark-tertiary);padding-top:4px;">🚀 Missiles in Flight</h4><ul style="list-style:none;margin:0;padding:0;">${rows}</ul>`;
    (root.querySelector("#combat-tracker") ?? root.querySelector(".combat-tracker") ?? root).appendChild(panel);
    panel.querySelectorAll(".cp-missile-row").forEach(el => el.addEventListener("click", () => {
      const t = canvas?.tokens?.get(el.dataset.tokenId);
      if (t) { try { t.control({ releaseOthers: true }); canvas.animatePan({ x: t.center.x, y: t.center.y }); } catch {} }
    }));
  });
}
