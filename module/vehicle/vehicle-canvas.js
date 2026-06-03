/**
 * Vehicle canvas representation — Idea A (Phase 2).
 *
 * A vehicle is shown on the canvas as a scalable **Tile** (the art) locked over a near-invisible
 * **handle Token** (alpha 0) linked to the vehicle Actor. The token is the combat object —
 * targetable, carries the SDP bar, and is caught by the area-effect token sweeps. The TILE is the
 * single control surface: dragging / rotating / scaling the tile drives the handle token and any
 * "boarded" crew tokens (one-directional, so there are no sync loops).
 *
 *   tile.flags.cyberpunk2020 = { vehicleTokenId, vehicleActorId }
 *   token.flags.cyberpunk2020 = { vehicleHandle: true, vehicleTileId }
 *   crewToken.flags.cyberpunk2020.boardedVehicle = <vehicleActorId>
 */

const SCOPE = "cyberpunk2020";

/**
 * Place a vehicle on a scene: create the handle token + the art tile, link them.
 * @param {Actor} actor  a `vehicle`-type actor
 * @param {{scene?:Scene, x?:number, y?:number, gw?:number, gh?:number}} [opts]
 *        gw/gh = footprint in grid units (default 4×2). x/y = top-left in px (default scene centre).
 * @returns {Promise<{tokenId:string, tileId:string}|null>}
 */
export async function deployVehicleToScene(actor, opts = {}) {
  const scene = opts.scene ?? canvas?.scene;
  if (!actor || actor.type !== "vehicle" || !scene) return null;

  const gridSize = scene.grid?.size ?? canvas?.grid?.size ?? 100;
  const gw = Math.max(1, Number(opts.gw) || 4);
  const gh = Math.max(1, Number(opts.gh) || 2);
  const wpx = gw * gridSize, hpx = gh * gridSize;
  const px = opts.x ?? Math.round(((scene.width ?? 2000) - wpx) / 2);
  const py = opts.y ?? Math.round(((scene.height ?? 2000) - hpx) / 2);

  // Handle token: invisible, footprint gw×gh, linked to the vehicle actor (combat handle).
  const [tokenDoc] = await scene.createEmbeddedDocuments("Token", [{
    name: actor.name, actorId: actor.id, actorLink: true,
    x: px, y: py, width: gw, height: gh, alpha: 0, disposition: 0,
    flags: { [SCOPE]: { vehicleHandle: true } },
  }]);

  // Art tile: same position/footprint, the vehicle's image.
  const [tileDoc] = await scene.createEmbeddedDocuments("Tile", [{
    texture: { src: actor.img },
    x: px, y: py, width: wpx, height: hpx,
    flags: { [SCOPE]: { vehicleTokenId: tokenDoc.id, vehicleActorId: actor.id } },
  }]);

  await tokenDoc.update({ [`flags.${SCOPE}.vehicleTileId`]: tileDoc.id });
  return { tokenId: tokenDoc.id, tileId: tileDoc.id };
}

/** Mark a crew token as riding a vehicle (so it moves with the vehicle). */
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
 * Register the tile→token+crew movement coupling. The tile is the control surface; the handle
 * token mirrors its position/rotation/size, and boarded crew translate by the same delta.
 * Gated on the active GM so only one client applies the coupled moves.
 */
export function registerVehicleCanvasHooks() {
  Hooks.on("updateTile", async (tileDoc, change, options) => {
    if (options?.cp2020VehicleSync) return;                    // ignore our own echo
    if (game.users.activeGM?.id !== game.user.id) return;      // one client applies the coupling
    const f = tileDoc.flags?.[SCOPE];
    if (!f?.vehicleTokenId) return;

    const scene = tileDoc.parent;
    const token = scene?.tokens?.get(f.vehicleTokenId);
    if (!token) return;
    const gridSize = scene.grid?.size ?? canvas?.grid?.size ?? 100;

    // Token and tile share a top-left, so the token's current x/y is the tile's OLD x/y.
    const upd = {};
    let dx = 0, dy = 0;
    if (change.x !== undefined)        { dx = change.x - token.x; upd.x = change.x; }
    if (change.y !== undefined)        { dy = change.y - token.y; upd.y = change.y; }
    if (change.rotation !== undefined) upd.rotation = change.rotation;
    if (change.width !== undefined)    upd.width  = Math.max(1, Math.round(change.width  / gridSize));
    if (change.height !== undefined)   upd.height = Math.max(1, Math.round(change.height / gridSize));
    if (Object.keys(upd).length) await token.update(upd, { cp2020VehicleSync: true });

    // Translate boarded crew by the same delta.
    if (dx || dy) {
      const crew = scene.tokens.filter(t => t.flags?.[SCOPE]?.boardedVehicle === f.vehicleActorId);
      const crewUpd = crew.map(t => ({ _id: t.id, x: t.x + dx, y: t.y + dy }));
      if (crewUpd.length) await scene.updateEmbeddedDocuments("Token", crewUpd, { cp2020VehicleSync: true });
    }
  });

  // When the linked tile/token is deleted, clean up the partner so no orphan remains.
  Hooks.on("deleteTile", async (tileDoc) => {
    if (game.users.activeGM?.id !== game.user.id) return;
    const tid = tileDoc.flags?.[SCOPE]?.vehicleTokenId;
    const tok = tid ? tileDoc.parent?.tokens?.get(tid) : null;
    if (tok) await tok.delete().catch(() => {});
  });
}
