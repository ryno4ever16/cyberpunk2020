/**
 * DamageDialog.js  —  module/combat/DamageDialog.js
 *
 * Preview shows: Roll − SP = after-SP damage (editable by GM)
 * On Apply:      after-SP − BTM = final HP damage (min 1 if penetrated)
 *
 * BTM is intentionally excluded from the preview rows. It represents the
 * character's personal toughness applied at receive-time — not a property
 * of the attack. Showing it per-row would conflate armor and body toughness.
 * BTM is displayed as a summary line below the hit list instead.
 *
 * Cover SP: GM enters the obstacle SP; combined with armor as the outermost
 * layer via the proportional table (CP2020 p.99).
 */

import { ARMOR_MODES, resolveAreaDamagesSync, applyBTM, ablateLocationOnce } from "./DamageApplicator.js";
import { postStunSavePrompt, postDeathSavePrompt, updateTaserState, applyAcidDotState } from "./save-rolls.js";

export class DamageDialog extends FormApplication {

  constructor(payload, target, options = {}) {
    super({}, options);
    this.payload    = payload;
    this.target     = target;
    this._overrides = {};   // { flatIndex: after-SP override }
    this._armorMode = null;
    this._ablate    = null;
    this._coverSP   = 0;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      title:     "Apply Damage",
      template:  "systems/cyberpunk2020/templates/dialog/damage-dialog.hbs",
      width:     500,
      height:    "auto",
      classes:   ["cyberpunk", "dialog", "damage-dialog"],
      resizable: true,
    });
  }

  getData() {
    const armorMode = this._armorMode ?? game.settings.get("cyberpunk2020", "damageArmorMode");
    const ablate    = this._ablate    ?? game.settings.get("cyberpunk2020", "damageAblation");
    const coverSP   = this._coverSP;

    const rawHits = resolveAreaDamagesSync({
      target:      this.target,
      areaDamages: this.payload.areaDamages,
      ap:            Boolean(this.payload.ap),
      edged:         Boolean(this.payload.edged),
      armorMultSoft: Number(this.payload.armorMultSoft ?? 1.0),
      armorMultHard: Number(this.payload.armorMultHard ?? 1.0),
      armorMode,
      coverSP,
    });

    const btm = Number(this.target.system.stats?.bt?.modifier) || 0;

    const resolvedHits = rawHits.map((hit, i) => ({
      ...hit,
      afterSP:    this._overrides[i] !== undefined ? this._overrides[i] : hit.damageAfterSP,
      overridden: this._overrides[i] !== undefined,
    }));

    const headDoubling = game.settings.get("cyberpunk2020", "headHitDoubling");
    const totalNet = resolvedHits.reduce((s, h) => {
      const btmResult = applyBTM(h.afterSP, btm, h.penetrates);
      return s + ((headDoubling && h.location === "Head" && btmResult > 0) ? btmResult * 2 : btmResult);
    }, 0);

    return {
      weaponName:   this.payload.weaponName,
      targetName:   this.target.name,
      resolvedHits,
      totalNet,
      btm,
      armorMode,
      ablate,
      armorModes:   Object.values(ARMOR_MODES),
      ap:           Boolean(this.payload.ap),
      coverSP,
    };
  }

  activateListeners(html) {
    super.activateListeners(html);

    html.find("select[name='armorMode']").on("change", ev => {
      this._armorMode = ev.currentTarget.value;
      this._overrides = {};
      this.render(false);
    });

    html.find("input[name='coverSP']").on("change", ev => {
      const v = Number(ev.currentTarget.value);
      this._coverSP   = (Number.isFinite(v) && v >= 0) ? v : 0;
      this._overrides = {};
      this.render(false);
    });

    html.find("input[name='ablate']").on("change", ev => {
      this._ablate = ev.currentTarget.checked;
    });

    // Override stores the after-SP value; BTM applied on Apply
    html.find("input.after-sp-override").on("change", ev => {
      const idx = Number(ev.currentTarget.dataset.hitIndex);
      const val = Number(ev.currentTarget.value);
      if (Number.isFinite(val) && val >= 0) {
        this._overrides[idx] = val;
      } else {
        delete this._overrides[idx];
      }
      this._updateTotalDisplay(html);
    });

    html.find("button[name='apply']").on("click",  this._onApply.bind(this));
    html.find("button[name='cancel']").on("click", () => this.close());
  }

  _updateTotalDisplay(html) {
    const armorMode = this._armorMode ?? game.settings.get("cyberpunk2020", "damageArmorMode");
    const btm = Number(this.target.system.stats?.bt?.modifier) || 0;
    const base = resolveAreaDamagesSync({
      target:      this.target,
      areaDamages: this.payload.areaDamages,
      ap:            Boolean(this.payload.ap),
      edged:         Boolean(this.payload.edged),
      armorMultSoft: Number(this.payload.armorMultSoft ?? 1.0),
      armorMultHard: Number(this.payload.armorMultHard ?? 1.0),
      armorMode,
      coverSP:     this._coverSP,
    });
    const headDoublingLive = game.settings.get("cyberpunk2020", "headHitDoubling");
    let total = 0;
    base.forEach((hit, i) => {
      const afterSP   = this._overrides[i] !== undefined ? this._overrides[i] : hit.damageAfterSP;
      const btmResult = applyBTM(afterSP, btm, hit.penetrates);
      total += (headDoublingLive && hit.location === "Head" && btmResult > 0) ? btmResult * 2 : btmResult;
    });
    html.find(".damage-total-value").text(total);
  }

  async _onApply(ev) {
    ev.preventDefault();

    const armorMode = this._armorMode ?? game.settings.get("cyberpunk2020", "damageArmorMode");
    const coverSP   = this._coverSP;
    const btm       = Number(this.target.system.stats?.bt?.modifier) || 0;

    const ablateEl = this.element?.find("input[name='ablate']")[0];
    const ablate   = ablateEl ? ablateEl.checked
                              : (this._ablate ?? game.settings.get("cyberpunk2020", "damageAblation"));

    const rawHits = resolveAreaDamagesSync({
      target:      this.target,
      areaDamages: this.payload.areaDamages,
      ap:            Boolean(this.payload.ap),
      edged:         Boolean(this.payload.edged),
      armorMultSoft: Number(this.payload.armorMultSoft ?? 1.0),
      armorMultHard: Number(this.payload.armorMultHard ?? 1.0),
      armorMode,
      coverSP,
    });

    const headDoubling = game.settings.get("cyberpunk2020", "headHitDoubling");

    // Pre-compute all per-hit final values (shared between socket relay and direct paths)
    const resolvedHits = rawHits.map((hit, i) => {
      const afterSP   = this._overrides[i] !== undefined ? this._overrides[i] : hit.damageAfterSP;
      // BTM applied at click time; head doubling applied after BTM (see module header)
      const btmResult = applyBTM(afterSP, btm, hit.penetrates);
      const netDamage = (headDoubling && hit.location === "Head" && btmResult > 0) ? btmResult * 2 : btmResult;
      return { location: hit.location, afterSP, penetrates: hit.penetrates, btmResult, netDamage };
    });
    const totalApplied = resolvedHits.reduce((s, h) => s + h.netDamage, 0);

    if (!game.user.isGM) {
      // Route through GM socket relay — player cannot write to unowned actor documents
      game.socket.emit("system.cyberpunk2020", {
        type:             "applyDamage",
        mode:             "resolved",
        requesterId:      game.user.id,
        targetActorId:    this.target.id,
        resolvedHits,
        totalApplied,
        ablate,
        armorMode,
        stunSaveOnHit:    Boolean(this.payload.stunSaveOnHit),
        stunSaveMod:      Number(this.payload.stunSaveMod     ?? 0),
        dotEnabled:       Boolean(this.payload.dotEnabled),
        dotTurns:         Number(this.payload.dotTurns        ?? 0),
        dotDamageFormula: String(this.payload.dotDamageFormula || "1d6"),
        weaponName:       String(this.payload.weaponName      || ""),
        firstHitLocation: rawHits[0]?.location ?? null,
      });
      this.close();
      return;
    }

    // GM direct path
    let currentDamage = Number(this.target.system.damage) || 0;

    for (const hit of resolvedHits) {
      if (hit.netDamage > 0) {
        currentDamage += hit.netDamage;
        await this.target.update(
          { "system.damage": currentDamage },
          { render: false, fromCyberpunkDamageSystem: true }
        );
      }

      // Ablation gates on the bullet penetrating, not on the doubled HP value
      if (ablate && armorMode === ARMOR_MODES.FULL && hit.btmResult > 0) {
        await ablateLocationOnce(this.target, hit.location);
      }
    }

    await this.target.sheet?.render(false);
    ui.notifications.info(`Applied ${totalApplied} damage to ${this.target.name}.`);

    // Taser flag must be updated BEFORE the save prompt — threshold calculation reads it
    if (this.payload.stunSaveOnHit && resolvedHits.some(h => h.penetrates)) {
      const taserEnabled = (() => { try { return game.settings.get("cyberpunk2020", "taserCumPenaltyEnabled"); } catch { return true; } })();
      if (taserEnabled) await updateTaserState(this.target, this.payload);
    }

    const acidEnabled = (() => { try { return game.settings.get("cyberpunk2020", "acidArmorDotEnabled"); } catch { return true; } })();
    if (acidEnabled && this.payload.dotEnabled && Number(this.payload.dotTurns) > 0 && rawHits.length > 0) {
      await applyAcidDotState(this.target, rawHits[0].location, Number(this.payload.dotTurns), String(this.payload.dotDamageFormula || "1d6"));
    }

    if (totalApplied > 0) {
      await _postSavePrompts(this.target);
    }

    this.close();
  }

  async _updateObject() {}
}

async function _postSavePrompts(actor) {
  const woundState = actor.woundState?.() ?? 0;
  if (woundState === 0) return;
  const token = canvas?.tokens?.placeables?.find(t => t.actor?.id === actor.id) ?? null;
  if (woundState >= 4) {
    await postDeathSavePrompt(actor, token);
  } else {
    await postStunSavePrompt(actor, token);
  }
}

