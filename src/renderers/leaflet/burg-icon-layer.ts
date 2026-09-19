// A persistent Leaflet layer for burg icons — points, like markers, so L.marker + L.divIcon again
// (see marker-layer.ts). Two independent icons can exist per burg: the primary group icon (town,
// capital, fort, ...) and, for port burgs, a second "anchor" glyph drawn at the same point. See
// MIGRATION.md Phase 5.
//
// Sizing/positioning trick, preserved from the old renderer: every symbol in index.html's <defs> is
// authored centered on its own local (0,0) (e.g. <circle cx="0" cy="0" r="5"/>), and a plain
// `<use href="#icon" x="cx" y="cy"/>` (no transform) places that centered content exactly at
// (cx, cy) in the use element's coordinate space — the same trick the old #burgIcons/#anchors <g>
// used with `font-size` for 1em-relative symbol sizing. Each divIcon here reproduces it with its own
// small wrapper <svg viewBox="0 0 2*size 2*size">, so the icon artwork (which can overflow well past
// its nominal box — the old renderer's own comment says "up to two em above its anchor") keeps
// rendering exactly like before, just inside a Leaflet-positioned div instead of a shared <g>.
//
// No custom viewport culling — see river-layer.ts for the same reasoning.
//
// Group stacking order: the old renderer painted whole groups in options.map.burgs.groups order
// (later group = on top). Leaflet auto-orders markers by screen Y by default; zIndexOffset biases
// stacking back toward group order, though it's no longer a hard guarantee within a group — an
// accepted compromise, see MIGRATION.md.
import * as L from "leaflet";
import { getFeaturePane, getLeafletMap } from "@/components/leaflet-map";
import type { Burg } from "@/generators/burgs-generator";
import { escapeHtml } from "@/utils/stringUtils";

const PANE_NAME = "burg-icons-leaflet";
const Z_INDEX = 108;
const GROUP_ORDER_SCALE = 1000;

/** Matches any rendered burg or anchor icon's wrapper <svg> (id="burg{i}"/"anchor{i}", data-id="{i}"
 *  on both) — the one place this id/data-attribute convention is defined; every other file that
 *  needs to find a rendered burg icon (hover tooltips, table<->map highlighting, label-spread's
 *  bounds lookup) imports this instead of restating the selector */
export const BURG_ICON_SELECTOR = "svg[id^='burg'][data-id], svg[id^='anchor'][data-id]";

type BurgIconAttrs = Record<string, string | number | boolean | null | undefined>;

function buildIcon(
  id: number,
  group: string,
  icon: string,
  size: number,
  attrs: BurgIconAttrs,
  isAnchor: boolean
): L.DivIcon {
  const box = size * 2;
  const center = size;
  const attrString = Object.entries(attrs)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => ` ${key}="${escapeHtml(String(value))}"`)
    .join("");
  const pointerStyle = isAnchor ? "pointer-events:none" : "cursor:pointer";
  const html = /* html */ `<svg id="${isAnchor ? "anchor" : "burg"}${id}" data-id="${id}" data-group="${escapeHtml(group)}" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}" overflow="visible" style="${pointerStyle}"><g font-size="${size}"${attrString}><use href="${icon}" x="${center}" y="${center}"/></g></svg>`;
  return L.divIcon({ html, className: "", iconSize: [box, box], iconAnchor: [center, center] });
}

interface IconMeta {
  group: string;
  icon: string;
  baseSize: number;
  attrs: BurgIconAttrs;
  isAnchor: boolean;
}

const primaryMarkers = new Map<number, L.Marker>();
const anchorMarkers = new Map<number, L.Marker>();
const primaryMeta = new Map<number, IconMeta>();
const anchorMeta = new Map<number, IconMeta>();
let layerGroup: L.LayerGroup | undefined;
let lastZoomSized: number | undefined;

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

/** Full rebuild from pack.burgs, grouped and styled exactly as the old renderer did. Icon size is
 *  apparent (screen) size, scaled by the current zoom — see refreshSizeForZoom for why: unlike the
 *  old renderer, nothing here is nested inside an implicitly-scaled parent transform any more */
