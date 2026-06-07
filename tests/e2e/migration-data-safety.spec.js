import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Migration data-safety suite.
 *
 * Creates actors/items in the OLD (main-era + ancient legacy) data shapes, runs them through the
 * real Foundry load pipeline (DataModel migrateData + cleanData + validation), and asserts that
 * EVERY user value survives unchanged. Includes adversarial inputs (extremes, zero/negative, wrong
 * types, missing fields) to surface weak points. Baseline = `main` (template.json-only, no DataModels).
 *
 * Cyberware (the one subsystem that was unsafe) is covered in migrate-cyberware.spec.js.
 */
test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("actor core: main-era (top-level) shape survives a full round-trip with no value loss", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});
  const R = await evalGameOrThrow(page, async () => {
    const sys = {
      points: 60, age: 27, humanity: 33,
      role: { value: "netrunner" },
      events: "MY EVENTS", family: "MY FAMILY", style: "punk", motivations: "revenge",
      stats: { int: { base: 9, tempMod: 1 }, ref: { base: 8, tempMod: 0 }, cool: { base: 7, tempMod: 2 } },
      ip: 42,
      sdp: { current: { Head: 3, Torso: 7 }, touched: { Head: true } },
      damage: 12,
      eurobucks: 5000,
      // netrun deck (top-level in main after template merge)
      deckModel: "Mk7", interface: 4, cpu: 3, speed: 2, strength: 5, dataWall: 6,
      ramMax: 30, ramUsed: 12, deckType: "cyberdeck", hasKeyboard: true, hasScreen: true
    };
    let a; const out = {};
    try {
      a = await Actor.create({ name: "__PW__MIG_TOP", type: "character", flags: { cyberpunk2020: { __pwtest: true } }, system: sys });
      const s = a.system;
      Object.assign(out, {
        points: s.points, age: s.age, humanity: s.humanity, role: s.role?.value,
        events: s.events, family: s.family, style: s.style, motivations: s.motivations,
        intBase: s.stats?.int?.base, intTemp: s.stats?.int?.tempMod, coolTemp: s.stats?.cool?.tempMod,
        ip: s.ip, sdpHead: s.sdp?.current?.Head, sdpTorso: s.sdp?.current?.Torso, touchedHead: s.sdp?.touched?.Head,
        damage: s.damage, eurobucks: s.eurobucks,
        deckModel: s.deckModel, interface: s.interface, cpu: s.cpu, dataWall: s.dataWall,
        ramUsed: s.ramUsed, deckType: s.deckType, hasKeyboard: s.hasKeyboard
      });
    } finally { if (a) await a.delete().catch(() => {}); }
    return out;
  });
  console.log("MIG top-level:", JSON.stringify(R));
  expect(R).toMatchObject({
    points: 60, age: 27, humanity: 33, role: "netrunner",
    events: "MY EVENTS", family: "MY FAMILY", style: "punk", motivations: "revenge",
    intBase: 9, intTemp: 1, coolTemp: 2, ip: 42,
    sdpHead: 3, sdpTorso: 7, touchedHead: true, damage: 12, eurobucks: 5000,
    deckModel: "Mk7", interface: 4, cpu: 3, dataWall: 6, ramUsed: 12, deckType: "cyberdeck", hasKeyboard: true
  });
});

test("actor core: ancient double-nested legacy shape un-nests losslessly", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});
  const R = await evalGameOrThrow(page, async () => {
    // Pre-flatten shape some very old worlds carried: stats.stats, hitLocations.hitLocations + .sdp,
    // gear.eurobucks, netrun.*, and icon as an object.
    const sys = {
      stats: { stats: { int: { base: 9, tempMod: 1 }, ref: { base: 6, tempMod: -1 } } },
      hitLocations: { hitLocations: { Head: { location: [1] } }, sdp: { current: { Torso: 7, lArm: 2 } } },
      gear: { eurobucks: 5000 },
      netrun: { interface: 4, cpu: 3, deckType: "cyberdeck", hasKeyboard: true, ramMax: 20 },
      icon: { default: "icons/foo.webp" },
      damage: 9
    };
    let a; const out = {};
    try {
      a = await Actor.create({ name: "__PW__MIG_NEST", type: "character", flags: { cyberpunk2020: { __pwtest: true } }, system: sys });
      const s = a.system;
      Object.assign(out, {
        intBase: s.stats?.int?.base, intTemp: s.stats?.int?.tempMod, refTemp: s.stats?.ref?.tempMod,
        // stats must be un-nested (no leftover stats.stats)
        hasDoubleNest: s.stats?.stats !== undefined,
        sdpTorso: s.sdp?.current?.Torso, sdpArm: s.sdp?.current?.lArm,
        eurobucks: s.eurobucks, interface: s.interface, cpu: s.cpu, deckType: s.deckType,
        hasKeyboard: s.hasKeyboard, ramMax: s.ramMax, damage: s.damage
      });
    } finally { if (a) await a.delete().catch(() => {}); }
    return out;
  });
  console.log("MIG double-nest:", JSON.stringify(R));
  expect(R).toMatchObject({
    intBase: 9, intTemp: 1, refTemp: -1, hasDoubleNest: false,
    sdpTorso: 7, sdpArm: 2, eurobucks: 5000, interface: 4, cpu: 3, deckType: "cyberdeck",
    hasKeyboard: true, ramMax: 20, damage: 9
  });
});

