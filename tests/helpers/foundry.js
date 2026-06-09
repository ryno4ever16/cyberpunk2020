/**
 * Foundry VTT driving helpers for the CP2020 E2E suite.
 *
 * These wrap the two things every spec needs: (1) authenticating into the live
 * world through the /join page, and (2) running arbitrary code inside the live
 * `game` context so we can create test documents, fire hooks, and read state.
 *
 * Everything we create is tagged with the TEST_FLAG marker so cleanupTestData()
 * can remove it afterward without touching the user's own world content.
 */

export const SYSTEM_ID = "cyberpunk2020";
/** Flag namespace.key used to tag every document this suite creates. */
export const TEST_FLAG = { scope: SYSTEM_ID, key: "__pwtest" };
/** Name prefix as a secondary marker (visible in the UI, easy to spot/clean). */
export const TEST_PREFIX = "__PW__";

/**
 * Authenticate into the live world as the given account and wait for readiness.
 * @param {import('@playwright/test').Page} page
 * @param {{name:string, password:string}} account
 * @param {{canvas?:boolean}} [opts] wait for the canvas to finish drawing too
 */
export async function login(page, account, opts = {}) {
  await page.goto("/join", { waitUntil: "domcontentloaded" });

  const form = page.locator("#join-game-form");
  await form.locator('select[name="userid"]').waitFor({ state: "visible", timeout: 30_000 });
  await form.locator('select[name="userid"]').selectOption({ label: account.name });
  await form.locator('input[name="password"]').fill(account.password);

  await Promise.all([
    page.waitForNavigation({ url: /\/game/, timeout: 45_000 }).catch(() => {}),
    form.locator('button[name="join"]').click(),
  ]);

  await page.waitForFunction(() => window.game?.ready === true, undefined, { timeout: 60_000 });

  // NOTE: do not wait on canvas.ready here. The test world may have no active
  // scene (canvas.ready stays false). Tests that need a drawn canvas create and
  // activate their own scene, then call waitForCanvasScene().
  if (opts.canvas) {
    await page.waitForFunction(() => typeof window.canvas !== "undefined", undefined, { timeout: 20_000 });
  }
  return page;
}

/**
 * Wait until the canvas has finished drawing the given scene. Use after
 * activating a freshly created test scene.
 */
export async function waitForCanvasScene(page, sceneId) {
  await page.waitForFunction(
    (id) => !!window.canvas?.ready && window.canvas?.scene?.id === id,
    sceneId,
    { timeout: 45_000 }
  );
}

/**
 * Run a function inside the live game page. Thin wrapper that fails loudly with
 * the in-page error message rather than a generic "evaluate failed".
 * @template T
 * @param {import('@playwright/test').Page} page
 * @param {(arg:any)=>Promise<T>|T} fn
 * @param {any} [arg]
 * @returns {Promise<T>}
 */
export async function evalGame(page, fn, arg) {
  return page.evaluate(async (payload) => {
    const userFn = new Function("return (" + payload.src + ")")();
    try {
      return await userFn(payload.arg);
    } catch (err) {
      return { __pwError: true, message: err?.message ?? String(err), stack: err?.stack ?? null };
    }
  }, { src: fn.toString(), arg });
}

/** Like evalGame but throws if the in-page code reported an error. */
export async function evalGameOrThrow(page, fn, arg) {
  const result = await evalGame(page, fn, arg);
  if (result && result.__pwError) {
    throw new Error("In-page error: " + result.message + (result.stack ? "\n" + result.stack : ""));
  }
  return result;
}

/** Convenience: who am I logged in as, and am I the active GM? */
export async function whoami(page) {
  return evalGameOrThrow(page, () => ({
    userId: game.user.id,
    userName: game.user.name,
    isGM: game.user.isGM,
    isActiveGM: game.users.activeGM?.id === game.user.id,
    systemId: game.system.id,
    systemVersion: game.system.version,
    foundryVersion: game.version ?? game.release?.version,
    ready: game.ready,
    canvasReady: !!window.canvas?.ready,
    activeSceneId: game.scenes?.active?.id ?? null,
  }));
}

