---
name: qa-checklist
description: QA bugtesting checklist for CP2020 FoundryVTT combat automation — written for human playtesters
metadata:
  type: project
---

# CP2020 Combat Automation — Playtester QA Checklist

**Last updated: Session 14**

**How to use this checklist:**
Each item describes a scenario to set up, what action to take, and what you should see happen. Mark results as you go.

- `[ ]` Not yet tested
- `[x]` Tested and working
- `[!]` Known bug (description included)
- `[?]` Needs a ruling — the rulebook doesn't cover this clearly

**Settings note:** Most features can be turned on or off in Game Settings → System. Each section notes which setting controls it.

---

## 1. Applying Damage After a Shot

*Tests the "Apply Damage" button that appears on chat cards after firing.*

**Setup:** Have two tokens on the canvas — one attacker, one target.

- [x] **Targeted shot — dialog mode.** Fire a ranged weapon with the target token selected (targeted). The damage dialog should open automatically. Confirm it shows location, raw damage, armor SP, and net HP loss. Click Apply — damage should be deducted from the target's HP.

- [x] **Targeted shot — auto-apply mode.** With `Auto-Apply Without Dialog` turned ON, fire at a targeted token. Damage should apply instantly with no dialog, and a stun save prompt should appear in chat.

- [x] **Untargeted shot — Apply button.** Fire without targeting anyone. A chat card appears with an "Apply Damage" button. Click it. A dialog should appear with two options: target a token on canvas, or pick from the list.

- [ ] **Canvas targeting while dialog is open.** Click "Apply Damage" with no target. The dialog opens. Without closing it, right-click a token on the canvas and choose Target (or hover and press T). Then click "Use Canvas Target." Damage should apply to the token you just targeted.

- [ ] **List targeting.** Click "Apply Damage" with no target. When the dialog opens, ignore the canvas target option and use the dropdown list instead. Pick a token from the list and click "Use List." Damage should apply to that token.

- [ ] **Cancel from dialog.** Click "Apply Damage," then click Cancel in the dialog. Nothing should happen — no damage, no error.

- [ ] **Cover SP.** In the damage dialog, type a value in the Cover SP field and confirm. The final damage shown should be lower than without cover. (Cover acts as an extra outer armor layer.)

---

## 2. Damage Math

*Tests that the numbers come out correctly.*

- [ ] **Armor stops the shot.** Fire at a target where the rolled damage is lower than or equal to their armor SP. The result should show 0 HP damage taken (armor stopped it completely).

- [ ] **Armor piercing (AP) ammo.** Fire AP ammo at a target with high armor. The effective SP should be shown as half the target's actual SP in the dialog. More damage should get through compared to a normal shot.

- [ ] **Hollow-point ammo.** Fire hollow-point at a target wearing soft armor. The effective SP against soft armor should be higher than nominal (hollow points are worse against real armor, better against unarmored). Check armorMultSoft > 1 on the ammo item.

- [ ] **Head hit — damage doubling.** Hit a target in the head with `Head Hit Doubles Damage` ON. The per-row values in the dialog (raw damage, armor SP) are NOT doubled — doubling happens after armor and BTM, not before. The total HP at the bottom of the dialog should be roughly double a comparable torso hit. Edge case: a hit that barely penetrates (BTM floors damage to 1) should show 2 HP to the head, not 1.

- [ ] **Head hit — no doubling on blocked shots.** Fire a head shot that the armor stops completely (damage ≤ SP). The result should be 0 HP damage, not doubled 0.

- [ ] **Head hit — doubling disabled.** With `Head Hit Doubles Damage` turned OFF, a head hit should deal the same HP damage as an identical torso hit.