export function update(burgs: Burg[]): void {
  const group = ensureLayerGroup();
  group.clearLayers();
  primaryMarkers.clear();
  anchorMarkers.clear();
  primaryMeta.clear();
  anchorMeta.clear();

  const burgsByGroup = new Map<string, Burg[]>();
  for (const burg of burgs) {
    if (!burg.i || burg.removed || !burg.group) continue;
    const list = burgsByGroup.get(burg.group);
    if (list) list.push(burg);
    else burgsByGroup.set(burg.group, [burg]);
  }

  const primaryGroups = styles.burgIcons.burgIcons.groups;
  const anchorGroups = styles.burgIcons.anchors.groups;
  const primaryDefault = primaryGroups.town || Object.values(primaryGroups)[0];
  const anchorDefault = anchorGroups.town || Object.values(anchorGroups)[0];
  const paneId = getFeaturePane(PANE_NAME, Z_INDEX).id;
  const zoom = getLeafletMap().getZoom();
  lastZoomSized = zoom;

  const orderedGroups = [...options.map.burgs.groups].sort((a, b) => a.order - b.order);
  for (const { name, order } of orderedGroups) {
    const burgsInGroup = burgsByGroup.get(name);
    if (!burgsInGroup) continue;

    const primaryStyle = primaryGroups[name] || primaryDefault;
    const anchorStyle = anchorGroups[name] || anchorDefault;
    const icon = escapeHtml(primaryStyle?.options.icon || "#icon-circle");
    const primaryBaseSize = primaryStyle?.options.size ?? 1;
    const anchorBaseSize = anchorStyle?.options.size ?? 1;
    const primaryAttrs = primaryStyle?.attrs ?? {};
    const anchorAttrs = anchorStyle?.attrs ?? {};

    for (const burg of burgsInGroup) {
      const primaryIcon = buildIcon(burg.i, name, icon, zoom * primaryBaseSize, primaryAttrs, false);
      const marker = L.marker([burg.y, burg.x], {
        icon: primaryIcon,
        pane: paneId,
        zIndexOffset: order * GROUP_ORDER_SCALE
      });
      primaryMarkers.set(burg.i, marker);
      primaryMeta.set(burg.i, { group: name, icon, baseSize: primaryBaseSize, attrs: primaryAttrs, isAnchor: false });
      group.addLayer(marker);

      if (!burg.port) continue;
      const anchorIcon = buildIcon(burg.i, name, "#icon-anchor", zoom * anchorBaseSize, anchorAttrs, true);
      const anchorMarker = L.marker([burg.y, burg.x], {
        icon: anchorIcon,
        pane: paneId,
        interactive: false,
        zIndexOffset: order * GROUP_ORDER_SCALE + 1
      });
      anchorMarkers.set(burg.i, anchorMarker);
      anchorMeta.set(burg.i, {
        group: name,
        icon: "#icon-anchor",
        baseSize: anchorBaseSize,
        attrs: anchorAttrs,
        isAnchor: true
      });
      group.addLayer(anchorMarker);
    }
  }
}

/** Recompute every burg/anchor icon's apparent size for the current zoom — burg icons have no
 *  per-group "rescale" toggle (unlike markers): they always scaled with zoom in the old renderer,
 *  implicitly, as part of #viewbox's own shared transform. Call on zoom end, not per frame; skips
 *  entirely when the zoom level hasn't actually changed (e.g. a pure pan) */
export function refreshSizeForZoom(): void {
  if (!layerGroup) return;
  const zoom = getLeafletMap().getZoom();
  if (zoom === lastZoomSized) return;
  lastZoomSized = zoom;

  for (const [id, marker] of primaryMarkers) {
    const meta = primaryMeta.get(id);
    if (!meta) continue;
    marker.setIcon(buildIcon(id, meta.group, meta.icon, zoom * meta.baseSize, meta.attrs, false));
  }
  for (const [id, marker] of anchorMarkers) {
    const meta = anchorMeta.get(id);
    if (!meta) continue;
    marker.setIcon(buildIcon(id, meta.group, meta.icon, zoom * meta.baseSize, meta.attrs, true));
  }
}

export function clear(): void {
  layerGroup?.clearLayers();
  primaryMarkers.clear();
  anchorMarkers.clear();
  primaryMeta.clear();
  anchorMeta.clear();
}
