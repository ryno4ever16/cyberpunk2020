/**
 * Test-actor PROVISIONER runner + verifier (:30004, official 1.1.1 + module).
 *
 * Runs the standard-process provisioner in the live rig, then reads every created item back and
 * asserts the mech* fields PERSISTED on the misc/cyberware DataModels (the Batch-A assumption: misc
 * items take mechRollMods/mechStatMods/mechVision/mechLight/mechProtection/mechConsumable/mechContainer;
 * cyberware chips take CyberWorkType.ChipSkills). If a field were stripped by the model it would read
 * back undefined and fail here. Leaves the fixtures in place for hands-on testing.
 *
 * Run:  FVTT_URL=http://localhost:30004 FVTT_RIG_PASSWORD=cp2020-v14-rig node cp2020-augmented-provision-test-actors.mjs
 */
import { chromium } from "@playwright/test";
const BASE = process.env.FVTT_URL || "http://localhost:30004";
const GM_PW = process.env.FVTT_RIG_PASSWORD || "cp2020-v14-rig";

async function joinAs(page, match, pws) {
  await page.goto(BASE + "/join", { waitUntil: "domcontentloaded" });
  const s = page.locator('select[name="userid"]');
  await s.waitFor({ state: "visible", timeout: 30000 });
  const us = await s.locator("option").evaluateAll(o => o.map(x => ({ v: x.value, l: (x.textContent || "").trim() })).filter(x => x.v));
  const u = us.find(x => match.test(x.l));
  if (!u) throw new Error("no user matching " + match);
  for (const pw of pws) {
    await s.selectOption(u.v);
    await page.locator('input[name="password"]').fill(pw);
    await Promise.all([page.waitForNavigation({ url: /\/game/, timeout: 15000 }).catch(() => {}), page.locator('button[name="join"]').click()]);
    try { await page.waitForFunction(() => window.game?.ready === true, undefined, { timeout: 15000 }); return u.l; }
    catch { await page.goto(BASE + "/join", { waitUntil: "domcontentloaded" }).catch(() => {}); await s.waitFor({ state: "visible" }).catch(() => {}); }
  }
  throw new Error("join failed " + u.l);
}