- [ ] **Minimum 1 HP.** Set up a scenario where a shot penetrates armor but the remaining damage (after BTM) would be 0. The target should take exactly 1 HP damage, not 0. (BTM can't reduce a penetrating hit to 0.)

- [ ] **BTM 0 character.** A character with Very Weak body (BTM 0) takes a penetrating hit. No BTM reduction should occur — whatever gets through armor is the full HP loss.

- [ ] **Burst fire.** Fire a three-round burst and hit. Each individual bullet should resolve its own location roll, armor check, and HP damage separately.

- [ ] **Armor mode — Simple.** With armor mode set to Simple, fire a shot. SP should subtract from damage as a flat number with no ablation and no proportional armor math.

- [ ] **Armor mode — None.** With armor mode set to None, fire a shot. Armor should be ignored entirely. BTM still applies.

---

## 3. Armor Ablation

*Armor loses SP over time as it gets hit. RAW: armor SP is reduced by 1 for each penetrating hit at that location.*

- [ ] **Ablation after one hit.** Fire a shot that penetrates a target's armor. Check the armor item's SP on the target's sheet — it should have dropped by 1 at the hit location.

- [ ] **No ablation on blocked shots.** Fire a shot that does NOT penetrate the target's armor (damage ≤ SP). The armor SP should be unchanged.

- [ ] **Ablation disabled.** With `Ablate Armor on Hit` turned OFF, a penetrating hit should not reduce the armor SP at all.

- [ ] **Multi-hit burst.** Fire a burst where multiple bullets hit the same location. Armor SP should drop by 1 for each penetrating bullet — each hit ablates separately.

---

## 4. Limb Loss and Head Wounds

*RAW (p.103): more than 8 net damage (after BTM) to an arm or leg triggers an immediate Mortal 0 Death Save. The same amount to the head is instant death. BTM can prevent this.*

- [ ] **Limb wound — Death Save fires.** Deal more than 8 net HP damage in a single hit to an arm or leg. A Mortal 0 Death Save prompt should appear immediately in chat.

- [ ] **Limb wound — borderline.** Deal exactly 8 net HP damage to a limb. No Death Save prompt — it's strictly greater than 8 that triggers it.

- [ ] **Head wound — instant death.** Deal more than 8 net HP damage in a single hit to the head. The character should be marked dead instantly with no Death Save roll allowed.

- [ ] **BTM saves the limb.** Set up a scenario where the raw damage after SP is 9+ but BTM reduces the net damage to 8 or less. No Death Save should fire — BTM protected the limb.

- [ ] **Limb loss disabled.** With `Limb Loss & Head Wound Checks` turned OFF, a hit of any size to any location should not trigger a Death Save or instant death.

---

## 5. Stun Saves

*After taking any damage, the target must roll a Stun Save. Roll 1d10 equal to or under their threshold to stay conscious.*

- [ ] **Save prompt fires.** Deal any amount of damage to a target. A Stun Save prompt should appear in chat with a Roll button, the correct threshold value, and any active penalties listed.

- [ ] **Failed save.** Click the Roll button and get a result over the threshold. The target should gain the Unconscious status, and their token should show the effect.

- [ ] **Passed save.** Roll a result at or under the threshold. The target stays conscious. A pass message should appear in chat.

- [ ] **Recovery prompt.** Advance to the unconscious character's next turn. A recovery Stun Save prompt should fire automatically. (Setting: `Stun Save Recovery Each Turn` ON)

- [ ] **Recovery pass.** The unconscious character passes their recovery roll. The Unconscious status should be removed.

- [ ] **Recovery fail.** The unconscious character fails their recovery roll. They stay unconscious and will be prompted again next turn.

- [ ] **Wound state penalties.** A character at Serious wound or worse should show a lower threshold in the prompt than a character at Light wound.

---

## 6. Death Saves

*Characters at Mortal wound state must roll a Death Save each turn or die.*

- [ ] **Mortal wound state.** A character's total HP damage puts them at Mortal wound. A Death Save prompt should appear at the start of their next turn with their current threshold. (Setting: `Death Save Each Turn` ON)

- [ ] **Failed Death Save.** Roll over the threshold. The character is marked dead. No further save prompts should appear.

- [ ] **Passed Death Save.** Roll at or under the threshold. A "survived" message appears in chat along with a "Attempt Stabilization" button.

- [ ] **Auto-death at threshold 0.** If a character's BT stat minus their mortal level equals 0, no save roll should be offered — they die automatically.

- [ ] **Stabilization dialog.** Click "Attempt Stabilization." A dialog should appear with TECH and Medical Skill pre-filled from the actor's stats, plus a dropdown for facility bonus (None / Trauma Team / Hospital / Life Suspension Tank).

- [ ] **Stabilization success.** Roll TECH + Medical + 1d10 ≥ total damage taken. The "stabilized" flag should be set and no more Death Save prompts should appear on future turns.

- [ ] **Stabilization failure.** Fail the roll. Death Saves continue on future turns. The player can try again (no limit on attempts).

- [ ] **New damage clears stabilization.** A stabilized character takes new damage. Their stabilized status should clear and Death Saves should resume.

---

## 7. Taser Cumulative Penalty

*Each successive taser hit within 3 rounds lowers the target's Stun Save threshold by 2 (configurable on the ammo item). Setting: `Taser Cumulative Save Penalty`*

- [ ] **First hit — no penalty.** Hit a target with a taser. Their Stun Save threshold should be unchanged.

- [ ] **Second hit within 3 rounds.** Hit the same target with a taser again within 3 rounds. Their Stun Save prompt should now show a −2 reduction to the threshold.

- [ ] **Third hit.** Third taser hit within the window. The penalty shown in chat should be −4.

- [ ] **Window expiry.** Wait more than 3 rounds after the last taser hit, then hit again. The penalty counter should reset — first hit again with no penalty.

- [ ] **Taser penalty disabled.** With the setting OFF, multiple taser hits should show no penalty regardless of how many land.

---

## 8. Melee and Martial Arts

*Targeted melee attacks use a contested roll — attacker vs defender. Martial arts add special effects.*

- [ ] **Contested roll.** Make a targeted melee attack. Both the attacker's total and the defender's total should appear in chat. If the attacker wins, damage fires; if the defender ties or wins, it misses.

- [ ] **Dodge bonus.** Declare a 🛡 Dodge for a character (active combatant button). When that character is attacked in melee, the defender's effective roll should be 2 points higher than their natural roll.

- [ ] **Parry blocks the hit.** Declare a ⛨ Parry. The next melee attack against that character should be blocked outright regardless of the attacker's roll. The Parry should then be consumed.

- [ ] **Parry cancelled before use.** Declare a Parry, then click the button again to cancel it. The flag should clear. The next incoming attack should not be blocked.

- [ ] **Hold.** Make a successful Hold attack. The target should have a "held" status. At the start of their next turn, a chat message should remind them they can only attempt Escape.

- [ ] **Grapple.** Successful Grapple attack should set a grapple status and post the grapple rules summary in chat.

- [ ] **Choke.** Successful Choke attack. Each turn at the target's turn start: 1d6 HP damage is applied and a Stun Save prompt fires. This should stop if the target dies.

- [ ] **Choke stops on death.** A choked target dies. Choke damage should NOT fire on subsequent turns. (This was a known bug, fixed in Session 12.)

- [ ] **Escape.** Make a successful Escape attack. All Hold, Grapple, and Choke statuses should be removed from the target at once.

- [ ] **Throw / Sweep.** Successful Throw or Sweep attack. A knockdown announcement should appear in chat.

---

## 9. Aim and Wait Buttons

*Aim accumulates a bonus to your next shot. Wait lets you defer your action.*

- [ ] **Aim button cycles correctly.** Click 🎯 on a combatant's row in the tracker. The number next to the icon should go 1, 2, 3, then back to 0 on the fourth click.

- [ ] **Aim pre-fills the attack dialog.** With aim rounds accumulated, open the attack modifier dialog for that character's weapon. The Aim Rounds field should already show the saved count.

- [ ] **Aim resets after firing.** Fire a weapon with aim rounds saved. The aim count should drop back to 0.

- [ ] **Aim reset doesn't count as an action.** Click 🎯 to reset from 3 back to 0. The multi-action badge should NOT increment. (Resetting aim is not an action.)

- [ ] **Wait — mid-order.** Press ⏸ on an active combatant who is not last in initiative. A dialog should appear listing other combatants to choose from. Pick one. The waiting combatant's turn should be skipped and a ⚡ button should appear next to their name.

- [ ] **Wait — "your moment" alert.** When the combatant the waiter chose to follow finishes their turn, a chat alert should fire saying the waiting character can now act.

- [ ] **Wait — act now.** The waiting character clicks ⚡. Their waiting status should clear and a "takes delayed action" message should post.

- [ ] **Wait — two characters waiting for same trigger.** Two characters both wait until after the same combatant. Both should receive "your moment" alerts when that combatant's turn ends.

- [ ] **Wait — last combatant.** Press ⏸ on the last active combatant in initiative order. A notification should appear saying they're already last — nothing else should happen. (No flags set, no turn advance, no round change. This was a known bug, fixed in Session 12.)

- [ ] **Wait — round end clears flags.** A character is waiting at round end. Their waiting status should be automatically cleared for the new round.

---

## 10. Multi-Action Penalty

*RAW (p.105): your first action each round is free. Every additional action gives −3 to all your rolls that round. Setting: `Multi-Action Penalty`*

- [ ] **No penalty on first action.** Fire a weapon. The attack modifier dialog should show 0 in the Extra Modifiers field (no penalty yet).

- [ ] **Second action: −3 penalty.** Fire a second weapon or take any action. Open the attack modifier dialog. Extra Modifiers should be pre-filled with −3.

- [ ] **Third action: −6 penalty.** Take a third action. The modifier dialog should pre-fill −6.

- [ ] **Override is editable.** The Extra Modifiers field is editable. Type 0 over the pre-filled penalty. The GM can always override.

- [ ] **Action badge in tracker.** After any action, a ×N (−P) badge should appear next to the acting character's name in the combat tracker showing the count and current penalty.

- [ ] **Auto-tracked actions.** Fire a weapon, declare Aim, declare Dodge, declare Parry. Each should increment the action count automatically. (Setting: `Multi-Action Auto-Tracking` ON)

- [ ] **Manual action button.** Click ➕ on an active combatant's row. A notification should appear saying action N was recorded. Use this for actions the system can't detect automatically (reload, skill rolls, mount/dismount, etc.)

- [ ] **Aim reset does NOT count.** Clicking 🎯 to reset aim back to 0 should not increment the action count.

- [ ] **Dodge cancel does NOT count.** Clicking 🛡 a second time to cancel dodge should not increment the count.

- [ ] **Parry cancel does NOT count.** Clicking ⛨ a second time to cancel parry should not increment.

- [ ] **Reset at round end.** Advance to the next round. All action count badges should disappear and all penalties should reset to 0.

- [ ] **Penalty disabled.** With `Multi-Action Penalty` turned OFF, no badge, no pre-fill, and no auto-tracking should occur.

- [ ] **Auto-tracking disabled.** With `Multi-Action Auto-Tracking` turned OFF, weapon fire and button clicks should not change the count. Only the ➕ button should work.

---

## 11. Suppressive Fire

*Creates a fire zone on the canvas. All tokens inside must make an Evasion save or take random hits.*

- [ ] **Fire zone template.** Fire in suppressive fire mode. An orange ray template should appear on the canvas anchored to the attacker's position. A "Confirm Fire Zone" button should appear in chat.

- [ ] **Template positioning.** The GM should be able to rotate and aim the template before confirming. The template's origin should stay locked to the attacker's token position.

- [ ] **Confirm fire zone.** Click "Confirm Fire Zone." Every token inside the template bounds should receive an Evasion Save prompt in chat.

- [ ] **Evasion success.** Roll the evasion check and beat the DC. A pass message appears and no damage is applied to that token.

- [ ] **Evasion failure.** Fail the evasion check. 1d6 random hits are applied through the full damage pipeline (location rolled per hit, armor checked, HP reduced).

- [ ] **Per-turn re-check.** At the start of the next round, tokens still inside the fire zone should be prompted again for Evasion.

- [ ] **Zone auto-expires.** After one full combat round, the fire zone template should be automatically deleted from the canvas.

---

## 12. Acid Armor Degradation

*Acid ammo starts a lasting armor-corroding effect. Each turn, the outer armor layer's SP is reduced until the timer runs out. Setting: `Acid Weapon Armor Degradation`*

- [ ] **DOT starts on hit.** Hit a target with acid ammo. At the start of that target's next turn, a roll should reduce the outer armor SP at the hit location. A message should appear in chat noting the SP reduction.

- [ ] **SP reduces outermost layer first.** If the target has multiple armor layers at the hit location, only the outermost layer's SP should drop. The inner layer is untouched until the outer one reaches 0.

- [ ] **Timer counts down.** After each turn tick, the remaining turns should decrease by 1. When it reaches 0, a "dissolved" message should appear and the effect should end.

- [ ] **Stack mode.** With stacking mode set to Stack, hit the same target with acid while they already have an acid effect active at the same location. The remaining turns should increase (duration extended), not reset.

- [ ] **Reset mode.** With stacking mode set to Reset, the second acid hit should restart the timer from scratch. The previous remaining turns should be discarded.

- [ ] **Separate mode.** With stacking mode set to Separate, each acid hit should run as an independent concurrent timer. Both should tick down and roll separately each turn.

- [ ] **No error on zero-SP armor.** Hit a target whose armor at that location has already been reduced to 0 SP by acid. No error should occur — the effect just does nothing new.

- [ ] **DOT stops on death.** A character with an active acid effect dies. On subsequent turns, no acid rolls should fire and no errors should occur.

---

## 13. Gas Grenades

*Gas ammo creates a persistent cloud on the canvas. Tokens inside must make Stun Saves each turn. Setting: `Gas Grenade Cloud & Per-Turn Saves`*

- [ ] **Cloud placed on fire.** Fire a weapon loaded with gas ammo. A green circle template should appear on the canvas centered on the target's position (or the attacker's if no target).

