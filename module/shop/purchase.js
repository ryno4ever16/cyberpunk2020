import { canShop } from "../settings.js";
import { localize } from "../utils.js";

/**
 * Fashion style multipliers applied at purchase to style-priced (clothing) items.
 * Core 2020 Gear-List fashion pricing ([[core-rules-reference]] #1). `key` is stored; `mult`
 * multiplies the unit price; `label` is shown on the chat card.
 */
export const FASHION_STYLES = [
  { key: "generic",    label: "Generic",     mult: 1 },
  { key: "leisure",    label: "Leisure",     mult: 2 },
  { key: "urbanflash", label: "Urban Flash", mult: 2 },
  { key: "business",   label: "Businesswear", mult: 3 },
  { key: "highfashion", label: "High Fashion", mult: 4 }
];

/**
 * Shopping purchase engine — the generic GEAR path ([[shopping-design]]).
 *
 * Mirrors the proven buy-ammo idiom (module/dialog/buy-ammo.js): validate → check funds →
 * CHARGE FIRST → create the item → refund on failure, so a failed create can never leave free
 * goods or a double charge. Money lives on `actor.system.eurobucks`. Cyberware (buy-and-install)
 * and services (recurring/one-off) have their own paths; shop pricing/stock lives in shops.js and
 * the buy routing lives in catalog.js.
 */

/**
 * Effective price of one unit: catalog cost × (fashion) style multiplier, rounded.
 * @param {Item|object} item
 * @param {{styleMult?:number}} [opts]
 * @returns {number}
 */
export function priceFor(item, { styleMult = 1 } = {}) {
  const base = Number(item?.system?.cost ?? 0);
  return Math.max(0, Math.round(base * (Number(styleMult) || 1)));
}

/**
 * Purchase `qty` of a source item for `actor`: deduct eurobucks, then add it to inventory.
 * @param {Actor} actor
 * @param {Item|object} source       catalog Item (compendium/world doc) or raw item data
 * @param {object} [opts]
 * @param {number} [opts.qty=1]
 * @param {number} [opts.unitPrice]  price per unit (defaults to the item's catalog cost)
 * @param {string} [opts.priceLabel] short note shown on the chat card (e.g. "High Fashion ×4")
 * @param {object} [opts.systemPatch] system fields merged onto the created item (e.g. {serviceMode:"recurring"})
 * @returns {Promise<boolean>} true on success
 */
export async function buyItem(actor, source, { qty = 1, unitPrice, priceLabel = "", systemPatch = null } = {}) {
  if (!actor) { ui.notifications?.warn(localize("ShopNoActor")); return false; }
  if (!canShop()) { ui.notifications?.warn(localize("ShopNotAllowed")); return false; }

  const data = (source && typeof source.toObject === "function") ? source.toObject() : foundry.utils.deepClone(source ?? {});
  const name = data?.name ?? "item";
  const n = Math.max(1, Math.floor(Number(qty) || 1));
  const base = Number(unitPrice ?? data.system?.cost ?? 0);
  const total = Math.max(0, Math.round(base * n));

  const funds = Number(actor.system?.eurobucks ?? 0);
  if (funds < total) {
    ui.notifications?.warn(game.i18n.format("CYBERPUNK.ShopInsufficientFunds", { name, cost: total, funds }));
    return false;
  }

  // Charge first; refund if stocking fails (update before create — same order as buy-ammo).
  await actor.update({ "system.eurobucks": funds - total });
  try {
    delete data._id;
    delete data.folder;
    delete data.ownership;
    // Don't carry shop-only metadata onto the buyer's copy.
    if (data.flags?.cyberpunk2020?.shop) delete data.flags.cyberpunk2020.shop;
    if (systemPatch && typeof systemPatch === "object") data.system = { ...(data.system ?? {}), ...systemPatch };
    // If the item TYPE's schema carries a numeric quantity (only ammo does), buy one stack of N;
    // otherwise create N copies. (Checking the schema — not the raw source — avoids stacking onto
    // a field the type would drop, which would silently lose the items the buyer paid for.)
    const typeHasQty = !!CONFIG.Item?.dataModels?.[data.type]?.schema?.fields?.quantity;
    const hasQty = typeHasQty && Number.isFinite(Number(data.system?.quantity));
    let toCreate;
    if (hasQty) {
      data.system.quantity = n;
      toCreate = [data];
    } else {
      toCreate = Array.from({ length: n }, () => foundry.utils.deepClone(data));
    }
    await actor.createEmbeddedDocuments("Item", toCreate);
  } catch (err) {
    console.error("Cyberpunk2020 | Shop purchase failed to stock, refunding.", err);
    await actor.update({ "system.eurobucks": funds });
    ui.notifications?.error(localize("ShopBuyFailed"));
    return false;
  }

  ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: game.i18n.format("CYBERPUNK.ShopBought", {
      qty: n, name, cost: total, label: priceLabel ? ` (${priceLabel})` : ""
    })
  });
  return true;
}
