import { select } from "d3";
import * as L from "leaflet";
import { Layers } from "@/components/layers";
import { getLeafletMap, isLeafletMapReady } from "@/components/leaflet-map";
import { setViewportTransform, viewport } from "@/components/viewport";
import { refreshBurgIconsZoomSize } from "@/renderers/draw-burg-icons";
import { refreshMarkersZoomSize } from "@/renderers/draw-markers";
import { ViewportLayers } from "@/renderers/viewport/viewport-renderer";
import { ensureEl, findEl } from "@/utils/nodeUtils";
import { rn } from "@/utils/numberUtils";

let listenersBound = false;

/** (Re-)enable the Leaflet gesture handlers and, on first call, wire the view-change listeners.
 *  Callers use this to restore default map interaction after a tool has taken it over */
export function applyZoomBehavior(): void {
  const map = getLeafletMap();

  if (!listenersBound) {
    map.on("move zoom", onZoom);
    map.on("moveend zoomend", handleZoomEnd);
    listenersBound = true;
  }

  map.dragging.enable();
  map.scrollWheelZoom.enable();
  map.doubleClickZoom.enable();
  map.touchZoom.enable();
  map.boxZoom.enable();
  map.keyboard.enable();
}

let frameId: number | null = null;
let pendingScaleChange = false;
let pendingPositionChange = false;
let isViewChanged = false;

/** World point (0,0) rendered at the current view: its screen position is the transform's translate */
function currentTransform(): { k: number; x: number; y: number } {
  const map = getLeafletMap();
  const origin = map.latLngToContainerPoint(L.latLng(0, 0));
  return { k: map.getZoom(), x: origin.x, y: origin.y };
}

function onZoom(): void {
  const { k, x, y } = currentTransform();

  const isScaleChanged = viewport.scale !== k;
  const isPositionChanged = viewport.x !== x || viewport.y !== y;
  if (!isScaleChanged && !isPositionChanged) return;
  isViewChanged = true;

  setViewportTransform(k, x, y);

  pendingScaleChange = pendingScaleChange || isScaleChanged;
  pendingPositionChange = pendingPositionChange || isPositionChanged;
  if (frameId !== null) return;

  frameId = requestAnimationFrame(() => {
    frameId = null;
    handleZoomPerFrame();
  });
}

/** Per-frame view tracking. Keep this cheap */
function handleZoomPerFrame(): void {
  const didScaleChange = pendingScaleChange;
  const didPositionChange = pendingPositionChange;
  pendingScaleChange = false;
  pendingPositionChange = false;
  if (!didScaleChange && !didPositionChange) return;

  ensureEl<SVGGElement>("viewbox").setAttribute(
    "transform",
    `translate(${viewport.x} ${viewport.y}) scale(${viewport.scale})`
  );

  if (didScaleChange) {
    Layers.draw("scaleBar");

    if (options.map.labels.resizeOnZoom) applyLabelsZoomSize();
  }

  if (didPositionChange) Layers.draw("coordinates");

  window.updateMinimap?.();
  redrawTracedImage();
  if (options.app.viewportRedraw === "continuous") ViewportLayers.schedule();
}

/** Rewrite map content once zoom gesture settles */
function handleZoomEnd(): void {
  if (!isViewChanged) return;
  isViewChanged = false;

  if (frameId !== null) {
    cancelAnimationFrame(frameId);
    frameId = null;
    handleZoomPerFrame();
  }

  invokeActiveZooming();
}

/** Mirror the map transform onto the heightmap tracing canvas */
function redrawTracedImage(): void {
  if (customization !== 1) return;
  const canvas = findEl<HTMLCanvasElement>("canvas");
  if (!canvas || canvas.style.opacity === "0") return;
  const image = findEl<HTMLImageElement>("imageToConvert");
  const context = image && canvas.getContext("2d");
  if (!context) return;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.setTransform(viewport.scale, 0, 0, viewport.scale, viewport.x, viewport.y);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
}

