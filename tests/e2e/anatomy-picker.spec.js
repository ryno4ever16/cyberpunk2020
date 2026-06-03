import { test, expect } from "@playwright/test";
import { ACCOUNTS } from "../helpers/accounts.js";
import { login, evalGameOrThrow, cleanupTestData } from "../helpers/foundry.js";

/**
 * Cyberware-tab body-type picker: a dropdown swaps the anatomy image between the registered body
 * types (developer-extensible ANATOMY_IMAGES; players only choose). SVG types render via <object>,
 * raster types via <img>. The choice is stored per-actor in a flag.
 */

test.afterAll(async ({ browser }) => {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const p = await ctx.newPage();
  try { await login(p, ACCOUNTS.gm); await cleanupTestData(p); } catch {}
  await ctx.close();
});

test("anatomy registry + dropdown swaps the cyberware-tab body image (object↔img)", async ({ page }) => {
  await login(page, ACCOUNTS.gm);
  await cleanupTestData(page).catch(() => {});

  const R = await evalGameOrThrow(page, async () => {
    const LK = await import("/systems/cyberpunk2020/module/lookups.js");
    const flags = { cyberpunk2020: { __pwtest: true } };
    const out = {};

    // Developer-side registry shape
    out.hasMale = !!LK.ANATOMY_IMAGES.male && LK.ANATOMY_IMAGES.male.svg === true;
    out.hasFemale = !!LK.ANATOMY_IMAGES.female && LK.ANATOMY_IMAGES.female.svg === false;
    out.femaleSrc = LK.ANATOMY_IMAGES.female?.src;
    out.defaultKey = LK.DEFAULT_ANATOMY_KEY;

    const actor = await Actor.create({ name: "__PW__Anatomy", type: "character", flags });

    const renderAndGet = async () => {
      await actor.sheet.render(true);
      const dl = Date.now() + 6000;
      let el = null;
      while (Date.now() < dl) {
        const node = actor.sheet.element && (actor.sheet.element[0] || actor.sheet.element);
        if (node?.querySelector) { el = node; break; }
        await new Promise(r => setTimeout(r, 150));
      }
      return el;
    };

    // Default (male → SVG <object>)
    let root = await renderAndGet();
    const sel = root?.querySelector(".anatomy-select");
    out.optionCount = sel ? sel.querySelectorAll("option").length : -1;
    let img = root?.querySelector("#anatomy-img");
    out.defaultTag = img?.tagName ?? null;                                  // OBJECT
    out.defaultSrc = img?.getAttribute("data") ?? img?.getAttribute("src"); // male svg

    // Switch to female → raster <img>
    await actor.setFlag("cyberpunk2020", "anatomyImage", "female");
    await new Promise(r => setTimeout(r, 250));
    root = await renderAndGet();
    img = root?.querySelector("#anatomy-img");
    out.femaleTag = img?.tagName ?? null;                                   // IMG
    out.femaleImgSrc = img?.getAttribute("src") ?? img?.getAttribute("data");

    await actor.sheet.close().catch(() => {});
    await actor.delete().catch(() => {});
    return out;
  });

  console.log("Anatomy picker:", JSON.stringify(R));

  expect(R.hasMale, "male is an SVG body type").toBe(true);
  expect(R.hasFemale, "female is a raster body type").toBe(true);
  expect(R.defaultKey).toBe("male");

  expect(R.optionCount, "dropdown lists both body types").toBe(2);
  expect(R.defaultTag, "default body renders via <object> (SVG)").toBe("OBJECT");
  expect(R.defaultSrc, "default is the male anatomy SVG").toContain("male-anatomy");

  expect(R.femaleTag, "female body renders via <img> (raster)").toBe("IMG");
  expect(R.femaleImgSrc, "female image is the female PNG").toBe(R.femaleSrc);
  expect(R.femaleImgSrc).toContain("female-anatomy.png");
});
