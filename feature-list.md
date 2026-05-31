---
name: feature-list
description: Player-facing feature list for CP2020 FoundryVTT combat automation — plain language, no technical details
metadata:
  type: project
---

# CP2020 FoundryVTT — Combat Automation Feature List

*For players and GMs. Explains what the system does at the table without technical detail.*
*Last updated: Session 14*

---

## Combat Tracker Buttons

Each combatant row in the combat tracker can show several action buttons depending on what applies to them this round.

| Button | Who sees it | What it does |
|---|---|---|
| 🎯 Take Aim | Active combatant | Accumulates aiming rounds (up to 3). Each round of aiming pre-fills +1 to your next attack roll automatically. Resets when you fire. |
| ⏸ Wait for Turn | Active combatant | Defer your action to later in the round. Pick who you want to go after — you'll get a chat alert when it's your moment. Click ⚡ to announce you're acting. |
| 🛡 Dodge | Active combatant | Declares active dodging for this round. All melee attackers suffer −2 to their attack roll until your next turn. Costs one action. |
| ⛨ Parry | Any combatant | Declares a reactive parry. The next melee attack against you is automatically blocked (consumed on use). Costs one action — the GM tracks the −3 penalty to your other actions this turn. |
| ➕ Manual Action | Active combatant | Marks an action the system can't detect automatically — like reloading, mounting a vehicle, or a skill roll made from the character sheet. Updates your action count and penalty badge. |

---

## Multi-Action Penalty

**Rule (CP2020 p.105):** Your first action per turn is free. Every additional action applies a cumulative −3 penalty to all rolls you make that round.

- A **badge** appears in your tracker row showing how many actions you've taken this round and the current penalty: `×2 (−3)`, `×3 (−6)`, etc.
- When you open the attack modifier dialog, the penalty is **pre-filled** in the Extra Modifiers field. You can always edit it if the GM rules differently.
- The system **automatically tracks**: weapon fire, Aim rounds, Dodge declarations, and Parry declarations.
- Use the **➕ Manual Action** button for things it can't detect: reloading, non-combat skills, mount/dismount, etc.
- Movement is **free** (not counted) per RAW — walking or running doesn't consume an action.
- The counter resets automatically at the start of each new round.

> *Settings: Multi-Action Penalty (ON/OFF) · Multi-Action Auto-Tracking (ON/OFF)*

---

## Applying Damage to a Target

When you fire at a targeted token, damage resolves automatically. When there is no target pre-selected (untargeted shots, burst fire into a crowd), an **Apply Damage** button appears on the chat card. Clicking it gives you two ways to choose who gets hit:

- **Canvas targeting** — target a token on the canvas the normal Foundry way (right-click → Target, or hover and press T). If you already have a token targeted before clicking Apply Damage, the system uses it immediately with no extra dialog. If you target one while the dialog is open, click "Use Canvas Target" to apply.
- **List selection** — a dropdown lists every token on the scene by name. Pick from the list and click "Use List."

Whichever method you use, the full damage pipeline runs the same way from that point forward.

**Players can apply their own damage** — the button shows up on your own attack rolls, and damaging enemies just works.

---

## Damage & Armor

- **Automatic hit location** — location is rolled automatically on each hit; aimed shots use your declared location and skip the roll
- **Full armor resolution** — armor SP, ablation (armor degrades by 1 SP per penetrating hit per RAW), BTM, and net HP damage all calculated and applied automatically
- **AP ammo** — halves the target's armor SP when set on the ammo item
- **Specialty ammo** — hollow-point, frangible, and other ammo types with custom armor multipliers are fully supported through ammo items
- **Edged weapon armor halving** — soft armor SP is halved against knives, swords, and other edged weapons; hard armor is unaffected
- **Head hit doubling** — any hit to the head doubles the net HP damage after armor and BTM have both resolved (toggle, ON by default). A shot blocked by armor still deals 0 — the doubling never amplifies a miss.
- **Limb loss** — a single hit dealing more than 8 net damage (after BTM and head doubling) to an arm or leg triggers an immediate Death Save at Mortal 0; a head hit of the same severity is automatic death (toggle, ON by default)
- **Cover SP field** — the GM can enter cover/obstacle SP directly in the damage dialog before applying

> *Settings: Armor Mode (Full/Simple/None) · Ablation (ON/OFF) · Auto-Apply (ON/OFF) · Head Hit Doubling (ON/OFF) · Limb Loss (ON/OFF)*

---

## Saves & Wound State

