/**
 * Vehicle canvas representation (Phase 2, corrected).
 *
 * A vehicle is a single **visible Token** showing the vehicle's image, sized to its footprint
 * (the art scales to the box — `texture.fit:"contain"`; resize the token to fit any image). It is
 * the natural movable/selectable/targetable object, and it is AoE-detected like any token. A low
 * `sort` makes crew tokens render on top of it. Crew flagged as "boarded" ride along when the
 * vehicle moves.
 *
 *   vehicleToken.flags.cyberpunk2020.vehicleHandle = true
 *   crewToken.flags.cyberpunk2020.boardedVehicle  = <vehicleActorId>
 */

const SCOPE = "cyberpunk2020";
const VEHICLE_SORT = -100;            // render below crew tokens
/** token.id → {dx,dy} captured in preUpdateToken, consumed in updateToken (same client). */
const _moveDeltas = new Map();

/**
 * Place a vehicle on a scene as a single visible, scalable handle token.
 * Idempotent per (actor, scene): if one already exists it is reused, not stacked.
 * @returns {Promise<{tokenId:string, existing:boolean}|null>}
 */
export async function deployVehicleToScene(actor, opts = {}) {
  const scene = opts.scene ?? canvas?.scene;
  if (!actor || actor.type !== "vehicle" || !scene) return null;

  const existing = scene.tokens.find(t => t.actorId === actor.id && t.flags?.[SCOPE]?.vehicleHandle);
  if (existing) {
    ui.notifications?.info?.(`${actor.name} is already on this scene — resize/move that token.`);
    return { tokenId: existing.id, existing: true };
  }

  const gridSize = scene.grid?.size ?? canvas?.grid?.size ?? 100;
  const gw = Math.max(1, Number(opts.gw) || 4);
  const gh = Math.max(1, Number(opts.gh) || 2);
  const wpx = gw * gridSize, hpx = gh * gridSize;
  const px = opts.x ?? Math.round(((scene.width ?? 2000) - wpx) / 2);
  const py = opts.y ?? Math.round(((scene.height ?? 2000) - hpx) / 2);

  const [tokenDoc] = await scene.createEmbeddedDocuments("Token", [{
    name: actor.name, actorId: actor.id, actorLink: true,
    x: px, y: py, width: gw, height: gh,
    sort: VEHICLE_SORT,                              // crew tokens render on top
    texture: { src: actor.img, fit: "contain" },     // art scales to the footprint
    flags: { [SCOPE]: { vehicleHandle: true } },
  }]);
  return { tokenId: tokenDoc.id, existing: false };
}

/** Mark a crew token as riding a vehicle (it will move with the vehicle). */
export async function boardVehicle(crewTokenDoc, vehicleActor) {
  if (!crewTokenDoc || !vehicleActor) return;
  await crewTokenDoc.update({ [`flags.${SCOPE}.boardedVehicle`]: vehicleActor.id });
}

/** Remove a crew token from a vehicle. */
export async function disembark(crewTokenDoc) {
  if (!crewTokenDoc) return;
  await crewTokenDoc.update({ [`flags.${SCOPE}.-=boardedVehicle`]: null });
}

/**
 * Register the crew-follow coupling: when a vehicle handle token moves, boarded crew translate by
 * the same delta. Gated to the client that made the move (so preUpdate and update share state and
 * only one client applies it). No tiles, no reverse coupling — nothing to loop on.
 */
export function registerVehicleCanvasHooks() {
  Hooks.on("preUpdateToken", (doc, change, options) => {
    if (options?.cp2020VehicleSync) return;
    if (!doc.flags?.[SCOPE]?.vehicleHandle) return;
    const dx = (change.x ?? doc.x) - doc.x;
    const dy = (change.y ?? doc.y) - doc.y;
    if (dx || dy) _moveDeltas.set(doc.id, { dx, dy });
  });

  Hooks.on("updateToken", async (doc, change, options, userId) => {
    const delta = _moveDeltas.get(doc.id);
    if (delta) _moveDeltas.delete(doc.id);
    if (options?.cp2020VehicleSync) return;
    if (userId !== game.user.id) return;             // only the client that performed the move
    if (!doc.flags?.[SCOPE]?.vehicleHandle || !delta || (!delta.dx && !delta.dy)) return;

    const scene = doc.parent;
    const crew = scene.tokens.filter(t => t.flags?.[SCOPE]?.boardedVehicle === doc.actorId);
    const upd = crew.map(t => ({ _id: t.id, x: t.x + delta.dx, y: t.y + delta.dy }));
    if (upd.length) await scene.updateEmbeddedDocuments("Token", upd, { cp2020VehicleSync: true });
  });

  // Sensible prototype-token defaults so dragging a vehicle actor to the canvas also works well.
  Hooks.on("preCreateActor", (actor, data) => {
    if (data?.type !== "vehicle") return;
    try {
      const base = actor.prototypeToken?.toObject?.() ?? {};
      actor.updateSource({ prototypeToken: foundry.utils.mergeObject(base, {
        actorLink: true, width: 4, height: 2, sort: VEHICLE_SORT, texture: { fit: "contain" }
      }, { inplace: false }) });
    } catch (e) { /* non-fatal */ }
  });
}
