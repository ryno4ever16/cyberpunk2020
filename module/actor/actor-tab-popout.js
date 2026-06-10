import { CyberpunkActorSheet } from "./actor-sheet.js";
import { shimmerWindow } from "../shimmer.js";

/**
 * Tear-off tab windows for the character/NPC sheet.
 *
 * Each instance is the SAME actor sheet, but its template renders a single tab's body in its own
 * window — so a player can pop the Combat tab to one place and the Cyberware tab to another. Because
 * this subclasses {@link CyberpunkActorSheet}, it inherits getData(), activateListeners(), _onDrop()
 * and every roll/edit handler unchanged: the popped-out tab is fully interactive and persists edits.
 * It also registers in `actor.apps`, so it live-updates whenever the actor changes.
 *
 * PopOut! friendly: the tab's listeners are bound directly to its own DOM (not global delegation), so
 * they travel with the nodes when PopOut! moves the window to a second monitor.
 */

// tab key -> { label (CYBERPUNK.<label>), width, height } for the popped-out window.
const TAB_META = {
  skills:   { label: "TabSkills",  width: 560, height: 620 },
  combat:   { label: "TabCombat",  width: 600, height: 660 },
  gear:     { label: "TabGear",    width: 560, height: 620 },
  services: { label: "ServicesTab", width: 540, height: 560 },
  cyber:    { label: "TabCyber",   width: 600, height: 660 },
  life:     { label: "Life",       width: 560, height: 560 },
  netrun:   { label: "NetRun",     width: 560, height: 620 },
};

export const POPOUT_TABS = Object.keys(TAB_META);

export class CyberpunkActorTabSheet extends CyberpunkActorSheet {
  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["cyberpunk", "sheet", "actor", "cp-tab-popout"],
      template: "systems/cyberpunk2020/templates/actor/actor-tab-popout.hbs",
      tabs: [],            // single tab — no in-window tab nav
      width: 580,
      height: 620,
    });
  }

  /** Which tab this window shows (passed through render options). */
  get tabKey() {
    return this.options.tabKey ?? "combat";
  }

  /** A distinct DOM id per (actor, tab) so several tab windows of one actor can coexist. */
  get id() {
    return `cp-tab-${this.actor.id}-${this.tabKey}`;
  }

  /** @override */
  get title() {
    const meta = TAB_META[this.tabKey];
    const name = meta ? game.i18n.localize(`CYBERPUNK.${meta.label}`) : this.tabKey;
    return `${this.actor.name} — ${name}`;
  }

  /** @override */
  getData(options) {
    const data = super.getData(options);
    data.tabKey = this.tabKey;
    data.isTabPopout = true;
    return data;
  }

  /** Re-grey the parent character sheet's nav whenever this tab window appears or closes, so a
   *  popped-out tab shows as detached on the main sheet. */
  _syncParentNav() {
    Object.values(this.actor?.apps ?? {})
      .find((a) => a.constructor?.name === "CyberpunkActorSheet" && a.rendered)
      ?._refreshDetachedTabs?.();
  }

  /** @override */
  async _render(force, options) {
    const r = await super._render(force, options);
    this._syncParentNav();
    return r;
  }

  /** @override */
  async close(options) {
    const r = await super.close(options);
    this._syncParentNav();
    return r;
  }

  /**
   * Open (or focus) the given tab as its own window for this actor. Singleton per (actor, tab):
   * re-triggering brings the existing window forward instead of spawning a duplicate. An optional
   * {left, top} positions the window (used by the drag-to-place tear-off gesture).
   */
  static open(actor, tabKey, { left = null, top = null } = {}) {
    if (!actor || !TAB_META[tabKey]) return null;
    const existing = Object.values(actor.apps ?? {})
      .find(a => a instanceof CyberpunkActorTabSheet && a.tabKey === tabKey);
    if (existing) {
      // Already open → just resurface it (NO re-render: a full render flashes the layout and would
      // wipe the shimmer overlay we're about to add).
      if (left != null && top != null) existing.setPosition({ left, top });
      existing.bringToTop?.();
      shimmerWindow(existing); // draw the eye to it
      return existing;
    }
    const meta = TAB_META[tabKey];
    const opts = { tabKey, width: meta.width, height: meta.height };
    if (left != null) opts.left = left;
    if (top != null) opts.top = top;
    return new CyberpunkActorTabSheet(actor, opts).render(true);
  }
}
