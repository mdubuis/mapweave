// The Leaflet map instance: owns pan/zoom gestures. Coordinates are plain Cartesian pixels
// (pack.cells.p / grid.points), never geographic — see MIGRATION.md's SRID 0 / L.CRS.Simple decision.
import * as L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * The zoom range here is a linear scale factor (matches the app's existing [1, 20] `viewport.scale`),
 * not Leaflet's default power-of-two tile zoom. Overriding `scale`/`zoom` on CRS.Simple keeps
 * `map.getZoom()` numerically equal to that scale factor everywhere else in the app reads it.
 */
const LinearSimpleCRS = L.extend({}, L.CRS.Simple, {
  scale: (zoom: number) => zoom,
  zoom: (scale: number) => scale
});

let map: L.Map | undefined;

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

  mountLegacySvg(map);
  return map;
}

export function isLeafletMapReady(): boolean {
  return map !== undefined;
}

function ensureContainer(): HTMLDivElement {
  let container = document.getElementById("leaflet-root") as HTMLDivElement | null;
  if (!container) {
    container = document.createElement("div");
    container.id = "leaflet-root";
    document.body.prepend(container);
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
