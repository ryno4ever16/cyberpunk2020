---
name: combat-flowchart
description: Programmer's reference for the CP2020 FoundryVTT combat system — full system, all files, hook registry, integration contracts, flag map, settings gates
metadata:
  type: project
---

# CP2020 Combat System — Programmer's Reference

**Scope:** Full system. Covers all files. AI-written code marked ◆, human-written marked ○.
**Last updated:** Session 14 (player damage button, socket relays, multi-GM gating, gas-cloud fix)
**Note:** `file:line` references are approximate anchors and drift as code is added; trust the function/feature names over exact line numbers. See [[combat-data-hazards]] for the two highest-risk gotchas (`attackerId` field name, `activeGM` socket gate).

---

## Authorship Map

| File | Author | Role |
|---|---|---|
| module/item/item.js ○ | Human | Weapon rolls, fire modes, melee, all Hooks.callAll emitters |
| module/actor/actor.js ○ | Human | Actor data prep, woundState(), stunThreshold(), getSkillVal() |
| module/actor/actor-sheet.js ○ | Human | Sheet rendering, getData(), armor display |
| module/combat/damage-hooks.js ◆ | AI | Damage routing (PATH A/B), all combat tracker buttons, per-turn effects |
| module/combat/DamageApplicator.js ◆ | AI | SP math, BTM, ablation, limb loss |
| module/combat/DamageDialog.js ◆ | AI | GM confirmation dialog before damage apply |
| module/combat/save-rolls.js ◆ | AI | Stun/death/stabilize prompts, chat button handlers, taser/acid DOT helpers |
| module/combat/armor-layers.js ◆ | AI | Layer ordering, hardness detection, SP contributor list |
| module/settings.js ○◆ | Human (base) + AI (13 added) | All game settings registration |

---

## Part 1: Hook Registry

Every hook registration in the system. This is the first place to look when tracing any feature.

### Hooks.on (listeners)

| Hook | Handler | File:Line | GM-only | Setting Gate |
|---|---|---|---|---|
| `cyberpunk2020.weaponFired` | PATH A/B damage routing | damage-hooks.js:_hookWeaponFired | **ownership** | damageAutoApply (path) |
| `cyberpunk2020.weaponFired` | Clear aimRounds flag | _hookAimTracking | no | aimTrackingEnabled |
| `cyberpunk2020.weaponFired` | Create gas cloud if Gas ammo | _hookGasCloud | GM (primary) | gasGrenadeCloudEnabled |
| `cyberpunk2020.weaponFired` | Increment action count | _hookMultiActionPenalty | no | multiActionAutoTrack |
| `cyberpunk2020.suppressiveFire` | Create ray template | _hookSuppressiveFire | yes | suppressiveFireSaves |
| `createChatMessage` | Attach damagePayload flag (PATH B) | _hookCreateChatMessage | **no** (client-local _pendingPayload) | — |
| `renderChatMessage` | Inject "Apply Damage" button | _hookRenderChatMessage | **no** (GM or attacker-owner) | — |
| `system.cyberpunk2020` (socket) | Apply player-relayed damage | _hookSocketRelay | GM (primary) | — |
| `system.cyberpunk2020` (socket) | Write relayed stabilization flag | save-rolls.js:_registerStabilizeSocket | GM (primary) | — |
| `preUpdateMeasuredTemplate` | Lock fire zone origin, clamp distance | damage-hooks.js:544 | yes | suppressiveFireSaves |
| `updateCombat` | Suppressive fire per-turn evasion + expiry | damage-hooks.js:570 | yes | suppressiveFireSaves |
| `updateCombat` | Wait-for-turn "your moment" alert; round clear | damage-hooks.js:877 | yes | waitForTurnEnabled |
| `updateCombat` | Dodge/parry flag cleanup | damage-hooks.js:985 | yes | activeDodgeParryEnabled |
| `updateCombat` | Acid DOT, choke DOT, hold/grapple reminders | damage-hooks.js:1009 | yes | acidArmorDotEnabled, specialMeleeEffectsEnabled |
| `updateCombat` | Gas cloud per-turn saves + expiry + drift | damage-hooks.js:1196 | yes | gasGrenadeCloudEnabled |
| `updateCombat` | Multi-action count reset on round change | damage-hooks.js:1356 | yes | multiActionPenaltyEnabled |
| `updateCombat` | Stun/death save re-prompts | save-rolls.js:512 | yes | autoSaveRePrompt, autoDeathSavePerTurn |
| `renderCombatTracker` | Inject 🎯 Aim button | damage-hooks.js:769 | no (owner) | aimTrackingEnabled |
| `renderCombatTracker` | Inject ⏸/⚡ Wait buttons | damage-hooks.js:838 | no (owner) | waitForTurnEnabled |
| `renderCombatTracker` | Inject 🛡/⛨ Dodge/Parry buttons | damage-hooks.js:937 | no (owner) | activeDodgeParryEnabled |
| `renderCombatTracker` | Inject ×N badge + ➕ button | damage-hooks.js:1291 | no (owner) | multiActionPenaltyEnabled |
| `renderModifiersDialog` | Pre-fill aimRounds select | damage-hooks.js:796 | no | aimTrackingEnabled |
| `renderModifiersDialog` | Pre-fill extraMod with penalty | damage-hooks.js:1334 | no | multiActionPenaltyEnabled |

### Hooks.callAll (emitters)

All emitters are in human-written item.js except the last row.

