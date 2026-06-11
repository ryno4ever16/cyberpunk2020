import { CyberpunkActor } from "./actor/actor.js";
import { CyberpunkActorSheet } from "./actor/actor-sheet.js";
import { CyberpunkVehicleSheet } from "./actor/vehicle-sheet.js";
import { registerShopHooks } from "./shop/catalog.js";
import { migrateShopActorsToDefs } from "./shop/shops.js";
import { registerIpHooks } from "./ip/ip.js";
import { openIpTracker } from "./ip/tracker.js";
import { ipSystem } from "./settings.js";
import { CyberpunkItem } from "./item/item.js";
import { CyberpunkItemSheet } from "./item/item-sheet.js";
import { CyberpunkCharacterData, CyberpunkNpcData, CyberpunkVehicleActorData } from "./data/actor-data.js";
import {
    CyberpunkAcpaSystemData,
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
import { seedAcpaSystemCompendium, ensureAcpaSystemSeed } from "./vehicle/vehicle-acpa-catalog.js";
import { registerVehicleTargetingHandlers } from "./vehicle/vehicle-targeting.js";
import { registerMissileFlightHooks } from "./vehicle/vehicle-missile-flight.js";
import { registerPopoutCompat } from "./popout-compat.js";
import { registerShimmerOnReopen } from "./shimmer.js";
import { openAcpaMeleeDialog, registerAcpaCombatHooks, repairAcpa } from "./vehicle/vehicle-acpa-combat.js";

Hooks.once('init', async function () {

    // Shimmer any window that's re-opened while already on screen (actor/item/compendium sheets, …).
    registerShimmerOnReopen();

    // Place classes in system namespace for later reference.
    game.cyberpunk = {
        entities: {
            CyberpunkActor,
            CyberpunkItem,
        },
        // A manual migrateworld.
        migrateWorld: migrations.migrateWorld,
        // Vehicle API: deploy a scalable handle token, board/disembark crew, and roll control/maneuver.
        vehicles: { deploy: deployVehicleToScene, board: boardVehicle, disembark, controlRoll: openControlRollDialog, applyDamage: openVehicleDamageDialog, weaponToPen: weaponToPenetration, toHitMod: vehicleToHitModifier, fire: openVehicleFireDialog, seedWeapons: seedVehicleWeaponCompendium, seedAcpaSystems: seedAcpaSystemCompendium, acpaMelee: openAcpaMeleeDialog, acpaRepair: repairAcpa },
        // IP tracker API: open the GM Improvement-Points tracker.
        ip: { openTracker: openIpTracker }
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
    CONFIG.Item.dataModels.acpaSystem = CyberpunkAcpaSystemData;
    CONFIG.Item.dataModels.misc = CyberpunkMiscData;

    // Register sheets, unregister original core sheets
    // v15-readiness: globals ActorSheet/ItemSheet/Actors/Items are removed in v15; use the
    // namespaced forms, falling back to the bare globals on cores that lack them (v13).
    const _Actors = foundry?.documents?.collections?.Actors ?? Actors;
    const _Items = foundry?.documents?.collections?.Items ?? Items;
    const _ActorSheetV1 = foundry?.appv1?.sheets?.ActorSheet ?? ActorSheet;
    const _ItemSheetV1 = foundry?.appv1?.sheets?.ItemSheet ?? ItemSheet;
    _Actors.unregisterSheet("core", _ActorSheetV1);
    _Actors.registerSheet("cyberpunk2020", CyberpunkActorSheet, { types: ["character", "npc"], makeDefault: true });
    _Actors.registerSheet("cyberpunk2020", CyberpunkVehicleSheet, { types: ["vehicle"], makeDefault: true });
    _Items.unregisterSheet("core", _ItemSheetV1);
    _Items.registerSheet("cyberpunk2020", CyberpunkItemSheet, { makeDefault: true });

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
          // PopOut!: measure against the element's OWN window, not the main one.
          const view = el.ownerDocument.defaultView || window;
          left = Math.max(8, Math.min(left, view.innerWidth - tr.width - 8));

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

          // PopOut!: create + mount in the hovered element's OWN document, not the main window.
          const tipDoc = el.ownerDocument;
          tip = tipDoc.createElement("div");
          tip.className = "cp-dice-tooltip";
          tip.innerHTML = tooltipHTML;
          tipDoc.body.appendChild(tip);

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
  // PopOut! compat: bind our global chat-card click delegators onto every popped-out window too.
  registerPopoutCompat();

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

  // Register ACPA per-round status ticks (seize-up / interface-out countdowns).
  registerAcpaCombatHooks();

  // Register shopping hooks (published-shop chat links + GM stock-depletion relay).
  registerShopHooks();

  // One-time: migrate any legacy `shop`-type Actors into world-data ShopDefs, then drop them (round-7).
  migrateShopActorsToDefs();

  // Register IP-tracker hooks (skill-roll auto-queue + GM relay).
  registerIpHooks();

  // Seed the Vehicle Weapons (MM) compendium from the verified catalog if it's empty (active GM only).
  ensureVehicleWeaponSeed();

  // Seed the ACPA Systems (MM) compendium from the verified catalog if it's empty (active GM only).
  ensureAcpaSystemSeed();

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

/**
 * Add an "IP Tracker" button to the Actors sidebar header for the GM when the IP system is on.
 */
Hooks.on("renderActorDirectory", (app, html) => {
  try {
    if (!game.user.isGM || ipSystem() === "disabled") return;
    const root = html instanceof jQuery ? html[0] : html;
    if (!root || root.querySelector(".cp-ip-tracker-btn")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cp-ip-tracker-btn";
    btn.style.cssText = "flex:0 0 auto; margin:4px;";
    btn.innerHTML = `<i class="fas fa-graduation-cap"></i> ${game.i18n.localize("CYBERPUNK.IpTrackerTitle")}`;
    btn.addEventListener("click", () => openIpTracker());
    const header = root.querySelector(".directory-header") ?? root.querySelector(".header-actions") ?? root.firstElementChild ?? root;
    header.prepend(btn);
  } catch (e) { /* non-fatal */ }
});
