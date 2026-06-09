import { buyItem, buyFromShop, shopStockOf, addItemToShop, removeItemFromShop, setShopStock, FASHION_STYLES } from "./purchase.js";
import { buyAndInstallCyberware } from "../cyberware/install.js";
import { classifyService, payOneOffService } from "./services.js";
import { classifySupplement, sourceState, isVisibleTo, knownOfficialSupplements, knownNoncanonSources } from "./supplements.js";
import { categoryOfPack, CATEGORIES, EXCLUDED_TYPES, catalogPacks } from "./categories.js";
import { shoppingEnabled, shopBuySource, shopSourceConfig, shopShowSource, shopAllowHomebrew } from "../settings.js";

/**
 * Shopping catalog browser ([[shopping-design]]). ONE window that serves three modes:
 *   • "catalog"    — the global master list (sidebar cart): browse/search every purchasable item at
 *                    flat Core cost; buy directly. GMs also get an "Add to shop ▾" per row.
 *   • "build"      — GM curation of a shop actor: the same searchable catalog, with per-row Add/Remove
 *                    to THIS shop and inline stock economics (price override / unlimited|qty / fashion),
 *                    plus a shop-config toolbar (name, fullSearch, open, publish). Replaces the old
 *                    drag-to-stock shop sheet.
 *   • "storefront" — what a buyer sees for a published shop: curated stock only (no search) unless the
 *                    shop's `fullSearch` is on, in which case the whole visible catalog is searchable
 *                    with the curated items featured.
 *
 * Shared engine: greedy search, inclusive two-level category filters, alphabetical list + letter jump
 * bar, per-item source badge, canonicity gating (Core always; official GM-curated per book; homebrew
 * absent until allowed). Cyberware → buy-and-install; one-off services → pay-and-confirm; recurring →
 * tagged item; fashion items get a style multiplier. No zone markup (not RAW).
 */

const SCOPE = "cyberpunk2020";

/**
 * Session-wide cache of the aggregated catalog index (raw items; visibility/filtering is applied
 * per-render in getData, so the raw pool is identical for every opener). Built once, shared by all
 * CatalogBrowser instances — reopening is instant. Call clearCatalogIndexCache() if pack content
 * changes mid-session.
 */
let _catalogIndexPromise = null;

/** Build the aggregated index by loading every catalog pack's index IN PARALLEL. */
async function buildCatalogIndex() {
  const results = await Promise.all(catalogPacks().map(async (pack) => {
    const { category, sub } = categoryOfPack(pack.metadata.name);
    let idx;
    try { idx = await pack.getIndex({ fields: ["system.cost", "system.source", "type", "img"] }); }
    catch (e) { return []; }
    const items = [];
    for (const e of idx) {
      const type = e.type ?? "misc";
      if (EXCLUDED_TYPES.has(type)) continue;
      const { supplement, canon } = classifySupplement(e.system?.source);
      items.push({
        id: e._id, packId: pack.collection, name: e.name, img: e.img,
        cost: Number(e.system?.cost) || 0, type, category, sub, supplement, canon,
        key: `${pack.collection}.${e._id}`
      });
    }
    return items;
  }));
  const all = results.flat();
  all.sort((a, b) => a.name.localeCompare(b.name));
  return all;
}

/** Get the cached catalog index (building it once). Concurrent callers share the same build. */
export function getCatalogIndex() {
  if (!_catalogIndexPromise) _catalogIndexPromise = buildCatalogIndex().catch(e => { _catalogIndexPromise = null; throw e; });
  return _catalogIndexPromise;
}

/** Invalidate the cached catalog index (e.g. after pack content changes). */
export function clearCatalogIndexCache() { _catalogIndexPromise = null; }

