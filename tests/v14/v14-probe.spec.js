import { test, expect } from "@playwright/test";

/**
 * V14 client-runtime probes against the isolated v14 world (:30002, no password).
 * Ground-truth for the V14 compatibility plan:
 *   1. Does cyberpunk2020.js init cleanly + do the (V1) sheets open?
 *   2. Is MeasuredTemplate gone / Region present, and do the shim's intended
 *      Region shapes (ellipse, polygon) actually create + testPoint on v14?
 */

/** Tolerant join: read userid options, join the first Gamemaster, wait for game.ready. */
async function joinAsGM(page) {
  await page.goto("/join", { waitUntil: "domcontentloaded" });
  const sel = page.locator('select[name="userid"]');
  await sel.waitFor({ state: "visible", timeout: 30_000 });
  const users = await sel.locator("option").evaluateAll((opts) =>
    opts.map((o) => ({ value: o.value, label: (o.textContent || "").trim() })).filter((o) => o.value)
  );
  const gm = users.find((u) => /gamemaster|game master/i.test(u.label)) || users[0];
  if (!gm) throw new Error("v14 world has no joinable users");
  await sel.selectOption(gm.value);
  await page.locator('input[name="password"]').fill(process.env.FVTT_RIG_PASSWORD ?? ""); // rig GM password via env (never persisted to a file)
  await Promise.all([
    page.waitForNavigation({ url: /\/game/, timeout: 45_000 }).catch(() => {}),
    page.locator('button[name="join"]').click(),
  ]);
  await page.waitForFunction(() => window.game?.ready === true, undefined, { timeout: 60_000 });
  return users;
}

test("v14 runtime + Region/MeasuredTemplate + sheets", async ({ page }) => {
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("PAGEERROR: " + (e?.message ?? String(e))));

  const users = await joinAsGM(page);
  console.log("V14 JOIN USERS:", JSON.stringify(users));

  const probe = await page.evaluate(() => {
    const SceneCls = CONFIG.Scene?.documentClass ?? foundry?.documents?.BaseScene;
    const embedded = SceneCls ? Object.keys(SceneCls.metadata?.embedded ?? {}) : null;
    const hookCount = (n) => {
      const s = (typeof Hooks !== "undefined" && (Hooks.events || Hooks._hooks)) || {};
      const a = s[n]; return Array.isArray(a) ? a.length : (a ? 1 : 0);
    };
    return {
      foundry: game.version ?? game.release?.version,
      systemId: game.system?.id,
      systemVersion: game.system?.version,
      ready: game.ready,
      sceneEmbeddedTypes: embedded,
      hasMeasuredTemplateEmbedded: Array.isArray(embedded) ? embedded.includes("MeasuredTemplate") : "unknown",
      hasRegionEmbedded: Array.isArray(embedded) ? embedded.includes("Region") : "unknown",
      measuredTemplateDocClass: typeof foundry?.documents?.MeasuredTemplateDocument,
      regionDocClass: typeof foundry?.documents?.RegionDocument,
      regionPlaceable: typeof foundry?.canvas?.placeables?.Region,
      setting_fireDotEnabled: game.settings.settings.has("cyberpunk2020.fireDotEnabled"),
      setting_suppressiveFireSaves: game.settings.settings.has("cyberpunk2020.suppressiveFireSaves"),
      setting_gasGrenadeCloudEnabled: game.settings.settings.has("cyberpunk2020.gasGrenadeCloudEnabled"),
      hook_suppressiveFire: hookCount("cyberpunk2020.suppressiveFire"),
      hook_weaponFired: hookCount("cyberpunk2020.weaponFired"),
    };
  });
  console.log("V14 PROBE:", JSON.stringify(probe, null, 2));

  const sheets = await page.evaluate(async () => {
    const res = { errors: [] };
    const flags = { cyberpunk2020: { __pwtest: true } };
    try {
      const a = await Actor.create({ name: "__PW__v14_actor", type: "character", flags });
      await a.sheet.render(true); await new Promise((r) => setTimeout(r, 1000));
      res.actorSheetRendered = a.sheet.rendered === true;
      await a.sheet.close(); await a.delete();
    } catch (e) { res.errors.push("actor: " + (e?.message ?? e)); }
    try {
      const it = await Item.create({ name: "__PW__v14_item", type: "weapon", flags });
      await it.sheet.render(true); await new Promise((r) => setTimeout(r, 1000));
      res.itemSheetRendered = it.sheet.rendered === true;
      await it.sheet.close(); await it.delete();
    } catch (e) { res.errors.push("item: " + (e?.message ?? e)); }
    return res;
  });
  console.log("V14 SHEETS:", JSON.stringify(sheets, null, 2));
  console.log("V14 CONSOLE ERRORS (first 30):", JSON.stringify(consoleErrors.slice(0, 30), null, 2));

  expect(probe.systemId).toBe("cyberpunk2020");
  expect(probe.ready).toBe(true);
});

