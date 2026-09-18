// A persistent Leaflet vector layer for rivers — tapered ribbon polygons built from the same
// offset geometry Rivers.getRiverPath (the old SVG/Path2D renderer) uses, via the new
// Rivers.getRiverPolygonRing (see river-generator.ts). See MIGRATION.md Phase 5.
//
// Color: rivers don't have a per-river color in the data model — normally every river shares one
// color from the "rivers" layer style (styles.rivers.attrs.fill), applied today via plain SVG fill
// inheritance from the #rivers container. Leaflet always writes an explicit fill per path, so to
// keep that same inherited-color behavior each rendered path has its `fill` attribute stripped
// right back off unless basin highlighting is on — then every river is painted by its basin instead.
//
// No custom viewport culling here (unlike the old renderer's ViewportLayers/Scene): Leaflet's SVG
// renderer draws every provided feature regardless of visibility. Acceptable for now, revisit if a
// very high river count becomes a real perf issue — see MIGRATION.md.
import * as L from "leaflet";
import { getFeaturePane, getLeafletMap } from "@/components/leaflet-map";
import type { River } from "@/generators/river-generator";
import type { Point } from "@/types/global";

interface RiverFeatureProperties {
  id: number;
}

type RiverFeature = GeoJSON.Feature<GeoJSON.Polygon, RiverFeatureProperties>;

const PANE_NAME = "rivers-leaflet";
const Z_INDEX = 105;
const ID_PREFIX = "river";

let geoJsonLayer: L.GeoJSON<RiverFeatureProperties> | undefined;
let basinColors: Map<number, string> | null = null;

function buildFeature(river: River): RiverFeature | null {
  const { i, cells, widthFactor, sourceWidth } = river;
  if (!cells || cells.length < 2) return null;

  let points: Point[] | undefined = river.points;
  if (points && points.length !== cells.length) {
    ERROR &&
      console.error(`River ${i} has ${cells.length} cells, but only ${points.length} points. Resetting points data`);
    points = undefined;
  }

  const meandered = Rivers.addMeandering(cells, points);
  const ring = Rivers.getRiverPolygonRing(meandered, widthFactor, sourceWidth);
  if (ring.length < 4) return null;

  return {
    type: "Feature",
    properties: { id: i },
    geometry: { type: "Polygon", coordinates: [ring as unknown as GeoJSON.Position[]] }
  };
}

function style(feature?: GeoJSON.Feature<GeoJSON.Geometry, RiverFeatureProperties>) {
  const id = feature?.properties.id;
  const basinColor = id !== undefined ? basinColors?.get(id) : undefined;
  return {
    stroke: false,
    fillColor: basinColor ?? "#000000", // stripped right back off below when there's no basin color
    fillOpacity: 1
  };
}

/** Leaflet always writes an explicit fill; strip it back off so the pane's CSS fill (the shared
 *  river color) shows through instead, unless this river has a basin-highlight color to keep */
function fixupFill(layer: L.Path, properties: RiverFeatureProperties): void {
  const element = layer.getElement();
  if (!element) return;
  if (basinColors?.get(properties.id)) return;
  element.removeAttribute("fill");
}

function tagAndFixup(layer: L.Layer): void {
  const path = layer as L.Path & { feature: RiverFeature };
  const element = path.getElement();
  if (element) element.id = `${ID_PREFIX}${path.feature.properties.id}`;
  fixupFill(path, path.feature.properties);
}

function findLayer(riverId: number): (L.Path & { feature: RiverFeature }) | undefined {
  let found: (L.Path & { feature: RiverFeature }) | undefined;
  geoJsonLayer?.eachLayer(layer => {
    const path = layer as L.Path & { feature: RiverFeature };
    if (path.feature.properties.id === riverId) found = path;
  });
  return found;
}

export function ensurePane(): void {
  getFeaturePane(PANE_NAME, Z_INDEX);
}

/** Full rebuild from pack.rivers */
export function update(rivers: River[]): void {
  const features = rivers.map(buildFeature).filter((f): f is RiverFeature => f !== null);
  const data: GeoJSON.FeatureCollection<GeoJSON.Polygon, RiverFeatureProperties> = {
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

  geoJsonLayer.eachLayer(tagAndFixup);
}

/** Incremental: rebuild just one river, keeping every other river's layer untouched */
export function updateOne(river: River): void {
  if (!geoJsonLayer) return;
  const feature = buildFeature(river);

  const existing = findLayer(river.i);
  if (existing) geoJsonLayer.removeLayer(existing);
  if (!feature) return;

  geoJsonLayer.addData(feature);
  const added = findLayer(river.i);
  if (added) tagAndFixup(added);
}

export function clear(): void {
  geoJsonLayer?.clearLayers();
}

export function setBasinColors(colors: Map<number, string> | null): void {
  basinColors = colors;
  if (!geoJsonLayer) return;
  geoJsonLayer.setStyle(style as L.StyleFunction<RiverFeatureProperties>);
  geoJsonLayer.eachLayer(tagAndFixup);
}

/** World-space bounds of one river's rendered ribbon — see territory-layer.ts's getFeatureBounds
 *  for why this reads L.Path.getBounds() rather than the DOM element's own getBBox() */
export function getBounds(riverId: number): DOMRect | undefined {
  const layer = findLayer(riverId);
  if (!layer) return undefined;

  const bounds = (layer as unknown as L.Polygon).getBounds();
  const x0 = bounds.getWest();
  const y0 = bounds.getSouth();
  return new DOMRect(x0, y0, bounds.getEast() - x0, bounds.getNorth() - y0);
}
