/**
 * A6/D2 — martial hit-effects wired to the live path (:30004, official 1.1.1 + module).
 *
 * The grapple/choke/hold enforcement (choke DOT + Stun Save, hold/grapple per-turn reminders) is
 * already live in damage-hooks; only the trigger was dead. Now the live martial dialog
 * (_cpOpenMartialActionDialog onConfirm) applies the effect on-declare to a single target, GM-relayed.
 *
 * Behavioural: drive the (now live) applyMartialHitEffects and assert the exact flags the per-turn
 * loop reads (heldBy / grappledBy / chokeState), the escape clear, and the specialMeleeEffectsEnabled
 * gate. Source-shape: the onConfirm wiring + the martialEffect relay case.
 *
 * Run from fork tests/:  FVTT_URL=http://localhost:30004 FVTT_RIG_PASSWORD=cp2020-v14-rig node cp2020-augmented-a6-martial-effects.mjs
 */
import { chromium } from "@playwright/test";
const BASE = process.env.FVTT_URL || "http://localhost:30004";
const GM_PW = process.env.FVTT_RIG_PASSWORD || "cp2020-v14-rig";

async function joinAs(page, match, passwords) {
  await page.goto(BASE + "/join", { waitUntil: "domcontentloaded" });
  const sel = page.locator('select[name="userid"]');
  await sel.waitFor({ state: "visible", timeout: 30_000 });
  const users = await sel.locator("option").evaluateAll((o) =>
    o.map((x) => ({ v: x.value, l: (x.textContent || "").trim() })).filter((x) => x.v));
  const u = users.find((x) => match.test(x.l));
  if (!u) throw new Error("no user matching " + match);
  for (const pw of passwords) {
    await sel.selectOption(u.v);
    await page.locator('input[name="password"]').fill(pw);
    await Promise.all([
      page.waitForNavigation({ url: /\/game/, timeout: 15_000 }).catch(() => {}),
      page.locator('button[name="join"]').click(),
    ]);
    try { await page.waitForFunction(() => window.game?.ready === true, undefined, { timeout: 15_000 }); return u.l; }
    catch { await page.goto(BASE + "/join", { waitUntil: "domcontentloaded" }).catch(() => {}); await sel.waitFor({ state: "visible" }).catch(() => {}); }
  }
  throw new Error("could not join as " + u.l);
}

const browser = await chromium.launch({ headless: true });
let failures = 0;
try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
  await joinAs(page, /^gamemaster$/i, [GM_PW]);

  const R = await page.evaluate(async () => {
    const M = "/modules/cp2020-augmented/module";
    const SCOPE = "cp2020-augmented";
    const out = { checks: [] };
    const ok = (name, cond, got) => out.checks.push({ name, pass: !!cond, got });
    let atk = null, tgt = null, prevMelee;
    try {
      const flag = (a, k) => a.getFlag(SCOPE, k);

      // source-shape: the wiring is in the served code
      const asheet = await (await fetch(`${M}/actor/actor-sheet.js`, { cache: "no-store" })).text();
      ok("A6 onConfirm calls the effect helper", /_cpApplyOrRelayMartialEffect\(action, targetActor\)/.test(asheet), true);
      ok("A6 helper emits martialEffect relay", /type: "martialEffect"/.test(asheet), true);
      const dhooks = await (await fetch(`${M}/combat/damage-hooks.js`, { cache: "no-store" })).text();
      ok("A6 damage-hooks handles martialEffect", /data\.type === "martialEffect"/.test(dhooks), true);

      // behavioural: drive the now-live effect writer
      const MA = await import(`${M}/martial/martial.js`);
      prevMelee = game.settings.get(SCOPE, "specialMeleeEffectsEnabled");
      await game.settings.set(SCOPE, "specialMeleeEffectsEnabled", true);

      atk = await Actor.create({ name: "GRIG Attacker", type: "character" });
      tgt = await Actor.create({ name: "GRIG Target",   type: "character" });

      await MA.applyMartialHitEffects("Hold", tgt, atk);
      ok("A6 Hold sets heldBy = attacker", flag(tgt, "heldBy") === atk.id, flag(tgt, "heldBy"));
      await MA.applyMartialHitEffects("Grapple", tgt, atk);
      ok("A6 Grapple sets grappledBy = attacker", flag(tgt, "grappledBy") === atk.id, flag(tgt, "grappledBy"));
      await MA.applyMartialHitEffects("Choke", tgt, atk);
      const choke = flag(tgt, "chokeState");
      ok("A6 Choke sets chokeState (with formula)", !!choke && !!choke.formula, JSON.stringify(choke));
      await MA.applyMartialHitEffects("Escape", tgt, atk);
      ok("A6 Escape clears held/grapple/choke",
        !flag(tgt, "heldBy") && !flag(tgt, "grappledBy") && !flag(tgt, "chokeState"),
        `${flag(tgt,"heldBy")}/${flag(tgt,"grappledBy")}/${flag(tgt,"chokeState")}`);

      // gate: off → no-op
      await game.settings.set(SCOPE, "specialMeleeEffectsEnabled", false);
      await MA.applyMartialHitEffects("Hold", tgt, atk);
      ok("A6 gate off → Hold is a no-op", !flag(tgt, "heldBy"), flag(tgt, "heldBy"));
    } catch (e) {
      out.error = e?.stack || e?.message || String(e);
    } finally {
      try { if (tgt) await tgt.delete(); } catch {}
      try { if (atk) await atk.delete(); } catch {}
      try { if (prevMelee !== undefined) await game.settings.set(SCOPE, "specialMeleeEffectsEnabled", prevMelee); } catch {}
    }
    return out;
  });

  if (R.error) { console.error("IN-PAGE ERROR:", R.error); failures++; }
  console.log("A6 martial hit-effects\n" + R.checks.map(c => `  [${c.pass ? "PASS" : "FAIL"}] ${c.name.padEnd(44)} got=${c.got}`).join("\n"));
  failures += R.checks.filter(c => !c.pass).length;
  console.log(`\n${failures === 0 ? "ALL GREEN" : failures + " FAILURE(S)"}`);
  process.exitCode = failures === 0 ? 0 : 1;
} catch (e) {
  console.error("TEST ERROR:", e?.stack || e?.message || e);
  process.exitCode = 2;
} finally {
  await browser.close();
}