| Hook | Method (item.js) | Line | Payload Includes |
|---|---|---|---|
| `cyberpunk2020.weaponFired` | `__fullAuto` | 573 | areaDamages, targetTokenId (per target in loop) |
| `cyberpunk2020.weaponFired` | `__threeRoundBurst` | 652 | areaDamages, targetTokenId |
| `cyberpunk2020.weaponFired` | `__semiAuto` | 777 | areaDamages, targetTokenId |
| `cyberpunk2020.weaponFired` | `__meleeBonk` | 945, 954 | areaDamages, edged, targetTokenId (two paths: hit vs miss) |
| `cyberpunk2020.weaponFired` | `__martialBonk` | 1096, 1107 | areaDamages, edged, targetTokenId |
| `cyberpunk2020.suppressiveFire` | `__suppressiveFire` | 716 | saveDC, dmgFormula, weaponName, zoneWidth, weaponRange |
| `cyberpunk2020.weaponFired` | `_executeSuppressionEvasion` ◆ | damage-hooks.js:672 | areaDamages, targetTokenId (on evasion failure) |

### Click Listeners (document.addEventListener)

Two independent registrations. They do not share any state.

**Registration 1 — damage-hooks.js:75** (registered in `registerDamageHooks`):

| CSS class | Handler | File:Line |
|---|---|---|
| `.cp-suppression-evasion-roll` | `_executeSuppressionEvasion()` | damage-hooks.js:625 |
| `.cp-confirm-fire-zone` | `_confirmFireZone()` | damage-hooks.js:473 |
| `.cp-take-aim-btn` | Cycle aimRounds 0→1→2→3→0 | damage-hooks.js:112 |
| `.cp-wait-for-turn-btn` | Show dialog, set flags, call nextTurn | damage-hooks.js:143 |
| `.cp-wait-act-btn` | Unset waiting flags, post chat | damage-hooks.js:220 |
| `.cp-dodge-btn` | Toggle dodging flag | damage-hooks.js:178 |
| `.cp-parry-btn` | Toggle parrying flag | damage-hooks.js:199 |
| `.cp-add-action-btn` | `_incrementActionCount()` | damage-hooks.js:232 |

**Registration 2 — save-rolls.js:475** (registered in `registerSaveRollHandlers`):

| CSS class | Handler | File:Line |
|---|---|---|
| `.cp-stun-save-roll` | `executeStunSave()` | save-rolls.js:260 |
| `.cp-death-save-roll` | `executeDeathSave()` | save-rolls.js:291 |
| `.cp-stabilize-roll` | `executeStabilize()` | save-rolls.js:359 |

---

## Part 2: Core Payload Contract

The `weaponFired` hook payload is the primary interface between human-written item.js and AI-written damage-hooks.js / DamageApplicator.js. If either side changes its structure, the damage system breaks silently.

### `areaDamages` object

```js
// Built in item.js (e.g. line 548), consumed by DamageApplicator.js (line 126)
{
  "Head":  [{ damage: 10, damageHtml: "..." }],
  "Torso": [{ damage: 5,  damageHtml: "..." }, { damage: 3, damageHtml: "..." }],
  // etc. Keys are location strings from rollLocation()
}
```

- Each key is a hit location string: `"Head"`, `"Torso"`, `"R. Arm"`, `"L. Arm"`, `"R. Leg"`, `"L. Leg"`
- Each value is an array (one entry per bullet that landed at that location)
- `damage` (number) is required. `damageHtml` is display-only, not used in math
- DamageApplicator.js:169 also accepts `dmg` as a fallback key name

### Full `weaponFired` payload

```js
{
  // ── Origin ──────────────────────────────────────────────────────────
  attackerId:        string | null,   // actor.id of shooter
  weaponName:        string,
  // ── Damage ──────────────────────────────────────────────────────────
  areaDamages:       object,          // see above
  edged:             boolean,         // true = soft armor SP halved (melee only)
  // ── Armor interaction (from _getAmmoProps / ammo item) ───────────────
  ap:                boolean,         // true = SP halved (standard AP)
  armorMultSoft:     number,          // SP multiplier for soft armor (1.0 = none)
  armorMultHard:     number,          // SP multiplier for hard armor
  // ── Target routing ──────────────────────────────────────────────────
  targetTokenId:     string | null,   // PATH A if present; PATH B if null
  targetActorId:     string | null,
  // ── Secondary effects (from ammo item) ──────────────────────────────
  stunSaveOnHit:     boolean,
  stunSaveMod:       number,
  dotEnabled:        boolean,
  dotTurns:          number,
  dotDamageFormula:  string,
  effectTypes:       string[],        // ["None"] | ["Gas"] | ["Taser"] etc.
  blastRadius:       number,
}
```

---

## Part 3: The weaponFired Pipeline

A single `Hooks.callAll("cyberpunk2020.weaponFired")` triggers all of these independently and in order:

```
item.js emits cyberpunk2020.weaponFired
         │
         ├──► [damage-hooks.js:250]  PATH A/B routing
         │      payload.targetTokenId present?
         │        Yes → PATH A: DamageDialog or _autoApply immediately
         │        No  → PATH B: _pendingPayload = payload (consumed by next createChatMessage)
         │
         ├──► [damage-hooks.js:808]  Aim tracking clear
         │      aimTrackingEnabled? → actor.unsetFlag("aimRounds")
         │
         ├──► [damage-hooks.js:1126]  Gas cloud creation
         │      gasGrenadeCloudEnabled && effectTypes includes "Gas"?
         │        → scene.createEmbeddedDocuments("MeasuredTemplate", [circle])
         │
         └──► [damage-hooks.js:1348]  Multi-action auto-increment
                multiActionAutoTrack? → _incrementActionCount(actor)
```

All four listeners run even if earlier ones short-circuit. They are registered independently inside separate `_hookXxx()` functions and have no shared state.

### Ownership routing (who handles a weaponFired event)

