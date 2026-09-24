/**
 * Phase 1 of the map/wiki single-DOM-merge plan (MAPWEAVE.md "Phase 6"): the legacy map engine is
 * hosted inside a Shadow DOM custom element so its ~9K lines of jQuery/D3/id-based code keep working
 * unmodified. Shadow DOM alone doesn't make that true — `document.getElementById`/`querySelector`
 * and jQuery's `$("#id")` fast path never descend into a shadow root, so legacy code doing
 * `document.getElementById("someMapId")` would just get `null` once that id lives inside a shadow
 * root instead of the light DOM.
 *
 * This patches `Document.prototype.getElementById`/`querySelector`/`querySelectorAll` once, at
 * shell boot, to fall back to a registered shadow root on a light-DOM miss. Strictly additive: a
 * light-DOM hit behaves exactly as before (real risk narrows from "near-guaranteed collision" to
 * "same id string exists in both the shell's light DOM and the registered shadow root", which is
 * mechanically auditable — see scripts/audit-id-collisions.mjs). Only bare `#id` selectors fall
 * back for querySelector; combining light+shadow results for a *single*-result query is genuinely
 * ambiguous (which one wins?) for anything more general, and nothing in this codebase's legacy code
 * needs it (confirmed by research before writing this). querySelectorAll doesn't have that
 * ambiguity — a multi-result query can just concatenate both trees' matches — so it isn't restricted
 * to bare ids: real bug found by actually generating a map and finding stale ocean-outline `<path>`
 * elements piling up across regenerations, traced to draw-ocean.ts's `removeOcean()` calling
 * `document.querySelectorAll("#oceanLayers path")` and silently finding nothing every time, since
 * this method had no shadow-root fallback at all before now (unlike querySelector). Several other
 * call sites had the same latent bug (auto-update.ts's fog/route dedup, styles-legacy.ts) — fixed at
 * the source instead of patched one by one, and future code gets it for free.
 */

const registeredShadowRoots = new Set<ShadowRoot>();
let patched = false;
// Captured lazily, inside installShadowDomBridge() — not at module load time. This module is
// reachable from many tests that run in vitest's default "node" environment (no real `Document`
// global at all, see test-setup.ts), via leaflet-map.ts's ensureContainer() importing
// getPrimaryMountRoot(); touching `Document.prototype` at import time broke every one of them.
let originalGetElementById: typeof Document.prototype.getElementById | undefined;
let originalQuerySelector: typeof Document.prototype.querySelector | undefined;
let originalQuerySelectorAll: typeof Document.prototype.querySelectorAll | undefined;

/** Registers a shadow root as a fallback target for light-DOM id/selector misses. Call once per
 *  hosted shadow root (e.g. when the map engine's custom element connects); unregister on teardown
 *  so a removed shadow root's stale content isn't found by later light-DOM misses. */
export function registerShadowRoot(root: ShadowRoot): void {
  registeredShadowRoots.add(root);
}

export function unregisterShadowRoot(root: ShadowRoot): void {
  registeredShadowRoots.delete(root);
}

/** The mount point legacy code should insert newly-created elements into, instead of assuming
 *  `document.body` directly (the monkeypatch above only fixes *lookups*; a direct `document.body`
 *  write — e.g. leaflet-map.ts's `ensureContainer()` — needs to call this instead). Returns the
 *  most recently registered shadow root, or `document.body` if none is registered (so this stays a
 *  no-op before the map engine has booted, or in a test environment with no shadow root at all). Only
 *  one shadow root is ever registered in practice today (the map engine's); if that changes, this
 *  single-"primary" assumption needs revisiting. */
export function getPrimaryMountRoot(): ParentNode {
  let last: ShadowRoot | undefined;
  for (const root of registeredShadowRoots) last = root;
  return last ?? document.body;
}

function findInShadowRootsById(id: string): HTMLElement | null {
  for (const root of registeredShadowRoots) {
    const found = root.getElementById(id);
    if (found) return found;
  }
  return null;
}

const BARE_ID_SELECTOR = /^#([A-Za-z][\w-]*)$/;

/** Installs the light-DOM-first/shadow-fallback patch on `Document.prototype`. Idempotent — safe
 *  to call more than once (e.g. from repeated shell boot code paths in tests). */
export function installShadowDomBridge(): void {
  if (patched) return;
  patched = true;

  originalGetElementById = Document.prototype.getElementById;
  originalQuerySelector = Document.prototype.querySelector;
  originalQuerySelectorAll = Document.prototype.querySelectorAll;
  const realGetElementById = originalGetElementById;
  const realQuerySelector = originalQuerySelector;
  const realQuerySelectorAll = originalQuerySelectorAll;

  Document.prototype.getElementById = function (this: Document, id: string): HTMLElement | null {
    const lightHit = realGetElementById.call(this, id);
    if (lightHit) return lightHit;
    return findInShadowRootsById(id);
  };

  Document.prototype.querySelector = function (this: Document, selector: string): Element | null {
    const lightHit = realQuerySelector.call(this, selector);
    if (lightHit) return lightHit;

    const bareId = BARE_ID_SELECTOR.exec(selector);
    if (!bareId) return null; // only bare #id selectors fall back — see module doc comment
    return findInShadowRootsById(bareId[1]);
  };

  // No ambiguity to worry about here (see module doc comment): light-DOM matches first, then every
  // registered shadow root's own matches appended after. A plain array, not a real NodeList (which
  // can't be constructed outside the platform) — every caller in this codebase only iterates or
  // indexes the result, never checks `instanceof NodeList`.
  Document.prototype.querySelectorAll = function (this: Document, selector: string): NodeListOf<Element> {
    const lightResults = Array.from(realQuerySelectorAll.call(this, selector));
    const shadowResults: Element[] = [];
    for (const root of registeredShadowRoots) shadowResults.push(...root.querySelectorAll(selector));
    return [...lightResults, ...shadowResults] as unknown as NodeListOf<Element>;
  };
}

/** Test-only: reverts the patch (restoring the real, unpatched prototype methods) and clears
 *  registered shadow roots. Not used in production code — the patch is meant to stay installed for
 *  the page's lifetime once the shell boots. */
export function _resetShadowDomBridgeForTests(): void {
  if (originalGetElementById) Document.prototype.getElementById = originalGetElementById;
  if (originalQuerySelector) Document.prototype.querySelector = originalQuerySelector;
  if (originalQuerySelectorAll) Document.prototype.querySelectorAll = originalQuerySelectorAll;
  patched = false;
  registeredShadowRoots.clear();
}
