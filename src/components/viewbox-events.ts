// Default interaction on the map canvas: pan/zoom, click-to-edit and hover tooltips
import { drag, select } from "d3";
import { getLeafletMap } from "@/components/leaflet-map";
import { Controllers } from "@/controllers";
import type { LabelType } from "@/generators/labels-generator";
import { dragLegendBox } from "@/renderers/draw-legend";
import { debounce } from "@/utils/commonUtils";
import { handleMouseMove } from "./map-tooltip";
import { applyZoomBehavior } from "./zoom";

const onMouseMove = debounce(handleMouseMove, 100);

/**
 * The click listener lives on the Leaflet map container rather than `#viewbox`: it's the one
 * shared ancestor of both the legacy `<svg id="map">` tree (hosted in its own `legacySvg` pane,
 * see leaflet-map.ts) and the panes the Leaflet-converted layers render into. A click on a
 * converted-layer feature never bubbles through `#viewbox` at all — different subtree entirely —
 * so binding there would silently miss it.
 *
 * map-placement.ts's click-to-place tools stay bound to `#viewbox` itself instead (their world-
 * coordinate math needs its SVG CTM) — since that's a *different* node than this one, the two
 * listeners no longer replace each other the way same-node d3 `.on()` calls used to. Each side is
 * responsible for clearing the other's leftover listener on its own node when it takes over: see
 * `map-placement.ts`'s `toggleMapPlacement()` (clears this listener) and `#viewbox`'s own
 * `.on("click", null)` below (clears any leftover placement listener once a tool stops).
 */
export function clickSurface() {
  return select(getLeafletMap().getContainer());
}

export function applyDefaultViewboxEvents(): void {
  applyZoomBehavior();

  select<SVGGElement, unknown>("#viewbox")
    .style("cursor", "default")
    .on(".drag", null)
    .on("click", null) // clears a leftover map-placement.ts click listener, if a tool was active
    .on("touchmove mousemove", onMouseMove);
  clickSurface().on("click", onClick);

  select<SVGGElement, unknown>("#legend").call(drag<SVGGElement, unknown>().on("start", dragLegendBox));
}

// map group id -> editor to open. The click target is resolved by walking up its ancestors
type Opener = (target: SVGElement, parent: SVGElement) => void;

const PARENT_EDITORS: Record<string, Opener> = {
  rivers: target => Controllers.RiverEditor.open(target.id),
  ice: target => Controllers.IceEditor.open(target),
  terrain: target => Controllers.ReliefEditor.open(target),
  goodsCells: () => Controllers.GoodsEditor.open()
};

const GRAND_EDITORS: Record<string, Opener> = {
  emblems: target => Controllers.EmblemsEditor.open(undefined, undefined, undefined, target),
  routes: target => Controllers.RouteEditor.open(target.id),
  burgIcons: target => Controllers.BurgEditor.open(Number(target.dataset.id)),
  journeys: (_target, parent) => Controllers.JourneyEditor.open(Number(parent.id.replace("journey", ""))),
  markers: target => Controllers.MarkersEditor.open(undefined, target),
  ruler: () => Controllers.MeasurersEditor.open(),
  goodsIcons: () => Controllers.GoodsEditor.open(),
  goodsBurgs: (_target, parent) => Controllers.ProductionOverview.open(Number(parent.dataset.id)),
  coastline: target => Controllers.CoastlineVertexEditor.open(target),
  lakes: target => Controllers.LakesEditor.open(target),
  markets: (target, parent) => {
    if (target.tagName !== "path") Controllers.MarketOverview.open(Number(parent.dataset.id));
  }
};

const GREAT_EDITORS: Record<string, Opener> = {
  markers: target => Controllers.MarkersEditor.open(undefined, target),
  ruler: () => Controllers.MeasurersEditor.open(),
  armies: (_target, parent) => Controllers.RegimentEditor.open(`#${parent.id}`)
};

// Leaflet-converted layer -> resolve its click directly by the pane it rendered into, rather than
// by a fixed DOM ancestor depth (meaningless for Leaflet's own pane/divIcon structure). Panes not
// listed here (the five territory fills: biomes/religions/cultures/provinces/states) have nothing
// wired to their clicks either, same as before this layer's conversion.
const PANE_EDITORS: Record<string, (target: Element) => void> = {
  "rivers-leaflet": target => {
    const path = target.closest<SVGPathElement>("path[id]");
    if (path) Controllers.RiverEditor.open(path.id);
  },
  "routes-leaflet": target => {
    const path = target.closest<SVGPathElement>("path[id]");
    if (path) Controllers.RouteEditor.open(path.id);
  },
  "markers-leaflet": target => {
    const svg = target.closest<SVGSVGElement>("svg[id^='marker']");
    if (svg) Controllers.MarkersEditor.open(Number(svg.id.slice(6)));
  },
  "burg-icons-leaflet": target => {
    const svg = target.closest<SVGSVGElement>("svg[data-id]");
    if (svg) Controllers.BurgEditor.open(Number(svg.dataset.id));
  }
};

/** Handle a click on the map: open the editor for the clicked element */
function onClick(event: MouseEvent): void {
  const target = event?.target as Element | null;
  if (!target) return;

  const pane = target.closest<HTMLElement>(".leaflet-pane");
  if (pane && pane.id !== "legacyPane") {
    PANE_EDITORS[pane.id]?.(target);
    return;
  }

  onLegacyClick(target as SVGElement);
}

function onLegacyClick(target: SVGElement): void {
  const parent = target?.parentElement as SVGElement | null;
  const grand = parent?.parentElement as SVGElement | null;
  const great = grand?.parentElement as SVGElement | null;
  const ancestor = great?.parentElement as SVGElement | null;
  if (!target || !parent || !grand || !great || !ancestor) return;

  const label = target.closest<SVGTextElement>("#labels text[data-label-type]");
  if (label) {
    const id = Number(label.dataset.id);
    const type = label.dataset.labelType as LabelType;
    if (type === "burg") {
      const burgEditor = document.getElementById("burgEditor");
      const isBurgEditorOpen = burgEditor?.dataset.burgId === String(id);
      if (isBurgEditorOpen) Controllers.LabelsEditor.open(type, id);
      else Controllers.BurgEditor.open(id);
    } else Controllers.LabelsEditor.open(type, id);
    return;
  }

  const open = PARENT_EDITORS[parent.id] || GRAND_EDITORS[grand.id] || GREAT_EDITORS[great.id];
  open?.(target, parent);
}
