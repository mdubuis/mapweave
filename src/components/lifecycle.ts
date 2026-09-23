// The app and map lifecycle: start the app, erase what is on screen, generate a new world, put it back
import { applyGraphSize, fitMapToScreen } from "@/components/canvas";
import { closeDialogs, confirmationDialog, initDialogPositionPersistence } from "@/components/dialog/dialog-helpers";
import { Layers } from "@/components/layers";
import { hideLoading, showLoading } from "@/components/loading";
import { restoreUi, syncOptionInputs } from "@/components/options/tabs/options-tab";
import { is3dView } from "@/components/options/view-mode";
import { setSeed } from "@/components/seed";
import { initShell, warnIfServerless } from "@/components/shell";
import { clearMainTip, tip } from "@/components/tooltips";
import { undraw } from "@/components/undraw";
import { applyDefaultViewboxEvents } from "@/components/viewbox-events";
import { setViewportSize } from "@/components/viewport";
import { invokeActiveZooming, resetZoom } from "@/components/zoom";
import { Controllers } from "@/controllers";
import { getPointsNumber } from "@/data/graph-density";
import { GenerationPipeline } from "@/generators/generation-pipeline";
import { initiateAutosave } from "@/services/autosave";
import { logStats } from "@/services/logging";
import { registerServiceWorker } from "@/services/platform";
import { checkLoadParameters } from "@/services/url-params";
import { cleanupData } from "@/services/versioning";
import type { GridGraph } from "@/types/GridGraph";
import { debounce, ensureEl, findEl, parseError } from "@/utils";

/** Bring the app up */
export async function boot(): Promise<void> {
  registerServiceWorker();
  initShell();
  initDialogPositionPersistence();

  Options.restore();
  syncOptionInputs();
  // Before restoreUi(): its applyZoomExtent() call divides by viewport.width/height to find the
  // zoom floor — real bug found by actually generating a map, not by reading the code: with this
  // order, that first computation always divided by the viewport module's unset 0/0 default,
  // setting minZoom to exactly 0. Nothing recomputed it before a "New Map" click on a map that had
  // never been generated before (idle-state's own path, unlike the old always-auto-generate one,
  // which happened to always fix it via fitMapToScreen() before anyone could hit "New Map") —
  // Leaflet's unproject() with a zero zoom then divides by zero internally, throwing "Invalid LatLng
  // object: (NaN, NaN)" and leaving the map blank.
  setViewportSize(options.map.graph.width, options.map.graph.height);
  restoreUi();
  applyDefaultViewboxEvents();
  // Real bug, same family as the zoom-floor one above: generateMapOnLoad() (the old auto-generate
  // path) always called this itself right after generating, so regenerateMap() ("New Map"/F2) never
  // needed to — it only ever ran on a map that generateMapOnLoad() had already set layer visibility
  // for. idle-state's "configure, then click New Map" flow lets regenerateMap() be the very first
  // generation ever, with no prior applyLayersPreset() call from anywhere — every layer (biomes
  // included) stayed at its blank initial state, so a freshly generated map showed bare black
  // landmass silhouettes with no biome colors, borders, or any other layer. Calling it once here
  // establishes that baseline before either code path can possibly run; generateMapOnLoad()'s own
  // call afterward is a harmless no-op repeat, not a second source of truth.
  // Dynamic import, not a static one: layers-presets.ts pulls in options/tabs/layers-tab.ts, whose
  // top-level code writes into a #layersContent element that only exists once the real map.html body
  // is in the DOM — fine at runtime (this line only runs after that's true), but a static import
  // makes it part of lifecycle.ts's own module-load-time graph, which broke an unrelated test that
  // imports lifecycle.ts in a DOM-less context (real regression, caught by the test suite, not
  // theoretical). A dynamic import only resolves when this line actually executes.
  const { applyLayersPreset } = await import("@/components/layers-presets");
  applyLayersPreset();

  if (!warnIfServerless()) {
    hideLoading();
    await checkLoadParameters();
  }

  initiateAutosave();
}

export type GenerationConfig = { seed?: string; graph?: GridGraph; width?: number; height?: number; points?: number };

/** Generate a whole new world */
export async function generate(config?: GenerationConfig): Promise<void> {
  try {
    const { seed: precreatedSeed, graph: precreatedGraph, width, height, points } = config || {};
    Options.setGraphSize(width, height);
    setSeed(precreatedSeed);
    Options.randomize();
    if (precreatedGraph && points !== undefined) options.map.graph.points = points;
    applyGraphSize(); // TODO: DOM change, not part of generation

    await GenerationPipeline.run({ graph: precreatedGraph });
    Options.persist();

    syncOptionInputs();
    registerMap();
    logStats();
    invokeActiveZooming();
  } catch (error) {
    ERROR && console.error(error);
    clearMainTip();

    ensureEl("alertMessage").innerHTML = /* html */ `An error has occurred on map generation. Please retry.
      <br />If error is critical, clear the stored data and try again.
      <p id="errorBox">${parseError(error as Error)}</p>`;

    $("#alert").dialog({
      resizable: false,
      title: "Generation error",
      width: "32em",
      buttons: {
        "Cleanup data": () => cleanupData(),
        Regenerate: function (this: HTMLElement) {
          regenerateMap("generation error");
          $(this).dialog("close");
        },
        Ignore: function (this: HTMLElement) {
          $(this).dialog("close");
        }
      },
      position: { my: "center", at: "center", of: "svg" }
    });
  }
}