function applyLabelsZoomSize(): void {
  const fontSize = Math.max(Math.round(((100 + 100 / viewport.scale) / 2) * 100) / 100, 1);
  select("#labels").attr("font-size", `${fontSize}px`);
}

export function invokeActiveZooming(): void {
  const isOptimized = ensureEl<HTMLSelectElement>("shapeRendering").value === "optimizeSpeed";

  if (options.map.labels.resizeOnZoom) applyLabelsZoomSize();
  ViewportLayers.renderNow();
  refreshMarkersZoomSize();
  refreshBurgIconsZoomSize();

  if (!customization && !isOptimized) {
    const statesHalo = select("#statesHalo");
    const desired = styles.states.statesHalo.options.width;
    const haloSize = rn(desired / viewport.scale ** 0.8, 2);
    statesHalo.attr("stroke-width", haloSize).style("display", haloSize > 0.1 ? "block" : "none");
  }
}

/** Zoom to a specific point, centering it in the viewport */
export function zoomTo(x: number, y: number, z = 8, duration = 2000): void {
  const map = getLeafletMap();
  const center = L.latLng(y, x);
  if (duration > 0) map.flyTo(center, z, { duration: duration / 1000 });
  else map.setView(center, z, { animate: false });
}

/** Reset zoom to the initial view: the map origin at the smallest scale the extents allow */
export function resetZoom(duration = 1000): void {
  const map = getLeafletMap();
  const min = map.getMinZoom();
  // the point that must land at the viewport center for world (0,0) to land at the viewport corner
  const center = map.unproject(L.point(viewport.width / 2, viewport.height / 2), min);

  if (duration) map.flyTo(center, min, { duration: duration / 1000 });
  else map.setView(center, min, { animate: false }); // no transition: the caller redraws right after
}

export function panMap(x: number, y: number): void {
  getLeafletMap().panBy([x, y], { animate: false });
}

export function setMapZoom(value: number): void {
  getLeafletMap().setZoom(value, { animate: false });
}

export function changeMapZoom(factor: number): void {
  const map = getLeafletMap();
  map.setZoom(map.getZoom() * factor, { animate: false });
}

export function setZoomExtent(min: number, max: number): void {
  const map = getLeafletMap();
  map.setMinZoom(min);
  map.setMaxZoom(max);
}

/**
 * Pull the current view back inside the extents. Leaflet applies min/maxZoom to gestures only, so a
 * scale that a new viewport or a new map has put out of bounds stays there until asked
 */
export function constrainZoom(): void {
  if (!isLeafletMapReady()) return; // no zoom behavior on the element yet

  const map = getLeafletMap();
  const zoom = map.getZoom();
  if (zoom < map.getMinZoom()) map.setZoom(map.getMinZoom(), { animate: false });
  else if (zoom > map.getMaxZoom()) map.setZoom(map.getMaxZoom(), { animate: false });
}

export function setTranslateExtent(x0: number, y0: number, x1: number, y1: number): void {
  getLeafletMap().setMaxBounds(L.latLngBounds(L.latLng(y0, x0), L.latLng(y1, x1)));
}

type ZoomTo = typeof zoomTo;
type ResetZoom = typeof resetZoom;
type InvokeActiveZooming = typeof invokeActiveZooming;

declare global {
  // biome-ignore lint/suspicious/noRedeclare: the bridges registered just below
  var zoomTo: ZoomTo;
  // biome-ignore lint/suspicious/noRedeclare: the bridges registered just below
  var resetZoom: ResetZoom;
  // biome-ignore lint/suspicious/noRedeclare: the bridges registered just below
  var invokeActiveZooming: InvokeActiveZooming;
}

// Bridges for classic public/ code. These take numbers only, never a selection: the behavior is
// d3 v7 while `public/` still speaks the global d3 v5, and the two must not meet.
window.zoomTo = zoomTo;
window.setZoomExtent = setZoomExtent;
window.setTranslateExtent = setTranslateExtent;
window.resetZoom = resetZoom;
window.invokeActiveZooming = invokeActiveZooming;
window.setMapZoom = setMapZoom;
