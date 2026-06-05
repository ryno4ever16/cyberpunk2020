/**
 * vehicle-area.js — Phase 5e: area weapons (burst + cone).
 *
 * Class B (HE/HEAT shells, GLs, direct rockets) place a circular burst template; Class F
 * (scatter-packs) place a true angular cone (MM p.72-73). Every token in the area is resolved by
 * the unified 5c dispatcher (vehicle → Pen vs Armor; person → MM p.8), with facing detected per
 * token from the firer. The token-in-area test uses PURE geometry (unit-testable); the
 * MeasuredTemplate is placed only for the visual.
 */

const DEG = Math.PI / 180;

/* --------------------------------- PURE geometry --------------------------------- */

/** Is (px,py) within radius r of (cx,cy)? PURE (pixel space). */
export function pointInCircle(px, py, cx, cy, r) {
  const dx = px - cx, dy = py - cy;
  return (dx * dx + dy * dy) <= r * r;
}

/**
 * Is (px,py) inside a cone from (ox,oy) facing dirDeg (screen degrees: 0 = +x/east, clockwise),
 * with half-angle `halfDeg` and reach `range`? PURE (pixel space). The origin point counts inside.
 */
export function pointInCone(px, py, ox, oy, dirDeg, halfDeg, range) {
  const dx = px - ox, dy = py - oy;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return true;
  if (dist > range) return false;
  const angTo = Math.atan2(dy, dx) / DEG;
  let d = (((angTo - dirDeg) % 360) + 360) % 360;
  if (d > 180) d = 360 - d;
  return d <= halfDeg;
}

/* ------------------------------ Canvas template placement ------------------------------ */

/** Meters → pixels for the active scene (grid.size px per grid.distance units). */
function pxPerMeter(scene) {
  const size = Number(scene?.grid?.size) || 100;
  const dist = Number(scene?.grid?.distance) || 1;
  return size / dist;
}

async function placeBurstTemplate(scene, x, y, radiusM) {
  const td = {
    t: "circle", x, y, distance: Math.max(0.5, Number(radiusM) || 0),
    fillColor: "#ff6600", borderColor: "#ff6600",
    flags: { cyberpunk2020: { vehicleArea: true } }
  };
  const [doc] = await scene.createEmbeddedDocuments("MeasuredTemplate", [td]);
  return doc;
}

async function placeConeTemplate(scene, x, y, dirDeg, angleDeg, rangeM) {
  const td = {
    t: "cone", x, y, direction: dirDeg, angle: Math.max(5, Number(angleDeg) || 60),
    distance: Math.max(0.5, Number(rangeM) || 0),
    fillColor: "#ff6600", borderColor: "#ff6600",
    flags: { cyberpunk2020: { vehicleArea: true } }
  };
  const [doc] = await scene.createEmbeddedDocuments("MeasuredTemplate", [td]);
  return doc;
}

const _center = (t) => ({ x: t.center?.x ?? t.x, y: t.center?.y ?? t.y });

/**
 * Resolve an area shot: place the template, find every token inside via pure geometry, and dispatch
 * each through the 5c dispatcher (per-token facing from the firer; the firer is skipped). Returns
 * the list of struck actors. `shape` = {type:"circle", radiusM} | {type:"cone", angleDeg, rangeM, dirDeg}.
 */
export async function resolveAreaShot({ firerToken, origin, shape, payload = {} } = {}) {
  const scene = canvas?.scene;
  if (!scene || !origin) return { struck: [], tokens: 0 };
  const ppm = pxPerMeter(scene);
  const { dispatchAttack, detectFacingFromTokens } = await import("./vehicle-targeting.js");

  let template = null, inside = [];
  const placeables = canvas?.tokens?.placeables ?? [];
  try {
    if (shape.type === "cone") {
      const rangePx = (Number(shape.rangeM) || 0) * ppm, half = (Number(shape.angleDeg) || 60) / 2;
      template = await placeConeTemplate(scene, origin.x, origin.y, shape.dirDeg, shape.angleDeg, shape.rangeM);
      inside = placeables.filter(t => t.actor && pointInCone(_center(t).x, _center(t).y, origin.x, origin.y, shape.dirDeg, half, rangePx));
    } else {
      const rPx = (Number(shape.radiusM) || 0) * ppm;
      template = await placeBurstTemplate(scene, origin.x, origin.y, shape.radiusM);
      inside = placeables.filter(t => t.actor && pointInCircle(_center(t).x, _center(t).y, origin.x, origin.y, rPx));
    }
  } catch (err) {
    console.warn("Cyberpunk2020 | area template placement failed", err);
  }

  const struck = [];
  for (const tok of inside) {
    if (firerToken && tok.id === firerToken.id) continue;      // a weapon doesn't blast its own firer
    const facing = firerToken ? detectFacingFromTokens(firerToken, tok) : (payload.facing || "front");
    await dispatchAttack({ ...payload, facing, targetTokenId: tok.id }, tok.actor);
    struck.push(tok.actor);
  }
  // Remove the visual template after a moment (keeps the scene clean).
  if (template) setTimeout(() => template.delete?.().catch(() => {}), 4000);
  return { struck, tokens: struck.length };
}
