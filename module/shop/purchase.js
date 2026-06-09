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
 * Read a shop's per-item stock metadata from the embedded item's flags.
 * Missing flag = unlimited stock (the safe default for freshly dragged-in items).
 * @param {Item} item embedded shop item
 * @returns {{unlimited:boolean, qty:number, fashion:boolean, price:(number|null)}}
 */
export function shopStockOf(item) {
  const f = item?.getFlag?.("cyberpunk2020", "shop") ?? item?.flags?.cyberpunk2020?.shop ?? {};
  const price = Number(f.price);
  return {
    unlimited: f.unlimited !== false,            // default true
    qty: Math.max(0, Math.floor(Number(f.qty) || 0)),
    fashion: f.fashion === true,
    price: Number.isFinite(price) ? price : null, // per-item GM price override (null = use catalog cost)
    sourceKey: typeof f.sourceKey === "string" ? f.sourceKey : null // origin catalog key "packId.itemId"
  };
}

/**
 * Add a catalog item to a shop as curated stock: embeds a copy with default stock metadata and a
 * `sourceKey` flag linking it back to its catalog entry (so the builder can show in-shop state and
 * avoid duplicate adds). Returns the created embedded Item, or null on failure / duplicate.
 * @param {Actor} shop
 * @param {string} packId  compendium collection id
 * @param {string} itemId  catalog item _id
 * @param {{fashion?:boolean}} [opts]
 * @returns {Promise<Item|null>}
 */
export async function addItemToShop(shop, packId, itemId, { fashion = false } = {}) {
  if (!shop || shop.type !== "shop") return null;
  const sourceKey = `${packId}.${itemId}`;
  // Skip if already stocked (matched by sourceKey).
  if (shop.items.some(it => shopStockOf(it).sourceKey === sourceKey)) return null;
  let doc;
  try { doc = await game.packs.get(packId)?.getDocument(itemId); } catch { doc = null; }
  if (!doc) return null;
  const data = doc.toObject();
  delete data._id; delete data.folder; delete data.ownership;
  data.flags = data.flags ?? {};
  data.flags.cyberpunk2020 = {
    ...(data.flags.cyberpunk2020 ?? {}),
    shop: { unlimited: true, qty: 0, fashion: fashion === true, price: null, sourceKey }
  };
  try {
    const [created] = await shop.createEmbeddedDocuments("Item", [data]);
    return created ?? null;
  } catch (e) { console.warn("Cyberpunk2020 | addItemToShop failed", e); return null; }
}

/** Remove a curated item from a shop by its embedded item id. */
export async function removeItemFromShop(shop, embeddedId) {
  const item = shop?.items?.get(embeddedId);
  if (!item) return false;
  try { await item.delete(); return true; }
  catch (e) { console.warn("Cyberpunk2020 | removeItemFromShop failed", e); return false; }
}

/** Patch a shop item's stock metadata (price/qty/unlimited/fashion), preserving the rest. */
export async function setShopStock(item, patch) {
  if (!item) return;
  const s = shopStockOf(item);
  try { await item.setFlag("cyberpunk2020", "shop", { ...s, ...patch }); }
  catch (e) { console.warn("Cyberpunk2020 | setShopStock failed", e); }
}

/**
 * Shopping purchase engine — the generic GEAR path.
 *
 * Mirrors the proven buy-ammo idiom (module/dialog/buy-ammo.js): validate → check funds →
 * CHARGE FIRST → create the item → refund on failure, so a failed create can never leave
 * free goods or a double charge. Money lives on `actor.system.eurobucks`.
 *
 * Cyberware (full buy-and-install: surgery cost + humanity roll + surgical damage) and
 * services (recurring-bill tab / one-off pay-and-confirm) are handled by their own paths;
 * this function is the plain "buy a thing, put it in inventory" core.
 */

/**
 * Effective price of one unit: catalog cost × shop markup × (fashion) style multiplier, rounded.
 * @param {Item|object} item
 * @param {{markup?:number, styleMult?:number}} [opts]
 * @returns {number}
 */
export function priceFor(item, { markup = 1, styleMult = 1 } = {}) {
  const base = Number(item?.system?.cost ?? 0);
  return Math.max(0, Math.round(base * (Number(markup) || 1) * (Number(styleMult) || 1)));
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
    // Don't carry shop-only stock metadata onto the buyer's copy.
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

/**
 * Buy `qty` of a shop's embedded item for `buyer`: price = the GM per-item override (if set) else
 * the catalog cost, × optional fashion style; deplete limited stock on success. No zone markup.
 * @param {Actor} shop   the shop actor
 * @param {Actor} buyer  the purchasing character
 * @param {Item}  item   an embedded item on the shop
 * @param {object} [opts]
 * @param {number} [opts.qty=1]
 * @param {number} [opts.styleMult=1]   fashion style multiplier
 * @param {string} [opts.styleLabel=""] fashion style label for the chat card
 * @returns {Promise<boolean>}
 */
export async function buyFromShop(shop, buyer, item, { qty = 1, styleMult = 1, styleLabel = "", systemPatch = null } = {}) {
  if (!shop || !buyer || !item) return false;
  if (shop.system?.open === false && !game.user.isGM) {
    ui.notifications?.warn(localize("ShopClosed"));
    return false;
  }
  const n = Math.max(1, Math.floor(Number(qty) || 1));
  const stock = shopStockOf(item);
  if (!stock.unlimited && stock.qty < n) {
    ui.notifications?.warn(game.i18n.format("CYBERPUNK.ShopOutOfStock", { name: item.name, qty: stock.qty }));
    return false;
  }

  // Price = per-item override (if set) else catalog cost, × fashion style. No zone markup.
  const base = stock.price != null ? stock.price : (Number(item.system?.cost) || 0);
  const unitPrice = Math.max(0, Math.round(base * (Number(styleMult) || 1)));
  const priceLabel = (styleLabel && styleMult !== 1) ? `${styleLabel} ×${styleMult}` : "";

  const ok = await buyItem(buyer, item, { qty: n, unitPrice, priceLabel, systemPatch });
  if (!ok) return false;

  // Deplete limited stock. The GM/shop-owner writes the flag directly; a non-owning player relays
  // the depletion to the primary GM (they can't write the shop they don't own).
  if (!stock.unlimited) {
    if (game.user.isGM || shop.isOwner) {
      try { await item.setFlag("cyberpunk2020", "shop", { ...stock, qty: Math.max(0, stock.qty - n) }); }
      catch (e) { console.warn("Cyberpunk2020 | could not decrement shop stock", e); }
    } else if (game.users.activeGM) {
      game.socket.emit("system.cyberpunk2020", { type: "shopDeplete", shopId: shop.id, itemId: item.id, qty: n });
    }
  }
  return true;
}