/**
 * Create a tagged test scene, optionally activate it, and place a tagged,
 * actor-linked token on it for a freshly created actor. Run as a GM.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{activate?:boolean, actorType?:string, actorName?:string,
 *          actorUpdate?:object, x?:number, y?:number}} [opts]
 * @returns {Promise<{sceneId:string, tokenId:string, actorId:string}>}
 */
export async function setupSceneWithToken(page, opts = {}) {
  return evalGameOrThrow(page, async (o) => {
    const flags = { cyberpunk2020: { __pwtest: true } };
    const actor = await Actor.create({
      name: o.actorName || "__PW__actor",
      type: o.actorType || "character",
      flags,
    });
    if (o.actorUpdate) await actor.update(o.actorUpdate);

    const scene = await Scene.create({
      name: "__PW__scene", width: 2000, height: 2000,
      grid: { type: 1, size: 100, distance: 2, units: "m" },
      padding: 0, flags,
    });
    if (o.activate) {
      await scene.activate();
      // Activation kicks off an async canvas redraw. Creating a token before the
      // new scene's layers exist throws "addChild of null" in TokenDocument._onCreate.
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (canvas?.ready && canvas?.scene?.id === scene.id) break;
        await new Promise(r => setTimeout(r, 200));
      }
    }

    const [tokenDoc] = await scene.createEmbeddedDocuments("Token", [{
      name: actor.name, x: o.x ?? 1000, y: o.y ?? 1000,
      actorId: actor.id, actorLink: true,
      width: 1, height: 1, flags,
    }]);

    return { sceneId: scene.id, tokenId: tokenDoc.id, actorId: actor.id };
  }, opts);
}

/**
 * Delete every document this suite created (tagged with TEST_FLAG or TEST_PREFIX).
 * Safe to call repeatedly; ignores anything it can't remove.
 * Run as a GM.
 */
export async function cleanupTestData(page) {
  return evalGameOrThrow(page, async (m) => {
    const { scope, key, prefix } = m;
    const tagged = (doc) =>
      doc?.getFlag?.(scope, key) === true || (typeof doc?.name === "string" && doc.name.startsWith(prefix));
    const report = { combats: 0, templates: 0, tokens: 0, actors: 0, scenes: 0, items: 0, messages: 0 };

    // Combats first (they reference tokens/scenes). Delete tagged combats AND orphaned (sceneless) ones:
    // once a test combat's scene/actors are cleaned, the combat is left untagged + sceneless but still
    // "active", which hides later test combats from the tracker (root cause of flaky combat-button specs).
    for (const c of [...game.combats]) {
      if (tagged(c) || !c.scene || c.combatants.some(cb => tagged(cb.actor))) { await c.delete().catch(() => {}); report.combats++; }
    }
    // Templates + tokens on every scene
    for (const scene of [...game.scenes]) {
      const tmplIds = scene.templates.filter(t => t.getFlag?.(scope, key) === true).map(t => t.id);
      if (tmplIds.length) { await scene.deleteEmbeddedDocuments("MeasuredTemplate", tmplIds).catch(() => {}); report.templates += tmplIds.length; }
      const tokIds = scene.tokens.filter(t => tagged(t) || tagged(t.actor)).map(t => t.id);
      if (tokIds.length) { await scene.deleteEmbeddedDocuments("Token", tokIds).catch(() => {}); report.tokens += tokIds.length; }
    }
    // Chat messages
    const msgIds = game.messages.filter(msg => (msg.content || "").includes(prefix)).map(m2 => m2.id);
    if (msgIds.length) { await ChatMessage.deleteDocuments(msgIds).catch(() => {}); report.messages += msgIds.length; }
    // Actors (and their tokens are gone with the scenes above)
    for (const a of [...game.actors]) { if (tagged(a)) { await a.delete().catch(() => {}); report.actors++; } }
    // World items
    for (const it of [...game.items]) { if (tagged(it)) { await it.delete().catch(() => {}); report.items++; } }
    // Scenes last (deactivate test scene first if active)
    for (const s of [...game.scenes]) {
      if (tagged(s)) {
        if (s.active) { const other = game.scenes.find(x => !tagged(x)); if (other) await other.activate().catch(() => {}); }
        await s.delete().catch(() => {});
        report.scenes++;
      }
    }
    return report;
  }, { scope: TEST_FLAG.scope, key: TEST_FLAG.key, prefix: TEST_PREFIX });
}
