import { openControlRollDialog } from "../vehicle/vehicle-control.js";
import { openVehicleDamageDialog } from "../vehicle/vehicle-damage.js";
import { openVehicleFireDialog } from "../vehicle/vehicle-weapons.js";

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

    // ── Weapon mounts ──────────────────────────────────────────────────────
    // The mount array is edited by rebuilding it from the DOM and writing the whole array (this
    // sidesteps Foundry's flaky per-index array form coercion). Each mount is a plain object.
    const readMounts = () => Array.from(root?.querySelectorAll?.(".cp-mount-row") ?? []).map(row => {
      const get = (f) => row.querySelector(`.cp-mount-field[data-field="${f}"]`)?.value ?? "";
      return { name: get("name"), penetration: Number(get("penetration")) || 0, rof: Number(get("rof")) || 1, arc: get("arc") || "fixed-fwd" };
    });
    const writeMounts = (mounts) => this.actor.update({ "system.weaponMounts": mounts });

    root?.querySelector?.(".cp-mount-add")?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const mounts = [...(this.actor.system.weaponMounts ?? [])];
      mounts.push({ name: "Weapon", penetration: 0, rof: 1, arc: "fixed-fwd" });
      await writeMounts(mounts);
    });
    root?.querySelectorAll?.(".cp-mount-field").forEach(el => el.addEventListener("change", () => writeMounts(readMounts())));
    root?.querySelectorAll?.(".cp-mount-remove").forEach(btn => btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const idx = Number(ev.currentTarget.dataset.mountIndex);
      const mounts = [...(this.actor.system.weaponMounts ?? [])];
      if (idx >= 0 && idx < mounts.length) { mounts.splice(idx, 1); await writeMounts(mounts); }
    }));
    root?.querySelectorAll?.(".cp-mount-fire").forEach(btn => btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const idx = Number(ev.currentTarget.dataset.mountIndex);
      const mount = (this.actor.system.weaponMounts ?? [])[idx];
      if (mount) openVehicleFireDialog(this.actor, mount);
    }));
  }
}