- [ ] **Per-turn saves.** At the start of each new turn, all tokens currently inside the cloud should receive a Stun Save prompt in chat with the correct save penalty.

- [ ] **Cloud timer counts down.** After each turn, the cloud should tick down. When the timer hits 0, the template should be automatically removed and a "dispersed" message posted.

- [ ] **Auto-drift.** With `Gas Cloud Auto-Drift` turned ON, the cloud template should shift 2m in a random direction each turn.

- [ ] **Manual deletion.** The GM manually deletes the cloud template mid-encounter. No error should occur on the next turn update.

- [ ] **No target on fire.** Fire gas ammo with no target selected. The cloud should be placed at the attacker's token position.

- [ ] **Cloud shows the right shooter.** The chat message announcing the cloud should name the character who fired, not appear blank or unattributed.

---

## 14. Armor Layering

*Multiple armor pieces at the same location interact in specific ways depending on which rule system is active. Setting: `Armor: Layer Rule System`*

- [ ] **Compliance panel visible.** With `Show Layer Compliance Panel` turned ON, the combat tab should show a breakdown of armor layers at each location.

- [ ] **Core rule — EV penalty.** With the Core rule system active and `Apply Layer EV Penalties` ON, equip two non-skinweave armor pieces covering the same location. The character's effective REF should drop by 1 (2nd layer = +1 EV). Adding a third piece should add another 2 EV.

