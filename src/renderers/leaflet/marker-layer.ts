// A persistent Leaflet layer for markers (POI pins) — unlike every other converted layer, markers
// are point icons, not geometry, so this uses L.marker + L.divIcon instead of L.geoJSON. The pin
// shape / icon content is unchanged from the old renderer (getPin/getMarkerContent, moved here
// verbatim); only positioning, sizing-on-zoom, and dragging now go through Leaflet's own APIs
// instead of raw SVG x/y attributes and d3-drag. See MIGRATION.md Phase 5.
//
// Each marker's divIcon HTML is still `<svg id="marker{i}" viewBox="0 0 30 30">...</svg>` — the
// exact element the old renderer produced, just without its own x/y/width/height (Leaflet's own
// wrapping <div> now carries position and size). Old code that found a marker by walking up to the
// nearest <svg id="marker{i}"> (markers-editor.ts) keeps working unchanged.
//
// No custom viewport culling — see river-layer.ts for the same reasoning.
import * as L from "leaflet";
import { getFeaturePane, getLeafletMap } from "@/components/leaflet-map";
import type { Marker } from "@/generators/markers-generator";
import { isImageIcon } from "@/utils/fileUtils";
import { rn } from "@/utils/numberUtils";
import { escapeHtml } from "@/utils/stringUtils";

const PANE_NAME = "markers-leaflet";
const Z_INDEX = 107;

const pinShapes: { [key: string]: (fill: string, stroke: string) => string } = {
  bubble: (fill: string, stroke: string) =>
    `<path d="M6,19 l9,10 L24,19" fill="${stroke}" stroke="none" /><circle cx="15" cy="15" r="10" fill="${fill}" stroke="${stroke}"/>`,
  pin: (fill: string, stroke: string) =>
    `<path d="m 15,3 c -5.5,0 -9.7,4.09 -9.7,9.3 0,6.8 9.7,17 9.7,17 0,0 9.7,-10.2 9.7,-17 C 24.7,7.09 20.5,3 15,3 Z" fill="${fill}" stroke="${stroke}"/>`,
  square: (fill: string, stroke: string) =>
    `<path d="m 20,25 -5,4 -5,-4 z" fill="${stroke}"/><path d="M 5,5 H 25 V 25 H 5 Z" fill="${fill}" stroke="${stroke}"/>`,
  squarish: (fill: string, stroke: string) =>
    `<path d="m 5,5 h 20 v 20 h -6 l -4,4 -4,-4 H 5 Z" fill="${fill}" stroke="${stroke}" />`,
  diamond: (fill: string, stroke: string) => `<path d="M 2,15 15,1 28,15 15,29 Z" fill="${fill}" stroke="${stroke}" />`,
  hex: (fill: string, stroke: string) =>
    `<path d="M 15,29 4.61,21 V 9 L 15,3 25.4,9 v 12 z" fill="${fill}" stroke="${stroke}" />`,
  hexy: (fill: string, stroke: string) =>
    `<path d="M 15,29 6,21 5,8 15,4 25,8 24,21 Z" fill="${fill}" stroke="${stroke}" />`,
  shieldy: (fill: string, stroke: string) =>
    `<path d="M 15,29 6,21 5,7 c 0,0 5,-3 10,-3 5,0 10,3 10,3 l -1,14 z" fill="${fill}" stroke="${stroke}" />`,
  shield: (fill: string, stroke: string) =>
    `<path d="M 4.6,5.2 H 25 v 6.7 A 20.3,20.4 0 0 1 15,29 20.3,20.4 0 0 1 4.6,11.9 Z" fill="${fill}" stroke="${stroke}" />`,
  pentagon: (fill: string, stroke: string) =>
    `<path d="M 4,16 9,4 h 12 l 5,12 -11,13 z" fill="${fill}" stroke="${stroke}" />`,
  heptagon: (fill: string, stroke: string) =>
    `<path d="M 15,29 6,22 4,12 10,4 h 10 l 6,8 -2,10 z" fill="${fill}" stroke="${stroke}" />`,
  circle: (fill: string, stroke: string) => `<circle cx="15" cy="15" r="11" fill="${fill}" stroke="${stroke}" />`,
  no: () => ""
};

const getPin = (shape = "bubble", fill = "#fff", stroke = "#000"): string => {
  const shapeFunction = pinShapes[shape] || pinShapes.bubble;
  return shapeFunction(fill, stroke);
};

function getMarkerContent({ icon, dx = 50, dy = 50, px = 12, pin, fill, stroke }: Marker): string {
  const isExternal = isImageIcon(icon);
  return /* html */ `
      <g>${getPin(pin, fill, stroke)}</g>
      <text x="${dx}%" y="${dy}%" font-size="${px}px" >${isExternal ? "" : escapeHtml(icon)}</text>
      <image x="${dx / 2}%" y="${dy / 2}%" width="${px}px" height="${px}px" href="${isExternal ? escapeHtml(icon) : ""}" />`;
}

