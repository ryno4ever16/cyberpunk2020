import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow } from "../helpers/foundry.js";

/**
 * QA §17/§19 — Ammo caliber matching + cost.
 *
 * Verifies the foundation of the Session-16 ammo redesign (pure exports in
 * lookups.js): caliber normalization (the data typos 7.56 / 7.565), the
 * RAW-confirmed 7.62 NATO vs 7.62 Soviet split, blank-caliber wildcard, the
 * hard-block matching logic, and box-price = caliber price × modifier multiplier.
 */

test("§17/§19 caliber normalize/match (incl. 7.62 split) + box pricing", async ({ page }) => {
  await login(page, ACCOUNTS.gm);

  const R = await evalGameOrThrow(page, async () => {
    const L = await import("/systems/cyberpunk2020/module/lookups.js");

    const norm = {
      typo756: L.normalizeCaliber("7.56"),
      typo7565: L.normalizeCaliber("7.565"),
      sovLower: L.normalizeCaliber("7.62s"),
      sovUpper: L.normalizeCaliber("7.62S"),
      blank: L.normalizeCaliber(""),
      passthrough: L.normalizeCaliber("9mm"),
    };

    const match = {
      same: L.caliberMatches("9mm", "9mm"),
      mismatch: L.caliberMatches("9mm", "5.56"),
      wildcardBlankAmmo: L.caliberMatches("9mm", ""),
      aliasNato: L.caliberMatches("7.62", "7.56"),        // ammo typo 7.56 -> 7.62 NATO
      aliasSov: L.caliberMatches("7.62sov", "7.565"),     // ammo typo 7.565 -> 7.62 Soviet
      natoVsSov: L.caliberMatches("7.62", "7.62sov"),     // the split: must NOT match
      sovVsNato: L.caliberMatches("7.62sov", "7.62"),
    };

    // Pricing: pick a real caliber with a positive box price, and a modifier with mult > 1.
    const cals = L.getCalibers();
    const pricedCal = Object.keys(cals).find(id => L.getCaliberBox(id).price > 0) ?? null;
    const stdMult = L.getModifierCostMult("standard");
    const apMult = L.getModifierCostMult("ap");
    const box = pricedCal ? L.getCaliberBox(pricedCal) : null;
    const priceStd = pricedCal ? L.getAmmoBoxPrice(pricedCal, "standard") : null;
    const priceAP = pricedCal ? L.getAmmoBoxPrice(pricedCal, "ap") : null;

    return { norm, match, pricedCal, stdMult, apMult, boxPrice: box?.price ?? null, priceStd, priceAP };
  });

  console.log("Ammo:", JSON.stringify(R));

  // Normalization
  expect(R.norm.typo756).toBe("7.62");
  expect(R.norm.typo7565).toBe("7.62sov");
  expect(R.norm.sovLower).toBe("7.62sov");
  expect(R.norm.sovUpper).toBe("7.62sov");
  expect(R.norm.blank).toBe("");
  expect(R.norm.passthrough).toBe("9mm");

  // Matching + the 7.62 split
  expect(R.match.same).toBe(true);
  expect(R.match.mismatch, "different calibers must hard-block").toBe(false);
  expect(R.match.wildcardBlankAmmo, "blank ammo caliber = wildcard (back-compat)").toBe(true);
  expect(R.match.aliasNato, "7.56 ammo loads a 7.62 NATO weapon").toBe(true);
  expect(R.match.aliasSov, "7.565 ammo loads a 7.62 Soviet weapon").toBe(true);
  expect(R.match.natoVsSov, "7.62 NATO weapon must NOT accept 7.62 Soviet ammo").toBe(false);
  expect(R.match.sovVsNato, "7.62 Soviet weapon must NOT accept 7.62 NATO ammo").toBe(false);

  // Pricing
  expect(R.pricedCal, "at least one caliber has a priced box").not.toBeNull();
  expect(R.stdMult, "standard modifier costs x1").toBe(1);
  expect(R.apMult, "AP modifier costs more than standard").toBeGreaterThan(1);
  expect(R.priceAP, "box price = caliber price x modifier mult").toBe(Math.round(R.boxPrice * R.apMult));
  expect(R.priceAP, "AP box costs more than standard box").toBeGreaterThan(R.priceStd);
});
