/** D4 combat-drug engine (SPECIAL-MECHANICS-D4-PROPOSAL.md §T2a): the pure helpers (block gate,
 *  tick, boost summary) and, on a real actor, the whole lifecycle — take a dose (stat overlay
 *  applies + addiction counter bumps + "took" card), wear it off manually (boost lifts + wear-off
 *  save card), the round-tick auto-expiry for a timed drug, and the status-strip surfacing of both
 *  the drug row and the addiction tally. Runs on :30004 (official 1.1.1 + module). */
import { chromium } from "@playwright/test";
const BASE = process.env.FVTT_URL || "http://localhost:30004";
const PW = process.env.FVTT_RIG_PASSWORD || "cp2020-v14-rig";
async function joinGM(p){await p.goto(BASE+"/join",{waitUntil:"domcontentloaded"});const s=p.locator('select[name="userid"]');await s.waitFor({state:"visible",timeout:30000});const us=await s.locator("option").evaluateAll(o=>o.map(x=>({v:x.value,l:(x.textContent||"").trim()})).filter(x=>x.v));const g=us.find(u=>/gamemaster/i.test(u.l));await s.selectOption(g.v);await p.locator('input[name="password"]').fill(PW);await Promise.all([p.waitForNavigation({url:/\/game/,timeout:45000}).catch(()=>{}),p.locator('button[name="join"]').click()]);await p.waitForFunction(()=>window.game?.ready===true,undefined,{timeout:60000});}

const b = await chromium.launch({ headless: true });
const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
p.on("pageerror", e => errors.push("pageerror: " + e.message));
p.on("console", m => { if (m.type() === "error") errors.push("console: " + m.text()); });
await joinGM(p);