- **Automatic stun save prompt** fires every time damage is dealt — roll is posted to chat with the correct threshold
- **Wound stat penalties** — Serious wounds reduce REF by 2; Critical halves REF/INT/Cool; Mortal reduces all three to one-third. These feed directly into all rolls
- **Per-turn save re-prompts** — unconscious characters are prompted to recover at the start of their turn; Mortal characters must make a Death Save each turn until stabilized
- **Stabilization system** — after surviving a Death Save, a Stabilize button appears. Roll TECH + Medical + 1d10 against total damage taken. Success stops future Death Saves permanently for this wound. Bonuses available for Trauma Team (+3), Hospital (+5), or Life Suspension Tank (+3)
- **Taser cumulative penalty** — each successive taser hit within a 3-round window lowers the target's Stun Save threshold (−2 per hit by default, configurable on the ammo item). Penalty shown in the save prompt
- **Players roll their own saves** — stun, death, and stabilize buttons work directly from your own character's prompts

> *Settings: Stun Save Re-prompts (ON/OFF) · Death Save Per Turn (ON/OFF) · Taser Penalty (ON/OFF)*

---

## Melee Combat

- **Contested roll** — when a melee or martial attack targets a token, the defender automatically rolls a defense using their best available skill (Melee, Fencing, Brawling, Dodge, Athletics, or any Martial Arts style). The attacker must beat the defender's total to land the hit. Both totals are shown in chat
- **Hold** — a successful Hold sets a status flag on the target; their turn start shows a reminder that they can only attempt Escape
- **Grapple** — sets a grappled flag with a chat message covering grapple mechanics
- **Choke** — deals 1d6 HP damage per turn and forces a Stun Save each turn until released. Automatically clears when the target dies
- **Throw / Sweep** — posts a knockdown announcement to chat; the target must spend an action to recover
- **Escape** — on a successful escape roll, all Hold, Grapple, and Choke status flags are cleared from the target

> *Setting: Martial Arts Special Effects (ON/OFF)*

---

## Ranged Combat

- **Automated rangefinding** — when enabled, distance between attacker and target is measured from the canvas and the correct range category (Point Blank / Close / Medium / Long / Extreme) is pre-applied to the attack roll
- **Suppressive fire zone** — creates an orange ray template on the canvas. All tokens inside are prompted for an evasion save (Athletics + REF + 1d10 vs difficulty). Failures take 1d6 random hits that run through the full damage pipeline. Zone auto-removes after one round
- **Three-round burst and full auto** — hits calculated per ROF rules; each hit gets its own location roll and armor resolution

> *Settings: Automated Rangefinding (ON/OFF) · Suppressive Fire Zone (ON/OFF)*

---

## Special Ammo Effects

- **Acid degradation** — acid ammo starts an armor-corroding effect: SP at the hit location is reduced each turn for a configurable number of turns (outermost armor layer first). If a target is hit by acid while already affected, you can choose whether the second hit stacks (extends duration), resets the timer, or runs as a separate independent effect
- **Gas grenades** — places a green circle cloud template on the canvas at the target's position. All tokens inside must make a Stun Save each turn (penalty configurable on the ammo item). Cloud persists for a configurable number of turns then auto-removes. Optional wind drift setting available

> *Settings: Acid Armor DOT (ON/OFF) · Acid DOT Multi-Hit Mode (Stack/Reset/Separate) · Gas Grenade Cloud (ON/OFF) · Gas Cloud Auto-Drift (ON/OFF)*

---

## Armor Layering

- **Proportional armor (New Rule 2)** — when multiple armor pieces cover the same location, SP is combined using the proportional table rather than simple addition
- **Layer compliance panel** — an optional display in the Combat tab showing your current armor stack per location with violation warnings (enable in settings)
- **New Rule 1 EV enforcement** — the 2nd and 3rd armor layer at any location add EV penalties that reduce effective REF
- **Chromebook 4 clothing system** — an alternate layering rule using clothing weight categories (Light/Medium/Heavy) with per-area free allowances and penalties for over-layering (Torso vs Legs tracked separately)

> *Settings: Layer Compliance Panel (ON/OFF) · Apply Layer EV Penalties (ON/OFF) · Layer Rule System (Core / Chromebook 4)*

---

## Optional Rules & Configuration

All major features can be toggled in **Game Settings → Configure Settings → System** without affecting unrelated features. A brief summary of available toggles:

| Category | What you can toggle |
|---|---|
| Damage | Armor mode · Ablation · Auto-apply · Head doubling · Limb loss |
| Saves | Stun re-prompts · Death save per turn · Taser penalty |
| Combat | Rangefinding · Suppressive fire · Melee special effects · Multi-action penalty |
| Ammo effects | Acid DOT · Acid DOT stacking mode · Gas cloud · Gas cloud drift |
| Armor layers | Compliance panel · EV penalties · Core vs Chromebook 4 system |
| Tracker | Aim tracking · Wait for Turn · Dodge/Parry declarations · Multi-action auto-tracking |
| Other | Fumble table · Reload by magazines · Friday Night Firefight 2 rules |
