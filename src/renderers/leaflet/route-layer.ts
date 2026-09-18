// A persistent Leaflet vector layer for routes (roads/trails/searoutes, plus any user-created
// groups from route-groups-editor.ts) — every route is a line, styled per its own group from
// styles.routes.groups[group].attrs, not a single shared style like rivers. See MIGRATION.md Phase 5.
//
// Curve smoothing: the old renderer (Routes.getPath) drew a Catmull-Rom curve through each route's
// points (a different alpha per group) — GeoJSON has no curves, so this connects the same points
// with straight segments instead. Routes.getPath itself is untouched: Routes.getLength() still uses
// it, but measures off an unattached, throwaway <path> element, independent of live rendering.
//
// No custom viewport culling — see river-layer.ts for the same reasoning (this app's other
// converted line/polygon layers).
import * as L from "leaflet";
import { getFeaturePane, getLeafletMap } from "@/components/leaflet-map";
import type { Route } from "@/generators/routes-generator";

interface RouteFeatureProperties {
  id: number;
  group: string;
}

type RouteFeature = GeoJSON.Feature<GeoJSON.LineString, RouteFeatureProperties>;

const PANE_NAME = "routes-leaflet";
const Z_INDEX = 106;
const ID_PREFIX = "route";
/** sentinel id for the temporary preview shown while drawing a new route in route-creator.ts —
 *  matches the old renderer's TEMP_ID convention (never a real route.i, which starts at 1) */
const TEMP_ID = -1;

let geoJsonLayer: L.GeoJSON<RouteFeatureProperties> | undefined;

function buildFeature(route: { i: number; group: string; points: number[][] }): RouteFeature | null {
  const { i, group, points } = route;
  if (!points || points.length < 2) return null;

  return {
    type: "Feature",
    properties: { id: i, group },
    geometry: { type: "LineString", coordinates: points.map(([x, y]) => [x, y]) }
  };
}

function style(feature?: GeoJSON.Feature<GeoJSON.Geometry, RouteFeatureProperties>): L.PathOptions {
  const group = feature?.properties.group ?? "roads";
  const attrs = styles.routes.groups[group]?.attrs;
  return {
    fill: false,
    color: attrs?.stroke ?? "#000000",
    weight: attrs?.["stroke-width"] ?? 1,
    dashArray: attrs?.["stroke-dasharray"] ?? undefined,
    lineCap: attrs?.["stroke-linecap"] as L.LineCapShape | undefined,
    opacity: attrs?.opacity ?? 1
  };
}

function tagElement(layer: L.Layer): void {
  const path = layer as L.Path & { feature: RouteFeature };
  const element = path.getElement();
  if (element) element.id = `${ID_PREFIX}${path.feature.properties.id}`;
}

function findLayer(routeId: number): (L.Path & { feature: RouteFeature }) | undefined {
  let found: (L.Path & { feature: RouteFeature }) | undefined;
  geoJsonLayer?.eachLayer(layer => {
    const path = layer as L.Path & { feature: RouteFeature };
    if (path.feature.properties.id === routeId) found = path;
  });
  return found;
}

export function ensurePane(): void {
  getFeaturePane(PANE_NAME, Z_INDEX);
}

/** Full rebuild from pack.routes */
export function update(routes: Route[]): void {
  const features = routes.map(buildFeature).filter((f): f is RouteFeature => f !== null);
  const data: GeoJSON.FeatureCollection<GeoJSON.LineString, RouteFeatureProperties> = {
    type: "FeatureCollection",
    features
  };

  if (!geoJsonLayer) {
    const pane = getFeaturePane(PANE_NAME, Z_INDEX);
    geoJsonLayer = L.geoJSON(data, { pane: pane.id, style }).addTo(getLeafletMap());
  } else {
    geoJsonLayer.clearLayers();
    geoJsonLayer.addData(data);
  }

  geoJsonLayer.eachLayer(tagElement);
}

/** Incremental: rebuild just one route (or the temp preview, id=TEMP_ID), keeping every other
 *  route's layer untouched. When the route already has a rendered shape, it is updated in place
 *  (setLatLngs for geometry, setStyle for its — possibly new — group's color/width) rather than
 *  removed and re-added: route-editor.ts binds a click handler directly to the rendered element
 *  while dragging a control point or changing its group, and that binding would silently go stale
 *  on a fresh element */
function updateOne(routeLike: { i: number; group: string; points: number[][] }): void {
  if (!geoJsonLayer) return;
  const feature = buildFeature(routeLike);
  const existing = findLayer(routeLike.i);

  if (existing && feature) {
    const coords = feature.geometry.coordinates as unknown as [number, number][];
    (existing as unknown as L.Polyline).setLatLngs(coords.map(([x, y]) => [y, x]));
    existing.feature = feature; // group may have changed
    existing.setStyle(style(feature));
    return;
  }

  if (existing) geoJsonLayer.removeLayer(existing);
  if (!feature) return;

  geoJsonLayer.addData(feature);
  const added = findLayer(routeLike.i);
  if (added) tagElement(added);
}

export function redrawRoute(route: Route): void {
  updateOne(route);
}

export function setTempRoute(route: { group: string; points: number[][] } | null): void {
  updateOne(route ? { ...route, i: TEMP_ID } : { i: TEMP_ID, group: "roads", points: [] });
}

export function clear(): void {
  geoJsonLayer?.clearLayers();
}

/** World-space bounds of one route's rendered line — see territory-layer.ts's getFeatureBounds
 *  for why this reads L.Path.getBounds() rather than the DOM element's own getBBox() */
export function getBounds(routeId: number): DOMRect | undefined {
  const layer = findLayer(routeId);
  if (!layer) return undefined;

  const bounds = (layer as unknown as L.Polyline).getBounds();
  const x0 = bounds.getWest();
  const y0 = bounds.getSouth();
  return new DOMRect(x0, y0, bounds.getEast() - x0, bounds.getNorth() - y0);
}
