/**
 * Boots the real legacy map engine — the actual map.html body, the actual classic scripts in their
 * real order, the actual boot() — inside a Shadow DOM custom element, as the wiki shell's "map"
 * route (Phase 6 "Phase 3", see MAPWEAVE.md). Promoted from src/spike/map-in-shadow.ts once the
 * user verified that spike works in a real browser; the mechanism itself is unchanged, only the
 * legacy body markup's source changed (see below) and this now exposes a real mount/show/hide API
 * instead of running once on page load.
 *
 * Boots exactly ONCE per page load, like main.ts always has — re-running main.ts's side-effect
 * imports and boot() a second time would double-register document-level listeners (initShell's
 * resize/drag handlers, etc.) and re-execute the classic scripts. Navigating away from the map
 * route and back reuses the same booted instance (moved into whichever container is current),
 * mirroring how the old iframe-based map panel kept its document alive across show/hide.
 */

// `?inline` (not a plain import): Vite's default CSS-import behavior injects into document.head —
// exactly what leaflet-map.ts's own `import "leaflet/dist/leaflet.css"` does, correctly, for the
// wiki's own board feature (a light-DOM-hosted Leaflet map). But that means Leaflet's own structural
// CSS (.leaflet-pane { position: absolute }, and everything else it depends on) never reaches this
// shadow root at all — a real, severe bug found by actually generating a map and finding water
// sometimes rendered off-screen: legacyPane (leaflet-map.ts's mountLegacySvg) landed at
// `position: static` instead of `absolute`, fell into normal document flow below the other Leaflet
// panes, and the whole #map SVG (everything: ocean, land, all of it) ended up positioned hundreds of
// pixels below the visible viewport — worse or better depending on how much flow height the other
// panes happened to have, which is exactly the "sometimes" in the bug report. Injected as its own
// inline <style> below, same technique map.html's own inline <style> already uses here.
import leafletCss from "leaflet/dist/leaflet.css?inline";
import { getLeafletMap, isLeafletMapReady } from "@/components/leaflet-map";
import mapHtmlRaw from "@/map.html?raw";
import { getPrimaryMountRoot, installShadowDomBridge, registerShadowRoot } from "@/services/shadow-dom-bridge";

// Real map.html's own script order — 6 synchronous classic scripts, then the module entry
// (replicated below instead of imported, see main.ts's own DOMContentLoaded-gated boot call, which
// never fires here since this page's DOMContentLoaded already happened), then 7 deferred scripts.
const SYNC_SCRIPTS = [
  "libs/jquery-3.1.1.min.js",
  "libs/jquery-ui.min.js",
  "libs/d3.min.js",
  "libs/flatqueue.js",
  "libs/delaunator.min.js",
  "libs/indexedDB.js"
];

const DEFERRED_SCRIPTS = [
  "libs/alea.min.js",
  "libs/polylabel.min.js",
  "libs/simplify.js",
  "modules/ui/style-presets.js",
  "modules/ui/style.js",
  "libs/rgbquant.min.js",
  "libs/jquery.ui.touch-punch.min.js"
];

const STYLESHEETS = ["index.css", "icons.css", "libs/jquery-ui.css"];

// The app is served under a non-root base path in dev/prod alike (vite.config.ts's `base`) — a
// hardcoded leading "/" 404s. import.meta.env.BASE_URL is Vite's own answer, always trailing-slashed.
const BASE = import.meta.env.BASE_URL;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${BASE}${src}`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function loadSequentially(paths: string[]): Promise<void> {
  for (const path of paths) await loadScript(path);
}

/** A `<link rel="stylesheet">` loads asynchronously and nothing here previously waited for it — real
 *  bug found by actually loading the page: `index.css` supplies `#leaflet-root { position: fixed;
 *  inset: 0 }`, the only thing giving Leaflet's map container real dimensions to measure before
 *  Leaflet's own constructor overwrites its inline style to `position: relative` and caches whatever
 *  size it measured. If `getLeafletMap()` (called early, via zoom.ts/viewbox-events.ts, during
 *  boot()) runs before this stylesheet has actually applied, Leaflet permanently caches a zero-height
 *  container — the stylesheet finishing moments later doesn't help, since Leaflet's own inline style
 *  already overrode it and nothing calls `invalidateSize()` afterward. Confirmed via a real browser:
 *  "Invalid LatLng object: (NaN, NaN)" thrown from Leaflet's `unproject`, every time a freshly
 *  generated map tried to fit/reset its view. */
function loadStylesheet(shadow: ShadowRoot, href: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${BASE}${href}`;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error(`Failed to load ${href}`));
    shadow.appendChild(link);
  });
}

