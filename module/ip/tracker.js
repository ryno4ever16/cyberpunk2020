import {
  getQueue, updateQueueRow, resolveQueueRow, dismissQueueRow, resolveAllQueue,
  applyPending, resetThrottle, awardPending, addToPool
} from "./ip.js";
import { ipSystem, ipAwardModel, ipThrottle } from "../settings.js";
import { localize } from "../utils.js";

/**
 * GM IP Tracker (RAW mode) — [[ip-tracker-design]].
 *
 * Shows the auto-queue of skill rolls awaiting an IP decision (each row = actor · skill · result),
 * a column to enter IP (manual model) or tick success (auto-baseline model), plus a manual-add and
 * a per-skill pending summary. "Apply" resolves all rows and releases pending → banked (visible to
 * players), clearing the queue + throttle for a new cycle. GM-only.
 */
export class IpTracker extends Application {
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["cyberpunk", "cp-ip-tracker"],
      template: "systems/cyberpunk2020/templates/ip/tracker.hbs",
      title: game.i18n.localize("CYBERPUNK.IpTrackerTitle"),
      width: 560,
      height: 600,
      resizable: true
    });
  }

  getData() {
    const auto = ipAwardModel() === "autoBaseline";
    const rows = getQueue().map(r => ({ ...r }));

    // Per-skill pending summary across the party.
    const pending = [];
    for (const a of game.actors.filter(x => x.type === "character" || x.type === "npc")) {
      for (const s of a.items) {
        if (s.type !== "skill") continue;
        const p = Number(s.system?.ipPending) || 0;
        if (p > 0) pending.push({ actorName: a.name, skillName: s.name, pending: p });
      }
    }
    pending.sort((x, y) => x.actorName.localeCompare(y.actorName) || x.skillName.localeCompare(y.skillName));

    return {
      auto,
      simple: ipSystem() === "simple",
      throttle: ipThrottle(),
      rows,
      rowCount: rows.length,
      pending,
      pendingTotal: pending.reduce((t, p) => t + p.pending, 0)
    };
  }

  activateListeners(html) {
    super.activateListeners(html);
    const root = html instanceof jQuery ? html[0] : html;
    if (!root) return;
    const rowId = (el) => el.closest("[data-row-id]")?.dataset?.rowId;

    root.querySelectorAll(".cp-ip-amount").forEach(el => el.addEventListener("change", (ev) => {
      updateQueueRow(rowId(ev.currentTarget), { ip: Math.max(0, parseInt(ev.currentTarget.value, 10) || 0) });
    }));
    root.querySelectorAll(".cp-ip-success").forEach(el => el.addEventListener("change", (ev) => {
      updateQueueRow(rowId(ev.currentTarget), { success: ev.currentTarget.checked });
    }));
    root.querySelectorAll(".cp-ip-award").forEach(el => el.addEventListener("click", async (ev) => {
      ev.preventDefault();
      // Persist the row's current input first (change may not have fired), then resolve it.
      const r = ev.currentTarget.closest("[data-row-id]");
      const amt = r?.querySelector(".cp-ip-amount");
      const suc = r?.querySelector(".cp-ip-success");
      const patch = {};
      if (amt) patch.ip = Math.max(0, parseInt(amt.value, 10) || 0);
      if (suc) patch.success = suc.checked;
      await updateQueueRow(rowId(ev.currentTarget), patch);
      await resolveQueueRow(rowId(ev.currentTarget));
    }));
    root.querySelectorAll(".cp-ip-skip").forEach(el => el.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await dismissQueueRow(rowId(ev.currentTarget));
    }));

    root.querySelector(".cp-ip-apply")?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await resolveAllQueue();
      await applyPending();
      this.render(false);
    });
    root.querySelector(".cp-ip-reset")?.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await resetThrottle();
      ui.notifications?.info(localize("IpThrottleReset"));
    });
    root.querySelector(".cp-ip-manual")?.addEventListener("click", (ev) => {
      ev.preventDefault();
      this._manualAdd();
    });
  }

  /** Manual add: pick an actor, then a skill, then an IP amount (or add to the Simple pool). */
  async _manualAdd() {
    const actors = game.actors.filter(a => a.type === "character" || a.type === "npc");
    if (!actors.length) return;
    const simple = ipSystem() === "simple";
    const esc = foundry.utils.escapeHTML ?? (s => String(s));
    const actorOpts = actors.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join("");
    const content = `
<form class="cyberpunk">
  <div class="form-group"><label>${localize("IpManualActor")}</label><select name="actor">${actorOpts}</select></div>
  ${simple ? "" : `<div class="form-group"><label>${localize("IpManualSkill")}</label><select name="skill"></select></div>`}
  <div class="form-group"><label>${localize("IpManualAmount")}</label><input type="number" name="amount" value="1" min="1"/></div>
</form>`;
    const dlg = new Dialog({
      title: localize("IpManualTitle"),
      content,
      buttons: {
        add: { label: localize("IpManualAdd"), callback: async (h) => {
          const r = h[0] ?? h;
          const actor = game.actors.get(r.querySelector('[name="actor"]')?.value);
          const amount = Math.max(1, parseInt(r.querySelector('[name="amount"]')?.value, 10) || 1);
          if (!actor) return;
          if (simple) { await addToPool(actor, amount); }
          else {
            const skill = actor.items.get(r.querySelector('[name="skill"]')?.value);
            if (skill) await awardPending(actor, skill, amount);
          }
          this.render(false);
        } },
        cancel: { label: localize("Cancel") }
      },
      default: "add",
      render: (h) => {
        const r = h[0] ?? h;
        const actorSel = r.querySelector('[name="actor"]');
        const skillSel = r.querySelector('[name="skill"]');
        const fillSkills = () => {
          if (!skillSel) return;
          const a = game.actors.get(actorSel.value);
          const skills = (a?.items.filter(i => i.type === "skill") ?? []).sort((x, y) => x.name.localeCompare(y.name));
          skillSel.innerHTML = skills.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
        };
        actorSel?.addEventListener("change", fillSkills);
        fillSkills();
      }
    });
    dlg.render(true);
  }
}

let _ipTracker = null;

/** Open (or focus) the GM IP Tracker. GM-only. */
export function openIpTracker() {
  if (!game.user.isGM) { ui.notifications?.warn(localize("IpTrackerGmOnly")); return; }
  if (_ipTracker?.rendered) { _ipTracker.bringToTop(); return _ipTracker; }
  _ipTracker = new IpTracker();
  _ipTracker.render(true);
  return _ipTracker;
}