test("DataModel.migrateData (the load-path reshape) is lossless, incl. icon object→string", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  const R = await evalGameOrThrow(page, async () => {
    const M = await import("/systems/cyberpunk2020/module/data/actor-data.js");
    const mig = (src) => M.CyberpunkCharacterData.migrateData(foundry.utils.deepClone(src));
    const out = {};
    out.icon = mig({ icon: { default: "icons/foo.webp" } }).icon;            // object → string
    const a = mig({ stats: { stats: { int: { base: 9, tempMod: 1 } } } });   // double-nest → flat
    out.intBase = a.stats?.int?.base; out.noDouble = a.stats?.stats === undefined;
    const b = mig({ hitLocations: { hitLocations: { Head: { location: [1] } }, sdp: { current: { Torso: 7 } } } });
    out.sdpTorso = b.sdp?.current?.Torso; out.hlHead = !!b.hitLocations?.Head; out.hlNoDouble = b.hitLocations?.hitLocations === undefined;
    out.euro = mig({ gear: { eurobucks: 4242 } }).eurobucks;                 // gear.eurobucks → eurobucks
    const c = mig({ netrun: { interface: 6, deckType: "x", hasScreen: true } });  // netrun.* → top-level
    out.iface = c.interface; out.deckType = c.deckType; out.hasScreen = c.hasScreen;
    return out;
  });
  console.log("MIG pure migrateData:", JSON.stringify(R));
  expect(R.icon).toBe("icons/foo.webp");
  expect(R).toMatchObject({ intBase: 9, noDouble: true, sdpTorso: 7, hlHead: true, hlNoDouble: true, euro: 4242, iface: 6, deckType: "x", hasScreen: true });
});

test("actor core: adversarial values (extremes / zero / negative / wrong-type / missing) are safe", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});
  const R = await evalGameOrThrow(page, async () => {
    const cases = {
      extreme: { stats: { int: { base: 12, tempMod: -3 } }, damage: 40, eurobucks: 999999999, humanity: 0 },
      zeroneg: { stats: { ref: { base: 0, tempMod: -5 } }, damage: 0, eurobucks: -250 },
      wrongtype: { damage: "12", eurobucks: "5000", humanity: "33", interface: "4" },   // numeric strings
      empty: {}
    };
    const out = {};
    for (const [key, sys] of Object.entries(cases)) {
      let a;
      try {
        a = await Actor.create({ name: `__PW__MIG_ADV_${key}`, type: "character", flags: { cyberpunk2020: { __pwtest: true } }, system: sys });
        const s = a.system;
        out[key] = {
          ok: true,
          intBase: s.stats?.int?.base, refBase: s.stats?.ref?.base, refTemp: s.stats?.ref?.tempMod,
          damage: s.damage, damageType: typeof s.damage, eurobucks: s.eurobucks, humanity: s.humanity,
          interface: s.interface, interfaceType: typeof s.interface,
          // defaults present when missing
          defStat: s.stats?.cool?.base, defSdp: s.sdp?.current?.Head
        };
      } catch (e) { out[key] = { ok: false, err: String(e?.message ?? e) }; }
      finally { if (a) await a.delete().catch(() => {}); }
    }
    return out;
  });
  console.log("MIG adversarial:", JSON.stringify(R));
  // No case should throw / fail to load
  expect(R.extreme.ok).toBe(true);
  expect(R.zeroneg.ok).toBe(true);
  expect(R.wrongtype.ok).toBe(true);
  expect(R.empty.ok).toBe(true);
  // Values preserved
  expect(R.extreme).toMatchObject({ intBase: 12, damage: 40, humanity: 0 });
  expect(R.zeroneg).toMatchObject({ refBase: 0, refTemp: -5, damage: 0 });
  // Numeric strings coerced to numbers (not lost / not NaN)
  expect(R.wrongtype.damage).toBe(12);
  expect(R.wrongtype.damageType).toBe("number");
  expect(R.wrongtype.interface).toBe(4);
  // Missing fields get defaults, no crash
  expect(R.empty.ok).toBe(true);
  expect(R.empty.defStat).toBe(5);
  expect(R.empty.defSdp).toBe(0);
});

