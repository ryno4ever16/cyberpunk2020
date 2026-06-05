import { CyberpunkActor } from "./actor/actor.js";
import { CyberpunkActorSheet } from "./actor/actor-sheet.js";
import { CyberpunkVehicleSheet } from "./actor/vehicle-sheet.js";
import { CyberpunkItem } from "./item/item.js";
import { CyberpunkItemSheet } from "./item/item-sheet.js";
import { CyberpunkCharacterData, CyberpunkNpcData, CyberpunkVehicleActorData } from "./data/actor-data.js";
import {
    CyberpunkAmmoData,
    CyberpunkArmorData,
    CyberpunkCyberwareData,
    CyberpunkMiscData,
    CyberpunkProgramData,
    CyberpunkSkillData,
    CyberpunkVehicleData,
    CyberpunkVehicleWeaponData,
    CyberpunkWeaponData
} from "./data/item-data.js";

import { preloadHandlebarsTemplates } from "./templates.js";
import { registerHandlebarsHelpers } from "./handlebars-helpers.js"
import * as migrations from "./migrate.js";
import { registerSystemSettings } from "./settings.js"
import { getHtmlElement } from "./compat.js";
import { registerDamageHooks } from "./combat/damage-hooks.js";
import { registerSaveRollHandlers, postSavePrompts } from "./combat/save-rolls.js";
import { registerVehicleCanvasHooks, deployVehicleToScene, boardVehicle, disembark } from "./vehicle/vehicle-canvas.js";
import { openControlRollDialog } from "./vehicle/vehicle-control.js";
import { openVehicleDamageDialog } from "./vehicle/vehicle-damage.js";
import { weaponToPenetration, vehicleToHitModifier, openVehicleFireDialog, registerVehicleFireHandlers } from "./vehicle/vehicle-weapons.js";
import { seedVehicleWeaponCompendium, ensureVehicleWeaponSeed } from "./vehicle/vehicle-weapon-catalog.js";
import { registerVehicleTargetingHandlers } from "./vehicle/vehicle-targeting.js";
import { registerMissileFlightHooks } from "./vehicle/vehicle-missile-flight.js";

Hooks.once('init', async function () {

    // Place classes in system namespace for later reference.
    game.cyberpunk = {
        entities: {
            CyberpunkActor,
            CyberpunkItem,
        },
        // A manual migrateworld.
        migrateWorld: migrations.migrateWorld,
        // Vehicle API: deploy a scalable handle token, board/disembark crew, and roll control/maneuver.
        vehicles: { deploy: deployVehicleToScene, board: boardVehicle, disembark, controlRoll: openControlRollDialog, applyDamage: openVehicleDamageDialog, weaponToPen: weaponToPenetration, toHitMod: vehicleToHitModifier, fire: openVehicleFireDialog, seedWeapons: seedVehicleWeaponCompendium }
    };

    // Define custom Document classes
    CONFIG.Actor.documentClass = CyberpunkActor;
    CONFIG.Item.documentClass = CyberpunkItem;

    // Register v13/v14 System DataModels.
    // These replace legacy system-template initialization for Actor/Item system data.
    CONFIG.Actor.dataModels.character = CyberpunkCharacterData;
    CONFIG.Actor.dataModels.npc = CyberpunkNpcData;
    CONFIG.Actor.dataModels.vehicle = CyberpunkVehicleActorData;

    CONFIG.Item.dataModels.skill = CyberpunkSkillData;
    CONFIG.Item.dataModels.program = CyberpunkProgramData;
    CONFIG.Item.dataModels.weapon = CyberpunkWeaponData;
    CONFIG.Item.dataModels.ammo = CyberpunkAmmoData;
    CONFIG.Item.dataModels.armor = CyberpunkArmorData;
    CONFIG.Item.dataModels.cyberware = CyberpunkCyberwareData;
    CONFIG.Item.dataModels.vehicle = CyberpunkVehicleData;
    CONFIG.Item.dataModels.vehicleWeapon = CyberpunkVehicleWeaponData;
    CONFIG.Item.dataModels.misc = CyberpunkMiscData;

    // Register sheets, unregister original core sheets
    Actors.unregisterSheet("core", ActorSheet);
    Actors.registerSheet("cyberpunk2020", CyberpunkActorSheet, { types: ["character", "npc"], makeDefault: true });
    Actors.registerSheet("cyberpunk2020", CyberpunkVehicleSheet, { types: ["vehicle"], makeDefault: true });
    Items.unregisterSheet("core", ItemSheet);
    Items.registerSheet("cyberpunk2020", CyberpunkItemSheet, { makeDefault: true });

    // Register System Settings
    registerSystemSettings();

    registerHandlebarsHelpers();

    // Vehicle canvas: tile→token+crew movement coupling (Idea A).
    registerVehicleCanvasHooks();

    // Register and preload templates with Foundry. See templates.js for usage
    preloadHandlebarsTemplates();

    // Fumble inline results
    Hooks.on("renderChatMessage", (message, html) => {
      const root = getHtmlElement(html);
      if (!root?.querySelectorAll) return;

      for (const el of root.querySelectorAll("a.cp-inline-roll")) {
        // avoid double-binding on re-renders
        if (el.dataset.cpInlineBound === "1") continue;
        el.dataset.cpInlineBound = "1";

        // Disable click (no reroll)
        el.addEventListener(
          "click",
          (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            ev.stopImmediatePropagation();
          },
          { capture: true }
        );

        let tip = null;

        const hideTip = () => {
          if (tip) {
            tip.remove();
            tip = null;
          }
        };

        const positionTip = () => {
          if (!tip) return;

          const r = el.getBoundingClientRect();
          const tr = tip.getBoundingClientRect();

          // default: above the number
          let top = r.top - tr.height - 8;
          // if not enough space above: place below
          if (top < 4) top = r.bottom + 8;

          let left = r.left + (r.width / 2) - (tr.width / 2);
          left = Math.max(8, Math.min(left, window.innerWidth - tr.width - 8));

          tip.style.top = `${top}px`;
          tip.style.left = `${left}px`;
        };

        const showTip = async () => {
          hideTip();

          const raw = el.dataset.roll;
          if (!raw) return;

          let roll;
          try {
            roll = Roll.fromJSON(decodeURIComponent(raw));
          } catch (e) {
            return;
          }

          let tooltipHTML = "";
          try {
            tooltipHTML = await roll.getTooltip();
          } catch (e) {
            return;
          }

          if (!tooltipHTML) return;

          tip = document.createElement("div");
          tip.className = "cp-dice-tooltip";
          tip.innerHTML = tooltipHTML;
          document.body.appendChild(tip);

          requestAnimationFrame(() => {
            positionTip();
          });
        };

        el.addEventListener("mouseenter", () => { void showTip(); });
        el.addEventListener("mouseleave", hideTip);
        el.addEventListener("mousemove", positionTip);
      }
    });
});

