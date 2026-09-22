/**
 * Phase 1 spike (MAPWEAVE.md "Phase 6"): boots the *real* legacy map engine — the actual map.html
 * body, the actual classic scripts in their real order, the actual boot() — inside a Shadow DOM
 * custom element, to prove out the single-DOM-merge mechanism before Phase 3 wires it into the
 * production shell. Dev-only: not a build entry (see vite.config.ts), reachable only via
 * `npm run dev` → /spike/map-in-shadow.html.
 *
 * Not a toy: this replicates main.ts's own side-effect imports and boot() call, because main.ts's
 * `document.addEventListener("DOMContentLoaded", boot)` would never fire if main.ts itself were
 * imported here — this page's own DOMContentLoaded already happened by the time this module runs.
 */
import { getPrimaryMountRoot, installShadowDomBridge, registerShadowRoot } from "@/services/shadow-dom-bridge";

// Real map.html's own script order (src/map.html) — 6 synchronous classic scripts, then the module
// entry (replicated below instead of imported, see doc comment), then 7 deferred classic scripts.
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

// The app is served under a non-root base path in dev/prod alike (see vite.config.ts's `base`) —
// a hardcoded leading "/" 404s. import.meta.env.BASE_URL is Vite's own answer to this, always
// including the trailing slash.
const BASE = import.meta.env.BASE_URL;

function log(message: string): void {
  console.log(`[shadow-spike] ${message}`);
}

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
  for (const path of paths) {
    await loadScript(path);
    log(`loaded ${path}`);
  }
}

/** Fetches the real map.html and returns its <body>'s child nodes, with <script> tags stripped
 *  (inert via innerHTML anyway — loaded explicitly via loadSequentially instead, in the real order,
 *  since script tags inserted through innerHTML never execute). Not a hand-picked subset of ids —
 *  the actual current map.html body, so this spike can't silently drift from the real page. */
async function fetchLegacyBody(): Promise<HTMLElement> {
  const response = await fetch(`${BASE}map.html`);
  const html = await response.text();
  const parsed = new DOMParser().parseFromString(html, "text/html");
  for (const script of Array.from(parsed.body.querySelectorAll("script"))) script.remove();

  const container = document.createElement("div");
  container.id = "legacy-body-root";
  while (parsed.body.firstChild) container.appendChild(parsed.body.firstChild);
  return container;
}

async function boot(): Promise<void> {
  log("installing shadow DOM bridge…");
  installShadowDomBridge();

  const host = document.getElementById("spike-host");
  if (!host) throw new Error("#spike-host not found");
  const shadow = host.attachShadow({ mode: "open" });
  registerShadowRoot(shadow);
  log("shadow root attached and registered");

  for (const href of STYLESHEETS) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = `${BASE}${href}`;
    shadow.appendChild(link);
  }
  log("stylesheets linked into the shadow root");

  const legacyBody = await fetchLegacyBody();
  shadow.appendChild(legacyBody);
  log("real map.html body content injected into the shadow root");

  await loadSequentially(SYNC_SCRIPTS);

  // jQuery UI dialogs default to appendTo: "body" — redirect them into the shadow root's own mount
  // point instead, so they render (and get styled by the shadow-scoped jquery-ui.css) where their
  // content actually lives, not as light-DOM children of the real document.body.
  const jq = (window as unknown as { $: JQueryStatic }).$;
  jq.ui.dialog.prototype.options.appendTo = getPrimaryMountRoot();
  log("jQuery UI dialog appendTo redirected to the shadow root");

  // main.ts's own side-effect imports, replicated (not imported wholesale — see module doc comment)
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
  log("main.ts's side-effect modules loaded");

  await loadSequentially(DEFERRED_SCRIPTS);

  const { boot: bootEngine } = await import("@/components/lifecycle");
  log("calling the real boot()…");
  await bootEngine();
  log("boot() resolved. Run the manual checklist in the page above.");
}

boot().catch(error => {
  console.error("[shadow-spike] boot failed:", error);
});

interface JQueryStatic {
  ui: { dialog: { prototype: { options: { appendTo: unknown } } } };
}