`Hooks.callAll` multicasts to **every** connected client. `_hookWeaponFired` routes by ownership so exactly one client acts:
```
attackerActorId = payload.attackerId ?? payload.actorId   ← item.js sends attackerId
isMyShot  = !isGM && attackerActor.isOwner                 ← player handles own actor's shots
gmHandles =  isGM && !attackerActor.hasPlayerOwner         ← GM handles NPCs + offline-player PCs
if (!isMyShot && !gmHandles) return;
```
`hasPlayerOwner` is true only when an owning player is currently **connected**, so the GM auto-takes-over offline players. The same `payload.attackerId ?? payload.actorId` resolution is used in `_hookRenderChatMessage`, `_hookAimTracking`, `_hookMultiActionPenalty`, and `_hookGasCloud`. Reading `payload.actorId` alone is a silent break (item.js never sets it) — see [[combat-data-hazards]].

### PATH B — "Apply Damage" button click flow

When PATH B is active, a chat message is created with an "Apply Damage" button, injected by `_hookRenderChatMessage`. The button shows to the **GM always**, and to a **player only if they own the attacker actor** (`canApply = isGM || attackerActor.isOwner`). An idempotency guard (`if root.querySelector(".cp2020-apply-damage-btn") return`) prevents duplicate buttons across re-renders (setFlag re-render, popout, scrollback). When GM or owner clicks it, target resolution happens in three steps before damage applies:

```
GM/owner clicks "Apply Damage" button in chat
  │
  ├─ Step 1: Check game.user.targets (canvas targeting)
  │     game.user.targets.size > 0?
  │       Yes → use that token immediately — no dialog shown
  │       No  → continue to step 2
  │
  ├─ Step 2: Check payload IDs (was a target set at fire time?)
  │     _resolveTarget(payload)  [damage-hooks.js:683]
  │       Resolves targetTokenId → canvas token → actor
  │       Or resolves targetActorId → game.actors → actor
  │       Found? → use it — no dialog shown
  │       Not found? → continue to step 3
  │
  └─ Step 3: _pickTargetDialog()  [damage-hooks.js:698]
        Shows a dialog with two options side by side:
        ┌─────────────────────────────────────────────────┐
        │ 🎯 Target a token on the canvas                 │
        │ [status: "✔ Goon 3 targeted" or "No target"]   │
        │ ─────────────────────────────────────────────   │
        │ Or pick from list: [dropdown of scene tokens]   │
        └─────────────────────────────────────────────────┘
        Buttons:
          [Use Canvas Target]  (default if token already targeted at open time)
          [Use List]           (default if no token targeted at open time)
          [Cancel]

        "Use Canvas Target" re-reads game.user.targets at click time.
          → GM can target a token WHILE the dialog is open, then click this button.
          → If nothing is targeted at click time: ui.notifications.warn() + resolve(null).
            The dialog closes; GM targets a token and clicks Apply Damage again.

        "Use List" resolves validTokens[dropdown_index].actor.

  After target is resolved (any path):
    damageAutoApply ON? → _autoApply(payload, target)    damage-hooks.js:_autoApply
    damageAutoApply OFF? → new DamageDialog(payload, target).render(true)
```

**Player applying to an NPC:** a player cannot `actor.update()` an unowned NPC, so both `_autoApply` (non-GM branch) and `DamageDialog._onApply` (non-GM branch) emit a `system.cyberpunk2020` socket message instead of writing directly. The primary GM applies it. See Part 13.

**Why three steps?** Step 1 covers the most common GM workflow (pre-target before clicking). Step 2 covers the case where a target was set at fire time but PATH B was still used (e.g., full-auto with one target). Step 3 is the explicit fallback for genuinely untargeted shots where the GM must decide after the fact.

---

## Part 4: Damage Resolution Chain

Entry: called by `_autoApply()` (damage-hooks.js:1370) or `DamageDialog._onApply()` (DamageDialog.js:150).

```
applyAreaDamages({ target, areaDamages, ap, edged, armorMultSoft, armorMultHard,
                   armorMode, ablate, coverSP, dryRun })
  DamageApplicator.js:126

  For each location in areaDamages:
    For each hit at that location:

      1. rawDamage = hit.damage  (no head doubling here — it applies after BTM)

      2. getArmorContributors(target, location)    armor-layers.js:133
           → ordered layer list (inside-out, soft before hard)
           → cover SP added as outermost layer

      3. SP calculation (armorMode = full / simple / none):
           full:   _deriveLiveSP() via proportional table, applying armorMultSoft/Hard
           simple: flat SP from first contributor
           none:   SP = 0

      4. resolveHitMath({ currentSP, rawDamage, ap, armorMode, coverSP })
           DamageApplicator.js:73
           → if ap: effectiveSP = floor(SP / 2)
           → damageAfterSP = max(0, rawDamage − effectiveSP)
           → penetrates = damageAfterSP > 0

      5. (dryRun = false only):
           a. btmDamage = applyBTM(damageAfterSP, btm, penetrates)    DamageApplicator.js:102
                → btmDamage = max(1, damageAfterSP − btm)  [min 1 if penetrates, 0 if not]
              Head hit doubling (CP2020 p.103), applied AFTER BTM:
                headHitDoubling && location=="Head" && btmDamage > 0?
                  → netDamage = btmDamage * 2
                else:
                  → netDamage = btmDamage
              NOTE: doubling never applies to 0 — a shot that doesn't penetrate deals 0 to head, not 0×2
           b. actor.update({ "system.damage": current + netDamage })
           c. ablate && penetrates:
                → _ablateLocation(target, location)    DamageApplicator.js:301
                     → reduces outermost non-skinweave armor SP by 1
           d. limbLossEnabled && netDamage > 8:
                → location in LIMBS? → postDeathSavePrompt(actor, token, 0)
                → location == "Head"? → auto-death, apply "dead" status

      6. Push result { location, rawDamage, spFull, spUsed,
                       damageAfterSP, btm, netDamage, penetrates }

resolveAreaDamagesSync()    DamageApplicator.js:252
  → same logic but always dryRun=true, synchronous
  → used by DamageDialog.getData() for preview before GM applies

ablateLocationByAmount(target, location, amount)    DamageApplicator.js:330
  → used only by acid DOT (per-turn, not per hit)
  → distributes SP reduction across layers outermost first
  → calls target.updateEmbeddedDocuments("Item", updates)
```