/**
 * Check whether this world needs a system data migration.
 */
Hooks.once("ready", async function () {
  // Register damage automation hooks (all users)
  registerDamageHooks();

  // Register stun/death save chat button handlers (all users)
  registerSaveRollHandlers();

  // Register the vehicle-fire "Apply to Targeted Vehicle" chat button handler (all users)
  registerVehicleFireHandlers();

  // Register the MM p.8 LUCK-save chat button handler (Penetration weapon vs a person)
  registerVehicleTargetingHandlers();

  // Register guided-missile multi-turn flight (auto-advance per round + Missiles-in-Flight panel)
  registerMissileFlightHooks();

  // Seed the Vehicle Weapons (MM) compendium from the verified catalog if it's empty (active GM only).
  ensureVehicleWeaponSeed();

  if (!game.user.isGM) return;

  // Focused, self-gating ammo-caliber cleanup. Runs on the current world without a version bump
  // and never touches the heavier migrations. Safe to fail — weapons still work via runtime
  // caliber normalization, so a hiccup here can never make a user think they've lost data.
  try {
    await migrations.migrateAmmoCalibers();
  } catch (err) {
    console.error("Cyberpunk2020 | ammo caliber cleanup failed (weapons still function normally)", err);
  }

  const TARGET_VERSION = game.system.version;

  const stored = game.settings.get("cyberpunk2020", "systemMigrationVersion") || "";

  const worldSystemVersion = game.world?.systemVersion || "";

  // Use worldSystemVersion as a baseline for worlds that predate the explicit migration marker.
  const baseline = stored || worldSystemVersion || "0";

  const needsMigration = foundry.utils.isNewerVersion(TARGET_VERSION, baseline);

  if (!needsMigration) {
    if (!stored) {
      await game.settings.set("cyberpunk2020", "systemMigrationVersion", TARGET_VERSION);
    }
    return;
  }

  await migrations.migrateWorld(TARGET_VERSION);
});

/**
 * Fire stun/death save prompts whenever actor damage changes —
 * including manual edits on the character sheet.
 *
 * We check that:
 *  - damage actually increased (not a heal)
 *  - the actor is a character (not an NPC without wound states)
 *  - the user is the GM or owns the actor (avoid duplicate prompts)
 */
Hooks.on("updateActor", async (actor, changes, options, userId) => {
  // Only the user who made the change fires the prompt (avoids duplicates)
  if (userId !== game.user.id) return;
  // Only fire if damage changed
  const newDamage = foundry.utils.getProperty(changes, "system.damage");
  if (newDamage === undefined) return;
  // Only increase triggers saves (heals don't)
  const oldDamage = actor._source?.system?.damage ?? 0;
  if (newDamage <= oldDamage) return;
  // Skip if this update came from our own DamageDialog/auto-apply
  // (those already call postSavePrompts directly after writing HP)
  if (options?.fromCyberpunkDamageSystem) return;

  await postSavePrompts(actor);
});
