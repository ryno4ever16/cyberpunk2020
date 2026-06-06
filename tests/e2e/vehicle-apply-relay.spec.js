import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Vehicle damage — player → GM socket relay (connected-client correctness).
 *
 * Applying vehicle damage writes the vehicle actor. A player firing at a GM-owned vehicle cannot call
 * actor.update() on it, so dispatchAttack relays the attack to the active GM (mirroring the personnel
 * apply-damage relay in §16 / apply-damage-routing.spec.js). This proves:
 *   1. The player genuinely CANNOT modify the unowned vehicle directly (permission boundary).
 *   2. dispatchAttack against that vehicle does NOT throw on the player's client (it relays, returns true).
 *   3. The GM (active) receives the relay and applies the damage — the vehicle's SDP drops once.
 *      (A Pen-30 hit at a 0-armor vehicle penetrates in both rulesets: Core subtracts to SDP, Maximum
 *       Metal rolls Catastrophic → SDP 0. Either way sdp.value ends below the starting value.)
 *
 * Without the relay, the player's direct write throws a permission error and the damage is silently lost.
 */

test.describe.configure({ mode: "serial" });

let gmCtx, gmPage;

test.beforeAll(async ({ browser }) => {
  gmCtx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
  gmPage = await gmCtx.newPage();
  await login(gmPage, ACCOUNTS.gm);
  await cleanupTestData(gmPage).catch(() => {});
});

test.afterAll(async () => {
  if (gmPage) await cleanupTestData(gmPage).catch(() => {});
  if (gmCtx) await gmCtx.close();
});

test("player firing at a GM-owned vehicle relays the damage to the GM", async ({ browser }) => {
  const START_SDP = 50;
  // GM creates a vehicle visible (OBSERVER) but not modifiable by players, with no armor + known SDP.
  const setup = await evalGameOrThrow(gmPage, async (arg) => {
    const OBSERVER = CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER; // 2
    const veh = await Actor.create({
      name: "__PW__EnemyVehicle", type: "vehicle",
      flags: { cyberpunk2020: { __pwtest: true } },
      ownership: { default: OBSERVER },
      system: { sp: { front: 0, side: 0, rear: 0, top: 0, bottom: 0 }, sdp: { value: arg.sdp, max: arg.sdp } },
    });
    return { vehId: veh.id };
  }, { sdp: START_SDP });

  const playerCtx = await browser.newContext({ viewport: { width: 1400, height: 800 }, ignoreHTTPSErrors: true });
  const playerPage = await playerCtx.newPage();
  try {
    await login(playerPage, ACCOUNTS.player1);

    const playerResult = await evalGameOrThrow(playerPage, async (arg) => {
      const out = {};
      const veh = game.actors.get(arg.vehId);
      out.vehVisible = !!veh;
      out.canModify = veh ? veh.canUserModify(game.user, "update") : null;

      // (1) Direct write is forbidden — the relay exists precisely because this throws.
      out.directThrew = false;
      try { await veh.update({ "system.sdp": { value: 1, max: arg.sdp } }); } catch { out.directThrew = true; }
      out.sdpAfterDirect = game.actors.get(arg.vehId)?.system?.sdp?.value ?? null;

      // (2) dispatchAttack against the GM vehicle: the player can't write it, so it relays (no throw).
      const VT = await import("/systems/cyberpunk2020/module/vehicle/vehicle-targeting.js");
      out.dispatchThrew = false;
      try {
        out.handled = await VT.dispatchAttack(
          { scale: "penetration", penetration: 30, facing: "front", weaponName: "__PW__RelayTest" },
          veh
        );
      } catch (e) { out.dispatchThrew = true; out.err = String(e?.message ?? e); }
      return out;
    }, { vehId: setup.vehId, sdp: START_SDP });

    console.log("Player vehicle-relay result:", JSON.stringify(playerResult));

    // Permission boundary + non-throwing relay.
    expect(playerResult.vehVisible, "vehicle visible to the player (OBSERVER)").toBe(true);
    expect(playerResult.canModify, "player must NOT have update permission on the GM vehicle").toBe(false);
    expect(playerResult.directThrew, "a direct write to the unowned vehicle must throw").toBe(true);
    expect(playerResult.sdpAfterDirect, "the failed direct write must not change SDP").toBe(START_SDP);
    expect(playerResult.dispatchThrew, "dispatchAttack must relay (not throw) on the player's client").toBe(false);
    expect(playerResult.handled, "dispatchAttack reports it handled the vehicle attack").toBe(true);

    // (3) GM-side: poll until the relayed damage lands (SDP drops below the start).
    const finalSdp = await evalGameOrThrow(gmPage, async (arg) => {
      const deadline = Date.now() + 12_000;
      let v = game.actors.get(arg.vehId)?.system?.sdp?.value ?? null;
      while (Date.now() < deadline && v === arg.sdp) {
        await new Promise(r => setTimeout(r, 150));
        v = game.actors.get(arg.vehId)?.system?.sdp?.value ?? null;
      }
      return v;
    }, { vehId: setup.vehId, sdp: START_SDP });

    console.log("Vehicle SDP after relay:", finalSdp);
    expect(finalSdp, "the GM applied the relayed vehicle damage (SDP dropped from the start)").toBeLessThan(START_SDP);
  } finally {
    await playerCtx.close();
  }
});
