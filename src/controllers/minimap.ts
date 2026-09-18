// The old minimap mirrored #viewbox live via <use href="#viewbox"> — free, but only ever showed
// legacy SVG content. Once biomes/religions/cultures/provinces/states/rivers/routes/markers/burgs
// moved into separate Leaflet panes (Phase 5), that mirror silently stopped showing any of them.
// Rebuilt as its own small, independent L.Map instance instead: no panning/zooming of its own, a
// states-colored overview layer, and a rectangle tracking the main map's current view. Territory
// content is a real (if simplified) render of the current pack.states, not a DOM copy, so it needs
// its own explicit refresh — see refreshMinimapContent(). See MIGRATION.md Phase 5.
import * as L from "leaflet";
import { closeDialogs } from "@/components/dialog/dialog-helpers";
import { LinearSimpleCRS } from "@/components/leaflet-map";
import { viewport } from "@/components/viewport";
import { zoomTo } from "@/components/zoom";
import {
  buildTerritoryFeatureCollection,
  type TerritoryFeatureProperties
} from "@/renderers/leaflet/territory-geojson";
import { ensureEl, minmax } from "../utils";

let minimapMap: L.Map | undefined;
let territoryLayer: L.GeoJSON<TerritoryFeatureProperties> | undefined;
let viewportRect: L.Rectangle | undefined;

function open(): void {
  closeDialogs("#minimap, .stable");
  renderDialog();
  createMinimapMap();
  refreshMinimapContent();

  $("#minimap").dialog({
    title: "Minimap",
    resizable: false,
    width: "auto",
    position: { my: "left bottom", at: "left+10 bottom-25", of: "svg", collision: "fit" },
    open: function (this: HTMLElement) {
      $(this).parent().addClass("minimap-dialog");
    },
    close: closeMinimap
  });
}

function renderDialog(): void {
  document.getElementById("minimap")?.remove();
  const { width, height } = options.map.graph;
  const html = /* html */ `<div id="minimap" class="dialog stable">
      <div id="minimapViewportWrap">
        <div id="minimapMap" style="aspect-ratio: ${width} / ${height}"></div>
      </div>
    </div>`;
  ensureEl("dialogs").insertAdjacentHTML("beforeend", html);

  document.getElementById("minimapStyles")?.remove();
  const style = document.createElement("style");
  style.id = "minimapStyles";
  style.textContent = /* css */ `
    .minimap-dialog .ui-dialog-content {
      padding: 0 !important;
      overflow: hidden;
    }

    #minimap {
      padding: 0 !important;
      background: transparent;
    }

    #minimapViewportWrap {
      position: relative;
      width: 20em;
      border: 0;
    }

    #minimapMap {
      display: block;
      width: 100%;
      cursor: crosshair;
      background: #5b8dd9;
    }
  `;
  document.head.append(style);
}

function closeMinimap(): void {
  $("#minimap").dialog("destroy");
  ensureEl("minimap").remove();
  document.getElementById("minimapStyles")?.remove();
  minimapMap?.remove();
  minimapMap = undefined;
  territoryLayer = undefined;
  viewportRect = undefined;
}

function createMinimapMap(): void {
  minimapMap?.remove(); // the dialog's own DOM is rebuilt fresh on every open(); the map must be too

  const { width, height } = options.map.graph;
  const bounds = L.latLngBounds(L.latLng(0, 0), L.latLng(height, width));

  minimapMap = L.map(ensureEl<HTMLDivElement>("minimapMap"), {
    crs: LinearSimpleCRS,
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    touchZoom: false,
    inertia: false,
    maxBounds: bounds
  });
  minimapMap.fitBounds(bounds, { animate: false });

  territoryLayer = L.geoJSON<TerritoryFeatureProperties>(undefined, { style: territoryStyle }).addTo(minimapMap);
  viewportRect = L.rectangle(bounds, {
    color: "#624954",
    weight: 1,
    dashArray: "4",
    fillColor: "#beff89",
    fillOpacity: 0.1,
    interactive: false
  }).addTo(minimapMap);

  minimapMap.on("click", (event: L.LeafletMouseEvent) => {
    const x = minmax(event.latlng.lng, 0, width);
    const y = minmax(event.latlng.lat, 0, height);
    zoomTo(x, y, viewport.scale, 450);
  });
}

function territoryStyle(feature?: GeoJSON.Feature<GeoJSON.Geometry, TerritoryFeatureProperties>) {
  const state = feature ? pack.states[feature.properties.id] : undefined;
  return { stroke: false, fillColor: state?.color || "#5b8dd9", fillOpacity: 1 };
}

/** Re-render the overview layer from the current pack.states — cheap enough for "on open" and after
 *  an edit, but not something to call every pan/zoom frame (see updateMinimap below) */
function refreshMinimapContent(): void {
  if (!territoryLayer) return;
  territoryLayer.clearLayers();
  territoryLayer.addData(buildTerritoryFeatureCollection(cellId => pack.cells.state[cellId]));
}

/** Called on every pan/zoom frame of the *main* map (see zoom.ts) — kept cheap on purpose: only
 *  repositions the viewport rectangle, never re-renders territory (see refreshMinimapContent) */
function updateMinimap(): void {
  if (!viewportRect) return;
  const inverseScale = viewport.scale ? 1 / viewport.scale : 1;
  const { width, height } = options.map.graph;

  const left = minmax(-viewport.x * inverseScale, 0, width);
  const top = minmax(-viewport.y * inverseScale, 0, height);
  const right = minmax(left + viewport.width * inverseScale, 0, width);
  const bottom = minmax(top + viewport.height * inverseScale, 0, height);

  viewportRect.setBounds(L.latLngBounds(L.latLng(top, left), L.latLng(bottom, right)));
}

declare global {
  interface Window {
    updateMinimap: () => void;
  }
}
window.updateMinimap = updateMinimap;

export const Minimap = { open };
