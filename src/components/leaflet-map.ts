// The Leaflet map instance: owns pan/zoom gestures. Coordinates are plain Cartesian pixels
// (pack.cells.p / grid.points), never geographic — see MIGRATION.md's SRID 0 / L.CRS.Simple decision.
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";
import { getPrimaryMountRoot } from "@/services/shadow-dom-bridge";

/**
 * The zoom range here is a linear scale factor (matches the app's existing [1, 20] `viewport.scale`),
 * not Leaflet's default power-of-two tile zoom. Overriding `scale`/`zoom` on CRS.Simple keeps
 * `map.getZoom()` numerically equal to that scale factor everywhere else in the app reads it.
 *
 * `transformation` also has to be overridden, not just inherited from CRS.Simple: its default
 * (`new L.Transformation(1, 0, -1, 0)`) flips the y axis, because CRS.Simple assumes a "y increases
 * upward" convention. This app's world data (pack.cells.p / grid.points, and #viewbox's own manual
 * translate/scale transform for the still-legacy layers) uses the opposite, ordinary screen/SVG
 * convention — y increases downward. Left at the default, every Leaflet-rendered layer (GeoJSON
 * paths, L.marker positions) renders vertically mirrored relative to #viewbox's legacy content and
 * to the actual pack coordinates — confirmed empirically, not theoretical; see leaflet-map.test.ts.
 * `(1, 0, 1, 0)` is a true identity transform (x=lng, y=lat, no flip), matching the y-down convention
 * everywhere else in the app already assumes.
 */
export const LinearSimpleCRS = L.extend({}, L.CRS.Simple, {
  scale: (zoom: number) => zoom,
  zoom: (scale: number) => scale,
  transformation: new L.Transformation(1, 0, 1, 0)
});

let map: L.Map | undefined;
const featurePanes = new Map<string, HTMLElement>();

/** The single Leaflet map instance, created on first use */
export function getLeafletMap(): L.Map {
  if (map) return map;

  map = L.map(ensureContainer(), {
    crs: LinearSimpleCRS,
    zoomSnap: 0,
    zoomDelta: 1,
    inertia: false, // matches d3-zoom's default: no inertial coasting after a drag
    attributionControl: false,
    zoomControl: false,
    minZoom: 1,
    maxZoom: 20
  });

  // Leaflet's vector layers silently render nothing (no error) until the map has an established
  // view (map._loaded) — a real risk here, since a "leaflet"-parented layer's first draw() can run
  // before components/zoom.ts ever calls setView/flyTo. This placeholder view unblocks rendering
  // immediately; the real initial view the app fits to replaces it moments later, same as always
  map.setView(L.latLng(0, 0), map.getMinZoom(), { animate: false });

  mountLegacySvg(map);
  return map;
}

export function isLeafletMapReady(): boolean {
  return map !== undefined;
}

/**
 * A named pane for a real (GeoJSON-backed) vector layer, created once and reused. A standard
 * `map.createPane` call — a child of Leaflet's own zoom-animated map pane — so `L.geoJSON`'s SVG
 * renderer gets fully native pan/zoom handling.
 *
 * The legacy SVG pane (below) was appended to the map container *after* Leaflet's own map pane, so
 * it paints on top of every pane created here regardless of `zIndex` — `zIndex` only orders panes
 * created here *relative to each other*. A deliberate, documented compromise (MIGRATION.md Phase 5):
 * converted layers render as one block below the legacy SVG content, not interleaved with it.
 */
export function getFeaturePane(name: string, zIndex: number): HTMLElement {
  const map = getLeafletMap();
  let pane = featurePanes.get(name);
  if (!pane) {
    pane = map.createPane(name);
    pane.id = name;
    pane.style.zIndex = String(zIndex);
    featurePanes.set(name, pane);
  }
  return pane;
}

const featureLayerGroups = new Map<string, L.LayerGroup>();

/** A persistent `L.layerGroup` attached to a named feature pane, created once and reused — the
 *  bootstrap every point-icon layer (marker-layer.ts, burg-icon-layer.ts) needs, factored out so
 *  it isn't duplicated verbatim in each one */
export function getFeatureLayerGroup(name: string, zIndex: number): L.LayerGroup {
  let group = featureLayerGroups.get(name);
  if (!group) {
    const pane = getFeaturePane(name, zIndex);
    group = L.layerGroup([], { pane: pane.id }).addTo(getLeafletMap());
    featureLayerGroups.set(name, group);
  }
  return group;
}

function ensureContainer(): HTMLDivElement {
  let container = document.getElementById("leaflet-root") as HTMLDivElement | null;
  if (!container) {
    container = document.createElement("div");
    container.id = "leaflet-root";
    // getPrimaryMountRoot() is document.body unless the map engine is hosted inside a shadow root
    // (see shadow-dom-bridge.ts) — a direct document.body write, unlike a lookup, isn't covered by
    // that module's monkeypatch, so this needs to ask explicitly instead of assuming document.body.
    getPrimaryMountRoot().prepend(container);
  }
  return container;
}

/** Hosts the existing hand-drawn #map SVG in a pane that is a plain sibling of Leaflet's own map
 *  pane (not a child of it), so it gets none of Leaflet's automatic pane transform —
 *  components/zoom.ts keeps driving its translate/scale itself, exactly as it drove the old
 *  d3-zoom transform. Because it is appended after Leaflet's map pane, it paints on top of it. */
function mountLegacySvg(map: L.Map): void {
  const legacyPane = map.createPane("legacySvg", map.getContainer());
  legacyPane.id = "legacyPane";

  const svg = document.getElementById("map");
  if (svg) legacyPane.appendChild(svg);
}
