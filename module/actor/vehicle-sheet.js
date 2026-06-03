import { openControlRollDialog } from "../vehicle/vehicle-control.js";
import { openVehicleDamageDialog } from "../vehicle/vehicle-damage.js";

/**
 * Vehicle / ACPA actor sheet (Phase 1-3).
 *
 * Deliberately separate from CyberpunkActorSheet — vehicles have no skills/wound-track/
 * cyberware tabs. Shows a single SP in Core mode and all five facings under Maximum Metal
 * (the vehicleRuleSystem toggle). Derived Armor Value / Body Value are read-only.
 *
 * There is no "Deploy to Canvas" button: a vehicle is placed by dragging the actor onto the
 * canvas like any other actor. The prototype-token defaults (see vehicle-canvas.js preCreateActor)
 * make that drag produce a correctly sized, low-sorted, art-fitted, vehicle-flagged token.
 */
export class CyberpunkVehicleSheet extends ActorSheet {

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["cyberpunk", "sheet", "actor", "vehicle"],
      template: "systems/cyberpunk2020/templates/actor/vehicle-sheet.hbs",
      width: 560,
      height: 560,
    });
  }

  /** @override */
  getData(options) {
    const data = super.getData(options);
    data.system   = this.actor.system;
    data.owner    = this.actor.isOwner;
    data.editable = this.isEditable ?? this.options?.editable ?? false;

    let rule = "Core";
    try { rule = game.settings.get("cyberpunk2020", "vehicleRuleSystem"); } catch (e) { /* settings not ready */ }
    data.ruleSystem = rule;
    data.isMM = rule === "MaximumMetal";
    try { data.controlEnabled = game.settings.get("cyberpunk2020", "vehicleControlEnabled"); } catch (e) { data.controlEnabled = true; }
    try { data.damageEnabled = game.settings.get("cyberpunk2020", "vehicleDamageEnabled"); } catch (e) { data.damageEnabled = true; }

    data.vehicleTypes = ["car", "sportscar", "limo", "AV-4", "AV-6", "AV-7", "cycle", "truck", "rotor", "osprey", "boat", "tank", "APC", "acpa"];
    return data;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    const root = html instanceof jQuery ? html[0] : html;
    root?.querySelector?.(".cp-control-roll")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      openControlRollDialog(this.actor);
    });
    root?.querySelector?.(".cp-vehicle-damage")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      openVehicleDamageDialog(this.actor);
    });
  }
}