const r = await p.evaluate(async () => {
  const out = {};
  const S = await import("/modules/cp2020-augmented/module/mech/drug.js");
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  // ── (0) PURE ──────────────────────────────────────────────────────────────
  out.drugOf = {
    on: !!S.drugOf({ system: { mechDrug: { enabled: true } } }),
    off: S.drugOf({ system: { mechDrug: { enabled: false } } }) === null,
    none: S.drugOf({ system: {} }) === null
  };
  const tick = S.tickDrugMarkers([
    { itemId: "a", turnsLeft: 2 },   // timed, survives (→1)
    { itemId: "b", turnsLeft: 1 },   // timed, expires
    { itemId: "c", turnsLeft: 0 }    // untimed, persists forever
  ]);
  out.tick = {
    survivingIds: tick.surviving.map(m => m.itemId).sort().join(","),
    aLeft: tick.surviving.find(m => m.itemId === "a")?.turnsLeft,
    expiredIds: tick.expired.map(m => m.itemId).join(",")
  };
  out.boostSummary = S.boostSummary({ statBoosts: [{ stat: "cool", mod: 3 }, { stat: "emp", mod: -3 }], rollBoosts: [{ label: "Awareness", mod: 3 }] });

  // ── (1) full lifecycle on a real actor ────────────────────────────────────
  // Pre-clean: a leftover ACTIVE combat from a crashed prior run feeds per-turn drug ticks into THIS
  // run — sweep combats tied to our fixtures too, not just the actors.
  for (const c of [...game.combats].filter(c => c.combatants.some(cb => cb.actor?.name?.startsWith("__PW__")))) await c.delete().catch(() => {});
  for (const a of game.actors.filter(a => a.name.startsWith("__PW__Drug"))) await a.delete().catch(() => {});
  const actor = await Actor.create({ name: "__PW__DrugPunk", type: "character" });
  await actor.update({ "system.stats.cool.base": 8, "system.stats.emp.base": 5, "system.stats.ref.base": 6 });
  await sleep(300);
  const total = (s) => actor.system.stats[s].total;
  const markers = () => S.drugMarkersFor(actor);
  const addiction = () => S.addictionStateFor(actor);
  out.baseline = { cool: total("cool"), emp: total("emp"), noFlag: actor._mechDrugMods == null, noMarkers: markers().length === 0, noAddiction: addiction().total === 0 };

  // "Char": COOL +3 / EMP −3 while active; addiction TN 20; no auto-timer (worn off manually).
  const [char] = await actor.createEmbeddedDocuments("Item", [{ name: "__PW__Char", type: "misc",
    system: { equipped: true, mechDrug: { enabled: true, statBoosts: [{ stat: "cool", mod: 3 }, { stat: "emp", mod: -3 }],
      rollBoosts: [], duration: "1d10+1 minutes", durationTurns: "", expireSave: { stat: "", difficulty: 0, penalty: "" },
      addictionDifficulty: 20, psychosis: "", note: "Confidence drug" } } }]);
  await sleep(200);

  await S.takeDrug(char); await sleep(600);
  out.taken = { cool: total("cool"), emp: total("emp"), flag: !!actor._mechDrugMods?.cool,
    markerCount: markers().length, addictionTotal: addiction().total, addictionChar: addiction().byDrug["__PW__Char"] };

  // Second dose while active is REFUSED (single-dose rule): call returns false, boost/tally unchanged.
  const secondTake = await S.takeDrug(char); await sleep(400);
  out.secondDose = { refused: secondTake === false, cool: total("cool"),
    markerCount: markers().length, addictionTotal: addiction().total };

  // Strip + tooltip surfacing while active.
  await actor.sheet.render(true); await sleep(900);
  let root = actor.sheet.element;
  const drugPill = [...(root?.querySelectorAll(".cp-status-pill.cp-kind-drug") ?? [])][0];
  const addPill = [...(root?.querySelectorAll(".cp-status-pill.cp-kind-addiction") ?? [])][0];
  const coolTip = root?.querySelector('.stat-total[data-stat-name="cool"]')?.getAttribute("title") ?? "";
  out.surface = {
    drugPill: !!drugPill, drugText: drugPill?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    addPill: !!addPill, addText: addPill?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    coolTipNamesDrug: /__PW__Char/.test(coolTip)
  };
  await actor.sheet.close().catch(() => {});

  // Wear off manually → boost lifts, marker cleared, addiction PERSISTS (tracking, not auto-reset).
  await S.endDrug(char); await sleep(600);
  out.wornOff = { cool: total("cool"), emp: total("emp"), noMarkers: markers().length === 0, addictionStillOne: addiction().total === 1 };

  // Re-take → addiction increments (same drug ×2).
  await S.takeDrug(char); await sleep(500);
  out.reDose = { addictionTotal: addiction().total, addictionChar: addiction().byDrug["__PW__Char"] };
  await S.endDrug(char); await sleep(400);

  // Clear the tally.
  await S.clearAddiction(actor); await sleep(300);
  out.cleared = { addictionTotal: addiction().total };

  // ── (1b) interactive wear-off save + auto-applied crash (guaranteed fail/pass) ─────
  // Guaranteed FAIL: 1d10 + COOL(8) tops out at 18, difficulty 99 → always crashes.
  const [crashDrug] = await actor.createEmbeddedDocuments("Item", [{ name: "__PW__CrashDrug", type: "misc",
    system: { equipped: true, mechDrug: { enabled: true, statBoosts: [], rollBoosts: [], duration: "1 hour", durationTurns: "",
      expireSave: { stat: "cool", difficulty: 99, penaltyBoosts: [{ stat: "cool", mod: -2 }], penaltyTurns: "", penalty: "-3 to all skills" },
      addictionDifficulty: 0, psychosis: "", note: "" } } }]);
  await sleep(200);
  await S.takeDrug(crashDrug); await sleep(400);
  const msgBefore = game.messages.size;
  await S.endDrug(crashDrug); await sleep(500);               // posts the INTERACTIVE wear-off card
  // Scope to THIS drug's card, not the global last message (a status/other card may post after it).
  const woCard = game.messages.contents.slice(msgBefore).reverse().find(m => (m.content || "").includes(crashDrug.id))?.content ?? "";
  out.saveCard = { interactive: /cp-drug-save-roll/.test(woCard), carriesItem: woCard.includes(crashDrug.id), posted: game.messages.size > msgBefore };
  await S.executeDrugExpireSave({ actorId: actor.id, itemId: crashDrug.id }); await sleep(600);
  out.crashApplied = { cool: total("cool"), penaltyMarker: markers().some(m => m.isPenalty && m.itemId === crashDrug.id) };
  // The crash shows in the strip labelled as a crash.
  await actor.sheet.render(true); await sleep(800);
  root = actor.sheet.element;
  const crashPill = [...(root?.querySelectorAll(".cp-status-pill.cp-kind-drug") ?? [])].map(e => e.textContent.replace(/\s+/g, " ").trim());
  out.crashPill = crashPill.some(t => /crash/i.test(t) && /COOL/.test(t));
  await actor.sheet.close().catch(() => {});
  // Clear the crash (item-sheet Wear-off finds the penalty marker by itemId).
  await S.endDrug(crashDrug); await sleep(400);
  out.crashCleared = { cool: total("cool"), noPenalty: !markers().some(m => m.isPenalty) };

  // Guaranteed PASS: difficulty 1 → 1d10 + COOL always ≥ 1 → resisted, no crash.
  const [passDrug] = await actor.createEmbeddedDocuments("Item", [{ name: "__PW__PassDrug", type: "misc",
    system: { equipped: true, mechDrug: { enabled: true, statBoosts: [], rollBoosts: [], duration: "1 hour", durationTurns: "",
      expireSave: { stat: "cool", difficulty: 1, penaltyBoosts: [{ stat: "cool", mod: -2 }], penaltyTurns: "", penalty: "" },
      addictionDifficulty: 0, psychosis: "", note: "" } } }]);
  await sleep(200);
  await S.executeDrugExpireSave({ actorId: actor.id, itemId: passDrug.id }); await sleep(500);
  out.savePass = { cool: total("cool"), noPenalty: !markers().some(m => m.isPenalty) };

  // ── (2) round-tick auto-expiry (1-turn) + a 3-turn countdown that PERSISTS every tick ─────────────
  // Combat is created active:true; a mid-run throw would otherwise leave it feeding later keepers' per-
  // turn hooks — tear the combat/token down in finally so an exception never leaks an active combat.
  let scene = null, tok = null, combat = null;
  try {
    const [stim] = await actor.createEmbeddedDocuments("Item", [{ name: "__PW__Stim", type: "misc",
      system: { equipped: true, mechDrug: { enabled: true, statBoosts: [{ stat: "ref", mod: 2 }],
        rollBoosts: [], duration: "1 turn", durationTurns: "1", expireSave: { stat: "", difficulty: 0, penalty: "" },
        addictionDifficulty: 0, psychosis: "", note: "Timed test" } } }]);
    await sleep(200);
    scene = game.scenes.viewed ?? game.scenes.active ?? game.scenes.contents[0];
    [tok] = await scene.createEmbeddedDocuments("Token", [{ name: "__PW__Drug", actorId: actor.id, actorLink: true, x: 1500, y: 1500 }]);
    combat = await Combat.create({ scene: scene.id, active: true });
    await combat.createEmbeddedDocuments("Combatant", [{ tokenId: tok.id, actorId: actor.id }]);
    await combat.startCombat();          // round 0→1: the begin-combat guard skips ticking here
    await sleep(300);
    await S.takeDrug(stim); await sleep(500);
    out.timedTaken = { ref: total("ref"), markerTurns: markers().find(m => m.itemId === stim.id)?.turnsLeft };
    await combat.nextRound();            // round 1→2: prevRound 1 → the tick decrements 1→0 → expires
    for (let i = 0; i < 25 && markers().length; i++) await sleep(200);
    out.timedExpired = { ref: total("ref"), noMarkers: markers().length === 0 };

    // FIX(b): a 3-turn timed marker decrements on EVERY tick and persists across rounds — assert the
    //         FLAG VALUE each tick (3 → 2 → 1 → expiry), not just a final absence.
    const [stim3] = await actor.createEmbeddedDocuments("Item", [{ name: "__PW__Stim3", type: "misc",
      system: { equipped: true, mechDrug: { enabled: true, statBoosts: [{ stat: "ref", mod: 2 }],
        rollBoosts: [], duration: "3 turns", durationTurns: "3", expireSave: { stat: "", difficulty: 0, penalty: "" },
        addictionDifficulty: 0, psychosis: "", note: "3-turn countdown test" } } }]);
    await sleep(200);
    await S.takeDrug(stim3); await sleep(500);
    const turnsOf = () => markers().find(m => m.itemId === stim3.id)?.turnsLeft ?? null;
    const start3 = turnsOf();                                                             // 3
    await combat.nextRound(); for (let i = 0; i < 25 && turnsOf() !== 2; i++) await sleep(200);
    const after1 = turnsOf();                                                             // 2
    await combat.nextRound(); for (let i = 0; i < 25 && turnsOf() !== 1; i++) await sleep(200);
    const after2 = turnsOf();                                                             // 1
    await combat.nextRound(); for (let i = 0; i < 25 && markers().some(m => m.itemId === stim3.id); i++) await sleep(200);
    out.timed3 = { start: start3, after1, after2, expired: !markers().some(m => m.itemId === stim3.id) };
  } finally {
    if (combat) await combat.delete().catch(() => {});
    if (scene && tok) await scene.deleteEmbeddedDocuments("Token", [tok.id]).catch(() => {});
  }
  await actor.delete().catch(() => {});
  return out;
});