// The old renderer computed a *world-space* size that #viewbox's own scale(viewport.scale) transform
// then multiplied by zoom automatically (worldSize = rescale ? size/5 + 24/scale : size, apparent =
// scale * worldSize). Leaflet's divIcon has no such implicit transform — its size is screen pixels
// directly — so this computes the equivalent *apparent* size straight away: zoom * (size/5) + 24 when
// rescale is on (icons grow with zoom, floored at a legible 24px), or zoom * size when it's off
// (plain linear scaling, same as any other zoomed map content).
function getMarkerSize({ size = 30 }: Marker, rescale: number, zoom: number): number {
  const apparentSize = rescale ? (zoom * size) / 5 + 24 : zoom * size;
  return Math.max(rn(apparentSize, 2), 1);
}

// world-space top-left corner, in the same convention the old renderer used — old code that reads
// these back off the element (highlightElement()'s getBBox() fallback for an <svg> tag) keeps working
function buildIcon(marker: Marker, size: number): L.DivIcon {
  const x = rn(marker.x - size / 2, 1);
  const y = rn(marker.y - size, 1);
  const html = /* html */ `<svg id="marker${marker.i}" viewBox="0 0 30 30" width="${size}" height="${size}" x="${x}" y="${y}">${getMarkerContent(marker)}</svg>`;
  return L.divIcon({ html, className: "", iconSize: [size, size], iconAnchor: [size / 2, size] });
}

const markers = new Map<number, L.Marker>();
let layerGroup: L.LayerGroup | undefined;
let visibleMarkerIds: Set<number> | null = null;
let editedMarkerId: number | null = null;
let editedDragEnd: ((x: number, y: number) => void) | undefined;

function ensureLayerGroup(): L.LayerGroup {
  if (!layerGroup) {
    const pane = getFeaturePane(PANE_NAME, Z_INDEX);
    layerGroup = L.layerGroup([], { pane: pane.id }).addTo(getLeafletMap());
  }
  return layerGroup;
}

export function ensurePane(): void {
  getFeaturePane(PANE_NAME, Z_INDEX);
}

/** Full rebuild from pack.markers, honoring the pinned-only / id-filter / hidden rules the old
 *  renderer applied */
export function update(allMarkers: Marker[]): void {
  const group = ensureLayerGroup();
  group.clearLayers();
  markers.clear();

  const rescale = styles.markers.options.rescale;
  const anyPinned = allMarkers.some(m => m.pinned);
  const zoom = getLeafletMap().getZoom();

  for (const marker of allMarkers) {
    if (marker.hidden) continue;
    const isEdited = marker.i === editedMarkerId;
    if (!isEdited && ((anyPinned && !marker.pinned) || (visibleMarkerIds && !visibleMarkerIds.has(marker.i)))) continue;

    const size = getMarkerSize(marker, rescale, zoom);
    const leafletMarker = L.marker([marker.y, marker.x], {
      icon: buildIcon(marker, size),
      draggable: isEdited,
      pane: getFeaturePane(PANE_NAME, Z_INDEX).id
    });
    if (isEdited) wireDrag(leafletMarker);
    markers.set(marker.i, leafletMarker);
    group.addLayer(leafletMarker);
  }
}

function wireDrag(leafletMarker: L.Marker): void {
  leafletMarker.on("dragend", () => {
    const { lat, lng } = leafletMarker.getLatLng();
    editedDragEnd?.(lng, lat);
  });
}

let lastZoomSized: number | undefined;

/** Recompute every marker's icon size for the current zoom — every marker needs this, not just
 *  rescale-enabled ones (see getMarkerSize), since apparent size always depends on zoom now that
 *  there's no implicit #viewbox-style scale transform doing it automatically. Call on zoom end, not
 *  per frame: rebuilding a divIcon means replacing the marker's DOM node. Skips the rebuild
 *  entirely when the zoom level hasn't actually changed (e.g. a pure pan) */
export function refreshSizeForZoom(): void {
  if (!layerGroup) return;
  const zoom = getLeafletMap().getZoom();
  if (zoom === lastZoomSized) return;
  lastZoomSized = zoom;

  const rescale = styles.markers.options.rescale;
  const byId = new Map(pack.markers.map((m: Marker) => [m.i, m]));
  for (const [id, leafletMarker] of markers) {
    const marker = byId.get(id);
    if (!marker) continue;
    leafletMarker.setIcon(buildIcon(marker, getMarkerSize(marker, rescale, zoom)));
  }
}

export function setMarkersFilter(ids: number[] | null): void {
  visibleMarkerIds = ids ? new Set(ids) : null;
}

/** The one marker under live edit renders draggable, even if it would otherwise be filtered out by
 *  pinned/visible-ids rules; onDragEnd receives world-space [x, y] once a drag completes */
export function setEditedMarker(markerId: number | null, onDragEnd?: (x: number, y: number) => void): void {
  editedMarkerId = markerId;
  editedDragEnd = onDragEnd;
}

export function clear(): void {
  layerGroup?.clearLayers();
  markers.clear();
}
