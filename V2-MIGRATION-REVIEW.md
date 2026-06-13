# ApplicationV2 Migration — Review Checklist

Every place the v14-compat branch touched for the **ApplicationV2 / DialogV2** migration (the move
that makes the system v16-ready). Use this to review the updated UI code. Dev doc — **not shipped**
(the release build allowlist excludes loose root `.md` files).

**How to test any of these:** the rig (`:30002`) junctions `module/` `templates/` `css/` to this
working tree, so a **hard-reload in the browser (Ctrl+Shift+R) picks up edits — no rig restart
needed.** Restart the rig only for `options.json` changes or to recover a crashed/locked server.

**Verification legend:** ✅ verified (render + the noted interaction) · 🟡 render/instance-validated
only, interactions NOT auto-tested (the "blind port" risk) · 🐞 known open bug · ⬜ still V1.

---

## 1. Sheets — the big surface (ActorSheetV2 / ItemSheetV2)

| Sheet | Code | Template(s) | Status |
|------|------|-------------|--------|
| **Character / NPC** | `module/actor/actor-sheet.js` → `CyberpunkActorSheet` (l.28) | `templates/actor/actor-sheet.hbs` + everything in `templates/actor/parts/` | 🟡 **BLIND PORT** |
| **Tear-off tabs** | `module/actor/actor-tab-popout.js` → `CyberpunkActorTabSheet` (extends `CyberpunkActorSheet`, l.30) | reuses the actor parts | 🟡 |
| **Vehicle / ACPA** | `module/actor/vehicle-sheet.js` → `CyberpunkVehicleSheet` (l.27) | `vehicle-sheet.hbs`, `vehicle-sheet-wrapper.hbs`, `acpa-sheet.hbs` | 🟡 **reference V2 pattern** |
| **Item** | `module/item/item-sheet.js` → `CyberpunkItemSheet` (l.20) | `templates/item/item-sheet.hbs` + `templates/item/parts/` | 🟡 |

**What changed in all four:** base class → `*SheetV2`; `getData` → `_prepareContext`; the V1 jQuery
`activateListeners` is re-invoked from a new `_onRender` (tabs bound manually); template root
`<form>` → `<div>` (the `<form>` now comes from `tag:"form"`); `dragDrop` declared in
`DEFAULT_OPTIONS`; `this.options` is frozen (per-instance state on private fields).

**Review focus (highest risk — these are the blind ports):**
- **Buttons inside the sheet:** any `<button>` without `type="button"` now submits the V2 form on
  click. Audit every button in the actor/item templates. *(This class of bug is exactly what
  bricked the fire flow in the dialogs — see §3.)*
- Tab switching, item **drag-to-reorder** + drag-onto-sheet, the ProseMirror **notes** editor save,
  in-sheet **delete-confirm**, the avatar/icon **FilePicker**.
- `_prepareContext` returning the full shape the templates expect (it builds the base context
  explicitly — no `super.getData`).

**Known open bugs here (from your testing — not yet fixed):**
- 🐞 **Sticky corner-resize** — resize mode latches; needs rig repro.
- 🐞 **Wound track hard to see / flexing oddly** — CSS regression suspect (the V2 part wrapper
  changes the flex context). `templates/actor/parts/woundtracker.hbs` + `.wound-tracker` /
  `.wound-state` / `.damage` rules in `css/cyberpunk2020.css`. Compare against the v13 rig (:30003).

---

## 2. Application windows (ApplicationV2 subclasses)

| Window | Code | Template | Status |
|--------|------|----------|--------|
| **Attack modifiers / fire** | `module/dialog/modifiers.js` → `ModifiersDialog` (l.11) | `templates/dialog/modifiers.hbs` | ✅ **fire verified** (nested-form fix) |
| **Apply Damage** | `module/combat/DamageDialog.js` → `DamageDialog` (l.21) | `templates/dialog/damage-dialog.hbs` | ✅ nested-form fix (same pattern) |
| **IP Tracker** | `module/ip/tracker.js` → `IpTracker` (l.18) | (its template) | 🟡 |
| **Shop / Catalog** | `module/shop/catalog.js` → `CatalogBrowser` (l.80) | `templates/shop/catalog.hbs` | ✅ **ported + verified** (2026-06-13) |

**Shop port — what changed** (`module/shop/catalog.js`, was `extends Application`):
- base class → `HandlebarsApplicationMixin(ApplicationV2)`; `static get defaultOptions()` →
  `static DEFAULT_OPTIONS` + `static PARTS`; `getData()` → `_prepareContext()`.
- the old `_render` scroll-capture override → the PART's `scrollable: [".cp-catalog-list"]`.
- preserved jQuery `activateListeners` is now re-invoked from a new `_onRender` (which also keeps the
  window header title synced to the dynamic, view-based `get title()`); dropped the `super.activateListeners`.
