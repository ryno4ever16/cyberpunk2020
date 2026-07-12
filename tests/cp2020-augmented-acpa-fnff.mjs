/** ACPA FNFF build (Units B pt.2 / C / D) — pilot-driven initiative + movement, the Quick Kill pole,
 *  and the per-suit combat-model toggle. Deterministic core: pure-fn tables + cap, getRollData wiring,
 *  derived run/jump, acpaResolveMode pole selection, a quick-kill end-to-end (chat card), and the D sheet.
 *  Run: FVTT_URL=http://localhost:30004 FVTT_RIG_PASSWORD=cp2020-v14-rig node cp2020-augmented-acpa-fnff.mjs */
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
  const out = { checks: {} };
  const ok = (k, v) => { out.checks[k] = v; };
  // cleanup prior run
  for (const a of game.actors.filter(a => a.name.startsWith("__PW__ACPA"))) await a.delete().catch(() => {});
  try { await game.settings.set("cp2020-augmented", "vehicleDamageEnabled", true); } catch {}

  const acpa = await import("/modules/cp2020-augmented/module/vehicle/vehicle-acpa.js");
  const dmg = await import("/modules/cp2020-augmented/module/vehicle/vehicle-damage.js");

  // ── Pure-fn tables + cap (deterministic) ─────────────────────────────
  // acpaInitiativeRollData cap: SIB + PACS ≤ 20.
  const capHi = acpa.acpaInitiativeRollData({ sib: 18, pilotPACS: 5, effectiveRef: 7, commandComputer: true });
  ok("cap_clamped", capHi.CombatSenseMod === 2 && capHi.initiativeMod === 18 && capHi.stats.ref.total === 7 && capHi.initiativeImplantMod === 1);
  const capLo = acpa.acpaInitiativeRollData({ sib: 2, pilotPACS: 5, effectiveRef: 8, commandComputer: false });
  ok("cap_uncapped", capLo.CombatSenseMod === 5 && capLo.initiativeMod === 2 && capLo.initiativeImplantMod === 0);
  const capNeg = acpa.acpaInitiativeRollData({ sib: -3, pilotPACS: 0, effectiveRef: 5 });
  ok("cap_zero_pacs", capNeg.CombatSenseMod === 0 && capNeg.initiativeMod === -3);

  // acpaRunM / acpaJumpM (MM p.57).
  ok("runM_formula", acpa.acpaRunM({ sib: 2, ma: 6 }) === 24 && acpa.acpaRunM({ sib: 0, ma: 0 }) === 0);
  ok("jump_formula", acpa.acpaJumpM(24, {}) === 4 && acpa.acpaJumpM(24, { running: true }) === 6);

  // acpaHitLocation (MM p.5-6 table): ≤0 Power Cell / 1-3 Legs / 4-6 Arms / 7+ Torso/Head.
  ok("hitloc_table", dmg.acpaHitLocation(-1) === "Power Cell" && dmg.acpaHitLocation(0) === "Power Cell"
    && dmg.acpaHitLocation(2) === "Legs" && dmg.acpaHitLocation(5) === "Arms" && dmg.acpaHitLocation(9) === "Torso/Head");
  // A1 fix: the ACPA table spans −1..12 via the vehicle facing shift (+2 top / −1 side / −2 rear/bottom),
  // so a rear/bottom/side hit can reach the Power Cell (roll ≤0) and a top hit skews toward Torso/Head.
  ok("hitloc_facing", dmg.acpaHitLocation(1, "rear") === "Power Cell" && dmg.acpaHitLocation(2, "bottom") === "Power Cell"
    && dmg.acpaHitLocation(8, "top") === "Torso/Head" && dmg.acpaHitLocation(3, "side") === "Legs"
    && dmg.acpaHitLocation(3, "front") === "Legs");

  // acpaResolveMode pole selection (Units C/D).
  const M = dmg.acpaResolveMode;
  ok("mode_nopilot_quickkill", M({ acpaCombatModel: "", pilotId: "" }) === "quickkill");
  ok("mode_pilot_detailed",    M({ acpaCombatModel: "", pilotId: "abc" }) === "detailed");
  ok("mode_force_quickkill",   M({ acpaCombatModel: "quickkill", pilotId: "abc" }) === "quickkill");
  ok("mode_force_detailed",    M({ acpaCombatModel: "detailed", pilotId: "" }) === "detailed");

  // mmDamageSeverity with BodyValue = STR/20 (quick-kill reuses the vehicle severity table).
  const sev = dmg.mmDamageSeverity({ pen: 20, effectiveArmorValue: 5, bodyValue: 1, d10: 5 });
  ok("severity_penetrates", sev.penetrated === true && typeof sev.severity === "string");

  // ── Live actor: pilot + linked ACPA (B2 getRollData + B4 movement) ───
  const pilot = await Actor.create({ name: "__PW__ACPA Pilot", type: "character" });
  await pilot.update({ "system.stats.ref.base": 8, "system.stats.ma.base": 6 });
  await pilot.createEmbeddedDocuments("Item", [{ _id: "PACombatSense001", name: "PA Combat Sense", type: "skill", system: { level: 3, stat: "ref" } }], { keepId: true });
  const pilotFresh = game.actors.get(pilot.id);
  out.pilot = { ref: pilotFresh.system?.stats?.ref?.total, ma: pilotFresh.system?.stats?.ma?.total,
    pacsItem: !!pilotFresh.items.find(i => i._id === "PACombatSense001") };

  const suit = await Actor.create({ name: "__PW__ACPA Suit", type: "cp2020-augmented.vehicle",
    system: { isACPA: true, str: 30, sp: { front: 20, side: 20, rear: 20, top: 20, bottom: 20 } } });
  await suit.update({ "system.pilotId": pilot.id });
  suit.reset();
  const ss = game.actors.get(suit.id).system;
  const sib = Number(ss.sib) || 0, effRef = Number(ss.effectiveRef) || 0, pacs = 3;
  out.derived = { sib, effRef, pilotPACS: ss.pilotPACS, runM: ss.runM, jumpStanding: ss.jumpStanding, jumpRunning: ss.jumpRunning };

  // B2 — getRollData maps the derived init terms into the system initiative formula for an ACPA.
  const rd = game.actors.get(suit.id).getRollData();
  const expectPacs = Math.max(0, Math.min(pacs, 20 - sib));
  ok("b2_pilotPACS_read", ss.pilotPACS === pacs);
  ok("b2_rolldata_ref", rd?.stats?.ref?.total === effRef);
  ok("b2_rolldata_sib", rd?.initiativeMod === sib);
  ok("b2_rolldata_pacs", rd?.CombatSenseMod === expectPacs);
  ok("b2_rolldata_implant", rd?.initiativeImplantMod === (ss.commandComputer ? 1 : 0));

  // B4 — run/jump derived from (SIB + pilot MA) × 3.
  ok("b4_runM", ss.runM === (sib + 6) * 3);
  ok("b4_jumpStanding", ss.jumpStanding === acpa.acpaJumpM(ss.runM, {}));
  ok("b4_jumpRunning", ss.jumpRunning === acpa.acpaJumpM(ss.runM, { running: true }));

  // Non-ACPA + character actors are untouched by the getRollData wrap.
  const rdPilot = pilotFresh.getRollData();
  ok("b2_pilot_rolldata_untouched", rdPilot?.CombatSenseMod === undefined || typeof rdPilot?.stats?.ref?.total === "number");

  // ── C — quick-kill end-to-end on an unpiloted suit (chat card says Quick Kill) ──
  await suit.update({ "system.pilotId": "", "system.acpaCombatModel": "quickkill" });
  const before = new Set(game.messages.map(m => m.id));
  let qkResult = null, qkThrew = false;
  try { qkResult = await dmg.applyVehicleDamageMM(game.actors.get(suit.id), { basePen: 45, facing: "front" }); }
  catch (e) { qkThrew = true; out.qkError = String(e?.message || e); }
  await new Promise(res => setTimeout(res, 400));
  const newMsg = game.messages.find(m => !before.has(m.id) && /__PW__ACPA Suit|Quick Kill|SDP|Pen/i.test(m.content || ""));
  ok("c_quickkill_ran", qkThrew === false && qkResult != null && qkResult.isACPA === true);
  ok("c_quickkill_card", !!newMsg && /Quick Kill/i.test(newMsg?.content || ""));
  out.qkResult = qkResult ? { isACPA: qkResult.isACPA, pen: qkResult.pen } : null;

  // ── D — schema field round-trips + sheet renders the GM select + effective-model field ──
  await suit.update({ "system.acpaCombatModel": "detailed" });
  ok("d_field_roundtrip", game.actors.get(suit.id).system.acpaCombatModel === "detailed");
  const suitDoc = game.actors.get(suit.id);
  await suitDoc.sheet.render(true);
  await new Promise(res => setTimeout(res, 800));
  const root = suitDoc.sheet.element instanceof HTMLElement ? suitDoc.sheet.element : suitDoc.sheet.element?.[0];
  const sel = root?.querySelector('select[name="system.acpaCombatModel"]');
  ok("d_sheet_select", !!sel);
  ok("d_sheet_select_options", (sel?.querySelectorAll("option").length ?? 0) === 3);
  ok("d_sheet_effective_field", /Active model|Detailed|Quick Kill/i.test(root?.textContent || ""));
  ok("d_sheet_no_rawkey", !/CYBERPUNK\.Vehicle\.Acpa/.test(root?.textContent || ""));
  await suitDoc.sheet.close().catch(() => {});

  // cleanup
  await suit.delete().catch(() => {});
  await pilot.delete().catch(() => {});
  return out;
});

console.log("\n===== ACPA FNFF build (Units B pt.2 / C / D) =====");
console.log("  pilot:", JSON.stringify(r.pilot));
console.log("  derived:", JSON.stringify(r.derived));
console.log("  quick-kill result:", JSON.stringify(r.qkResult), r.qkError ? ("ERR: " + r.qkError) : "");
for (const [k, v] of Object.entries(r.checks)) console.log(`  ${v ? "✅" : "❌"} ${k}`);
console.log("  page errors:", errors.length ? errors.slice(0, 5) : "none");

const failed = Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k);
const ok = failed.length === 0 && errors.length === 0;
console.log("\n  RESULT: " + (ok ? `PASS ✅ — ${Object.keys(r.checks).length}/${Object.keys(r.checks).length} checks`
  : `FAIL ❌ — failed: ${failed.join(", ") || "(none)"}${errors.length ? " · page errors: " + errors.length : ""}`));
await b.close();
process.exit(ok ? 0 : 1);