**Dialog preview note:** `resolveAreaDamagesSync` (used for the per-row preview) does NOT apply head doubling.
Doubling happens after BTM, which the preview doesn't compute per-row. The dialog `totalNet`
and `_updateTotalDisplay` both apply BTM + head doubling, so the footer total is correct.
The per-row `damageAfterSP` values show pre-BTM, pre-doubling armor resolution only.

**After applyAreaDamages returns** (in both _autoApply and DamageDialog._onApply):
```
hits.some(h => h.penetrates)?
  Yes && stunSaveOnHit:
    taserCumPenaltyEnabled? → updateTaserState(target, payload)    save-rolls.js:90
  acidArmorDotEnabled && dotEnabled && dotTurns > 0?
    → applyAcidDotState(target, location, turnsLeft, formula)    save-rolls.js:60
  → _postSavePrompts(actor, token)    DamageDialog.js:226
       → postStunSavePrompt(actor, token)    save-rolls.js:141
       → woundState >= 4? → postDeathSavePrompt(actor, token)    save-rolls.js:184
```

---

## Part 5: Per-Turn Pipeline (updateCombat)

**Seven independent registrations** fire when Foundry advances a turn or round. All are GM-only. They run in registration order.

```
Hooks.on("updateCombat", ...)  — registered six times across two files

Firing condition:
  Turn change:  updateData.turn  !== undefined
  Round change: updateData.round !== undefined
  Both can be true simultaneously (first turn of a new round).
```

| # | Handler | File:Line | Fires On | Key Condition |
|---|---|---|---|---|
| 1 | Suppressive fire evasion + zone expiry | damage-hooks.js:570 | turn | isSuppressiveZone templates exist |
| 2 | Wait-for-turn "your moment" alert | damage-hooks.js:877 | turn | waitingAfterId matches justActed combatant |
| 2 | Wait-for-turn round-clear | damage-hooks.js:877 | round | any combatant has waitingForTurn flag |
| 3 | Dodge flag clear (active combatant) | damage-hooks.js:985 | turn | actor has dodging flag |
| 3 | Parry flag clear (round sweep) | damage-hooks.js:985 | round | any actor has parrying flag |
| 4 | Acid DOT SP degradation per entry | damage-hooks.js:1009 | turn | acidArmorDotEnabled, dotState flag exists |
| 4 | Choke DOT damage + stun save | damage-hooks.js:1009 | turn | specialMeleeEffectsEnabled, chokeState flag |
| 4 | Hold/grapple turn reminders | damage-hooks.js:1009 | turn | heldBy or grappledBy flag, !dead |
| 5 | Gas cloud saves, expiry, drift | damage-hooks.js:1196 | turn | isGasCloud templates exist |
| 6 | Multi-action count reset | damage-hooks.js:1356 | round | actionCount flag on any combatant |
| 7 | Stun save re-prompt | save-rolls.js:512 | turn | actor has "unconscious" status |
| 7 | Death save re-prompt | save-rolls.js:512 | turn | woundState >= 4 && !stabilized |

**Handler 4 detail — _hookDotEffects() acid DOT path:**
```
rawDot = actor.getFlag("dotState")
  → normalize: Array.isArray(raw) ? raw : (raw ? [raw] : [])   ← legacy migration
  → for each entry { location, turnsLeft, formula }:
       Roll formula → ablateLocationByAmount(actor, location, result)
       decrement turnsLeft
       turnsLeft <= 0 → drop entry; turnsLeft > 0 → keep
  → surviving.length > 0? → setFlag("dotState", surviving)
  → else → unsetFlag("dotState")
```

**Handler 4 detail — choke DOT path:**
```
actor.statuses?.has("dead")?
  Yes → unsetFlag("chokeState")   ← dead-actor guard (Bug 2 fix)
  No  → Roll formula → actor.update({ "system.damage": ... })
       → postStunSavePrompt(actor, token)
```

---

## Part 6: Combat Tracker UI

Four independent `renderCombatTracker` listeners inject buttons. All run on every tracker re-render.

```
renderCombatTracker fires
  │
  ├──► [damage-hooks.js:769]  Aim button  (aimTrackingEnabled)
  │      Active combatant → <a class="cp-take-aim-btn"> 🎯
  │      Badge: aimCount number + color if > 0
  │
  ├──► [damage-hooks.js:838]  Wait buttons  (waitForTurnEnabled)
  │      isWaiting → <a class="cp-wait-act-btn"> ⚡  (all combatants)
  │      isActive && !isWaiting → <a class="cp-wait-for-turn-btn"> ⏸
  │
  ├──► [damage-hooks.js:937]  Dodge/Parry buttons  (activeDodgeParryEnabled)
  │      Active combatant → <a class="cp-dodge-btn"> 🛡
  │      Any combatant (owner/GM) → <a class="cp-parry-btn"> ⛨
  │
  └──► [damage-hooks.js:1291]  Multi-action badge + ➕  (multiActionPenaltyEnabled)
         Any combatant, count > 0 → <span class="cp-action-count-badge"> ×N (−P)
         Active combatant → <a class="cp-add-action-btn"> ➕
```

**Aim button click flow:**
```
current aimCount (0–3) → nextCount = (aimCount + 1) % 4
  going 0→1, 1→2, 2→3:
    setFlag("aimRounds", next)
    multiActionAutoTrack? → _incrementActionCount(actor)
  going 3→0 (reset):
    unsetFlag("aimRounds")   ← no action count increment
ui.combat?.render()
```