/** icons.css's own `@font-face` (a base64-embedded WOFF2 — see that file's own header) registers
 *  fine for CSS cascade matching inside this shadow root — every icon-font element's computed style
 *  correctly reports `font-family: icons` and the right `content: '\fXXX'` codepoint — but it never
 *  actually paints anything: `document.fonts` (the one, document-wide FontFaceSet the CSS Font
 *  Loading spec defines) never gains an "icons" entry at all when the `@font-face` rule only ever
 *  lived in a shadow root's own `<link>`. The browser matches the family name for style resolution
 *  without ever loading the underlying resource for rendering. Real bug found by actually opening a
 *  dialog and looking, not by reading CSS: every icon-font glyph anywhere (toolbar buttons, the
 *  wiki-link icon, burg feature markers — anything using icons.css's own
 *  `.icon-X:before { content: '\fXXX' }` convention) rendered as nothing, despite every computed
 *  style checking out. Confirmed the font data itself is fine — loading the exact same bytes via the
 *  FontFace API directly succeeds — so this loads it that way ourselves and registers it on
 *  `document.fonts`, which does make it render. Same rationale as leafletCss's manual `<style>`
 *  injection below: another shadow-root CSS feature, this time `@font-face` specifically, that
 *  doesn't work passively and needs doing by hand. */
async function loadIconFont(): Promise<void> {
  const cssText = await fetch(`${BASE}icons.css`).then(response => response.text());
  const match = cssText.match(/src:\s*url\('(data:[^']+)'\)\s*format\('woff2'\)/);
  if (!match) {
    console.error("Could not find icons.css's own @font-face src — icon-font glyphs will be blank.");
    return;
  }
  try {
    const fontFace = new FontFace("icons", `url(${match[1]})`);
    await fontFace.load();
    document.fonts.add(fontFace);
  } catch (error) {
    console.error("Failed to load icons.css's icon font:", error);
  }
}

/** Parses the real map.html once — used for both the `<head>`'s inline `<style>` and the `<body>`
 *  below, so there's only one source of truth for "what map.html actually contains" rather than two
 *  independent DOMParser passes that could drift apart. */
function parseLegacyDocument(): Document {
  return new DOMParser().parseFromString(mapHtmlRaw, "text/html");
}

/** map.html's `<head>` carries one inline `<style>` block (loading-screen styling, and critically
 *  `#map { position: absolute }`) alongside the STYLESHEETS `<link>`s above — a `<link>` can't cover
 *  it, so it needs its own injection. Real bug found by actually loading this in a browser, not by
 *  reading the code: without it, the map SVG falls back to static positioning and, being sized to
 *  the full map canvas, pushes every sibling that comes after it in the body — including the whole
 *  `#optionsContainer` (so "Generate a new map"'s Options panel) — hundreds of pixels below the
 *  visible viewport. It never threw an error or failed a resource load, so nothing short of actually
 *  looking at the rendered page surfaced it. */
function legacyHeadStyles(parsed: Document): HTMLElement[] {
  return Array.from(parsed.head.querySelectorAll("style"));
}

/** The real map.html's <body>, bundled at build time (see the `?raw` import above — a real Vite
 *  build only emits an HTML file that's a declared rollupOptions.input entry, and map.html no
 *  longer is one, so `fetch()`-ing it at runtime like the spike did would 404 in production).
 *  <script> tags are stripped (inert via innerHTML anyway — loaded explicitly via
 *  loadSequentially instead, in the real order) and never a hand-picked subset: the whole body,
 *  so this can't silently drift from the actual page. */
function legacyBodyElement(parsed: Document): HTMLElement {
  for (const script of Array.from(parsed.body.querySelectorAll("script"))) script.remove();

  const container = document.createElement("div");
  container.id = "legacy-body-root";
  while (parsed.body.firstChild) container.appendChild(parsed.body.firstChild);
  return container;
}

interface JQueryStatic {
  ui: { dialog: { prototype: { options: { appendTo: unknown } } } };
}

/** Restores the browser's native "an element with an id becomes a `window` global of that name"
 *  behavior for the legacy body's contents. That behavior only ever applies to a document's real
 *  light DOM, never to a shadow root, so once the legacy body moved into one (Phase 1) any classic
 *  script relying on a bare `someId` reference (not `document.getElementById`/`ensureEl`) silently
 *  broke — real, confirmed by actually loading the page, not theoretical: public/modules/ui/style.js
 *  — a ~1000-line classic script, not yet converted to TS like the rest of this codebase — does this
 *  well over 100 times, starting with its very first top-level statement
 *  (`styleElementSelect.addEventListener(...)`), which threw "styleElementSelect is not defined" and
 *  aborted everything after it in that file. Individually converting every one of those references
 *  to `ensureEl()` would be an invasive rewrite of a legacy file CLAUDE.md says to build on top of,
 *  not rewrite — this restores the environment the file already assumes instead, the same choice
 *  Phase 1's getElementById/querySelector monkeypatch already made for a different implicit behavior.
 *  Guards against clobbering a genuine existing global (`in window`), matching the browser's own
 *  precedence — an own property always wins over id-based named access. */