test("v14 shim mechanics: MeasuredTemplate throws, Region (ellipse+polygon) create + testPoint", async ({ page }) => {
  await joinAsGM(page);

  const out = await page.evaluate(async () => {
    const r = { errors: [], polygonFormats: {} };
    const flags = { cyberpunk2020: { __pwtest: true } };
    const scene = await Scene.create({
      name: "__PW__v14_scene", width: 3000, height: 3000,
      grid: { type: 1, size: 100, distance: 2, units: "m" }, padding: 0, flags,
    });

    // 1. MeasuredTemplate should fail to create (removed embedded type)
    try {
      await scene.createEmbeddedDocuments("MeasuredTemplate", [{ t: "circle", x: 1000, y: 1000, distance: 5 }]);
      r.measuredTemplateCreate = "SUCCEEDED (unexpected!)";
    } catch (e) { r.measuredTemplateCreate = "threw: " + (e?.message ?? e); }

    // 2. Region from an ELLIPSE (our 'circle' shape)
    try {
      const [reg] = await scene.createEmbeddedDocuments("Region", [{
        name: "__PW__ellipse", color: "#ff6600",
        shapes: [{ type: "ellipse", x: 1000, y: 1000, radiusX: 250, radiusY: 250, rotation: 0, hole: false }],
        flags,
      }]);
      r.ellipse = {
        created: !!reg?.id,
        testInside: (() => { try { return reg.testPoint({ x: 1000, y: 1000, elevation: 0 }); } catch (e) { return "err:" + e.message; } })(),
        testOutside: (() => { try { return reg.testPoint({ x: 50, y: 50, elevation: 0 }); } catch (e) { return "err:" + e.message; } })(),
        tokensType: typeof reg.tokens,
      };
    } catch (e) { r.errors.push("ellipse: " + (e?.message ?? e)); }

    // 3. Region from a POLYGON (our 'cone'/'ray') — try flat number array first, then nested pairs
    for (const [fmt, points] of Object.entries({
      flat: [1000, 1000, 1600, 850, 1600, 1150],
      nested: [[1000, 1000], [1600, 850], [1600, 1150]],
    })) {
      try {
        const [reg] = await scene.createEmbeddedDocuments("Region", [{
          name: "__PW__poly_" + fmt, color: "#ff4400",
          shapes: [{ type: "polygon", points, hole: false }], flags,
        }]);
        r.polygonFormats[fmt] = {
          created: !!reg?.id,
          testInside: (() => { try { return reg.testPoint({ x: 1450, y: 1000, elevation: 0 }); } catch (e) { return "err:" + e.message; } })(),
          testOutside: (() => { try { return reg.testPoint({ x: 50, y: 50, elevation: 0 }); } catch (e) { return "err:" + e.message; } })(),
        };
      } catch (e) { r.polygonFormats[fmt] = "threw: " + (e?.message ?? e); }
    }

    await scene.delete();
    return r;
  });
  console.log("V14 SHIM MECHANICS:", JSON.stringify(out, null, 2));
});

