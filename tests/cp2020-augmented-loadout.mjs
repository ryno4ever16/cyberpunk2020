/** Loadout materialization (Parts 1+2 of the borg batch): the pure manifest/item-data helpers, and
 *  the install→materialize→prune→re-install→delete lifecycle on a real actor. A body carrying a
 *  `loadout` manifest auto-creates its options as real cyberware (equipped, zoned, parented via Q6
 *  Module.ParentId) on install, and removes exactly them on uninstall/delete. */
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
  const L = await import("/modules/cp2020-augmented/module/mech/loadout.js");
  const sleep = (ms) => new Promise(res => setTimeout(res, ms));

  // ── (0) PURE ──────────────────────────────────────────────────────────────
  const withM = { flags: { "cp2020-augmented": { loadout: [{ name: "x", mountZone: "Head" }] } } };
  out.pure = {
    hasWith: L.hasLoadout(withM),
    hasWithout: L.hasLoadout({ flags: {} }),
    hasEmpty: L.hasLoadout({ flags: { "cp2020-augmented": { loadout: [] } } }),
    manifestLen: L.loadoutManifestOf(withM).length,
    eqOn: L.equippedChange({ system: { equipped: true } }),
    eqOff: L.equippedChange({ system: { equipped: false } }),
    eqNull: L.equippedChange({ system: { foo: 1 } }),
  };
  const data = L.loadoutItemData({ name: "Opt", mountZone: "Arm", side: "Right", cyberwareType: "CyberArm", humanityCost: "2", description: "d" }, "BODY123");
  out.pureData = {
    type: data.type, equipped: data.system.equipped === true, zone: data.system.MountZone,
    bodyType: data.system.CyberBodyType.Type, side: data.system.CyberBodyType.Location,
    parent: data.system.Module.ParentId, hloss: Number(data.system.humanityLoss) || 0,
    cost: Number(data.system.cost) || 0, src: data.flags["cp2020-augmented"].loadoutSource,
  };

  // ── (1) Lifecycle on a real actor ───────────────────────────────────────────
  for (const a of game.actors.filter(a => a.name.startsWith("__PW__Loadout"))) await a.delete().catch(() => {});
  const actor = await Actor.create({ name: "__PW__LoadoutPunk", type: "character" });
  const MANIFEST = [
    { name: "__PW__Optic", mountZone: "Head", cyberwareType: "CyberOptic", humanityCost: "3", description: "test optic" },
    { name: "__PW__ArmMount", mountZone: "Arm", side: "Right", cyberwareType: "CyberArm", humanityCost: "2" },
    { name: "__PW__LegMount", mountZone: "Leg", side: "Left", cyberwareType: "CyberLeg", humanityCost: "2" },
    { name: "__PW__Neural", mountZone: "Nervous", humanityCost: "1" },
  ];
  const [body] = await actor.createEmbeddedDocuments("Item", [{
    name: "__PW__Body", type: "cyberware",
    system: { equipped: false, EffectMode: "Permanent", EffectActive: false, CyberWorkType: {}, CyberBodyType: {}, Module: {} },
    flags: { "cp2020-augmented": { loadout: MANIFEST } },
  }]);
  const opts = (bid) => actor.items.filter(i => i.getFlag("cp2020-augmented", "loadoutSource") === bid);

  out.beforeInstall = { count: opts(body.id).length };   // 0 — created equipped:false, nothing materialized

  await body.update({ "system.equipped": true }); await sleep(1400);
  const optic = opts(body.id).find(i => i.name === "__PW__Optic");
  const arm = opts(body.id).find(i => i.name === "__PW__ArmMount");
  const leg = opts(body.id).find(i => i.name === "__PW__LegMount");
  out.installed = {
    count: opts(body.id).length,
    installedFlag: body.getFlag("cp2020-augmented", "loadoutInstalled") === true,
    opticZone: optic?.system?.MountZone,
    opticEquipped: optic?.system?.equipped === true,
    opticParent: optic?.system?.Module?.ParentId === body.id,
    opticHLoss: Number(optic?.system?.humanityLoss) || 0,     // never re-charged
    opticType: optic?.system?.cyberwareType,
    armZone: arm?.system?.MountZone, armSide: arm?.system?.CyberBodyType?.Location,
    legZone: leg?.system?.MountZone, legSide: leg?.system?.CyberBodyType?.Location,
  };

  // Idempotent: an explicit second materialize (or a re-render) must not duplicate (loadoutInstalled guard).
  await L.materializeLoadout(body); await sleep(400);
  out.idempotent = { count: opts(body.id).length };

  // Uninstall → prune exactly this body's options + clear the guard.
  await body.update({ "system.equipped": false }); await sleep(1400);
  out.uninstalled = {
    count: opts(body.id).length,
    flagCleared: body.getFlag("cp2020-augmented", "loadoutInstalled") === undefined,
  };

  // Re-install → fresh materialization.
  await body.update({ "system.equipped": true }); await sleep(1400);
  out.reinstalled = { count: opts(body.id).length };

  // Delete the body → the whole loadout goes with it.
  const bid = body.id;
  await body.delete(); await sleep(1400);
  out.deleted = { count: actor.items.filter(i => i.getFlag("cp2020-augmented", "loadoutSource") === bid).length };

  // ── (2) Negative: a body with NO manifest materializes nothing ──────────────
  const [plain] = await actor.createEmbeddedDocuments("Item", [{
    name: "__PW__Plain", type: "cyberware",
    system: { equipped: false, EffectMode: "Permanent", EffectActive: false, CyberWorkType: {}, CyberBodyType: {}, Module: {} },
  }]);
  await plain.update({ "system.equipped": true }); await sleep(800);
  out.negative = { count: actor.items.filter(i => i.getFlag("cp2020-augmented", "loadoutSource") === plain.id).length };

  await actor.delete().catch(() => {});
  return out;
});