**Wait button click flow:**
```
remaining = combat.turns after current, excluding self + already-waiting combatants
remaining.length === 0?
  → ui.notifications.info("already last") → EXIT   ← Bug 1 fix (no flags set)
else:
  Dialog "Act after which combatant?" → user picks targetId
  cancelled? → EXIT
  setFlag("waitingForTurn", true)
  setFlag("waitingAfterId", targetId)
  combat.nextTurn()
  ChatMessage.create(...)
```

**⚡ button click flow:**
```
unsetFlag("waitingForTurn")
unsetFlag("waitingAfterId")
ChatMessage.create(...)
```

**Modifier dialog pre-fills (renderModifiersDialog):**
```
Aim:         select[name='aimRounds'].value = saved aimRounds flag
Multi-action: input[name='extraMod'].value += _getMultiActionPenalty(actor)
              (additive — doesn't overwrite other pre-fills)
```

---

## Part 7: Save System

**Entry via chat buttons** (save-rolls.js:475 click listener):
```
.cp-stun-save-roll  → executeStunSave({ actorId, tokenId, sceneId })    save-rolls.js:260
  Roll 1d10
  result <= getStunThreshold(actor)?    save-rolls.js:104
    Yes → "conscious" chat result
    No  → _applyStatusEffect(actor, "unconscious")    save-rolls.js:433
            → Foundry status + movement speed = 0

.cp-death-save-roll → executeDeathSave({ actorId, tokenId, sceneId, mortalLevel })    save-rolls.js:291
  Roll 1d10
  result <= getDeathThreshold(actor)?    save-rolls.js:116
    Yes → survival result + "💉 Stabilize" button in chat
    No  → _applyStatusEffect(actor, "dead")

.cp-stabilize-roll  → executeStabilize({ actorId })    save-rolls.js:359
  Dialog: TECH (pre-filled), Medical Skill (pre-filled), facility bonus dropdown
  Roll: TECH + Medical + 1d10 ≥ actor.system.damage?
    Yes → setFlag("cyberpunk2020", "stabilized", true)
    No  → fail, can retry
```

**Threshold calculations:**
```
getStunThreshold(actor):    save-rolls.js:104
  base = actor.stunThreshold()         ← human-written, actor.js:590
       = BT − woundStatePenalty + 1, floored at 1
  subtract _getTaserPenalty(actor)     ← AI-written, save-rolls.js:41
       = (taserState.count − 1) * |taserState.mod|  (0 if count ≤ 1 or window expired)
  floor at 1

getDeathThreshold(actor):    save-rolls.js:116
  = BT − mortalLevel  (no floor — 0 = auto-death, handled before posting prompt)
```

**Per-turn re-prompts** (updateCombat handler 7, save-rolls.js):
```
updateData.turn !== undefined?
  actor.statuses.has("unconscious")? → postStunSavePrompt()     (autoSaveRePrompt gate)
  actor.woundState() >= 4 && !stabilized? → postDeathSavePrompt()  (autoDeathSavePerTurn gate)
```

**Who can USE a save prompt:** prompts post to chat for everyone, but usability differs by save type.
- **Stun & death saves are owner-gated.** `executeStunSave` / `executeDeathSave` begin with `if (!_assertCanResolveSave(actor)) return;` (`= isGM || actor.isOwner`). A non-owner clicking gets a notice ("You don't own X…") and nothing happens — the GM resolves NPC saves. No relay.
- **Stabilization is NOT gated.** Any user may stabilize any target (a medic acting on a patient). The dialog + roll run locally (medic enters their own TECH/Medical). On success, the patient's `stabilized` flag is written directly if the medic owns the patient, otherwise relayed to the primary GM (`type: "stabilizeFlag"`). See Part 13.

---

## Part 8: Human ↔ AI Integration Points

These are the joints in the system where a change on one side breaks the other silently.

### item.js reads flags written by AI (damage-hooks.js)

| Flag read | Method | item.js line | Written by |
|---|---|---|---|
| `dodging` | `__meleeBonk`, `__martialBonk` | 936, 1087 | damage-hooks.js:182 |
| `parrying` | `__meleeBonk`, `__martialBonk` | 937, 943, 1088, 1094 | damage-hooks.js:203 |

Both flags are tested with `getFlag("cyberpunk2020", key)`. Parrying is **consumed** inside item.js — it calls `actor.unsetFlag("cyberpunk2020", "parrying")` at line 943 and 1094 after blocking.

### AI reads flags written by item.js (_applyMartialHitEffects)

`_applyMartialHitEffects()` is static, human-written, defined at item.js:802. It writes the three melee state flags that AI's `_hookDotEffects()` reads on every turn.

| Flag written | item.js line | Read by (AI) | File:Line |
|---|---|---|---|
| `heldBy` | 823 | hold reminder chat | damage-hooks.js:1095 |
| `grappledBy` | 831 | grapple reminder chat | damage-hooks.js:1096, 1103 |
| `chokeState` | 839 | choke DOT damage + save | damage-hooks.js:1073 |

### AI calls human-written actor methods

These methods are defined in human-written actor.js. AI code calls them as black boxes. If their signatures or return values change, the damage system breaks.

| Method | actor.js:Line | Called by (AI) | Purpose |
|---|---|---|---|
| `actor.woundState()` | 582 | save-rolls.js:534, damage-hooks.js:1085 | Determines wound threshold; drives save prompts |
| `actor.stunThreshold()` | 590 | save-rolls.js:108 | Base stun save threshold before penalties |
| `actor.getSkillVal(name)` | 732 | save-rolls.js (melee defense) | Skill lookup for contested roll defense |
| `actor.system.damage` | data model | DamageApplicator.js:178 | HP tracking |
| `actor.system.stats.bt` | data model | save-rolls.js:108, 116 | Body Type for BTM and thresholds |
| `actor.statuses` | Foundry API | multiple | Status effect checks (dead, unconscious) |

