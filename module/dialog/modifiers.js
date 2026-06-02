import { deepSet, localize, localizeParam } from "../utils.js"
import { fireModes, caliberMatches, normalizeCaliber } from "../lookups.js"
import { createCyberpunkChatMessage, getGMUserIds } from "../compat.js";

/**
 * Dialog used to select attack, range, fire-mode and miscellaneous modifiers.
 * @implements {FormApplication}
 */
 export class ModifiersDialog extends FormApplication {

    /** @override */
      static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
        id: "weapon-modifier",
        classes: ["cyberpunk2020"],
        title: localize("AttackModifiers"),
        template: "systems/cyberpunk2020/templates/dialog/modifiers.hbs",
        width: 500,
        height: "auto",
        weapon: null,
        // Use like [[mod1, mod2], [mod3, mod4, mod5]] etc to add groupings,
        modifierGroups: [],
        targetTokens: [], // id and name for each target token
        // Extra mod field for miscellaneous mod
        extraMod: true,
        showAdvDis: false,
        advantage: false,
        disadvantage: false,
        hiddenAdvantage: false,
        closeOnSubmit: false,

        onConfirm: () => {}
      });
    }
  
    /* -------------------------------------------- */
  
    /**
     * Return a reference to the target attribute
     * @type {String}
     */
    get attribute() {
        return this.options.name;
    }
  
    /* -------------------------------------------- */
  
    /** @override */
    getData() {
      // Woo! This should be much more flexible than the previous implementation
      // My gods did it require thinking about the shape of things, because loosely-typed can be a headache

      const groups = JSON.parse(JSON.stringify(this.options.modifierGroups || []));

      if (this.options.weapon) {
        const sys = this.options.weapon._getWeaponSystem ? this.options.weapon._getWeaponSystem() : this.options.weapon.system;
        const rof = Number(sys?.rof) || 0;
        const shotsLeft = Number(sys?.shotsLeft) || 0;
        groups.forEach(group => {
          group.forEach(mod => {
            if (mod.dataPath === "roundsFired" && (mod.defaultValue === undefined || mod.defaultValue === null || mod.defaultValue === "")) {
              mod.defaultValue = rof;
              if (mod.min === undefined) mod.min = 1;
              if (mod.max === undefined) mod.max = shotsLeft;
            }
          });
        });
      }

      if (this.options.extraMod) {
        const already = groups.some(g =>
          g.some(m => m.dataPath === "extraMod"));
        if (!already) {
          groups.push([{
            localKey: "ExtraModifiers",
            dataPath: "extraMod",
            defaultValue: 0
          }]);
        }
      }

      const defaultValues = {};
      groups.forEach(group => {
        group.forEach(mod => {
          const t = mod.choices ? "select" : (["string","number","boolean"].includes(typeof mod.defaultValue) ? typeof mod.defaultValue : "string");
          mod.fieldPath = `fields/${t}`;
          deepSet(defaultValues, mod.dataPath, mod.defaultValue !== undefined ? mod.defaultValue : "");
        });
      });

      return {
        modifierGroups: groups,
        targetTokens: this.options.targetTokens,
        // You can't refer to indices in FormApplication form entries as far as I know, so let's give them a place to live
        defaultValues,
        isRanged: this.options.weapon?.isRanged?.() ?? false,
        shotsLeft: (this.options.weapon?._getWeaponSystem?.().shotsLeft) ?? (this.options.weapon?.system.shotsLeft) ?? 0,
        showAdvDis: this.options.showAdvDis,
        advantage: this.options.advantage,
        disadvantage: this.options.disadvantage,
        isGM: game.user.isGM
      };
    }

    /** @override */
    activateListeners(html) {
      super.activateListeners(html);

    // RELOAD
    html.find(".reload").on("click", async (ev) => {
      ev.preventDefault();

      const weapon = this.options.weapon;
      if (!weapon) return;

      const sys = weapon._getWeaponSystem?.() ?? weapon.system ?? {};
      const capacity = Number(sys.shots ?? 0);
      const currentLeft = Number(sys.shotsLeft ?? 0);

      // Where weapon fields live (plain weapon vs. weapon-cyberware).
      const weaponFieldPrefix = (weapon.type === "cyberware") ? "system.CyberWorkType.Weapon." : "system.";

      const updateWeaponShotsLeft = async (value) => {
        if (weapon.__setWeaponField) {
          await weapon.__setWeaponField("shotsLeft", value);
          return;
        }

        if (weapon.type === "cyberware") {
          await weapon.update({ "system.CyberWorkType.Weapon.shotsLeft": value });
        } else {
          await weapon.update({ "system.shotsLeft": value });
        }
      };

      // Write several weapon fields at once (used to load a magazine: shots + loaded type).
      const updateWeaponFields = async (fields, opts = { render: false }) => {
        const data = {};
        for (const [k, v] of Object.entries(fields)) data[`${weaponFieldPrefix}${k}`] = v;
        await weapon.update(data, opts);
      };

      // GM audit: show reload in chat for player-controlled characters (not NPCs)
      const gmReloadAudit = async (shotsLeftAfter) => {
        try {
          const actor = weapon.actor;

          // Only players (non-GM) and only Characters (not NPC)
          if (actor && actor.type !== "npc" && !game.user.isGM) {
            const gmRecipients = getGMUserIds();
            if (!gmRecipients.length) return;

            const shotsText = `${shotsLeftAfter}/${capacity}`;

            await createCyberpunkChatMessage({
              speaker: ChatMessage.getSpeaker({ actor }),
              whisper: gmRecipients,
              content: localizeParam("Chat.Reload", {
                actor: actor.name,
                weapon: weapon.name,
                shots: shotsText
              })
            });
          }
        } catch (err) {
          console.warn("Cyberpunk2020 | reload audit message failed", err);
        }
      };

      const applyLocalState = (shotsLeftAfter) => {
        if (weapon.type === "weapon") {
          this.options.weapon.system.shotsLeft = shotsLeftAfter;
        } else if (weapon.type === "cyberware" && weapon.system?.CyberWorkType?.Weapon) {
          this.options.weapon.system.CyberWorkType.Weapon.shotsLeft = shotsLeftAfter;
        }
        html.find('input.number[readonly]').val(shotsLeftAfter);
      };

      const ammoTracking = weapon.actor?.getFlag?.("cyberpunk2020", "ammoTracking") ?? true;
      const ammoItemId = String(sys.ammoItemId ?? "");

      // Free Fire only (tracking OFF) -> reload to capacity for free, no inventory required.
      if (!ammoTracking) {
        await updateWeaponShotsLeft(capacity);
        ui.notifications.info(localize("Reloaded"));
        await gmReloadAudit(capacity);
        applyLocalState(capacity);
        return;
      }

      // Ammo tracking ON: a linked ammo Item with rounds is required — no free refills.
      const actor = weapon.actor;
      if (!ammoItemId) {
        ui.notifications.warn(localize("NoLinkedAmmo"));
        return;
      }

      const ammoItem = actor?.items?.get(ammoItemId);
      if (!ammoItem || ammoItem.type !== "ammo") {
        ui.notifications.warn(localize("NoLinkedAmmo"));
        return;
      }

      // Caliber hard-block: the ammo's caliber must match the weapon's chamber. A blank ammo
      // caliber is a wildcard (back-compat for ammo created before the caliber system existed).
      const weaponCaliber = normalizeCaliber(sys.ammoType ?? "");
      if (!caliberMatches(weaponCaliber, ammoItem.system?.caliber ?? "")) {
        ui.notifications.warn(localizeParam("AmmoCaliberMismatch", {
          weapon: weaponCaliber || "?",
          ammo: normalizeCaliber(ammoItem.system?.caliber ?? "") || "?"
        }));
        return;
      }

      // One type at a time: refuse to load a different ammo over a partially-loaded magazine.
      // The player must Unload first (RAW — you can't mix ammo types in a magazine).
      const loadedId = String(sys.loadedAmmoId ?? "");
      if (currentLeft > 0 && loadedId && loadedId !== ammoItemId) {
        ui.notifications.warn(localize("AmmoUnloadFirst"));
        return;
      }

      const ammoQty = Number(ammoItem.system?.quantity ?? 0);

      if (!Number.isFinite(capacity) || capacity <= 0) {
        ui.notifications.warn("This weapon cannot be reloaded.");
        return;
      }

      const missing = Math.max(0, capacity - currentLeft);
      if (missing <= 0) {
        ui.notifications.info(localize("Reloaded"));
        return;
      }

      if (ammoQty <= 0) {
        ui.notifications.warn(localize("NotEnoughAmmoToReload"));
        return;
      }

      const reloadByMagazines = !!game.settings.get("cyberpunk2020", "reloadByMagazines");

      let ammoToLoad;
      let shotsLeftAfter;
      if (reloadByMagazines) {
        // Whole-magazine reload: a fresh box tops the magazine; partial box gives a partial mag.
        ammoToLoad = Math.min(capacity, ammoQty);
        shotsLeftAfter = ammoToLoad;
      } else {
        // Loose-rounds reload: feed only what's missing; partial fill if inventory runs out,
        // leaving the (now empty) ammo Item in inventory for the player to replenish.
        ammoToLoad = Math.min(missing, ammoQty);
        shotsLeftAfter = currentLeft + ammoToLoad;
      }

      await ammoItem.update(
        { "system.quantity": Math.max(0, ammoQty - ammoToLoad) },
        { render: false }
      );

      // Record the loaded type ("where it came from") plus a snapshot so the rounds keep their
      // damage profile and can be re-created on Unload even if the source item is later deleted.
      const snapObj = ammoItem.toObject();
      const loadedSnap = { name: snapObj.name, img: snapObj.img, system: snapObj.system };
      await updateWeaponFields({
        shotsLeft: shotsLeftAfter,
        loadedAmmoId: ammoItem.id,
        loadedAmmo: loadedSnap
      });

      ui.notifications.info(localize("Reloaded"));
      await gmReloadAudit(shotsLeftAfter);
      applyLocalState(shotsLeftAfter);

      // Keep local loaded-type state coherent for the rest of this dialog session.
      const _wsys = weapon._getWeaponSystem?.() ?? weapon.system;
      if (_wsys) {
        _wsys.loadedAmmoId = ammoItem.id;
        _wsys.loadedAmmo = loadedSnap;
      }
    });

    // UNLOAD — empty the magazine back into inventory so a different ammo type can be loaded.
    html.find(".unload").on("click", async (ev) => {
      ev.preventDefault();

      const weapon = this.options.weapon;
      if (!weapon) return;

      const sys = weapon._getWeaponSystem?.() ?? weapon.system ?? {};
      const currentLeft = Number(sys.shotsLeft ?? 0);

      if (currentLeft <= 0) {
        ui.notifications.info(localize("MagazineAlreadyEmpty"));
        return;
      }

      const weaponFieldPrefix = (weapon.type === "cyberware") ? "system.CyberWorkType.Weapon." : "system.";
      const actor = weapon.actor;
      const loadedId = String(sys.loadedAmmoId ?? "");
      const loadedSnap = sys.loadedAmmo;

      // 1) Return the rounds to the originating ammo Item if it still exists.
      let returnedTo = null;
      if (actor && loadedId) {
        const src = actor.items.get(loadedId);
        if (src && src.type === "ammo") {
          const q = Number(src.system?.quantity ?? 0);
          await src.update({ "system.quantity": q + currentLeft }, { render: false });
          returnedTo = src;
        }
      }

      // 2) Source gone — only NOW create a fresh ammo Item, faithfully from the loaded snapshot.
      if (!returnedTo && actor && loadedSnap && typeof loadedSnap === "object" && loadedSnap.system && Object.keys(loadedSnap).length) {
        const created = await actor.createEmbeddedDocuments("Item", [{
          name: loadedSnap.name || localize("UnloadedRounds"),
          type: "ammo",
          img: loadedSnap.img,
          system: { ...loadedSnap.system, quantity: currentLeft }
        }]);
        returnedTo = created?.[0] ?? null;
      }

      // 3) Empty the magazine and clear the loaded type. loadedAmmo is a required ObjectField,
      //    so reset to {} rather than deleting the key (deletion -> undefined -> validation error).
      //    _getAmmoProps only consults the snapshot when loadedAmmoId is set, so a now-orphaned
      //    snapshot is never used once we clear loadedAmmoId.
      await weapon.update({
        [`${weaponFieldPrefix}shotsLeft`]: 0,
        [`${weaponFieldPrefix}loadedAmmoId`]: "",
        [`${weaponFieldPrefix}loadedAmmo`]: {}
      }, { render: false });

      // Local state for this dialog session.
      const _wsys = weapon._getWeaponSystem?.() ?? weapon.system;
      if (_wsys) {
        _wsys.shotsLeft = 0;
        _wsys.loadedAmmoId = "";
        _wsys.loadedAmmo = {};
      }
      html.find('input.number[readonly]').val(0);

      if (returnedTo) {
        ui.notifications.info(localizeParam("UnloadedToItem", { count: currentLeft, item: returnedTo.name }));
      } else {
        ui.notifications.info(localizeParam("UnloadedNoSource", { count: currentLeft }));
      }
    });

      // Advantage/Disadvantage
      html.find('input.adv, input.dis').on("change", ev => {
        const $el = $(ev.currentTarget);
        if ($el.hasClass("adv") && $el.prop("checked")) html.find("input.dis").prop("checked", false);
        if ($el.hasClass("dis") && $el.prop("checked")) html.find("input.adv").prop("checked", false);
      });

      // Suppressive Fire fields
      // fire mode select
      const $fireMode = html.find(
        'select[name="fields.fireMode"], select[name="fireMode"], .field[data-path="fireMode"] select'
      );

      // collect strings used exclusively for suppression
      const $supRows = $([
        '.field[data-path="zoneWidth"]',
        '.field[data-path="roundsFired"]',
        '.field[data-path="targetsCount"]',
        'input[name="fields.zoneWidth"], input[name="zoneWidth"]',
        'input[name="fields.roundsFired"], input[name="roundsFired"]',
        'input[name="fields.targetsCount"], input[name="targetsCount"]'
      ].join(','), html)
        .map((i, el) => $(el).closest('.field, .form-group')[0])
        .get()
        .reduce((jq, el) => jq.add(el), $());

      // Autofire "rounds to fire" field — shown only for full auto.
      const $autoRows = $([
        '.field[data-path="autoRounds"]',
        'input[name="fields.autoRounds"], input[name="autoRounds"]'
      ].join(','), html)
        .map((i, el) => $(el).closest('.field, .form-group')[0])
        .get()
        .reduce((jq, el) => jq.add(el), $());

      const updateVisibility = () => {
        const mode = $fireMode.val();
        $supRows.toggle(mode === fireModes.suppressive);
        $autoRows.toggle(mode === fireModes.fullAuto);
      };

      updateVisibility();
      $fireMode.on('change', updateVisibility);
    }
  
    /** @override */
    async _updateObject(event, formData) {
      this.object = formData;
      const fired = await this.options.onConfirm(this.object);
      if (fired !== false) this.close();
    }
 }