export class CatalogBrowser extends Application {
  /**
   * @param {Actor|null} buyer  who pays (storefront/catalog); null in build mode.
   * @param {{shop?:Actor, mode?:"catalog"|"build"|"storefront"}} [options]
   */
  constructor(buyer, options = {}) {
    super(options);
    this.shop = options.shop ?? null;
    this.mode = options.mode ?? (this.shop ? "storefront" : "catalog");
    this.buyer = buyer ?? null;
    this._search = "";
    this._cats = new Set();       // active filter keys: "Category" or "Category/Sub"
    this._shopOnly = false;       // build mode: show only items already in this shop
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      classes: ["cyberpunk", "cp-catalog"],
      template: "systems/cyberpunk2020/templates/shop/catalog.hbs",
      title: game.i18n.localize("CYBERPUNK.CatalogTitle"),
      width: 860,
      height: 700,
      resizable: true
    });
  }

  /** @override — title reflects mode + shop. */
  get title() {
    if (this.mode === "build") return game.i18n.format("CYBERPUNK.ShopBuilderTitle", { name: this.shop?.name ?? "" });
    if (this.mode === "storefront") return this.shop?.name ?? game.i18n.localize("CYBERPUNK.ShopTitle");
    return game.i18n.localize("CYBERPUNK.CatalogTitle");
  }

  /** Aggregate every catalog pack's index into one item list (shared session cache). */
  async _buildIndex() {
    return getCatalogIndex();
  }

  // ── Shared row helpers ────────────────────────────────────────────────────

  /** Filter the index to rows passing visibility + active category + search. No sort. */
  _filterRows(all, { isGM, cfg, search }) {
    const catsActive = this._cats.size > 0;
    const matchesCat = (it) => !catsActive || this._cats.has(it.category) || this._cats.has(`${it.category}/${it.sub}`);
    const rows = [];
    for (const it of all) {
      if (!isVisibleTo(it.supplement, it.canon, cfg, isGM)) continue;
      if (!matchesCat(it)) continue;
      if (search && !it.name.toLowerCase().includes(search)) continue;
      rows.push({ ...it, fashion: it.category === "Gear" && it.sub === "Fashion" });
    }
    return rows;
  }

  /** Assign per-row letter + section-first flags; optionally collect the jump-bar letters. */
  _assignLetters(arr, collect, letters) {
    const seen = new Set();
    for (const r of arr) {
      const L = (r.name[0] || "#").toUpperCase();
      r._letter = /[A-Z]/.test(L) ? L : "#";
      if (!seen.has(r._letter)) { seen.add(r._letter); r._first = true; if (collect) letters.push(r._letter); }
    }
  }

  /** Greedy search ordering: exact, then prefix, then substring; alphabetical within each band. */
  _greedySort(rows, search) {
    const band = (n) => { const s = n.toLowerCase(); return s === search ? 0 : s.startsWith(search) ? 1 : 2; };
    rows.sort((a, b) => band(a.name) - band(b.name) || a.name.localeCompare(b.name));
  }

  /** The category filter tree with active state. */
  _catTree() {
    return CATEGORIES.map(c => ({
      key: c.key, active: this._cats.has(c.key),
      subs: c.subs.map(s => ({ key: `${c.key}/${s}`, label: s, active: this._cats.has(`${c.key}/${s}`) }))
    }));
  }

  /** GM source-enable panel: supplements present in the index with per-source player-enable state. */
  _sourcePanel(all, cfg) {
    const present = new Set(all.map(i => i.supplement + " " + i.canon));
    const enabled = cfg.enabledSources;
    const mk = (names, canon) => names.filter(n => present.has(n + " " + canon)).map(n => ({ name: n, enabled: enabled[n] === true }));
    return {
      official: mk(knownOfficialSupplements(), "official"),
      homebrew: shopAllowHomebrew() ? mk(knownNoncanonSources(), "noncanon") : [],
      allowHomebrew: shopAllowHomebrew()
    };
  }

  /** Map of catalog sourceKey → embedded shop item, for the current shop (build/storefront). */
  _shopStockMap() {
    const map = new Map();
    if (!this.shop) return map;
    for (const it of this.shop.items) {
      if (EXCLUDED_TYPES.has(it.type)) continue;
      const sk = shopStockOf(it).sourceKey;
      if (sk) map.set(sk, it);
    }
    return map;
  }

  /** Build a storefront/economics row from an embedded shop item. */
  _curatedRow(item) {
    const s = shopStockOf(item);
    const base = s.price != null ? s.price : (Number(item.system?.cost) || 0);
    return {
      shopItemId: item.id, name: item.name, img: item.img, type: item.type,
      catalog: Number(item.system?.cost) || 0, price: base, override: s.price,
      unlimited: s.unlimited, qty: s.qty, fashion: s.fashion, sourceKey: s.sourceKey,
      soldOut: !s.unlimited && s.qty <= 0, curated: true
    };
  }

  // ── getData ────────────────────────────────────────────────────────────────

  async getData() {
    const isGM = game.user.isGM;
    const cfg = shopSourceConfig();
    const showSource = shopShowSource();
    const all = await this._buildIndex();
    const search = this._search.trim().toLowerCase();
    const common = {
      mode: this.mode, isGM, showSource,
      isCatalog: this.mode === "catalog", isBuild: this.mode === "build", isStorefront: this.mode === "storefront",
      buyerName: this.buyer?.name ?? "",
      buyerFunds: this.buyer ? (Number(this.buyer.system?.eurobucks) || 0) : 0,
      search: this._search, searching: !!search,
      cats: this._catTree(), fashionStyles: FASHION_STYLES
    };

    if (this.mode === "build")      return { ...common, ...this._dataBuild(all, { isGM, cfg, search }) };
    if (this.mode === "storefront") return { ...common, ...this._dataStorefront(all, { isGM, cfg, search }) };
    return { ...common, ...this._dataCatalog(all, { isGM, cfg, search }) };
  }

  /** Global catalog (flat cost): visible rows, dimmed-sink banding, GM source panel + shop list. */
  _dataCatalog(all, { isGM, cfg, search }) {
    let rows = this._filterRows(all, { isGM, cfg, search }).map(it => ({
      ...it, dimmed: isGM && !sourceState(it.supplement, it.canon, cfg).enabledForPlayers
    }));
    const letters = [];
    const enabledRows = rows.filter(r => !r.dimmed);
    const dimmedRows  = rows.filter(r => r.dimmed);
    if (search) { this._greedySort(enabledRows, search); this._greedySort(dimmedRows, search); }
    else { this._assignLetters(enabledRows, true, letters); this._assignLetters(dimmedRows, false, letters); }
    if (dimmedRows.length) dimmedRows[0]._hiddenDivider = true;
    rows = [...enabledRows, ...dimmedRows];

    return {
      rows, rowCount: rows.length, letters,
      sourcePanel: isGM ? this._sourcePanel(all, cfg) : null,
      shopList: isGM ? game.actors.filter(a => a.type === "shop").map(s => ({ id: s.id, name: s.name })) : []
    };
  }

  /** Shop builder (GM): catalog rows annotated with in-shop state + inline economics; + extras + config. */
  _dataBuild(all, { isGM, cfg, search }) {
    const stockMap = this._shopStockMap();
    let rows = this._filterRows(all, { isGM, cfg, search }).map(it => {
      const shopItem = stockMap.get(it.key);
      const row = { ...it, dimmed: isGM && !sourceState(it.supplement, it.canon, cfg).enabledForPlayers, inShop: !!shopItem };
      if (shopItem) {
        const s = shopStockOf(shopItem);
        Object.assign(row, {
          shopItemId: shopItem.id, override: s.price,
          unlimited: s.unlimited, stockQty: s.qty, shopFashion: s.fashion
        });
      }
      return row;
    });
    if (this._shopOnly) rows = rows.filter(r => r.inShop);

    const letters = [];
    const enabledRows = rows.filter(r => !r.dimmed);
    const dimmedRows  = rows.filter(r => r.dimmed);
    if (search) { this._greedySort(enabledRows, search); this._greedySort(dimmedRows, search); }
    else { this._assignLetters(enabledRows, true, letters); this._assignLetters(dimmedRows, false, letters); }
    if (dimmedRows.length) dimmedRows[0]._hiddenDivider = true;
    rows = [...enabledRows, ...dimmedRows];

    // Curated items not represented anywhere in the catalog index (legacy drag-ins, custom items, or
    // a source item that was since removed) — surfaced so the GM can still price/remove them.
    const indexKeys = new Set(all.map(i => i.key));
    const extras = this.shop.items
      .filter(it => !EXCLUDED_TYPES.has(it.type))
      .filter(it => { const sk = shopStockOf(it).sourceKey; return !sk || !indexKeys.has(sk); })
      .map(it => this._curatedRow(it));

    const stockCount = this.shop.items.filter(it => !EXCLUDED_TYPES.has(it.type)).length;
    return {
      rows, rowCount: rows.length, letters, extras,
      shopOnly: this._shopOnly, stockCount,
      sourcePanel: isGM ? this._sourcePanel(all, cfg) : null,
      shop: {
        id: this.shop.id, name: this.shop.name,
        open: this.shop.system?.open === true, fullSearch: this.shop.system?.fullSearch === true,
        notes: this.shop.system?.notes ?? ""
      }
    };
  }

  /** Storefront: curated stock only, unless the shop's fullSearch merges the whole visible catalog. */
  _dataStorefront(all, { isGM, cfg, search }) {
    const fullSearch = this.shop?.system?.fullSearch === true;
    const stockMap = this._shopStockMap();
    const curatedItems = this.shop.items.filter(it => !EXCLUDED_TYPES.has(it.type));
    const curatedRows = curatedItems.map(it => this._curatedRow(it));

    const manageBack = game.user.isGM || this.shop?.isOwner;
    if (!fullSearch) {
      curatedRows.sort((a, b) => a.name.localeCompare(b.name));
      this._assignLetters(curatedRows, false, []);
      return {
        rows: curatedRows, rowCount: curatedRows.length, letters: [], fullSearch: false,
        shop: { id: this.shop.id, name: this.shop.name, open: this.shop.system?.open === true },
        noSearch: true, manageBack
      };
    }

    // fullSearch: visible catalog + curated featured (deduped by sourceKey).
    const catalog = this._filterRows(all, { isGM, cfg, search });
    const featuredKeys = new Set(curatedRows.map(r => r.sourceKey).filter(Boolean));
    const featured = curatedRows.map(r => ({ ...r, featured: true }));
    const rest = catalog.filter(it => !featuredKeys.has(it.key)).map(it => ({ ...it, curated: false }));

    const letters = [];
    if (search) {
      this._greedySort(featured, search); this._greedySort(rest, search);
    } else {
      featured.sort((a, b) => a.name.localeCompare(b.name)); // featured shown under one divider, no A–Z headers
      rest.sort((a, b) => a.name.localeCompare(b.name));
      this._assignLetters(rest, true, letters);
    }
    if (featured.length) featured[0]._featuredDivider = true;
    if (rest.length && featured.length) rest[0]._restDivider = true;
    const rows = [...featured, ...rest];
    return {
      rows, rowCount: rows.length, letters, fullSearch: true,
      shop: { id: this.shop.id, name: this.shop.name, open: this.shop.system?.open === true },
      noSearch: false, manageBack
    };
  }

  // ── Purchase routing ─────────────────────────────────────────────────────

  /** Direct purchase at flat catalog cost (catalog mode + non-curated storefront rows). */
  async _directBuy(packId, itemId, { qty, styleMult, styleLabel }) {
    if (!this.buyer) { ui.notifications?.warn(game.i18n.localize("CYBERPUNK.ShopBuyerNeeded")); return; }
    const doc = await game.packs.get(packId)?.getDocument(itemId);
    if (!doc) return;
    const unitPrice = Math.max(0, Math.round((Number(doc.system?.cost) || 0) * styleMult));
    const label = styleLabel && styleMult !== 1 ? `${styleLabel} ×${styleMult}` : "";
    if (doc.type === "cyberware") {
      await buyAndInstallCyberware(this.buyer, doc, { partPrice: unitPrice });
    } else {
      const svc = classifyService(doc, game.packs.get(packId)?.metadata?.name ?? "");
      if (svc === "oneoff") await payOneOffService(this.buyer, doc, { unitPrice, priceLabel: label });
      else if (svc === "recurring") await buyItem(this.buyer, doc, { qty: 1, unitPrice, priceLabel: label, systemPatch: { serviceMode: "recurring" } });
      else await buyItem(this.buyer, doc, { qty, unitPrice, priceLabel: label });
    }
  }

  /** Buy a curated shop item, applying the shop's economics (price override / stock / fashion). */
  async _shopBuy(shopItemId, { qty, styleMult, styleLabel }) {
    if (!this.buyer) { ui.notifications?.warn(game.i18n.localize("CYBERPUNK.ShopBuyerNeeded")); return; }
    const item = this.shop?.items?.get(shopItemId);
    if (!item) return;
    const s = shopStockOf(item);
    const base = s.price != null ? s.price : (Number(item.system?.cost) || 0);
    if (item.type === "cyberware") {
      await buyAndInstallCyberware(this.buyer, item, { partPrice: base });
      return;
    }
    const svc = classifyService(item);
    if (svc === "oneoff") { await payOneOffService(this.buyer, item, { unitPrice: base }); return; }
    const systemPatch = svc === "recurring" ? { serviceMode: "recurring" } : null;
    await buyFromShop(this.shop, this.buyer, item, { qty, styleMult, styleLabel, systemPatch });
  }

  // ── Listeners ──────────────────────────────────────────────────────────────

  activateListeners(html) {
    super.activateListeners(html);
    const root = html instanceof jQuery ? html[0] : html;
    if (!root) return;
    const manage = this.mode === "build" && (game.user.isGM || this.shop?.isOwner);

    // Search (debounced).
    root.querySelector(".cp-catalog-search")?.addEventListener("input", (ev) => {
      this._search = ev.currentTarget.value;
      clearTimeout(this._t); this._t = setTimeout(() => this.render(false), 180);
    });
    // Source-badge toggle (per-user).
    root.querySelector(".cp-catalog-showsource")?.addEventListener("change", async (ev) => {
      try { await game.settings.set(SCOPE, "shopShowSource", ev.currentTarget.checked); } catch {}
      this.render(false);
    });

    // Category filters (inclusive).
    root.querySelectorAll(".cp-cat-chip").forEach(el => el.addEventListener("click", (ev) => {
      ev.preventDefault();
      const key = ev.currentTarget.dataset.cat;
      if (this._cats.has(key)) this._cats.delete(key); else this._cats.add(key);
      this.render(false);
    }));
    root.querySelector(".cp-cat-clear")?.addEventListener("click", (ev) => {
      ev.preventDefault(); this._cats.clear(); this.render(false);
    });

    // Jump-to-letter.
    root.querySelectorAll(".cp-jump").forEach(el => el.addEventListener("click", (ev) => {
      ev.preventDefault();
      const L = ev.currentTarget.dataset.letter;
      root.querySelector(`.cp-catalog-row[data-letter="${L}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    }));

    // GM source enable toggles → write shopEnabledSources.
    root.querySelectorAll(".cp-src-toggle").forEach(el => el.addEventListener("change", async (ev) => {
      const name = ev.currentTarget.dataset.source;
      const map = { ...(() => { try { return game.settings.get(SCOPE, "shopEnabledSources") || {}; } catch { return {}; } })() };
      if (ev.currentTarget.checked) map[name] = true; else delete map[name];
      try { await game.settings.set(SCOPE, "shopEnabledSources", map); } catch (e) { console.warn(e); }
      this.render(false);
    }));

    const styleOf = (rowEl) => {
      const sel = rowEl.querySelector(".cp-catalog-style");
      if (sel?.value) { const s = FASHION_STYLES.find(x => x.key === sel.value); if (s) return { styleMult: s.mult, styleLabel: s.label }; }
      return { styleMult: 1, styleLabel: "" };
    };
    const qtyOf = (rowEl) => Math.max(1, parseInt(rowEl.querySelector(".cp-catalog-qty")?.value, 10) || 1);

    // Buy (catalog + storefront).
    root.querySelectorAll(".cp-catalog-buy").forEach(btn => btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const rowEl = ev.currentTarget.closest("[data-item-id], [data-shop-item-id]");
      if (!rowEl) return;
      const { styleMult, styleLabel } = styleOf(rowEl);
      const qty = qtyOf(rowEl);
      const shopItemId = rowEl.dataset.shopItemId;
      if (shopItemId) await this._shopBuy(shopItemId, { qty, styleMult, styleLabel });
      else await this._directBuy(rowEl.dataset.packId, rowEl.dataset.itemId, { qty, styleMult, styleLabel });
      this.render(false);
    }));

    // Click an item's name/image → open its compendium sheet (read its full details).
    root.querySelectorAll(".cp-cat-itemname, .cp-cat-thumb").forEach(el => el.addEventListener("click", async (ev) => {
      const rowEl = ev.currentTarget.closest("[data-item-id], [data-shop-item-id]");
      if (!rowEl) return;
      ev.preventDefault(); ev.stopPropagation();
      await this._openItemSheet(rowEl);
    }));

    // Storefront: GM/owner "Manage" → switch this (singleton) window to the builder.
    root.querySelector(".cp-shop-manage")?.addEventListener("click", (ev) => { ev.preventDefault(); openShopBuilder(this.shop); });

    // ── Build mode: add/remove/economics + config + add-to-shop (catalog mode) ──
    this._activateShopControls(root, manage);
  }

  /** Open the source compendium sheet for a row (catalog item, or a curated item via its sourceKey). */
  async _openItemSheet(rowEl) {
    const { packId, itemId, shopItemId } = rowEl.dataset;
    let doc = null;
    if (packId && itemId) {
      try { doc = await game.packs.get(packId)?.getDocument(itemId); } catch { /* gone */ }
    } else if (shopItemId) {
      const it = this.shop?.items?.get(shopItemId);
      const sk = it ? shopStockOf(it).sourceKey : null;
      if (sk) { const i = sk.lastIndexOf("."); try { doc = await game.packs.get(sk.slice(0, i))?.getDocument(sk.slice(i + 1)); } catch { /* gone */ } }
      if (!doc) doc = it ?? null;   // fallback: the embedded shop item's own sheet
    }
    doc?.sheet?.render(true);
  }

  /** Build-mode curation controls, the global-catalog "Add to shop", and the config toolbar. */
  _activateShopControls(root, manage) {
    const rowItem = (el) => { const id = el?.closest?.("[data-shop-item-id]")?.dataset?.shopItemId; return id ? this.shop?.items?.get(id) : null; };
    const rowCatalog = (el) => { const r = el?.closest?.("[data-item-id]"); return r ? { packId: r.dataset.packId, itemId: r.dataset.itemId, fashion: r.dataset.fashion === "1" } : null; };

    // Global catalog (mode=catalog), GM: "Add to shop ▾" select.
    root.querySelectorAll(".cp-add-to-shop").forEach(sel => sel.addEventListener("change", async (ev) => {
      const val = ev.currentTarget.value;
      ev.currentTarget.value = "";  // reset the picker
      const cat = rowCatalog(ev.currentTarget);
      if (!val || !cat) return;
      let shop = game.actors.get(val);
      if (val === "__new__") {
        const name = await promptShopName();
        if (!name) return;
        shop = await Actor.create({ name, type: "shop", system: { open: false } });
      }
      if (!shop) return;
      const created = await addItemToShop(shop, cat.packId, cat.itemId, { fashion: cat.fashion });
      ui.notifications?.info(created
        ? game.i18n.format("CYBERPUNK.ShopAddedTo", { shop: shop.name })
        : game.i18n.localize("CYBERPUNK.ShopAlreadyStocked"));
    }));

    if (this.mode !== "build" || !manage) return;

    // Add a catalog item to this shop.
    root.querySelectorAll(".cp-shop-add").forEach(btn => btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const cat = rowCatalog(ev.currentTarget);
      if (!cat) return;
      await addItemToShop(this.shop, cat.packId, cat.itemId, { fashion: cat.fashion });
      this.render(false);
    }));
    // Remove a curated item from this shop.
    root.querySelectorAll(".cp-shop-remove").forEach(btn => btn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      const item = rowItem(ev.currentTarget);
      if (item) { await removeItemFromShop(this.shop, item.id); this.render(false); }
    }));
    // Edit a curated item's full item sheet.
    root.querySelectorAll(".cp-shop-edit").forEach(btn => btn.addEventListener("click", (ev) => {
      ev.preventDefault(); rowItem(ev.currentTarget)?.sheet?.render(true);
    }));

    // Inline economics (price override / unlimited / qty / fashion).
    root.querySelectorAll(".cp-shop-price").forEach(el => el.addEventListener("change", async (ev) => {
      const item = rowItem(ev.currentTarget); if (!item) return;
      const raw = ev.currentTarget.value.trim();
      const price = raw === "" ? null : Math.max(0, Math.round(Number(raw) || 0));
      await setShopStock(item, { price }); this.render(false);
    }));
    root.querySelectorAll(".cp-shop-unlimited").forEach(el => el.addEventListener("change", async (ev) => {
      const item = rowItem(ev.currentTarget); if (item) { await setShopStock(item, { unlimited: ev.currentTarget.checked }); this.render(false); }
    }));
    root.querySelectorAll(".cp-shop-stock-qty").forEach(el => el.addEventListener("change", async (ev) => {
      const item = rowItem(ev.currentTarget); if (item) await setShopStock(item, { qty: Math.max(0, parseInt(ev.currentTarget.value, 10) || 0) });
    }));
    root.querySelectorAll(".cp-shop-fashion").forEach(el => el.addEventListener("change", async (ev) => {
      const item = rowItem(ev.currentTarget); if (item) { await setShopStock(item, { fashion: ev.currentTarget.checked }); this.render(false); }
    }));

    // "Show only items in this shop" toggle.
    root.querySelector(".cp-shop-only")?.addEventListener("change", (ev) => { this._shopOnly = ev.currentTarget.checked; this.render(false); });

    // Config toolbar.
    root.querySelector(".cp-shop-name")?.addEventListener("change", async (ev) => {
      const name = ev.currentTarget.value.trim(); if (name) { await this.shop.update({ name }); this.render(false); }
    });
    root.querySelector(".cp-shop-fullsearch")?.addEventListener("change", async (ev) => {
      await this.shop.update({ "system.fullSearch": ev.currentTarget.checked });
    });
    root.querySelector(".cp-shop-notes")?.addEventListener("change", async (ev) => {
      await this.shop.update({ "system.notes": ev.currentTarget.value });
    });
    root.querySelector(".cp-shop-publish")?.addEventListener("click", async (ev) => { ev.preventDefault(); await publishShop(this.shop); this.render(false); });
    root.querySelector(".cp-shop-close")?.addEventListener("click", async (ev) => { ev.preventDefault(); await this.shop.update({ "system.open": false }); this.render(false); });
    root.querySelector(".cp-shop-preview")?.addEventListener("click", (ev) => { ev.preventDefault(); openShopStorefront(this.shop, resolveSidebarBuyer()); });
  }
}

/** Modal prompt for a new shop name (used by the catalog "Add to shop ▸ New shop…"). */
async function promptShopName() {
  return new Promise(resolve => {
    new Dialog({
      title: game.i18n.localize("CYBERPUNK.ShopNewTitle"),
      content: `<form><div class="form-group"><label>${game.i18n.localize("CYBERPUNK.ShopName")}</label><input type="text" name="n" value="${game.i18n.localize("CYBERPUNK.ShopNewDefault")}"/></div></form>`,
      buttons: {
        ok: { label: game.i18n.localize("CYBERPUNK.ShopCreate"), callback: (h) => resolve((h[0] ?? h).querySelector('[name="n"]')?.value?.trim() || "") },
        cancel: { label: game.i18n.localize("CYBERPUNK.Cancel"), callback: () => resolve("") }
      },
      default: "ok", close: () => resolve("")
    }).render(true);
  });
}

// ── Singleton window management ([[feedback-ui-singleton-assessment]]) ──────────────────────────
// Catalog/shop windows are SINGLETONS: one global cart, one window per shop id. Re-opening focuses
// the existing instance instead of spawning a duplicate.
// TODO (earmarked design polish): when an already-open singleton is re-opened, shimmer / highlight
// its border to draw the eye, rather than silently bringing it to top. See the memory note.

/** Focus an already-open browser for this shop (any mode), else null. */
function findShopWindow(shopId) {
  return Object.values(ui.windows).find(w => w instanceof CatalogBrowser && w.shop?.id === shopId) ?? null;
}

/** Focus the already-open GLOBAL catalog (the cart — no bound shop), else null. */
function findGlobalCatalog() {
  return Object.values(ui.windows).find(w => w instanceof CatalogBrowser && !w.shop) ?? null;
}

/** Bring a singleton window to the user's attention on a duplicate-open attempt. */
function focusSingleton(win) {
  // If it's already on screen, refresh in place + raise it. If its FIRST render is still in flight
  // (e.g. the catalog index is still loading), just (re-)render — bringToTop reads the element via
  // getComputedStyle and throws on a not-yet-attached window, so only raise a rendered one.
  if (win.rendered && win.element?.length) {
    win.render(false);
    try { win.bringToTop?.(); } catch (e) { /* element not ready — harmless */ }
  } else {
    win.render(true);
  }
  return win;
}

/** Open (or focus) the single global-catalog cart for a buyer. */
export function openCatalogBrowser(buyer) {
  const existing = findGlobalCatalog();
  if (existing) { existing.buyer = buyer ?? existing.buyer; return focusSingleton(existing); }
  return new CatalogBrowser(buyer).render(true);
}

/** Open (or focus) the GM shop BUILDER for a shop actor (one window per shop). */
export function openShopBuilder(shop) {
  if (!shop) return;
  const existing = findShopWindow(shop.id);
  if (existing) { existing.mode = "build"; existing.buyer = null; return focusSingleton(existing); }
  return new CatalogBrowser(null, { shop, mode: "build" }).render(true);
}

/** Open (or focus) the player-facing STOREFRONT for a shop actor (one window per shop). */
export function openShopStorefront(shop, buyer) {
  if (!shop) return;
  const existing = findShopWindow(shop.id);
  if (existing) { existing.mode = "storefront"; existing.buyer = buyer ?? existing.buyer ?? resolveSidebarBuyer(); return focusSingleton(existing); }
  return new CatalogBrowser(buyer ?? resolveSidebarBuyer(), { shop, mode: "storefront" }).render(true);
}

/** Route a shop actor to the right window: GM/owner → builder, others → storefront. */
export function openShopWindow(shop) {
  if (!shop) return;
  if (game.user.isGM || shop.isOwner) openShopBuilder(shop);
  else openShopStorefront(shop, resolveSidebarBuyer());
}

/** Resolve who's buying when the catalog is opened without sheet context. */
function resolveSidebarBuyer() {
  const tok = canvas?.tokens?.controlled?.find(t => t.actor?.type === "character");
  if (tok?.actor) return tok.actor;
  if (game.user.character?.type === "character") return game.user.character;
  return null;
}

/** Sidebar Shop button → open the global catalog (the shop IS the catalog). */
function openShopFromSidebar() {
  if (!shoppingEnabled()) { ui.notifications?.warn(game.i18n.localize("CYBERPUNK.ShopDisabled")); return; }
  openCatalogBrowser(resolveSidebarBuyer());
}

/**
 * Inject a native-looking Shop launcher button into the v13 sidebar tab strip (next to Actors,
 * Items, …). It's a plain launcher — no data-action="tab" — so Foundry's tab machinery ignores it;
 * clicking opens the catalog as a window. Idempotent + tolerant of jQuery/HTMLElement roots.
 */
function injectSidebarShopButton(html) {
  try {
    if (!shoppingEnabled()) return;
    const root = html instanceof jQuery ? html[0] : html;
    const menu = root?.querySelector?.("nav.tabs menu") ?? root?.querySelector?.(".tabs menu");
    if (!menu || menu.querySelector(".cp-shop-tab")) return;
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ui-control plain icon fa-solid fa-cart-shopping cp-shop-tab";
    btn.setAttribute("aria-label", game.i18n.localize("CYBERPUNK.ShopTitle"));
    btn.dataset.tooltip = game.i18n.localize("CYBERPUNK.ShopTitle");
    btn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); openShopFromSidebar(); });
    li.appendChild(btn);
    // Place directly under the Actors tab. Fall back to above the collapse caret, then end.
    const actorsLi = menu.querySelector('[data-tab="actors"]')?.closest("li");
    const collapseLi = menu.querySelector('[data-action="toggleState"]')?.closest("li");
    if (actorsLi) actorsLi.after(li);
    else if (collapseLi) menu.insertBefore(li, collapseLi);
    else menu.appendChild(li);
  } catch (e) { console.warn("Cyberpunk2020 | shop sidebar button failed", e); }
}

/**
 * Shop button entry router (character sheet). "catalog" → full-catalog browser; "shops" → a published
 * shop storefront (picker if several; warn if none).
 */
export function openShopForPlayer(buyer) {
  if (!shoppingEnabled()) { ui.notifications?.warn(game.i18n.localize("CYBERPUNK.ShopDisabled")); return; }

  if (shopBuySource() === "shops") {
    const shops = game.actors.filter(a => a.type === "shop"
      && (game.user.isGM || (a.system?.open !== false && a.testUserPermission(game.user, "LIMITED"))));
    if (!shops.length) { ui.notifications?.warn(game.i18n.localize("CYBERPUNK.ShopNonePublished")); return; }
    if (shops.length === 1) { openShopWindow(shops[0]); return; }
    const opts = shops.map(s => `<option value="${s.id}">${foundry.utils.escapeHTML(s.name)}</option>`).join("");
    new Dialog({
      title: game.i18n.localize("CYBERPUNK.ShopPickTitle"),
      content: `<form><div class="form-group"><label>${game.i18n.localize("CYBERPUNK.ShopTitle")}</label><select name="shop">${opts}</select></div></form>`,
      buttons: { open: { label: game.i18n.localize("CYBERPUNK.ShopBrowse"), callback: (h) => { const id = (h[0] ?? h).querySelector('[name="shop"]')?.value; const s = game.actors.get(id); if (s) openShopWindow(s); } } },
      default: "open"
    }).render(true);
    return;
  }
  openCatalogBrowser(buyer);
}

/**
 * GM "Show to Players": grant players observer access to a shop and post a clickable chat link.
 * (Also opens it — Show implies Open.)
 */
export async function publishShop(shop) {
  if (!shop) return;
  const LEVELS = CONST.DOCUMENT_OWNERSHIP_LEVELS;
  const ownership = foundry.utils.deepClone(shop.ownership ?? {});
  ownership.default = Math.max(ownership.default ?? LEVELS.NONE, LEVELS.OBSERVER);
  try { await shop.update({ ownership, "system.open": true }); }
  catch (e) { console.warn("Cyberpunk2020 | publishShop ownership update failed", e); }
  ChatMessage.create({
    content: `<div class="cp-shop-publish"><b>🛒 ${foundry.utils.escapeHTML(shop.name)}</b> is open for business. <button type="button" class="cp-shop-open-link" data-shop-id="${shop.id}">${game.i18n.localize("CYBERPUNK.ShopBrowse")}</button></div>`
  });
}

/** Ready-time hooks: sidebar Shop button + published-shop chat links + the GM stock-depletion socket relay. */
export function registerShopHooks() {
  // Sidebar Shop launcher (re-inject on every sidebar render; also inject the already-rendered one).
  Hooks.on("renderSidebar", (app, html) => injectSidebarShopButton(html));
  if (ui.sidebar?.element) injectSidebarShopButton(ui.sidebar.element);

  // Warm the catalog index in the background so the first open is instant (only if shopping is on).
  if (shoppingEnabled()) getCatalogIndex().catch(() => {});

  // Live-update an open catalog's buyer when the token selection changes (no need to reopen it).
  let _ctrlTimer = null;
  Hooks.on("controlToken", () => {
    clearTimeout(_ctrlTimer);
    _ctrlTimer = setTimeout(() => {
      const buyer = resolveSidebarBuyer();
      for (const w of Object.values(ui.windows)) {
        if (w instanceof CatalogBrowser && w.mode !== "build") { w.buyer = buyer; w.render(false); }
      }
    }, 50);
  });

  Hooks.on("renderChatMessage", (message, html) => {
    const root = html instanceof jQuery ? html[0] : html;
    root?.querySelectorAll?.(".cp-shop-open-link").forEach(btn => {
      if (btn.dataset.cpBound === "1") return;
      btn.dataset.cpBound = "1";
      btn.addEventListener("click", (ev) => { ev.preventDefault(); const s = game.actors.get(btn.dataset.shopId); if (s) openShopWindow(s); });
    });
  });

  game.socket.on("system.cyberpunk2020", async (data) => {
    if (data?.type !== "shopDeplete") return;
    if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return;
    const shop = game.actors.get(data.shopId);
    const item = shop?.items?.get(data.itemId);
    if (!item) return;
    const f = item.getFlag("cyberpunk2020", "shop") ?? {};
    if (f.unlimited !== false) return;
    const qty = Math.max(0, (Math.floor(Number(f.qty)) || 0) - (Math.floor(Number(data.qty)) || 1));
    try { await item.setFlag("cyberpunk2020", "shop", { ...f, qty }); }
    catch (e) { console.warn("Cyberpunk2020 | shopDeplete relay failed", e); }
  });
}