### The `weaponFired` payload contract

item.js assembles `areaDamages` (item.js:548) and emits it. DamageApplicator.js consumes it (DamageApplicator.js:126). The structure is undocumented in either file — it is the implicit contract between the two systems.

If item.js changes:
- The `damage` key name on hit objects → DamageApplicator falls back to `dmg` (has one safety net)
- The location string format (e.g., "R. Arm" vs "Right Arm") → armor contributor lookup returns nothing, SP = 0, all damage penetrates

---

## Part 9: Actor Flags Reference

All under namespace `"cyberpunk2020"`. Flags on actor documents unless noted.

| Flag | Type | Set By | Read By | Cleared By |
|---|---|---|---|---|
| `aimRounds` | Number 0–3 | 🎯 click (damage-hooks.js:121) | `renderModifiersDialog` pre-fill (796) | weaponFired hook (808); reset click (119) |
| `waitingForTurn` | Boolean | ⏸ click (damage-hooks.js:162) | `renderCombatTracker` (853); updateCombat alert (883) | ⚡ click (221); round end (884) |
| `waitingAfterId` | String (combatantId) | ⏸ click (damage-hooks.js:163) | updateCombat "your moment" (902) | ⚡ click (222); round end (885) |
| `dodging` | Boolean | 🛡 click (damage-hooks.js:182) | item.js `__meleeBonk` (936) | turn start — actor's own turn (994) |
| `parrying` | Boolean | ⛨ click (damage-hooks.js:203) | item.js `__meleeBonk` (937) | first use, consumed in item.js (943, 1094); round end sweep (998) |
| `actionCount` | Number | weapon fire, ➕ click, Aim/Dodge/Parry declare | `renderCombatTracker` badge (1306); `renderModifiersDialog` (1338) | round end (1361) |
| `actionCountRound` | Number | same as actionCount | `_getActionCount()` stale-check (43) | round end (1362) |
| `taserState` | `{count, round, mod}` | `updateTaserState()` (save-rolls.js:96) | `_getTaserPenalty()` (47) | expires naturally (round + 2 window) |
| `dotState` | `[{location, turnsLeft, formula}]` | `applyAcidDotState()` (save-rolls.js:60+) | `_hookDotEffects` acid block (damage-hooks.js:1024) | last entry expires (1060) |
| `heldBy` | String (actorId) | `_applyMartialHitEffects()` (item.js:823) | hold reminder (damage-hooks.js:1095) | Escape action (item.js:847) |
| `grappledBy` | String (actorId) | `_applyMartialHitEffects()` (item.js:831) | grapple reminder (damage-hooks.js:1096) | Escape action (item.js:848) |
| `chokeState` | `{formula}` | `_applyMartialHitEffects()` (item.js:839) | choke DOT (damage-hooks.js:1073) | Escape (item.js:849); dead-guard clear (1077) |
| `stabilized` | Boolean | `executeStabilize()` (save-rolls.js:421) | death save re-prompt (512, 534); per-turn handler | new damage received (damage-hooks.js:184) |
| `preStunMovement` | Number | `_applyStatusEffect()` (save-rolls.js:457) | movement restore on recovery | `_applyStatusEffect()` on clear |

**MeasuredTemplate flags** (under `flags.cyberpunk2020` on template documents):

| Flag | Set By | Used By |
|---|---|---|
| `isSuppressiveZone: true` | `_hookSuppressiveFire` (damage-hooks.js:418) | per-turn handler, template query |
| `isGasCloud: true` | `_hookGasCloud` weaponFired handler (1179) | per-turn gas handler, template query |
| `turnsLeft: N` | gas cloud creation | decremented each turn; delete when ≤ 0 |
| `stunSaveMod: N` | gas cloud creation | passed to `updateTaserState()` to piggyback taser save-mod path |
| `weaponName: str` | gas cloud creation | shown in chat |
| `createdRound: N` | suppressive fire creation | zone expiry check |

---

## Part 10: Settings Gates

Every setting that gates a feature, with the fallback value if the lookup throws.

| Setting Key | Default | Fallback | What it gates |
|---|---|---|---|
| `damageArmorMode` | "full" | — | SP calculation mode in applyAreaDamages |
| `damageAblation` | true | — | Whether armor SP is decremented on penetrating hit |
| `damageAutoApply` | false | — | PATH A: skip dialog, call _autoApply directly |
| `headHitDoubling` | true | — | rawDamage *= 2 for Head hits |
| `limbLossEnabled` | true | — | netDamage > 8 → death save / auto-death |
| `autoRangefinding` | false | — | Range bracket pre-fill in attack modifier dialog |
| `suppressiveFireSaves` | true | true | Ray template creation; per-turn evasion prompts |
| `autoDeathSavePerTurn` | true | — | updateCombat death save re-prompt |
| `autoSaveRePrompt` | true | — | updateCombat stun save re-prompt |
| `aimTrackingEnabled` | true | true | 🎯 button; renderModifiersDialog pre-fill |
| `waitForTurnEnabled` | true | true | ⏸/⚡ buttons |
| `activeDodgeParryEnabled` | true | true | 🛡/⛨ buttons; flag read in item.js melee |
| `specialMeleeEffectsEnabled` | true | — | Hold/grapple/choke/escape flag logic per turn |
| `gasGrenadeCloudEnabled` | true | true | Gas cloud creation; per-turn saves |
| `gasCloudAutoMove` | false | — | 2m random drift per turn |
| `taserCumPenaltyEnabled` | true | true | updateTaserState call; _getTaserPenalty |
| `acidArmorDotEnabled` | true | true | applyAcidDotState call; per-turn DOT |
| `acidDotStackMode` | "stack" | "stack" | How second acid hit merges with first |
| `multiActionPenaltyEnabled` | true | true | Badge, ➕ button, renderModifiersDialog pre-fill |
| `multiActionAutoTrack` | true | true | Auto-increment on weapon fire, Aim/Dodge/Parry |
| `layerRuleSystem` | "Core" | — | Which armor layering rule applies |
| `applyLayerEVPenalty` | true | — | EV penalty for 2nd/3rd armor layer |
| `damageLayersEnabled` | false | — | Layer compliance panel in combat tab |
| `fumbleTableEnabled` | true | — | Fumble on critical fail during ranged attack |
| `reloadByMagazines` | false | — | Magazine-based ammo tracking |
| `fnff2Enabled` | false | — | Friday Night Fistfight 2 optional rules |

