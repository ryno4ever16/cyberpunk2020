import { deployVehicleToScene } from "../vehicle/vehicle-canvas.js";

/**
 * Vehicle / ACPA actor sheet (Phase 1-2).
 *
 * Deliberately separate from CyberpunkActorSheet — vehicles have no skills/wound-track/
 * cyberware tabs. Shows a single SP in Core mode and all five facings under Maximum Metal
 * (the vehicleRuleSystem toggle). Derived Armor Value / Body Value are read-only. The
 * "Deploy to Canvas" button places the art tile + handle token (Idea A).
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

    data.vehicleTypes = ["car", "sportscar", "limo", "AV-4", "AV-6", "AV-7", "cycle", "truck", "rotor", "osprey", "boat", "tank", "APC", "acpa"];
    return data;
  }

  /** @override */
  activateListeners(html) {
    super.activateListeners(html);
    const root = html instanceof jQuery ? html[0] : html;
    root?.querySelector?.(".cp-deploy-vehicle")?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      if (!canvas?.scene) { ui.notifications.warn("Activate a scene first to deploy the vehicle."); return; }
      const res = await deployVehicleToScene(this.actor);
      if (res) ui.notifications.info(`${this.actor.name} deployed to the canvas. Scale/rotate the tile to taste.`);
    });
  }
}