/** Whether a style preset has ever been applied to the SVG elements this page load — see
 *  regenerateMap's own applyStyleOnLoad() call below for why this exists. generateMapOnLoad()
 *  (url-params.ts) calls this after its own applyStyleOnLoad(), so a later "New Map" click doesn't
 *  redundantly re-apply the saved preset over whatever the user has since customized. */
let styleAppliedOnce = false;
export function markStyleApplied(): void {
  styleAppliedOnce = true;
}

/** Replace the current map with a new one. Debounced: the hotkey and the button both fire it */
export const regenerateMap = debounce(async (config?: GenerationConfig | string) => {
  const reason = typeof config === "string" ? config : "user request";
  WARN && console.warn(`Generate new random map: ${reason}`);

  // a big grid takes long enough that the splash is worth showing. The size asked for, not the
  // one on screen: the map being replaced says nothing about how long the next one will take
  const shouldShowLoading = getPointsNumber(options.generation.graph.density) > 10000;
  shouldShowLoading && showLoading();

  closeDialogs("#worldConfigurator, #options3d");
  customization = 0;
  resetZoom(1000);
  undraw();
  // Real bug, same family as the two above: generateMapOnLoad() (the old auto-generate path)
  // always called applyStyleOnLoad() itself before generating — the thing that actually applies
  // the saved/default style preset's colors (including #landmass's own fill: SVG defaults an
  // unstyled shape to solid black, and nothing else ever painted over it once biome/state coloring
  // moved to Leaflet panes *underneath* the legacy SVG rather than later-in-the-same-SVG on top of
  // it) — so a map generated via regenerateMap() alone rendered as a flat black silhouette with the
  // real, colored territory data invisible right behind it. Can't just move this call into boot()
  // like the other two fixes: applyStyleOnLoad is a classic-script global (style-presets.js) that
  // doesn't exist yet at boot() time (it's one of the DEFERRED_SCRIPTS, loaded after boot()
  // returns — see map-engine-host.ts) — calling it there would throw. Only run it once, though:
  // unlike the zoom floor and layers preset (pure baseline state, safe to reset every regeneration),
  // re-applying the *saved* style preset on every subsequent "New Map" click would silently discard
  // whatever the user just customized in the Style tab.
  if (!styleAppliedOnce) {
    styleAppliedOnce = true;
    await applyStyleOnLoad();
  }
  await generate(typeof config === "string" ? undefined : config);
  Layers.drawAll();

  if (is3dView()) Controllers.View3d.redraw();
  if (findEl("worldConfigurator")?.offsetParent) Controllers.WorldConfigurator.open();

  fitMapToScreen();
  shouldShowLoading && hideLoading();
  clearMainTip();
}, 250);

/** Ask before throwing away a map the user has been working on for a while */
export function regeneratePrompt(config?: GenerationConfig): void {
  if (customization) {
    tip("New map cannot be generated when edit mode is active, please exit the mode and retry", false, "error");
    return;
  }

  const current = mapHistory.at(-1);
  const workingMinutes = current ? (Date.now() - current.registeredAt) / 60000 : 0;
  if (workingMinutes < 1) {
    regenerateMap(config);
    return;
  }

  confirmationDialog({
    title: "Generate new map",
    message:
      "Are you sure you want to generate a new map?<br />All unsaved changes made to the current map will be lost",
    confirm: "Generate",
    onConfirm: () => {
      closeDialogs();
      regenerateMap(config);
    }
  });
}

interface MapHistoryEntry {
  seed: string;
  width: number;
  height: number;
  template: string;
  created: number;
  /** when this entry was put on screen in this session, unlike `created` never backdated to a loaded file's own timestamp */
  registeredAt: number;
}

// every map this session put on screen, oldest first; the last one is what is on screen now
globalThis.mapHistory = [];

/** Take note of a map that is now on screen, and announce it */
export function registerMap(created: number = Date.now()): void {
  mapHistory.push({
    seed: options.map.seed,
    width: options.map.graph.width,
    height: options.map.graph.height,
    template: options.generation.template,
    created: created,
    registeredAt: Date.now()
  });

  // the public seam test automation and external integrations wait on; the id is the creation date
  window.dispatchEvent(new CustomEvent("map:generated", { detail: { seed: options.map.seed, mapId: created } }));
}

declare global {
  var mapHistory: MapHistoryEntry[];
  // biome-ignore lint/suspicious/noRedeclare: exposed on window for legacy JS
  var regeneratePrompt: (config?: GenerationConfig) => void;
  // biome-ignore lint/suspicious/noRedeclare: exposed on window for legacy JS
  var regenerateMap: (config?: GenerationConfig | string) => void;
}
window.regeneratePrompt = regeneratePrompt;
window.regenerateMap = regenerateMap;