- [ ] **Core rule — violation warning.** Equip more than 3 armor pieces at the same location. The compliance panel should show a warning.

- [ ] **Core rule — hard armor limit.** Equip two pieces of hard armor at the same location. A warning should appear — only one hard armor piece is allowed per location.

- [ ] **Chromebook 4 mode — torso free allowances.** Switch to the CB4 rule system. One Light armor at the torso should have no penalty. Two Light pieces at the torso should add +1 EV.

- [ ] **Chromebook 4 mode — legs.** Any Light armor piece covering the legs should immediately add +1 EV (no free Light piece for legs).

---

## 15. Edge Cases

*Corner cases that can produce unexpected interactions.*

- [ ] **Two targets, one acid DOT each at different locations.** Both should run their own timers independently each turn with no interference between them.

- [ ] **Choke + acid DOT active at same time.** Both effects should fire on the affected character's turn start — one after the other, not cancelling each other.

- [ ] **Taser hit while inside a gas cloud.** The target's Stun Save threshold should reflect both the taser penalty and the gas cloud penalty stacking on top of each other.

- [ ] **Stabilized character inside a gas cloud.** No Death Save prompt should fire (they're stabilized) but they should still receive the per-turn Gas Stun Save prompt.

- [ ] **Edged weapon + AP.** A Kendachi Monosword (edged) fired as AP: soft armor should be at 1/4 SP, hard armor at 1/2. Verify the dialog shows the correct reduced values.

- [ ] **Suppressive fire failure triggers head hit.** A token inside a fire zone fails evasion, rolls a head hit as one of their 1d6 random hits, and head doubling is ON. The doubled damage should process through the damage pipeline correctly.

- [ ] **Tokens entering fire zone or gas cloud mid-round.** Tokens that move INTO an active zone after it was confirmed will NOT be auto-checked — this is a known limitation. The GM must adjudicate these manually.

---

## 16. Players Acting on Their Own (Multiplayer)

*These tests need a second person — or a second browser window — logged in as a player, not the GM. They check that a player can run their own combat without the GM clicking anything for them.*

**Setup:** GM logged in on one screen, a player (controlling their own character) logged in on another. Put the player's character and an enemy on the canvas.

- [ ] **Player sees the Apply Damage button.** As the player, fire your character's weapon. The "Apply Damage" button should appear on your own chat card — you should not have to wait for the GM, and the GM should see it on their side too.

- [ ] **Player damages an enemy.** As the player, click Apply Damage and target the enemy. The enemy's health should drop and you should see a short "Applied X damage" confirmation. No red permission error should appear.

- [ ] **Player damages their own character.** As the player, apply damage to your own character (or one you control). It should apply directly and instantly, the same as the GM experience.

- [ ] **Player rolls their own stun/death save.** When your character takes damage and a save prompt appears, click it as the player. The roll should post to chat and the result (conscious/unconscious/alive/dead) should apply to your character.

- [ ] **Player can't roll someone else's save.** As a player, click a stun or death save prompt for an enemy (or another player's character) you don't control. You should get a notice that you don't own that character, and no roll should happen. The prompt is still visible — just not usable by you. (The GM, or that character's owner, can still click it.)

- [ ] **Player medic stabilizes a downed ally.** As a player with a medic character, click "Attempt Stabilization" on a downed ally or NPC you don't control. The dialog should let you enter your own TECH and Medical skill, and the roll should work. On success, the patient should become stabilized and stop being prompted for Death Saves. (Stabilizing others is allowed — unlike rolling their saves.)

- [ ] **No GM online.** With no GM logged in, have a player try to apply damage to an enemy. It should not crash; the player should get a notice that no GM is available rather than a silent failure.

- [ ] **Only one button per card.** Fire a shot and let the chat card finish loading. There should be exactly one Apply Damage button — never two stacked on the same card, even after the card updates or you pop it out.

- [ ] **Two GMs (if your table uses them).** With two GM accounts logged in, have a player damage an enemy. The damage should be applied once, not doubled, and only one set of save prompts should appear.
