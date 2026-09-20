// The app window itself: the SVG layer scaffold, browser-level behaviours
import { alertDialog, closeDialogs, confirmationDialog } from "@/components/dialog/dialog-helpers";
import { Layers } from "@/components/layers";
import { Pins } from "@/components/pins";
import { Services } from "@/services";
import { isElectron, isLocalhost } from "@/services/platform";
import { ensureEl, findEl } from "@/utils";
import { fitMapToScreen } from "./canvas";

/** Wire the window up: the svg layer scaffold and the browser-level behaviours around it. Called by boot() */
export function initShell(): void {
  Layers.init(); // create the svg layer groups the renderers draw into

  window.addEventListener("resize", onResize);
  window.addEventListener("vite:preloadError", onChunkLoadError);
  document.addEventListener("touchstart", onTitlebarButtonTouch, { capture: true, passive: true });
  addDragToUpload();
  initTourPromptButton();

  if (!isLocalhost() && !isElectron()) window.onbeforeunload = () => "Are you sure you want to navigate away?";
  if (isElectron()) removeWebOnlyControls();
}

/** Keep the next unpinned map request in step with the browser window. */
function onResize(): void {
  Options.set(config => {
    if (Pins.rolls("mapWidth") && window.innerWidth > 0) config.generation.graph.width = window.innerWidth;
    if (Pins.rolls("mapHeight") && window.innerHeight > 0) config.generation.graph.height = window.innerHeight;
  });
  fitMapToScreen();
}

/**
 * touch-punch preventDefaults touch sequences started on a dialog titlebar (the drag handle),
 * so taps on the titlebar buttons never produce a click. Stop the sequence from reaching it
 */
function onTitlebarButtonTouch(event: TouchEvent): void {
  const target = event.target as HTMLElement | null;
  if (target?.closest?.(".ui-dialog-titlebar-close, .ui-dialog-titlebar-collapse")) event.stopPropagation();
}

/**
 * Each release replaces the content-hashed chunk files on the server, so a page opened before
 * the release 404s when it lazy-loads a chunk it has not requested yet ("Failed to fetch
 * dynamically imported module"). Offer a reload to pick up the new build. Offline the same error
 * means the chunk was never precached (it was not in the build the worker installed), so say that
 */
function onChunkLoadError(): void {
  if (!navigator.onLine) {
    alertDialog({
      title: "You are offline",
      message: "This part of the app was not downloaded before the connection was lost. Reconnect and try again"
    });
    return;
  }

  confirmationDialog({
    title: "New version released",
    message:
      "This part of the app failed to load because a new version was released while the page was open.<br />Reload the page to get the new version. If you have unsaved changes, save the map first",
    confirm: "Reload",
    cancel: "Not now",
    onConfirm: () => {
      window.onbeforeunload = null; // the user just confirmed the reload, don't ask again.
      location.reload();
    }
  });
}

/** Dropping a .map or .gz anywhere on the window opens it. Pull request from @evyatron */
function addDragToUpload(): void {
  const overlay = () => ensureEl("mapOverlay");

  document.addEventListener("dragover", event => {
    event.stopPropagation();
    event.preventDefault();
    overlay().style.display = null as unknown as string;
  });

  document.addEventListener("dragleave", () => {
    overlay().style.display = "none";
  });

  document.addEventListener("drop", event => {
    event.stopPropagation();
    event.preventDefault();

    const mapOverlay = overlay();
    mapOverlay.style.display = "none";

    const items = event.dataTransfer?.items;
    if (items?.length !== 1) return; // no files, or more than one
    const file = items[0].getAsFile();
    if (!file) return;

    if (!file.name.endsWith(".map") && !file.name.endsWith(".gz")) {
      return alertDialog({
        title: "Invalid file format",
        message: "Please upload a map file (<i>.map</i> or <i>.gz</i> formats) you have previously downloaded"
      });
    }

    mapOverlay.style.display = null as unknown as string;
    mapOverlay.innerHTML = "Uploading<span>.</span><span>.</span><span>.</span>";
    closeDialogs();
    Services.Load.uploadMap(file, () => {
      mapOverlay.style.display = "none";
      mapOverlay.innerHTML = "Drop a map file to open";
    });
  });
}

/**
 * Offer the tour to newcomers with a floating button. Shown on the first few visits only, and never
 * again once the user has taken it. The tour itself stays lazy: it is a chunk of its own
 */
function initTourPromptButton(): void {
  const MAX_SHOWS = 3;
  const STORAGE_KEY = "fmg-tour-prompt-count";

  const count = Number.parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10);
  if (count >= MAX_SHOWS) return;

  const button = findEl("tourPromptButton");
  if (!button) return;

  button.style.display = "flex";
  button.addEventListener("click", () => {
    Services.UiTour.start();
    localStorage.setItem(STORAGE_KEY, String(MAX_SHOWS));
  });
  localStorage.setItem(STORAGE_KEY, String(count + 1));
}

/** The app is a static site, but it fetches assets: opening map.html from disk cannot work */
export function warnIfServerless(): boolean {
  if (location.hostname) return false;

  alertDialog({
    title: "Loading error",
    width: "28em",
    message: /* html */ `Mapweave cannot run serverless. Run a local web server (e.g. <code>npm run dev</code>) and open it from there instead of opening the file directly.`
  });
  return true;
}

function removeWebOnlyControls(): void {
  findEl("getAppButton")?.remove();
  findEl("saveToDropboxButton")?.remove();
  findEl("loadFromDropbox")?.remove();
}
