import { openControlRollDialog } from "../vehicle/vehicle-control.js";
import { openVehicleDamageDialog } from "../vehicle/vehicle-damage.js";
import { openVehicleFireDialog } from "../vehicle/vehicle-weapons.js";
import { openAcpaMeleeDialog, repairAcpa } from "../vehicle/vehicle-acpa-combat.js";
import { REALITY_INTERFACES, REFLEX_CONTROLS } from "../vehicle/vehicle-acpa.js";
import { acpaSystemsSummary, acpaAreaSpaces, acpaSpacesOver, acpaBuildIssues } from "../vehicle/vehicle-acpa-systems.js";
import { effectiveVehicleRuleSystem, mmEnabled } from "../settings.js";

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

  /**
   * @override
   * Powered armor (isACPA) renders a dedicated ACPA layout; standard vehicles render the vehicle
   * sheet. Same actor type + data model + combat code — only the template differs, so there is no
   * new document type, no migration, and no relaunch. Toggling the ACPA box swaps the sheet on
   * the next render.
   */
  get template() {
    return this.actor?.system?.isACPA
      ? "systems/cyberpunk2020/templates/actor/acpa-sheet.hbs"
      : "systems/cyberpunk2020/templates/actor/vehicle-sheet.hbs";
  }

  /** @override */
  getData(options) {
    const data = super.getData(options);
    data.system   = this.actor.system;
    data.owner    = this.actor.isOwner;
    data.editable = this.isEditable ?? this.options?.editable ?? false;

    let rule = "Core";
    try { rule = effectiveVehicleRuleSystem(); } catch (e) { /* settings not ready */ }
    data.ruleSystem = rule;
    data.isMM = rule === "MaximumMetal";
    try { data.mmOn = mmEnabled(); } catch (e) { data.mmOn = false; }   // master MM toggle: gates MM-only fields
    try { data.controlEnabled = game.settings.get("cyberpunk2020", "vehicleControlEnabled"); } catch (e) { data.controlEnabled = true; }
    try { data.damageEnabled = game.settings.get("cyberpunk2020", "vehicleDamageEnabled"); } catch (e) { data.damageEnabled = true; }

    // "acpa" is intentionally NOT a vehicle type — Powered Armor is marked by the ACPA checkbox
    // (system.isACPA), which is what the data model + resolver key on. Having both was redundant.
    data.vehicleTypes = ["car", "sportscar", "limo", "AV-4", "AV-6", "AV-7", "cycle", "truck", "rotor", "osprey", "boat", "tank", "APC"];

    // Weapons are embedded vehicleWeapon Items (Phase 5b). The vehicle's "mounts" = these Items;
    // the legacy inline system.weaponMounts array is deprecated (unreleased data → no migration).
    data.weapons = (this.actor.itemTypes?.vehicleWeapon ?? this.actor.items.filter(i => i.type === "vehicleWeapon"))
      .map(i => ({ id: i.id, name: i.name, img: i.img, system: i.system }));

    // ACPA build dropdowns (Reality Interface + Reflex/Control). Labels show the key stats inline.
    data.realityInterfaceChoices = Object.values(REALITY_INTERFACES)
      .map(r => ({ key: r.key, label: `${r.label} (SIB ${r.sib >= 0 ? "+" : ""}${r.sib} / DFB ${r.dfb >= 0 ? "+" : ""}${r.dfb})` }));
    data.reflexControlChoices = Object.values(REFLEX_CONTROLS)
      .map(r => ({ key: r.key, label: `${r.label} (REF ${r.refMod >= 0 ? "+" : ""}${r.refMod}, max ${r.maxRef})` }));

    // ACPA non-weapon systems = embedded acpaSystem Items (D-4d). List + per-area spaces budget.
    const sysItems = (this.actor.itemTypes?.acpaSystem ?? this.actor.items.filter(i => i.type === "acpaSystem"));
    data.acpaSystems = sysItems.map(i => ({ id: i.id, name: i.name, img: i.img, system: i.system }));
    try {
      const mounted = sysItems.map(i => ({
        key: i.system?.catalogKey, area: i.system?.area, mount: i.system?.mount,
        spaces: i.system?.spaces, weight: i.system?.weight, cost: i.system?.cost
      }));
      const summary = acpaSystemsSummary(mounted);
      const avail = acpaAreaSpaces(Number(this.actor.system?.str) || 0);
      data.acpaSpaceRows = [["head", "Head"], ["torso", "Torso"], ["rArm", "R.Arm"], ["lArm", "L.Arm"], ["rLeg", "R.Leg"], ["lLeg", "L.Leg"]]
        .map(([k, label]) => ({
          label,
          usedInt: summary.byArea[k].internal, availInt: avail[k].internal, overInt: summary.byArea[k].internal > avail[k].internal,
          usedExt: summary.byArea[k].external, availExt: avail[k].external, overExt: summary.byArea[k].external > avail[k].external,
        }));
      data.acpaSystemsCost = summary.totalCost;

      // Build validation (D-5): SP ≤ 2×STR, weight ≤ chassis capacity, per-area space budgets.
      const str = Number(this.actor.system?.str) || 0;
      const issues = acpaBuildIssues({
        str,
        armorSP: Number(this.actor.system?.sp?.front) || 0,
        totalWeight: Number(this.actor.system?.totalWeight) || 0,
        chassisCapacity: Number(this.actor.system?.lift) || 0,   // derived Lift/Capacity
        spacesOver: acpaSpacesOver(mounted, str),
      });
      data.acpaBuildIssues = issues;
      data.acpaBuildValid = issues.length === 0;
    } catch (e) { data.acpaSpaceRows = []; data.acpaSystemsCost = 0; data.acpaBuildIssues = []; data.acpaBuildValid = true; }
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
    root?.querySelector?.(".cp-acpa-melee")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      openAcpaMeleeDialog(this.actor);
    });
    root?.querySelector?.(".cp-acpa-repair")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      repairAcpa(this.actor);
    });

    // ── Weapon mounts = embedded vehicleWeapon Items (Phase 5b) ─────────────
    // Drag a weapon from the "Vehicle Weapons (MM)" compendium onto the sheet (default ActorSheet
    // drop handling creates the embedded Item), or use Add to create a blank one. Edit opens the
    // weapon's item sheet; the legacy inline weaponMounts UI is retired.
    const getWeapon = (el) => this.actor.items.get(el?.dataset?.weaponId);

    root?.querySelector?.(".cp-weapon-add")?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await this.actor.createEmbeddedDocuments("Item", [{ name: "New Weapon", type: "vehicleWeapon" }]);
    });
    root?.querySelectorAll?.(".cp-weapon-edit").forEach(btn => btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      getWeapon(ev.currentTarget)?.sheet?.render(true);
    }));
    root?.querySelectorAll?.(".cp-weapon-delete").forEach(btn => btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const w = getWeapon(ev.currentTarget);
      if (w) await w.delete();
    }));
    root?.querySelectorAll?.(".cp-weapon-fire").forEach(btn => btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      const w = getWeapon(ev.currentTarget);
      if (!w) return;
      // Adapter to the Phase-5 fire dialog shape; firing is reworked around the Item in 5c/5d.
      openVehicleFireDialog(this.actor, {
        name: w.name, penetration: Number(w.system?.penetration) || 0,
        rof: Number(w.system?.rof) || 1, arc: w.system?.arc || "turret", itemId: w.id
      });
    }));

    // ── ACPA non-weapon systems = embedded acpaSystem Items (D-4d) ──────────
    const getSystem = (el) => this.actor.items.get(el?.dataset?.systemId);
    root?.querySelector?.(".cp-acpa-system-add")?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await this.actor.createEmbeddedDocuments("Item", [{ name: "New System", type: "acpaSystem" }]);
    });
    root?.querySelectorAll?.(".cp-acpa-system-edit").forEach(btn => btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      getSystem(ev.currentTarget)?.sheet?.render(true);
    }));
    root?.querySelectorAll?.(".cp-acpa-system-delete").forEach(btn => btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const s = getSystem(ev.currentTarget);
      if (s) await s.delete();
    }));
  }
}