**Pattern used in AI-written code:**
```js
// Most gates use an inline IIFE with try/catch defaulting ON:
const enabled = (() => {
  try { return game.settings.get("cyberpunk2020", "someKey"); }
  catch { return true; }
})();
// The try/catch means: if settings aren't registered yet (e.g. during load),
// the feature stays ON rather than silently doing nothing.
```

---

## Part 11: Data Hazards

### `_pendingPayload` race condition
```
damage-hooks.js:27 — let _pendingPayload = null;
```
The pending payload is a module-level variable set by the `weaponFired` listener and consumed by the next `createChatMessage` hook. The assumption is that Foundry always fires `createChatMessage` synchronously after the roll that followed weapon fire.

**Risk:** If any other code path creates a `ChatMessage` between the `weaponFired` call and the roll's `execute()` call, the payload attaches to the wrong message. The "Apply Damage" button then appears on an unrelated chat card. No safeguard exists — it's a timing dependency on Foundry internals.

### `dotState` legacy migration
```
// Written everywhere dotState is read:
const raw = actor.getFlag?.("cyberpunk2020", "dotState");
const states = Array.isArray(raw) ? [...raw] : (raw ? [raw] : []);
```
Actors that had dotState set before the array migration (session 12) will have a bare object `{location, turnsLeft, formula}` instead of an array. The normalization above handles this transparently at read time. It does not rewrite the flag — the actor will keep the legacy format until the next write.

### GM-only handler pattern
Most `updateCombat` handlers begin with:
```js
if (!game.user.isGM) return;
```
Hooks fire on every connected client. This guard ensures automation effects (save prompts, template creation, DOT) only happen once. **But with 2+ connected GMs the guard is not enough** — every GM client runs the handler, duplicating prompts/templates/damage. World-write handlers that can be triggered by player actions or that create persistent documents now additionally gate on the **primary GM**:
```js
if (game.users.activeGM?.id !== game.user.id) return;
```
Applied to: `_hookSocketRelay` (damage), `_registerStabilizeSocket` (stabilization writes), `_hookGasCloud` (cloud creation + per-turn). The older single-GM-gated `updateCombat` handlers (suppressive fire, wait-for-turn, dodge/parry, acid/choke DOT, multi-action reset, save re-prompts) still use the plain `isGM` guard and would duplicate under multiple GMs — a known latent issue, fine for single-GM tables.

**Consequence:** If no GM is connected, no automation runs and player→GM relays have nobody to apply them (`_relayStabilizedFlag` warns "no GM is connected").

