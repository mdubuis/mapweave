// Converts a territory classifier (biome/state/province/culture/religion id per cell) into GeoJSON,
// reusing the same ring-tracing getIsolines() already does for the SVG renderers — see MIGRATION.md
// Phase 5. Coordinates are raw pack pixels (SRID 0 / L.CRS.Simple), never geographic.
//
// Known compromise vs. the SVG renderers this replaces: the "water gap" partial border (stroked only
// where a territory touches land, via isLandVertex in pathUtils.ts) has no Leaflet equivalent here —
// converted layers get no border at all, matching the fill-only look at the default zoom.
import { getIsolines } from "@/utils";

export interface TerritoryFeatureProperties {
  id: number;
}

export type TerritoryFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.MultiPolygon, TerritoryFeatureProperties>;

export function buildTerritoryFeatureCollection(
  getType: (cellId: number) => number | null
): TerritoryFeatureCollection {
  const isolines = getIsolines(pack, getType, { polygons: true });

  const features: GeoJSON.Feature<GeoJSON.MultiPolygon, TerritoryFeatureProperties>[] = [];
  for (const [id, isoline] of Object.entries(isolines)) {
    if (!isoline.polygons?.length) continue;
    features.push({
      type: "Feature",
      properties: { id: Number(id) },
      geometry: {
        type: "MultiPolygon",
        coordinates: isoline.polygons.map(ring => [ring as unknown as GeoJSON.Position[]])
      }
    });
  }

  return { type: "FeatureCollection", features };
}
