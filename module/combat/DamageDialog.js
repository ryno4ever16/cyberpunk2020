/**
 * DamageDialog.js  —  module/combat/DamageDialog.js
 *
 * DAMAGE SEQUENCE DISPLAYED:
 *   Roll (raw) − SP = after-SP damage  [this is what the GM can override]
 *   Then on Apply: − BTM = final HP damage (min 1 if SP was penetrated)
 *
 * BTM is NOT shown in the preview rows because it is the character's personal
 * toughness applied at the moment damage is received, not a property of the
 * attack or the armor. The dialog shows damage-after-SP so the GM can see
 * whether the armor stopped each round, and can override the after-SP value
 * before BTM is applied.
 *
 * BTM is shown as a separate informational line below the hit list.
 *
 * COVER SP:
 *   The GM enters the SP of any wall/obstacle. It is combined with armor SP
 *   as the outermost layer via the proportional table (CP2020 p.99).
 */

import { ARMOR_MODES, resolveAreaDamagesSync, applyBTM } from "./DamageApplicator.js";
import { getArmorContributors } from "./armor-layers.js";
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

    // Synchronous dry-run: returns damageAfterSP (pre-BTM)
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
      // after-SP damage shown in the editable field
      afterSP:    this._overrides[i] !== undefined ? this._overrides[i] : hit.damageAfterSP,
      overridden: this._overrides[i] !== undefined,
    }));

    // Total HP = sum of (afterSP - BTM), min 1 per penetrating hit
    const totalNet = resolvedHits.reduce((s, h) => {
      return s + applyBTM(h.afterSP, btm, h.penetrates);
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
    let total = 0;
    base.forEach((hit, i) => {
      const afterSP = this._overrides[i] !== undefined ? this._overrides[i] : hit.damageAfterSP;
      total += applyBTM(afterSP, btm, hit.penetrates);
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

    let totalApplied  = 0;
    let currentDamage = Number(this.target.system.damage) || 0;

    for (let i = 0; i < rawHits.length; i++) {
      const hit     = rawHits[i];
      // afterSP is either the GM's override or the computed value
      const afterSP = this._overrides[i] !== undefined ? this._overrides[i] : hit.damageAfterSP;
      // BTM applied HERE — at click time, not in the preview
      const netDamage = applyBTM(afterSP, btm, hit.penetrates);

      if (netDamage > 0) {
        currentDamage += netDamage;
        totalApplied  += netDamage;
        await this.target.update(
          { "system.damage": currentDamage },
          { render: false, fromCyberpunkDamageSystem: true }
        );
      }

      if (ablate && armorMode === ARMOR_MODES.FULL && hit.penetrates && netDamage > 0) {
        await _ablateLocation(this.target, hit.location);
      }
    }

    await this.target.sheet?.render(false);
    ui.notifications.info(`Applied ${totalApplied} damage to ${this.target.name}.`);

    // Taser cumulative penalty (T4-F): update flag BEFORE save prompts
    if (this.payload.stunSaveOnHit && rawHits.some(h => h.penetrates)) {
      const taserEnabled = (() => { try { return game.settings.get("cyberpunk2020", "taserCumPenaltyEnabled"); } catch { return true; } })();
      if (taserEnabled) await updateTaserState(this.target, this.payload);
    }

    // Acid armor DOT (T4-E): apply with stacking mode (stack/reset/separate)
    const acidEnabled = (() => { try { return game.settings.get("cyberpunk2020", "acidArmorDotEnabled"); } catch { return true; } })();
    if (acidEnabled && this.payload.dotEnabled && Number(this.payload.dotTurns) > 0 && rawHits.length > 0) {
      await applyAcidDotState(this.target, rawHits[0].location, Number(this.payload.dotTurns), String(this.payload.dotDamageFormula || "1d6"));
    }

    // Post stun/death save prompts if any HP damage was dealt
    if (totalApplied > 0) {
      await _postSavePrompts(this.target);
    }

    this.close();
  }

  async _updateObject() {}
}

// ---------------------------------------------------------------------------
// Post appropriate save prompts based on current wound state
// ---------------------------------------------------------------------------

async function _postSavePrompts(actor) {
  const woundState = actor.woundState?.() ?? 0;
  if (woundState === 0) return;

  // Find the token for this actor on the current scene (for status effect targeting)
  const token = canvas?.tokens?.placeables?.find(t => t.actor?.id === actor.id) ?? null;

  if (woundState >= 4) {
    // Mortal wound state — needs Death Save
    await postDeathSavePrompt(actor, token);
  } else {
    // Light, Serious, or Critical — Stun Save
    await postStunSavePrompt(actor, token);
  }
}

// ---------------------------------------------------------------------------
// Local ablation helper
// ---------------------------------------------------------------------------
async function _ablateLocation(target, location) {
  const contributors = getArmorContributors(target, location);
  const toAblate = [...contributors.orderedLayers, ...contributors.unassigned];

  const updates = [];
  for (const item of toAblate) {
    const liveItem = target.items.get(item.id);
    if (!liveItem) continue;
    const itemSP = Number(liveItem.system?.coverage?.[location]?.stoppingPower) || 0;
    if (itemSP <= 0) continue;
    const fullCoverage = foundry.utils.deepClone(liveItem.system.coverage || {});
    if (!fullCoverage[location]) fullCoverage[location] = {};
    fullCoverage[location].stoppingPower = Math.max(0, itemSP - 1);
    updates.push({ _id: liveItem.id, "system.coverage": fullCoverage });
  }

  if (updates.length > 0) {
    await target.updateEmbeddedDocuments("Item", updates, { render: false });
  }
}