### `attackerId`, not `actorId`
`weaponFired` payloads from item.js carry the shooter as `attackerId`. Every consumer resolves `payload.attackerId ?? payload.actorId`. Reading `actorId` alone silently breaks player damage routing (the player's client early-returns, the button never appears). This was the Session 14 root-cause bug. See [[combat-data-hazards]].

### `_getActionCount` lazy round reset
```js
// damage-hooks.js:39
function _getActionCount(actor) {
  const round = game?.combat?.round ?? 0;
  const count = Number(actor.getFlag?.("cyberpunk2020", "actionCount") ?? 0);
  const countRound = actor.getFlag?.("cyberpunk2020", "actionCountRound") ?? -1;
  if (round > 0 && countRound !== round) return 0;  // stale → treat as 0
  return count;
}
```
The count is never explicitly cleared between rounds by this getter — it returns 0 for stale data. The `updateCombat` round-change handler (damage-hooks.js:1356) also explicitly unsets both flags for cleanliness, but the getter's stale-check means even a missed cleanup doesn't cause phantom penalties.

### `postSavePrompts` vs `postStunSavePrompt`
Two similar functions exist:
- `postSavePrompts(actor, token)` — save-rolls.js:236 — routes to stun or death prompt based on current woundState. Used by DamageDialog.
- `postStunSavePrompt(actor, token)` — save-rolls.js:141 — always posts a stun prompt regardless of woundState. Used by choke DOT, gas cloud, taser path.

Calling the wrong one for a given context posts the wrong save type. The choke path correctly uses `postStunSavePrompt` since choke doesn't cause Mortal wounds on its own.

---

## Part 12: Key Function Index

Quick lookup for functions referenced frequently across the system.

| Function | File:Line | Author | What it does |
|---|---|---|---|
| `registerDamageHooks()` | damage-hooks.js:60 | AI ◆ | Registers all combat automation hooks |
| `registerSaveRollHandlers()` | save-rolls.js:473 | AI ◆ | Registers save chat handlers + updateCombat re-prompt |
| `applyAreaDamages()` | DamageApplicator.js:126 | AI ◆ | Full damage pipeline (SP, BTM, ablation, limb loss) |
| `resolveAreaDamagesSync()` | DamageApplicator.js:252 | AI ◆ | Dry-run preview for dialog display |
| `ablateLocationByAmount()` | DamageApplicator.js:330 | AI ◆ | Variable SP reduction (acid DOT) |
| `applyBTM()` | DamageApplicator.js:102 | AI ◆ | Subtract BTM from damageAfterSP |
| `getArmorContributors()` | armor-layers.js:133 | AI ◆ | Ordered armor layer list at a location |
| `applyAcidDotState()` | save-rolls.js:60 | AI ◆ | Set/merge dotState flag per stacking mode |
| `updateTaserState()` | save-rolls.js:90 | AI ◆ | Increment/reset taser hit counter |
| `postStunSavePrompt()` | save-rolls.js:141 | AI ◆ | Post stun save button to chat |
| `postDeathSavePrompt()` | save-rolls.js:184 | AI ◆ | Post death save button to chat |
| `postSavePrompts()` | save-rolls.js:236 | AI ◆ | Route to stun or death prompt by woundState |
| `executeStunSave()` | save-rolls.js:260 | AI ◆ | Roll stun save, apply unconscious on fail |
| `executeDeathSave()` | save-rolls.js:291 | AI ◆ | Roll death save, apply dead on fail |
| `executeStabilize()` | save-rolls.js:359 | AI ◆ | Dialog + roll; set stabilized flag on success |
| `_autoApply()` | damage-hooks.js:1370 | AI ◆ | Apply damage without dialog (damageAutoApply ON) |
| `_confirmFireZone()` | damage-hooks.js:473 | AI ◆ | Find tokens in suppressive zone, post evasion prompts |
| `_executeSuppressionEvasion()` | damage-hooks.js:625 | AI ◆ | Roll evasion; on fail, fire weaponFired with hits |
| `_resolveTarget()` | damage-hooks.js:683 | AI ◆ | Resolve actor from tokenId or actorId in payload |
| `_pickTargetDialog()` | damage-hooks.js:698 | AI ◆ | Fallback target selector: two options — "Use Canvas Target" (reads game.user.targets at click time, GM can target while dialog is open) and "Use List" (dropdown of scene tokens). Default button set by whether a token is already targeted when dialog opens. |
| `_incrementActionCount()` | damage-hooks.js:46 | AI ◆ | Increment action count flag + stamp round |
| `_getMultiActionPenalty()` | damage-hooks.js:52 | AI ◆ | Return (count−1)*−3 or 0 |
| `woundState()` | actor.js:582 | Human ○ | Returns wound tier 0–10 |
| `stunThreshold()` | actor.js:590 | Human ○ | Returns BT − woundPenalty + 1 |
| `getSkillVal(name)` | actor.js:732 | Human ○ | Returns effective skill value by name |
| `_applyMartialHitEffects()` | item.js:802 | Human ○ | Sets heldBy/grappledBy/chokeState flags |
| `_getAmmoProps()` | item.js:111 | Human ○ | Reads ammo item properties into payload |
| `_assertCanResolveSave()` | save-rolls.js | AI ◆ | Gate for stun/death: owner/GM only, else notice + false |
| `_canModifyActor()` | save-rolls.js | AI ◆ | isGM \|\| actor.isOwner (used by stabilize) |
| `_relayStabilizedFlag()` | save-rolls.js | AI ◆ | Relay stabilized-flag write to primary GM |

---

## Part 13: Socket Relay (Network Code)

**Channel:** `system.cyberpunk2020` (requires `"socket": true` in system.json — if false, all messages are silently dropped). Two independent `game.socket.on` listeners share this channel and filter by `data.type`: `_hookSocketRelay` (damage-hooks.js, handles `applyDamage`) and `_registerSaveSocket` (save-rolls.js, handles `saveRoll`). Multiple `.on` listeners on one channel is fine — each ignores types it doesn't own.

**Why it exists:** players cannot `actor.update()`, `setFlag`, or `toggleActiveEffect` on NPCs they don't own. Server-side permission checks reject the write. So the player emits a socket message; the **primary GM** (`game.users.activeGM`) performs the write with GM permissions.

**Multi-GM safety:** every GM client receives the emit. Each GM handler early-returns unless `game.users.activeGM?.id === game.user.id`, so exactly one GM applies.

### Damage relay (`type: "applyDamage"`)
```
Player fires at NPC → _hookWeaponFired (isMyShot) → PATH A/B
  damageAutoApply ON  → _autoApply: non-GM branch emits {mode:"auto", ...rawPayload}
  damageAutoApply OFF → button → DamageDialog._onApply: non-GM branch emits {mode:"resolved", resolvedHits}
       ↓ socket
  Primary GM _hookSocketRelay:
    mode "auto"     → re-runs applyAreaDamages (full pipeline + side effects)
    mode "resolved" → applies player's pre-computed per-hit values (afterSP overrides,
                      cover SP, armorMode, ablate toggle), then limb-loss/taser/acid/save prompts
    on success → emit {type:"damageApplied", requesterId, totalApplied} → player notification
    on error   → emit {type:"damageError",  requesterId, message}      → player error toast
```
`mode "resolved"` exists so the player's dialog choices (per-hit afterSP edits, cover SP, armor-mode override, ablate checkbox) are preserved — the GM applies exactly what the player saw, not a re-roll.

### Stabilization relay (`type: "stabilizeFlag"`)
Stun and death saves are **not** relayed — they are owner-gated (only the owner/GM can roll them; a non-owner gets a notice). Stabilization is the one save-flow action a non-owner may perform (a medic on a patient):
```
Any user clicks "Attempt Stabilization":
  dialog + roll run LOCALLY (medic's own TECH/Medical; chat card is world-visible)
  on success:
    _canModifyActor(patient)?  yes → actor.setFlag("stabilized", true)   (direct)
                               no  → _relayStabilizedFlag(actorId) → emit {type:"stabilizeFlag", actorId}
                                       ↓ socket   primary GM sets the stabilized flag
```
No result echo — the roll's chat card already shows the outcome to everyone.

### Payload field discipline
All socket payloads carry `requesterId: game.user.id`. Result messages are filtered client-side by `data.requesterId === game.user.id` so only the originating player reacts to their own result.
