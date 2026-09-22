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

/** The real map.html's <body>, bundled at build time (see the `?raw` import above — a real Vite
 *  build only emits an HTML file that's a declared rollupOptions.input entry, and map.html no
 *  longer is one, so `fetch()`-ing it at runtime like the spike did would 404 in production).
 *  <script> tags are stripped (inert via innerHTML anyway — loaded explicitly via
 *  loadSequentially instead, in the real order) and never a hand-picked subset: the whole body,
 *  so this can't silently drift from the actual page. */
function legacyBodyElement(): HTMLElement {
  const parsed = new DOMParser().parseFromString(mapHtmlRaw, "text/html");
  for (const script of Array.from(parsed.body.querySelectorAll("script"))) script.remove();

  const container = document.createElement("div");
  container.id = "legacy-body-root";
  while (parsed.body.firstChild) container.appendChild(parsed.body.firstChild);
  return container;
}

interface JQueryStatic {
  ui: { dialog: { prototype: { options: { appendTo: unknown } } } };
}

let bootPromise: Promise<HTMLElement> | undefined;

/** The actual one-time boot sequence — creates the shadow host, injects the real body/stylesheets,
 *  loads the classic scripts in order, redirects jQuery UI's dialog appendTo, replicates main.ts's
 *  side-effect imports, and calls the real boot(). Returns the host element (not yet attached to
 *  any container — the caller places it). */
async function bootEngine(): Promise<HTMLElement> {
  installShadowDomBridge();

  const host = document.createElement("div");
  host.id = "map-engine-host-root";
  const shadow = host.attachShadow({ mode: "open" });
  registerShadowRoot(shadow);

  for (const href of STYLESHEETS) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${BASE}${href}`;
    shadow.appendChild(link);
  }

  shadow.appendChild(legacyBodyElement());

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
  if (host.parentElement !== container) container.appendChild(host);
}

export function isMapEngineBooted(): boolean {
  return bootPromise !== undefined;
}