const b = await chromium.launch({ headless: true });
let pass = false; const log = [];
try {
  const gm = await (await b.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  gm.on("pageerror", e => log.push("PAGEERR " + e.message));
  await joinAs(gm, /gamemaster/i, [GM_PW]);
  await gm.waitForFunction(() => window.canvas?.ready === true, undefined, { timeout: 30000 }).catch(() => {});

  // --- run the provisioner (mirrors import-staging/test-fixtures/provision-test-actors.js) ---
  const res = await gm.evaluate(async () => {
    const FOLDER = "🧪 Automation Test Fixtures", SCOPE = "cp2020-augmented";
    for (const f of game.folders.filter(f => f.name === FOLDER && f.type === "Actor")) {
      const ids = f.contents.map(a => a.id); if (ids.length) await Actor.deleteDocuments(ids); await f.delete();
    }
    const folder = await Folder.create({ name: FOLDER, type: "Actor" });
    const misc = (name, system) => ({ name, type: "misc", img: "icons/svg/item-bag.svg",
      system: { equipped: true, cost: 0, weight: 0, source: "TEST", ...system }, flags: { [SCOPE]: { testFixture: true } } });
    const chip = (name, cs) => ({ name, type: "cyberware", img: "icons/svg/chest.svg",
      system: { equipped: true, cost: 0, weight: 0, source: "TEST", surgCode: "N", humanityCost: "0", cyberwareType: "CHIPWARE",
        cyberwareSubtype: "OPTION", EffectMode: "Permanent", EffectActive: true,
        CyberWorkType: { Type: "Chip", Types: ["Chip"], ChipSkills: cs, ChipActive: true } }, flags: { [SCOPE]: { testFixture: true } } });

    const player = game.users.find(u => !u.isGM); const ownership = { default: 0 };
    if (player) ownership[player.id] = 3; else ownership.default = 3;
    const pc = await Actor.create({ name: "🧪 Test PC — Wired Gear", type: "character", folder: folder.id, ownership });
    if (!pc.items.some(i => i.type === "skill")) {
      const pack = game.packs.get("cyberpunk2020.default-skills-en") || game.packs.get("cyberpunk2020.default-skills");
      if (pack) { const docs = await pack.getDocuments(); await pc.createEmbeddedDocuments("Item", docs.map(d => d.toObject())); }
    }
    await pc.createEmbeddedDocuments("Item", [
      misc("TEST · Medscanner (+2 Diagnose Illness) [P5 skill]", { mechRollMods: { enabled: true, attackMod: 0, skillName: "Diagnose Illness", skillMod: 2, auto: true } }),
      misc("TEST · Targeting Scope (+1 attack) [P5 atk]", { mechRollMods: { enabled: true, attackMod: 1, skillName: "", skillMod: 0, auto: true } }),
      misc("TEST · Personality Moddy (INT +2) [Q7 stat]", { mechStatMods: { enabled: true, mods: [{ stat: "int", mod: 2, combatMod: 0, context: "any", cap: 0, floor: 0, isSet: false, set: 0 }] } }),
      misc("TEST · IR Goggles (infrared) [P4 vision]", { mechVision: { enabled: true, on: true, mode: "infrared", range: 20, requiresItem: "" } }),
      misc("TEST · Flashlight (cone) [P3 light]", { mechLight: { enabled: true, on: true, shape: "cone", bright: 10, dim: 20, angle: 45, color: "" } }),
      misc("TEST · Gas Mask (gas immune) [P6 protect]", { mechProtection: { enabled: true, gas: { immune: true, mod: 0, percent: 0, damageMult: 0 }, flash: { immune: false, mod: 0, percent: 0, damageMult: 0 }, sonic: { immune: false, mod: 0, percent: 0, damageMult: 0 } } }),
      misc("TEST · Stimulant (3 doses) [P7 consumable]", { mechConsumable: { enabled: true, doses: 3, durationTurns: "1d6+2", note: "+1 REF" } }),
      chip("TEST · Skill Chip: Botany +3 [chip]", { Botany: 3 }),
    ]);
    const [arm] = await pc.createEmbeddedDocuments("Item", [misc("TEST · Cyberarm Compartment (cap 2) [Q6]", { mechContainer: { installedIn: "", capacity: 2, slotsTaken: 1 } })]);
    await pc.createEmbeddedDocuments("Item", [misc("TEST · Holdout Pistol (installed) [Q6 child]", { mechContainer: { installedIn: arm.id, capacity: 0, slotsTaken: 1 } })]);
    // Test Borg — import the real Dragoon (loadout materializes + FBC stats) + a re-typed flavor chip.
    const packByName = (n) => game.packs.get(`${SCOPE}.${n}`) || [...game.packs].find(pk => pk.metadata?.name === n);
    let borg = null;
    const cyberPack = packByName("supplement-cyberware");
    const dEntry = cyberPack ? (await cyberPack.getIndex()).find(e => e.name === "Dragoon") : null;
    if (dEntry) {
      borg = await Actor.create({ name: "🦾 Test Borg — Dragoon (loadout + FBC stats)", type: "character", folder: folder.id, ownership });
      const spack = game.packs.get("cyberpunk2020.default-skills-en") || game.packs.get("cyberpunk2020.default-skills");
      if (spack) { const docs = await spack.getDocuments(); await borg.createEmbeddedDocuments("Item", docs.map(d => d.toObject())); }
      const bodyData = (await cyberPack.getDocument(dEntry._id)).toObject(); bodyData.system.equipped = true;
      await borg.createEmbeddedDocuments("Item", [bodyData]);
      const chipPack = packByName("supplement-chipware");
      const cEntry = chipPack ? (await chipPack.getIndex()).find(e => e.name === "Death Trance") : null;
      if (cEntry) { const cd = (await chipPack.getDocument(cEntry._id)).toObject(); cd.system.equipped = true; cd.system.CyberWorkType = { ...(cd.system.CyberWorkType || {}), ChipActive: true }; await borg.createEmbeddedDocuments("Item", [cd]); }
    }
    const dummy = await Actor.create({ name: "🎯 Test Dummy (target)", type: "character", folder: folder.id, ownership: { default: 0 } });
    const scene = game.scenes.active; let tokens = 0;
    if (scene) {
      const mk = async (a, x, y) => (await a.getTokenDocument({ x, y, actorLink: true })).toObject();
      const drop = [await mk(pc, 1000, 1000), await mk(dummy, 1300, 1000)];
      if (borg) drop.push(await mk(borg, 1000, 1300));
      const t = await scene.createEmbeddedDocuments("Token", drop);
      tokens = t.length;
    }
    return { pcId: pc.id, dummyId: dummy.id, armId: arm.id, borgId: borg?.id ?? null, tokens,
      skills: pc.items.filter(i => i.type === "skill").length, playerOwned: !!player };
  });
  log.push(`provisioned: pc=${res.pcId} dummy=${res.dummyId} skills=${res.skills} tokens=${res.tokens} playerOwned=${res.playerOwned}`);

  // --- read back + assert mech* persistence ---
  const v = await gm.evaluate((armId) => {
    const pc = game.actors.find(a => a.name === "🧪 Test PC — Wired Gear");
    if (!pc) return { ok: false, why: "Test PC not found" };
    const byTag = t => pc.items.find(i => (i.name || "").includes(t));
    const g = (i, p) => p.split(".").reduce((o, k) => o?.[k], i?.system);
    const checks = [];
    const chk = (label, cond, got) => checks.push({ label, ok: !!cond, got });
    chk("skills present (Diagnose Illness)", pc.items.some(i => i.type === "skill" && /diagnose illness/i.test(i.name)), pc.items.filter(i => i.type === "skill").length + " skills");
    chk("P5 skill: Medscanner Diagnose Illness +2", g(byTag("Medscanner"), "mechRollMods.skillName") === "Diagnose Illness" && g(byTag("Medscanner"), "mechRollMods.skillMod") === 2, JSON.stringify(g(byTag("Medscanner"), "mechRollMods")));
    chk("P5 atk: Scope attackMod +1", g(byTag("Targeting Scope"), "mechRollMods.attackMod") === 1, g(byTag("Targeting Scope"), "mechRollMods.attackMod"));
    chk("Q7 stat: Moddy int +2", g(byTag("Personality Moddy"), "mechStatMods.mods.0.stat") === "int" && g(byTag("Personality Moddy"), "mechStatMods.mods.0.mod") === 2, JSON.stringify(g(byTag("Personality Moddy"), "mechStatMods.mods")));
    chk("P4 vision: Goggles infrared", g(byTag("IR Goggles"), "mechVision.mode") === "infrared" && g(byTag("IR Goggles"), "mechVision.enabled") === true, JSON.stringify(g(byTag("IR Goggles"), "mechVision")));
    chk("P3 light: Flashlight cone enabled", g(byTag("Flashlight"), "mechLight.enabled") === true && g(byTag("Flashlight"), "mechLight.shape") === "cone", JSON.stringify(g(byTag("Flashlight"), "mechLight")));
    chk("P6 protect: Gas Mask gas immune", g(byTag("Gas Mask"), "mechProtection.gas.immune") === true, JSON.stringify(g(byTag("Gas Mask"), "mechProtection.gas")));
    chk("P7 consumable: Stimulant doses 3", g(byTag("Stimulant"), "mechConsumable.doses") === 3, g(byTag("Stimulant"), "mechConsumable.doses"));
    chk("chip: Botany +3 ChipSkills", g(byTag("Skill Chip"), "CyberWorkType.ChipSkills.Botany") === 3, JSON.stringify(g(byTag("Skill Chip"), "CyberWorkType.ChipSkills")));
    chk("Q6 container: compartment capacity 2", g(byTag("Cyberarm Compartment"), "mechContainer.capacity") === 2, g(byTag("Cyberarm Compartment"), "mechContainer.capacity"));
    chk("Q6 child: holdout installedIn compartment", g(byTag("Holdout Pistol"), "mechContainer.installedIn") === armId, g(byTag("Holdout Pistol"), "mechContainer.installedIn"));
    return { ok: checks.every(c => c.ok), checks };
  }, res.armId);

  for (const c of v.checks || []) log.push(`  ${c.ok ? "PASS" : "FAIL"}  ${c.label}  ${c.ok ? "" : "-> got " + c.got}`);

  // --- verify the Test Borg fixture (loadout materialized + FBC stats + chip) ---
  const vb = await gm.evaluate(async () => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const borg = game.actors.find(a => a.name.startsWith("🦾 Test Borg"));
    const checks = []; const chk = (l, c, g) => checks.push({ label: l, ok: !!c, got: g });
    chk("Test Borg created", !!borg);
    if (borg) {
      const body = borg.items.find(i => i.name === "Dragoon");
      const opts = () => borg.items.filter(x => x.getFlag("cp2020-augmented", "loadoutSource") === body?.id);
      for (let i = 0; i < 40 && opts().length < 26; i++) await sleep(200);
      const zones = {}; for (const o of opts()) { const z = String(o.system?.MountZone || ""); zones[z] = (zones[z] || 0) + 1; }
      chk("loadout materialized (>=26 options)", opts().length >= 26, opts().length);
      chk("options across Head/Arm/Leg/Nervous/Torso", ["Head", "Arm", "Leg", "Nervous", "Torso"].every(z => (zones[z] || 0) > 0), JSON.stringify(zones));
      for (let i = 0; i < 25 && (Number(borg.system?.stats?.ref?.total) || 0) !== 15; i++) await sleep(200);
      chk("FBC stats SET (REF 15 / MA 25 / BODY 20)", borg.system?.stats?.ref?.total === 15 && borg.system?.stats?.ma?.total === 25 && borg.system?.stats?.bt?.total === 20, `${borg.system?.stats?.ref?.total}/${borg.system?.stats?.ma?.total}/${borg.system?.stats?.bt?.total}`);
      chk("borg SDP seeded (Torso 60)", Number(borg.system?.sdp?.sum?.Torso) === 60, borg.system?.sdp?.sum?.Torso);
      const dt = borg.items.find(i => i.name === "Death Trance");
      chk("Death Trance chip typed Chip + active", dt && dt.system?.CyberWorkType?.Type === "Chip" && dt.system?.CyberWorkType?.ChipActive === true, dt ? dt.system?.CyberWorkType?.Type : "missing");
    }
    return { ok: checks.every(c => c.ok), checks };
  });
  for (const c of vb.checks || []) log.push(`  ${c.ok ? "PASS" : "FAIL"}  [borg] ${c.label}  ${c.ok ? "" : "-> got " + c.got}`);
  pass = v.ok && vb.ok && !log.some(l => l.startsWith("PAGEERR"));
} catch (e) { log.push("ERROR " + (e?.message || e)); }
finally { await b.close(); }

console.log(log.join("\n"));
console.log(pass ? "\nRESULT: PASS" : "\nRESULT: FAIL");
process.exit(pass ? 0 : 1);
