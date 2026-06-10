/**
 * "Shimmering singletons" — when a singleton window's open control is pressed while that window is
 * already open, run a brief light-streak animation around its border to draw the eye to it (instead
 * of silently doing nothing).
 *
 * Two halves:
 *  - `shimmerWindow(app)` — the effect itself: appends a dedicated `.cp-shimmer-ring` overlay (NOT a
 *    `::after`, so UI modules that style window pseudo-elements can't clobber it), removed when done.
 *  - `registerShimmerOnReopen()` — wraps Application#render so ANY window re-opened while already on
 *    screen shimmers (actor/item/compendium sheets, dialogs, …). `render(true)` is the "open / bring to
 *    front" call; firing it on an already-rendered app means a re-open, which is exactly the cue.
 *    Custom singletons that re-focus WITHOUT a render (tear-off tabs, the shop) call shimmerWindow directly.
 */

const SHIMMER_MS = 950; // a touch longer than the CSS animation so it always finishes cleanly

/** @param {Application|JQuery|HTMLElement} target  An app (uses its .element) or a raw element. */
export function shimmerWindow(target) {
  const raw = target?.element;
  const el = raw?.[0] ?? (raw instanceof HTMLElement ? raw : (target instanceof HTMLElement ? target : null));
  if (!el?.appendChild) return;

  el.querySelectorAll(":scope > .cp-shimmer-ring").forEach((n) => n.remove()); // restart on rapid re-open
  const ring = (el.ownerDocument ?? document).createElement("div");
  ring.className = "cp-shimmer-ring";
  el.appendChild(ring);

  clearTimeout(el._cpShimmerTimer);
  el._cpShimmerTimer = setTimeout(() => ring.remove(), SHIMMER_MS);
}

/** Install the global "re-open an already-open window → shimmer it" behaviour (call once, at init). */
export function registerShimmerOnReopen() {
  const wrap = (Cls) => {
    const proto = Cls?.prototype;
    if (!proto?.render || proto.render.__cpShimWrapped) return;
    const orig = proto.render;
    function wrapped(...args) {
      // V1: render(force, options). V2: render(options) with options.force (or render(true)).
      let force = args[0];
      if (force && typeof force === "object") force = force.force;
      const wasRendered = this.rendered;
      const result = orig.apply(this, args);
      if (force === true && wasRendered) { try { shimmerWindow(this); } catch (_) {} }
      return result;
    }
    wrapped.__cpShimWrapped = true;
    proto.render = wrapped;
  };
  try { wrap(globalThis.Application); } catch (_) {}
  try { wrap(foundry?.applications?.api?.ApplicationV2); } catch (_) {}
}