function exposeLegacyIdsAsGlobals(shadow: ShadowRoot): void {
  for (const el of shadow.querySelectorAll<HTMLElement>("[id]")) {
    if (el.id && !(el.id in window)) (window as unknown as Record<string, unknown>)[el.id] = el;
  }
}

let bootPromise: Promise<HTMLElement> | undefined;

/** The actual one-time boot sequence — creates the shadow host, injects the real body/stylesheets,
 *  loads the classic scripts in order, redirects jQuery UI's dialog appendTo, replicates main.ts's
 *  side-effect imports, and calls the real boot(). Returns the host element, already attached (to a
 *  hidden temporary spot — see below) rather than left detached for the caller to place. */
async function bootEngine(): Promise<HTMLElement> {
  installShadowDomBridge();

  const host = document.createElement("div");
  host.id = "map-engine-host-root";
  const shadow = host.attachShadow({ mode: "open" });
  registerShadowRoot(shadow);

  // Attached immediately, off-screen, rather than left detached until mountMapEngine's caller places
  // it: a `<link>` appended to a shadow root inside a still-detached host never fires `load` at all
  // in a real browser (confirmed — the stylesheet await below hung forever until this was added), so
  // there is no way to wait for real CSS without being connected to the document first.
  // `visibility: hidden`, not `display: none` — a `display: none` subtree has no layout box at all
  // (every measurement, including what Leaflet's map constructor reads off its container, comes back
  // zero), while `visibility: hidden` still computes real layout, just without painting it — no
  // visible flash over the wiki page during boot, but real box sizes are measured. Positioned off the
  // visible page as a second safety net in case anything ever un-hides it early.
  // container.appendChild(host) later (in mountMapEngine) reparents this into the real spot, and
  // calls map.invalidateSize() there for anything Leaflet measured differently in this temporary spot.
  host.style.cssText = "visibility: hidden; position: fixed; top: 0; left: -99999px;";
  document.body.appendChild(host);

  await Promise.all([...STYLESHEETS.map(href => loadStylesheet(shadow, href)), loadIconFont()]);

  // Inline, applies synchronously (no load event to await, unlike the <link>s above) — must be in
  // place before boot() runs, since that's what first calls getLeafletMap() and creates its panes.
  const leafletStyle = document.createElement("style");
  leafletStyle.textContent = leafletCss;
  shadow.appendChild(leafletStyle);

  const parsed = parseLegacyDocument();
  for (const style of legacyHeadStyles(parsed)) shadow.appendChild(style);
  shadow.appendChild(legacyBodyElement(parsed));

  await loadSequentially(SYNC_SCRIPTS);

  // jQuery UI dialogs default to appendTo: "body" — redirect them into the shadow root's own mount
  // point instead, so they render (and get styled by the shadow-scoped jquery-ui.css) where their
  // content actually lives, not as light-DOM children of the real document.body.
  const jq = (window as unknown as { $: JQueryStatic }).$;
  jq.ui.dialog.prototype.options.appendTo = getPrimaryMountRoot();

  // main.ts's own side-effect imports, replicated (not imported wholesale — its own
  // `document.addEventListener("DOMContentLoaded", boot)` would never fire here, since this page's
  // DOMContentLoaded already happened before the map route was ever entered).
  await import("@/services/logging");
  await import("@/components/globals");
  await import("@/components/options/tabs");
  await import("@/utils");
  await import("@/data/heightmap-templates");
  await import("@/data/precreated-heightmaps");
  await import("@/generators");
  await import("@/renderers");
  await import("@/components");
  await import("@/controllers");
  await import("@/services");
  await import("@/generators/styles-legacy");

  // See exposeLegacyIdsAsGlobals's own doc comment: the deferred classic scripts below are where
  // this was actually found to matter (public/modules/ui/style.js's very first statement threw
  // without it) — run right before they load, once every tab panel's markup already exists (the
  // static body above, plus every dynamically-injected one: options-tab.ts's
  // `optionsContent.innerHTML = TEMPLATE` runs as an import side effect of lifecycle.ts, already
  // evaluated by the `boot()` call above).
  exposeLegacyIdsAsGlobals(shadow);
  await loadSequentially(DEFERRED_SCRIPTS);

  const { boot } = await import("@/components/lifecycle");
  await boot();

  // The era switcher (public/maps/ era timeline UI) used to bootstrap itself from map.html's own
  // DOMContentLoaded; now it's explicitly wired in once, right after the engine it depends on
  // actually exists, and mounts into the shadow root like everything else here.
  const { initEraSwitcher } = await import("@/services/era-switcher");
  initEraSwitcher();

  return host;
}