- **singleton lookup moved off `ui.windows` → `foundry.applications.instances`** (V2 apps aren't in
  `ui.windows` — this is the one change that would've silently broken find-or-focus). `bringToTop()` →
  `bringToFront()`; `win.element?.length` (jQuery) → `win.element`.
- `render(false)` → `render()`, `render(true)` → `render({force:true})` throughout.
- 4× `Dialog.confirm()` → `foundry.applications.api.DialogV2.confirm({ window:{title}, rejectClose:false })`.
- **Verified on the rig:** V2 instance, in `foundry.applications.instances` (not `ui.windows`), renders,
  singleton lookup resolves, home→catalog navigation + title sync work, catalog renders 910 rows.
  *(Not auto-tested: every buy/build-mode interaction — preserved jQuery, exercised via `_onRender`.)*

---

## 3. `new Dialog` → `DialogV2` conversions (~21 call sites)

Grep `DialogV2` in each file to find them. These are pop-up prompts (confirm/choose), not windows.

| File | Sites | Notes |
|------|-------|-------|
| `module/combat/damage-hooks.js` | 3 | l.169 "Wait for Turn" · l.750 "Apply Damage — Select Target" · **l.1874 "Cyberpunk 2020 — Setup & What's New"** 🐞 |
| `module/actor/actor-sheet.js` | 3 | confirm/prompt dialogs invoked from the sheet |
| `module/shop/catalog.js` | 7 | buy / qty / text prompts + 4 `Dialog.confirm`→`DialogV2.confirm` converted during the shop's V2 port |
| `module/vehicle/vehicle-ordnance.js` | 2 | indirect-fire / bomb dialogs |
| `module/vehicle/vehicle-weapons.js` | 2 | shell-selection etc. |
| `module/vehicle/vehicle-acpa-combat.js` | 1 | |
| `module/vehicle/vehicle-control.js` | 1 | |
| `module/vehicle/vehicle-damage.js` | 1 | |
| `module/combat/save-rolls.js` | 1 | |
| `module/cyberware/install.js` | 1 | install confirm |
| `module/dialog/buy-ammo.js` | 1 | buy-ammo prompt |
| `module/ip/ip.js` | 1 | level-up confirm |
| `module/ip/tracker.js` | 1 | |

**🐞 Known open bug:** the **Setup & What's New** dialog (`damage-hooks.js:1874`) renders too narrow
and its buttons are dead except "Settings." Likely a `DialogV2` button-action wiring + width/CSS
issue. *(This is the "migration dialogue" you reported — next on the list after the SVG fix.)*

**Review focus for DialogV2 sites:** `DialogV2.wait` resolves to the button callback's **return
value**, but a `null`/`undefined` return falls back to the action id — so success must be mapped by
type/shape (number for qty, `{ok:true}` object for text), and the X-close path must return `null`.

---

## 4. Still ApplicationV1

**None.** The shop `CatalogBrowser` was the last V1 window and is now ApplicationV2 (§2). Verified
across the whole `module/` tree: **no `extends Application/FormApplication/Dialog/ActorSheet/ItemSheet`
and no `new Dialog(` remain** — the UI layer is fully ApplicationV2 / DialogV2 (v16-ready).

---

## 5. Templates changed to the V2 single-root shape (`<form>`→`<div>`)

`templates/actor/actor-sheet.hbs` · `templates/actor/vehicle-sheet.hbs` ·
`templates/actor/vehicle-sheet-wrapper.hbs` · `templates/actor/acpa-sheet.hbs` ·
`templates/item/item-sheet.hbs` · `templates/dialog/modifiers.hbs` · `templates/dialog/damage-dialog.hbs`

(The `<form>` is now supplied by the app's `tag:"form"`. A **nested** `<form>` inside any of these
re-introduces the native-GET-submit brick — the two dialog templates had this and are now fixed.)

---

## 6. Status of the bugs you reported

| Bug | Where | State |
|-----|-------|-------|
| Fire → `game?firemode=…` bricks app | `modifiers.hbs` (+ `damage-dialog.hbs`) | ✅ fixed + live-verified |
| Cyberware male SVG blank | `templates/actor/parts/cyberware.hbs` (`<object>`→`<img>`) | ✅ fixed + live-verified |
| Migration dialog narrow + dead buttons | `damage-hooks.js:1874` | 🐞 next |
| Sticky corner-resize | actor sheet (V2) | 🐞 rig-repro pending |
| Wound track styling / flex | `woundtracker.hbs` + CSS | 🐞 rig-repro pending |
| Shop was ApplicationV1 | `shop/catalog.js` | ✅ ported to ApplicationV2 + rig-verified |

---

## 7. Recovery anchor

Pre-V2-rewrite state is tagged `pre-blind-sheets-rewrite` (per `PROGRESS.md`). The actor/item sheet
ports carry an explicit "BLIND PORT" header noting they were converted without live rig validation.
