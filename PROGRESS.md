# v14 Compatibility — Autonomous Run Log

> ⚠️ **WHEN YOU RETURN (Mon 2026-06-15): RE-ENABLE WINDOWS UPDATE.**
> It was disabled for this run so a reboot couldn't kill the rigs. Run in an **elevated** PowerShell:
> ```
> Set-ItemProperty -Path 'HKLM:\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU' -Name NoAutoUpdate -Value 0
> Restart-Service wuauserv -Force
> ```
> Then install the backlog of updates. (Sleep/hibernate were already "Never" — nothing to undo there.)

**Run window:** started 2026-06-11, user back 2026-06-15. Branch: `v14-compat` (off `Beta-v1.2.0`). Orchestrator: Opus 4.8 (single orchestrator; all subagents dispatched + integrated by me).

## Goal & scope
Make the system run on **Foundry v14** WITHOUT dropping **v13.350** — one codebase, runtime feature-detect. Core work = port the 4 load-bearing **MeasuredTemplate** features to **Scene Regions** (v14 deleted MeasuredTemplate as an embedded type; our `shape.contains`/per-turn-hook usage silently no-ops there). Plus: v15 global-namespacing, 3 small dialogs → ApplicationV2, big-sheet V2-*readiness* (NOT full port). Empirical findings + plan in memory `task-v14-compat.md`.

## STOP-LINE (hard)
Take it to **feature-complete + dual-core green + committed on `v14-compat`**, then **STOP**. NEVER push, NEVER touch the release/manifest branch, NEVER bump release version, NEVER set `verified` (we do that together at the end). At end-of-task (or if blocked), write a return summary here and wait.

## Test rigs (both mine, isolated, hardened)
- **v14:** `C:\FoundryV14App` (Node build 14.364) → dataPath `C:\Users\randa\FoundryVTT-V14-Data`, **:30002**, world `v14-compat-test`.
- **v13:** `C:\FoundryV13App` (Node build 13.350) → dataPath `C:\Users\randa\FoundryVTT-V13-Data`, **:30003**, world `v13-compat-test`.
- Both: **UPnP off**, **GM password set** (passed to Playwright via `FVTT_RIG_PASSWORD` env — value NOT recorded here per secrecy). System wired via junctions to the working tree (live code) + isolated `packs/` copy. License bootstrapped offline from the v13 install.
- Run v14 specs: `cd tests; $env:FVTT_URL='http://localhost:30002'; $env:FVTT_RIG_PASSWORD=<pw>; npx playwright test --config playwright.v14.config.js`. v13 = same with `:30003`.
- **Recovery if a rig password is lost to context compaction:** relaunch the rig pointed at a NEW world id (fresh passwordless GM), then re-run `_set-rig-password`. Rigs are throwaway.
- **Restart a rig after a reboot:** `node C:\FoundryV14App\main.js --dataPath=C:\Users\randa\FoundryVTT-V14-Data --port=30002 --world=v14-compat-test` (and V13App/30003). Clear `Config\options.json.lock` first if "directory already locked".

## Regression gate (the autonomous quality bar)
**Dual-core green or it doesn't land:** after every integration, the relevant unit tests + the v13.350 (:30003) suite + the v14 (:30002) probes must pass. Default decision bias when anything is ambiguous: **preserve v13.350 → reversible → green → in-scope.**

## Decision ledger (ratified — do NOT re-ask)
- **Aim UX:** v14 auto-aims region from firer→target (#1) + "draw it yourself" manual hatch (#2). V13 keeps the real template gizmo unchanged.
- **Gas auto-drift:** implement, behind a setting, **default ON** (sensible default wind: small drift/turn, GM-adjustable).
- **Gas port model:** Sonnet implements after suppression sets the pattern; **Opus reviews it again** regardless.
- **Big sheets:** V2-*ready* only (pure getData, named handlers, namespaced bases, dep-probe) — do NOT fully port the 1974/1654-LOC sheets. **Notify user at end of task** before any full sheet port.
- **v15 namespacing:** do the FULL captured list (ActorSheet/ItemSheet/Actors/Items globals, loadTemplates, renderChatMessage→renderChatMessageHTML).
- **Parity-impossible fallback:** ship auto-aim + graceful-degrade, log it, continue — don't block.
- **verified:14:** leave untouched; set with user at end.
- **Compendium edits:** OUT OF SCOPE — if the work ever leads there, STOP and notify user.
- **Escalation (interrupt the vacation) ONLY for:** a real data-safety risk, or an unresolvable v13.350 regression. Otherwise: halt that one thread, document here, keep working other lanes.

## Model allocation
- **My Opus:** area-shapes shim contract + feature-detect; damage-hooks split; suppression port; reference dialog-V2; all integration/commits/tests.
- **Other Opus (my pool):** gas port (Opus review mandatory).
- **Sonnet subagents:** geometry generators + unit tests; v15 namespacing; explosion+area-ray port; v14 E2E spec authoring + :30003/:30002 runs; dialog-V2 #2 & #3.
- Parallelism: non-overlapping files; **only I commit + run tests**; agents write + report.

## Phase plan
- **Phase 0 (me + first Sonnet lanes):** vitest; pure cone/ray→polygon geometry + tests; `module/combat/area-shapes.js` shim; split 4 features out of `damage-hooks.js`; v15 namespacing.
- **Phase 1 (fan out):** suppression / gas / explosion+area-ray ports; 3 dialog-V2; v14 E2E specs.
- **Phase 2 (me):** integrate, dual-core green, return summary.

## Commit policy
Commit per green increment on `v14-compat` with descriptive messages (`Co-Authored-By: Claude Opus 4.8`). Never push. Never touch release branch.

---

## Progress log (newest last)
- **2026-06-11** — Launch. Branch `v14-compat` created. Permissions scoped (repo writes allow, NightCity + push deny). Both rigs stood up + hardened (UPnP off + GM password). v14 empirically confirmed: system loads/inits/sheets-open; MeasuredTemplate gone as embedded type but shimmed-hollow (silent no-op); Region create + testPoint + flat-polygon validated. Reminder for 6/15 saved. Vitest installing. Next: geometry generators (Sonnet) + area-shapes shim (me).
- **2026-06-11** — Geometry generators (Sonnet lane) DONE: 25 unit tests green; committed `4da1356`. `area-shapes.js` shim DONE + **dual-core validated LIVE**: v14.364→Region+testPoint, v13.350→MeasuredTemplate+shape.contains; token-in-area correct + far token excluded + areasByFlag works on BOTH. 31 unit tests green. Keystone proven. Next (me): split the 4 area features out of `damage-hooks.js` into per-feature modules (behaviour-preserving), then fan out Phase 1 ports.
- **2026-06-11** — Fixed a PowerShell-permission flood (no `PowerShell` allow rule → every PS call prompted the user; invisible to me — they flagged it). Added `PowerShell` + git/npm/npx to settings allow; saved lesson `feedback-powershell-permission-autonomy`. **v15 global-namespacing DONE** (ActorSheet/ItemSheet/Actors/Items/loadTemplates → namespaced with `?? bare` fallback): dual-core regression GREEN — sheets render on v13.350 + v14.364, 0 console errors. **Plan adjustment:** the `:30000` e2e specs aren't rig-portable (different world content) → regression gate = **purpose-built dual-core specs** (like `area-shapes-live`). Folded the risky "big split" into per-feature extract-and-port increments. Next: port **suppression** (extract → `module/combat/area/suppression.js`, use the shim, v14 auto-aim + manual hatch) as the feature-port pattern-setter, with its own dual-core spec.
