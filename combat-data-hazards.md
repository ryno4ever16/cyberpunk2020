---
name: combat-data-hazards
description: Non-obvious gotchas in the combat automation pipeline — weaponFired payload field name, socket multi-GM arbitration
metadata:
  type: project
---

Two recurring data hazards in the combat automation code, both bug sources:

1. **`weaponFired` payload uses `attackerId`, NOT `actorId`.** Every `Hooks.callAll("cyberpunk2020.weaponFired", …)` in `module/item/item.js` sends the attacking actor's id as `attackerId`. Any consumer in `module/combat/damage-hooks.js` (`_hookWeaponFired`, `_hookRenderChatMessage`, `_hookAimTracking`, `_hookMultiActionPenalty`) must read `payload.attackerId ?? payload.actorId`. Reading only `actorId` silently breaks player damage routing (the player's client returns early, `_pendingPayload` never set, Apply Damage button never appears).

2. **Socket relay must gate on `game.users.activeGM`.** `game.socket.on("system.cyberpunk2020", …)` fires on EVERY connected GM client. The `applyDamage` handler in `_hookSocketRelay` must early-return unless `game.users.activeGM?.id === game.user.id`, or N connected GMs each apply the damage N times.

**Why:** these are invisible with a single GM and a GM-only test, so they pass casual testing and surface only with players connected or multiple GMs.

**How to apply:** when touching `weaponFired` emitters/consumers or any `game.socket` handler, check both points. See [[combat-flowchart]] for the full pipeline and [[project-combat-module]] for file map.
