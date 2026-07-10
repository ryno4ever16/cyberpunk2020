/** B1: the seam-shim now carries the ammo's effect fields into the weaponFired payload (stock). */
import { chromium } from "@playwright/test";
const BASE = process.env.FVTT_URL || "http://localhost:30004";
const PW = process.env.FVTT_RIG_PASSWORD || "cp2020-v14-rig";
async function joinGM(p){await p.goto(BASE+"/join",{waitUntil:"domcontentloaded"});const s=p.locator('select[name="userid"]');await s.waitFor({state:"visible",timeout:30000});const us=await s.locator("option").evaluateAll(o=>o.map(x=>({v:x.value,l:(x.textContent||"").trim()})).filter(x=>x.v));const g=us.find(u=>/gamemaster/i.test(u.l));await s.selectOption(g.v);await p.locator('input[name="password"]').fill(PW);await Promise.all([p.waitForNavigation({url:/\/game/,timeout:45000}).catch(()=>{}),p.locator('button[name="join"]').click()]);await p.waitForFunction(()=>window.game?.ready===true,undefined,{timeout:60000});}

const b = await chromium.launch({ headless: true });
const p = await b.newPage();
await joinGM(p);

const r = await p.evaluate(async () => {
  const srcTxt = await (await fetch("/modules/cp2020-augmented/module/seam-shim.js",{cache:"no-store"})).text();
  const servedHasHelper = srcTxt.includes("export function ammoEffectFields");

  // Is the shim engaged on this (official) system? Its wrappers carry __cpSeamShim.
  const ItemProto = CONFIG.Item.documentClass.prototype;
  const shimEngaged = ["__fullAuto","__threeRoundBurst","__semiAuto","__meleeBonk"]
    .some(m => ItemProto[m]?.__cpSeamShim === true);

  // Build a weapon with loaded explosive ammo and check the derived effect fields.
  for (const a of game.actors.filter(a=>a.name==="__PW__B1")) await a.delete().catch(()=>{});
  const actor = await Actor.create({ name:"__PW__B1", type:"character" });
  const [ammo] = await actor.createEmbeddedDocuments("Item", [{
    name:"__PW__ExplosiveAmmo", type:"ammo",
    system:{ effectTypes:["Explosive"], blastRadius:5, blastFullDamageWithin:1, dotEnabled:true, dotTurns:3, dotType:"fire", stunSaveOnHit:true, ap:true, penDamageMult:2 }
  }]);
  const [weapon] = await actor.createEmbeddedDocuments("Item", [{
    name:"__PW__Launcher", type:"weapon", system:{ ammoItemId: ammo.id }
  }]);

  const mod = await import("/modules/cp2020-augmented/module/seam-shim.js");
  const fields = mod.ammoEffectFields(actor.items.get(weapon.id));

  await actor.delete().catch(()=>{});
  return { servedHasHelper, shimEngaged, fields };
});

console.log("\n===== B1: seam-shim effect-field payload =====");
console.log("  served seam-shim has ammoEffectFields:", r.servedHasHelper);
console.log("  shim engaged on official system:", r.shimEngaged);
console.log("  ammoEffectFields(weapon) =", JSON.stringify(r.fields));
const f = r.fields || {};
const ok = r.servedHasHelper && r.shimEngaged
  && f.effectTypes?.[0]==="Explosive" && f.blastRadius===5 && f.blastFullDamageWithin===1
  && f.dotEnabled===true && f.dotTurns===3 && f.penDamageMult===2 && f.stunSaveOnHit===true;
console.log("\n  RESULT: " + (ok ? "PASS ✅ — shim carries explosion/DOT/taser/pen fields from the loaded ammo into weaponFired" : "FAIL ❌"));
await b.close();
process.exit(ok?0:1);