console.log(JSON.stringify(r, null, 1));
const checks = [
  ["pure: hasLoadout true w/ manifest, false w/o, false when empty", r.pure.hasWith === true && r.pure.hasWithout === false && r.pure.hasEmpty === false],
  ["pure: manifest length read", r.pure.manifestLen === 1],
  ["pure: equippedChange on/off/null", r.pure.eqOn === "on" && r.pure.eqOff === "off" && r.pure.eqNull === null],
  ["pure: loadoutItemData shape (equipped, zone, side, parent, HL0, cost0, source)",
    r.pureData.type === "cyberware" && r.pureData.equipped === true && r.pureData.zone === "Arm"
    && r.pureData.bodyType === "Arm" && r.pureData.side === "Right" && r.pureData.parent === "BODY123"
    && r.pureData.hloss === 0 && r.pureData.cost === 0 && r.pureData.src === "BODY123"],
  ["e2e: nothing materialized before install", r.beforeInstall.count === 0],
  ["e2e: install materializes all 4 options + sets the guard", r.installed.count === 4 && r.installed.installedFlag === true],
  ["e2e: option lands in its zone, equipped, parented, Humanity not re-charged",
    r.installed.opticZone === "Head" && r.installed.opticEquipped === true && r.installed.opticParent === true
    && r.installed.opticHLoss === 0 && r.installed.opticType === "CyberOptic"],
  ["e2e: sided limb options carry zone + Left/Right (cyberZones buckets by these)",
    r.installed.armZone === "Arm" && r.installed.armSide === "Right" && r.installed.legZone === "Leg" && r.installed.legSide === "Left"],
  ["e2e: second materialize does not duplicate (idempotent)", r.idempotent.count === 4],
  ["e2e: uninstall prunes the options + clears the guard", r.uninstalled.count === 0 && r.uninstalled.flagCleared === true],
  ["e2e: re-install re-materializes cleanly", r.reinstalled.count === 4],
  ["e2e: deleting the body removes its whole loadout", r.deleted.count === 0],
  ["e2e: a body with no manifest materializes nothing", r.negative.count === 0],
  ["0 console errors", errors.length === 0],
];
let fail = 0;
for (const [n, ok] of checks) { console.log(`  ${ok ? "PASS" : "FAIL"}  ${n}`); if (!ok) fail++; }
if (errors.length) console.log("errors:", errors.slice(0, 6));
await b.close();
process.exit(fail ? 1 : 0);