test("v14 MeasuredTemplate shim: what does the create actually produce?", async ({ page }) => {
  const warnings = [];
  page.on("console", (m) => { if (m.type() === "warning" || m.type() === "error") warnings.push(`[${m.type()}] ${m.text()}`); });
  await joinAsGM(page);

  const out = await page.evaluate(async () => {
    const r = {};
    const flags = { cyberpunk2020: { __pwtest: true } };
    const scene = await Scene.create({
      name: "__PW__mt_scene", width: 3000, height: 3000,
      grid: { type: 1, size: 100, distance: 2, units: "m" }, padding: 0, flags,
    });

    let created;
    try {
      created = await scene.createEmbeddedDocuments("MeasuredTemplate", [{
        t: "circle", x: 1000, y: 1000, distance: 5,
        flags: { cyberpunk2020: { __pwtest: true, isGasCloud: true } },
      }]);
    } catch (e) { r.createThrew = e?.message ?? String(e); }

    const doc = Array.isArray(created) ? created[0] : created;
    r.createdCount = Array.isArray(created) ? created.length : (created ? 1 : 0);
    r.returnedDocumentName = doc?.documentName ?? null;
    r.returnedCtor = doc?.constructor?.name ?? null;
    r.returnedId = doc?.id ?? null;

    // Where did it land? (our downstream code reads scene.templates + canvas.templates + shape.contains)
    r.sceneTemplatesType = typeof scene.templates;
    r.sceneTemplatesSize = scene.templates?.size ?? scene.templates?.contents?.length ?? "n/a";
    r.sceneTemplatesGetWorks = doc?.id ? !!scene.templates?.get?.(doc.id) : null;
    r.sceneRegionsSize = scene.regions?.size ?? scene.regions?.contents?.length ?? "n/a";

    // Does the returned doc expose the geometry our per-turn code relies on?
    r.docHasShape = !!(doc?.shape);
    r.docObjectCtor = doc?.object?.constructor?.name ?? null;
    r.docHasTestPoint = typeof doc?.testPoint;
    try { r.docContainsType = typeof (doc?.object?.shape?.contains); } catch { r.docContainsType = "err"; }

    await scene.delete();
    return r;
  });
  console.log("V14 MT SHIM RESULT:", JSON.stringify(out, null, 2));
  console.log("V14 MT WARNINGS:", JSON.stringify(warnings.filter((w) => /template|region|deprecat/i.test(w)).slice(0, 12), null, 2));
});

test("v14 active-scene: does the shimmed MeasuredTemplate pipeline actually work end-to-end?", async ({ page }) => {
  await joinAsGM(page);

  const out = await page.evaluate(async () => {
    const r = { hookFired: false };
    const flags = { cyberpunk2020: { __pwtest: true } };
    const scene = await Scene.create({
      name: "__PW__active", width: 2000, height: 2000,
      grid: { type: 1, size: 100, distance: 2, units: "m" }, padding: 0, flags,
    });
    await scene.activate();
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (canvas?.ready && canvas?.scene?.id === scene.id) break;
      await new Promise((res) => setTimeout(res, 200));
    }
    r.canvasReady = !!canvas?.ready && canvas?.scene?.id === scene.id;

    const hookId = Hooks.on("preUpdateMeasuredTemplate", () => { r.hookFired = true; });

    let doc;
    try {
      [doc] = await scene.createEmbeddedDocuments("MeasuredTemplate", [{ t: "circle", x: 1000, y: 1000, distance: 6, flags }]);
    } catch (e) { r.createErr = e?.message ?? String(e); }
    await new Promise((res) => setTimeout(res, 600));

    r.canvasTemplatesType = typeof canvas.templates;
    r.canvasTemplatesPlaceables = canvas.templates?.placeables?.length ?? "n/a";
    const obj = doc?.object ?? canvas.templates?.placeables?.find((t) => t.document?.id === doc?.id);
    r.placeableCtor = obj?.constructor?.name ?? null;
    r.placeableHasShape = !!obj?.shape;
    // our suppression/gas code calls tmplObj.shape.contains(localX, localY) with origin-relative coords
    r.shapeContainsCenter = (() => { try { return obj.shape.contains(0, 0); } catch (e) { return "err:" + e.message; } })();
    r.shapeContainsFar = (() => { try { return obj.shape.contains(5000, 5000); } catch (e) { return "err:" + e.message; } })();

    try { await doc.update({ direction: 45 }); } catch (e) { r.updateErr = e?.message ?? String(e); }
    await new Promise((res) => setTimeout(res, 300));

    Hooks.off("preUpdateMeasuredTemplate", hookId);
    const other = game.scenes.find((s) => s.getFlag("cyberpunk2020", "__pwtest") !== true);
    if (other) await other.activate().catch(() => {});
    await scene.delete();
    return r;
  });
  console.log("V14 ACTIVE MT PIPELINE:", JSON.stringify(out, null, 2));
});