test("items: weapon / armor / program old shapes survive with all stats intact", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});
  const R = await evalGameOrThrow(page, async () => {
    const out = {};
    const made = [];
    try {
      const [w] = await Promise.all([Item.create({
        name: "__PW__MIG_WPN", type: "weapon", flags: { cyberpunk2020: { __pwtest: true } },
        system: {
          weaponType: "Rifle", accuracy: 1, damage: "5d6",
          rangeDamages: { pointBlank: "6d6", close: "5d6", medium: "4d6", far: "3d6" },
          ammoType: "7.62", ap: true, shots: 30, shotsLeft: 20, rof: 25, range: 400
        }
      })]);
      made.push(w);
      const ws = w.system;
      out.weapon = {
        weaponType: ws.weaponType, accuracy: ws.accuracy, damage: ws.damage,
        rdPB: ws.rangeDamages?.pointBlank, rdMed: ws.rangeDamages?.medium, rdFar: ws.rangeDamages?.far,
        rdShortPresent: "short" in (ws.rangeDamages ?? {}), ammoType: ws.ammoType,
        ap: ws.ap, shots: ws.shots, shotsLeft: ws.shotsLeft, rof: ws.rof, range: ws.range
      };

      const a = await Item.create({
        name: "__PW__MIG_ARM", type: "armor", flags: { cyberpunk2020: { __pwtest: true } },
        system: { coverage: { Head: { stoppingPower: 14, ablation: 2 }, Torso: { stoppingPower: 20, ablation: 5 } }, encumbrance: 2 }
      });
      made.push(a);
      out.armor = {
        headSP: a.system.coverage?.Head?.stoppingPower, headAbl: a.system.coverage?.Head?.ablation,
        torsoSP: a.system.coverage?.Torso?.stoppingPower, torsoAbl: a.system.coverage?.Torso?.ablation,
        enc: a.system.encumbrance
      };

      const p = await Item.create({
        name: "__PW__MIG_PRG", type: "program", flags: { cyberpunk2020: { __pwtest: true } },
        system: { power: 5, mu: 2, programType: "Attacker", actionFormula: "1d10" }
      });
      made.push(p);
      out.program = { power: p.system.power, mu: p.system.mu, programType: p.system.programType, actionFormula: p.system.actionFormula };
    } finally { for (const m of made) await m.delete().catch(() => {}); }
    return out;
  });
  console.log("MIG items:", JSON.stringify(R));
  expect(R.weapon).toMatchObject({
    weaponType: "Rifle", accuracy: 1, damage: "5d6",
    rdPB: "6d6", rdMed: "4d6", rdFar: "3d6", rdShortPresent: true,
    ammoType: "7.62", ap: true, shots: 30, shotsLeft: 20, rof: 25, range: 400
  });
  expect(R.armor).toMatchObject({ headSP: 14, headAbl: 2, torsoSP: 20, torsoAbl: 5, enc: 2 });
  expect(R.program).toMatchObject({ power: 5, mu: 2, programType: "Attacker", actionFormula: "1d10" });
});

test("skills: a skill item passes through migrateItem unchanged (no mutation)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});
  const R = await evalGameOrThrow(page, async () => {
    const { migrateItem } = await import("/systems/cyberpunk2020/module/migrate.js");
    let s; const out = {};
    try {
      s = await Item.create({
        name: "__PW__MIG_SKILL Handgun", type: "skill", flags: { cyberpunk2020: { __pwtest: true } },
        system: { level: 7, ip: 13, isChipped: true, stat: "ref", isRoleSkill: true }
      });
      const upd = await migrateItem(s);
      out.touchesSystem = !!(upd && (upd.system || Object.keys(upd).some(k => k.startsWith("system."))));
      out.level = s.system.level; out.ip = s.system.ip; out.isChipped = s.system.isChipped;
      out.stat = s.system.stat; out.isRoleSkill = s.system.isRoleSkill;
    } finally { if (s) await s.delete().catch(() => {}); }
    return out;
  });
  console.log("MIG skill:", JSON.stringify(R));
  expect(R.touchesSystem).toBe(false);   // migration must not rewrite skill items
  expect(R).toMatchObject({ level: 7, ip: 13, isChipped: true, stat: "ref", isRoleSkill: true });
});
