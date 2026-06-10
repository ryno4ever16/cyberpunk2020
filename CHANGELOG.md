# Changelog

All notable changes to this system are recorded here. Dates are ISO (YYYY-MM-DD).

## [1.2.0-beta] — 2026-06-10

A feature release adding **Shopping**, folding **ammunition into the catalog**, and several
**character-sheet quality-of-life** features, plus a reworked setup / what's-new notice.

### Added — shopping & economy
- **Shop window**: a searchable master **catalog** (Core costs, category + source-book filters),
  GM-curated **custom shops** (per-item price/stock overrides + shop discount), a player
  **storefront** view, and **drag an item onto a character sheet to buy** it.
- **Ammunition in the catalog**: buy by **caliber + load** with box pricing, right from the
  catalog's *Ammo* section. The old on-sheet **"Buy Ammo" button is removed** (the optional
  in-inventory *Ammo Locker* still works).

### Added — character sheet
- **Tear-off tabs**: press-and-hold a sheet tab and drag it out into its own live, editable window.
- **Gear list**: drag rows to **reorder**, or drag a row **off the sheet to delete** it.
- **Improvement Points (IP) tracker** and a **Reputation / Facedown** panel on the combat tab.
- Singleton windows **shimmer** when you re-open/re-focus them instead of doing nothing.

### Changed
- **Setup / What's-New notice** is now a two-page dialog whose primary button reads **Next**
  until the last page; it appears on each load until you tick **"Don't show this again"** (the
  GM can re-enable it in System Settings). Its automation list is truth-checked: **Head Hit
  Doubling is shown as ON by default** (core 2020 rule, p.103); the other automations remain opt-in.

### Upgrade note — cyberware (read before upgrading)
- Upgrading re-runs the world migration, which **re-applies the compendium template** to each
  installed cyberware. **Preserved:** placement (limb/side), Humanity loss, cost, weight,
  equipped/active state, module links, and a **custom (renamed) name**. **Reverted to template:**
  other manual edits to a *recognized stock* cyberware — notably its **notes** and any hand-edited
  mechanical fields. To keep custom edits, **rename the item** or use a homebrew/non-canon
  cyberware entry (those are never overwritten). Renamed and homebrew cyberware are untouched.

### Housekeeping
- `version` → `1.2.0-beta`; `manifest` tracks the `Beta-v1.2.0` branch; `download` targets the
  `v1.2.0-beta` release tag.

## [1.1.1-beta] — 2026-06-06

A large feature release centred on **automated combat** and the new **Maximum Metal**
vehicle / powered-armor (ACPA) ruleset. This is a **beta**: the core ruleset and the
Maximum Metal layer are functional and tested, but a few optional rules are still
adjudicated manually (see *Known issues* in the README). Data changes are additive —
existing worlds load without migration.

### Added — Maximum Metal: vehicles & powered armor (ACPA)
- **Vehicle and ACPA sheets** (mech sheet), switched by an ACPA toggle on the same actor type.
- **Penetration → severity → hit-location** damage resolver for vehicles, and the faithful
  **SOP-damage** flow for powered armor (System Hit / Critical / Integrity charts, MM p.52–60).
- **Vehicle Weapons compendium** (68 entries: MGs/miniguns/gatlings, autocannon, recoilless,
  railguns, rockets, ATGMs, SAM/AAM/AAMRAM missiles, artillery, bombs) and an **ACPA Systems**
  compendium, both idempotent-by-name and force-reseedable.
- **Direct-fire shell selection** (base / Hi-Ex / HEAT) at fire time, persisted per weapon.
- **Composite armor** (halves shaped-charge Penetration) and **Reactive armor** (1d10 deflection
  that degrades with hits and is rearmed via *Replace*; stacks with Composite). MM p.23.
- **Area / indirect fire, missiles with in-flight resolution, countermeasures & anti-missile.**
- **Multiplayer-safe damage**: a player firing at a vehicle they don't own relays the hit to the
  owner/GM; two-GM double-application is guarded.

### Added — core combat automation
- **Target selection and automatic damage application**, including a chat-card *Apply Damage* button.
- **Per-shot armor ablation**, proportional stopping power, and an **armor-layering** system.
- **Automatic rangefinding** and basic **cover**.
- **Hit locations** with a display setting, plus **limb rules** including W4RST4R's alternate model.
- **Stun saves, death saves, and stabilization rolls**, with correct behaviour when a save is
  clicked by someone who doesn't own the actor.
- **Martial arts** redesigned into a single combat-tab action panel (fixes contributed via the
  Cyberpunk 2020 Discord).

### Added — gear
- **Ammo as items**: two-axis caliber + load, ammo consumed on reload, and ammo bindable to a weapon.

### Changed
- Non-destructive **data migration** with an accompanying bugfix; new fields use schema defaults.
- Documentation for contributors and beta testers: combat flowchart, feature list, and QA checklist.

### Housekeeping
- `version` → `1.1.1-beta`.
- `url` / `manifest` / `download` repointed to `github.com/ryno4ever16/cyberpunk2020`
  (manifest tracks the `Beta-v1.1.1` branch; download targets the `v1.1.1-beta` release tag).

## [1.1.0]
- Baseline prior release (netrunning, character sheet, skills-as-items, ranged combat,
  ammo tracking, Russian localisation). See repository history for details.
