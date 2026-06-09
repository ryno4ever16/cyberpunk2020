import { openShopWindow } from "../shop/catalog.js";

/**
 * Shop actor "sheet" (Shopping feature — [[shopping-design]]).
 *
 * The drag-to-stock storefront sheet was RETIRED in the round-6 refactor: a shop is now curated and
 * shown through the catalog window itself (CatalogBrowser). This class stays registered as the shop
 * type's sheet purely so that opening a shop actor (sidebar click, chat link, `actor.sheet.render()`)
 * routes to the right window — the GM/owner gets the catalog-style BUILDER; everyone else gets the
 * player STOREFRONT. It never renders its own DOM frame.
 */
export class CyberpunkShopSheet extends ActorSheet {

  /** @override */
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["cyberpunk", "sheet", "actor", "shop"],
      width: 860,
      height: 700,
    });
  }

  /** @override — route to the catalog-based builder/storefront instead of rendering a sheet frame. */
  render(force = false, options = {}) {
    openShopWindow(this.actor);
    return this;
  }

  /** @override — nothing to close (we never opened a frame); keep Foundry's bookkeeping happy. */
  async close(options = {}) {
    return;
  }
}