/** Mounts the map engine into `container`, booting it on first call and reusing the same live
 *  instance (moved, not recreated) on every later call — see module doc comment for why a second
 *  real boot() would be unsafe. */
export async function mountMapEngine(container: HTMLElement): Promise<void> {
  bootPromise ??= bootEngine();
  const host = await bootPromise;
  if (host.parentElement !== container) {
    container.appendChild(host);
    host.style.cssText = ""; // clears bootEngine's temporary off-screen/hidden positioning
    // Leaflet's own container was measured (and its inline `position: relative` set) while `host`
    // sat in its temporary spot — same viewport-relative size as the real one today (both fill the
    // viewport), but invalidateSize() is the correct, idiomatic Leaflet call whenever a map's
    // container may have moved/resized, and costs nothing if the size turns out unchanged.
    if (isLeafletMapReady()) getLeafletMap().invalidateSize();
  }
}

export function isMapEngineBooted(): boolean {
  return bootPromise !== undefined;
}

/** Opens the map engine's "Options" tab — map generation settings: seed, template, point count,
 *  culture/state/province/religion/burg counts (see components/options/tabs/options-tab.ts) —
 *  instead of leaving the default "no map yet" idle-state prompt up. For the wiki's "create a new
 *  world" landing choice: land the user on generation settings, not an instant random map.
 *
 * Dismisses the idle-state overlay if it's showing (true on a genuinely first boot with no
 * persisted/linked map — see url-params.ts's checkLoadParameters) rather than leaving it stacked
 * on top of the settings panel; harmless to call even when it isn't showing. Call after
 * mountMapEngine() has resolved, so the engine (and its "optionsTab" button, inside the shadow
 * root — found via shadow-dom-bridge.ts's document.getElementById fallback, same as the rest of
 * the legacy code) actually exists. */
export async function openGenerationSettings(): Promise<void> {
  document.getElementById("generateIdleState")?.remove();
  const { showOptions } = await import("@/components/options/options-panel");
  showOptions();
  document.getElementById("optionsTab")?.click();
}

/** Which Postgres map's data the engine currently shows, if any it loaded itself (never set by a
 *  manual "New Map"/local file load) — see loadConnectedWorld below. */
let loadedConnectedMapId: number | undefined;
let loadInFlight: Promise<void> | undefined;

/** Regenerates the engine's map from a connected Postgres world's own seed/size — the missing half
 *  of the old iframe's `?seed=&width=&height=` auto-load (mapFrameSrc, removed when the engine
 *  moved from an iframe to mounting directly, see wiki-main.ts's renderMapView). A no-op if `mapId`
 *  is already the one loaded, matching the old iframe's own "don't reload if it's still the same
 *  connected map" behavior — reopening the map view on the same world never regenerates it, so a
 *  manual "New Map"/local file load the user made afterward isn't silently clobbered just by
 *  reopening the view. Switching to a *different* connected world, or opening the map view for the
 *  first time this session, does load it. */
export async function loadConnectedWorld(mapId: number, seed: string, width?: number, height?: number): Promise<void> {
  if (loadedConnectedMapId === mapId) return;
  if (loadInFlight) await loadInFlight; // don't overlap two calls racing in from renderMapView + mountMapTabView
  if (loadedConnectedMapId === mapId) return; // the call just awaited may already have done this

  // idle-state.ts's overlay only removes itself from its own button's click handler — bypassing
  // that button (as this does, calling generateMapOnLoad directly) leaves it sitting on top of the
  // freshly generated map, full-viewport and z-indexed above everything, on a page's very first
  // boot with nothing else loaded yet. Same removal openGenerationSettings() already does before
  // its own generation path. A no-op via optional chaining when it was never shown (later loads —
  // checkLoadParameters only ever shows it once, on first boot).
  document.getElementById("generateIdleState")?.remove();

  const { generateMapOnLoad } = await import("@/services/url-params");
  loadInFlight = generateMapOnLoad({ seed, width, height }).then(() => {
    loadedConnectedMapId = mapId;
  });
  await loadInFlight;
  loadInFlight = undefined;
}