console.log(JSON.stringify(r, null, 1));
const checks = [
  ["pure: drugOf gate (enabled yes / disabled+missing no)", r.drugOf.on && r.drugOf.off && r.drugOf.none],
  ["pure: tick — timed survives/expires, untimed persists", r.tick.survivingIds === "a,c" && r.tick.aLeft === 1 && r.tick.expiredIds === "b"],
  ["pure: boostSummary joins stat + roll boosts", r.boostSummary === "COOL +3, EMP -3, Awareness +3"],
  ["e2e: baseline clean (no boost/marker/addiction)", r.baseline.cool === 8 && r.baseline.emp === 5 && r.baseline.noFlag && r.baseline.noMarkers && r.baseline.noAddiction],
  ["e2e: take applies COOL +3 / EMP −3 + 1 marker", r.taken.cool === 11 && r.taken.emp === 2 && r.taken.flag === true && r.taken.markerCount === 1],
  ["e2e: take bumps the addiction counter (Char ×1)", r.taken.addictionTotal === 1 && r.taken.addictionChar === 1],
  ["e2e: second dose while active is refused (boost, marker and tally unchanged)", r.secondDose.refused && r.secondDose.cool === 11 && r.secondDose.markerCount === 1 && r.secondDose.addictionTotal === 1],
  ["surface: drug pill shows the boost, cool tooltip names the drug", r.surface.drugPill && /COOL/.test(r.surface.drugText) && r.surface.coolTipNamesDrug],
  ["surface: addiction pill present with a count", r.surface.addPill && /1/.test(r.surface.addText)],
  ["e2e: wear off lifts the boost + clears the marker (addiction persists)", r.wornOff.cool === 8 && r.wornOff.emp === 5 && r.wornOff.noMarkers && r.wornOff.addictionStillOne],
  ["e2e: re-dose increments the addiction tally (×2)", r.reDose.addictionTotal === 2 && r.reDose.addictionChar === 2],
  ["e2e: clear resets the tally to 0", r.cleared.addictionTotal === 0],
  ["save: wear-off posts the INTERACTIVE card (Roll button + item id)", r.saveCard.posted && r.saveCard.interactive && r.saveCard.carriesItem],
  ["save: failed save applies the crash (COOL −2 overlay + penalty marker)", r.crashApplied.cool === 6 && r.crashApplied.penaltyMarker === true],
  ["save: crash pill shows in the strip labelled 'crash'", r.crashPill === true],
  ["save: clearing the crash lifts the penalty (COOL back to 8)", r.crashCleared.cool === 8 && r.crashCleared.noPenalty],
  ["save: passed save applies no crash", r.savePass.cool === 8 && r.savePass.noPenalty],
  ["e2e: timed drug applies REF +2 with turnsLeft 1", r.timedTaken.ref === 8 && r.timedTaken.markerTurns === 1],
  ["e2e: round tick expires the timed drug (boost drops)", r.timedExpired.ref === 6 && r.timedExpired.noMarkers],
  ["e2e: a 3-turn countdown persists + decrements every tick (3→2→1→expiry)", r.timed3.start === 3 && r.timed3.after1 === 2 && r.timed3.after2 === 1 && r.timed3.expired === true],
  ["0 console errors", errors.length === 0]
];
let fail = 0;
for (const [n, ok] of checks) { console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; }
if (errors.length) console.log("errors:", errors.slice(0, 6));
await b.close();
process.exit(fail ? 1 : 0);
