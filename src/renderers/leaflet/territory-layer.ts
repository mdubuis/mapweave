// A persistent Leaflet vector layer for one territory-fill map layer — created once, refreshed in
// place on every redraw. See MIGRATION.md Phase 5.
import * as L from "leaflet";
import { getFeaturePane, getLeafletMap } from "@/components/leaflet-map";
import { buildTerritoryFeatureCollection, type TerritoryFeatureProperties } from "./territory-geojson";

type Feature = GeoJSON.Feature<GeoJSON.MultiPolygon, TerritoryFeatureProperties>;

export interface TerritoryLayerHandle {
  /** Recompute geometry from the current pack and restyle every feature */
  update(getType: (cellId: number) => number | null, getColor: (id: number) => string): void;
  /** Remove all features, keeping the underlying layer (and its pane) attached to the map */
  clear(): void;
  /**
   * Create the pane (idempotent) without touching any geometry — LayersRegistry.init() calls this
   * for every "leaflet"-parented layer, at app boot, so `Layer.getEl()` has something to find the
   * first time this layer is shown/hidden, even before `update()` has ever drawn anything into it
   */
  ensurePane(): void;
}

/**
 * @param paneName Leaflet pane id, also usable as a `document.getElementById` target
 * @param zIndex stacking order relative to the other territory layers (see getFeaturePane)
 * @param idPrefix each rendered `<path>` gets `id="{idPrefix}{featureId}"` — old editor code that
 *   looked up a specific territory's SVG element by id (hover-highlight, live recolor) can still
 *   find it, as long as it targets it as a *descendant* of `#{paneName}` rather than a direct child
 */
export function createTerritoryLayer(paneName: string, zIndex: number, idPrefix: string): TerritoryLayerHandle {
  // deferred to first use, not created here: this runs at module load (draw-*.ts declares its
  // layer at the top level), well before the Leaflet map — or in a unit test, a DOM at all — exists
  let getColor: (id: number) => string = () => "none";
  let geoJsonLayer: L.GeoJSON<TerritoryFeatureProperties> | undefined;

  const style = (feature?: GeoJSON.Feature<GeoJSON.Geometry, TerritoryFeatureProperties>) => ({
    stroke: false,
    fillColor: feature ? getColor(feature.properties.id) : "none",
    fillOpacity: 1
  });

  const tagElementIds = () => {
    geoJsonLayer?.eachLayer(layer => {
      const feature = (layer as L.Path & { feature: Feature }).feature;
      const element = (layer as L.Path).getElement();
      if (element) element.id = `${idPrefix}${feature.properties.id}`;
    });
  };

  return {
    update(getTypeArg, getColorArg) {
      getColor = getColorArg;
      const data = buildTerritoryFeatureCollection(getTypeArg);

      if (!geoJsonLayer) {
        const pane = getFeaturePane(paneName, zIndex);
        geoJsonLayer = L.geoJSON(data, { pane: pane.id, style }).addTo(getLeafletMap());
      } else {
        geoJsonLayer.clearLayers();
        geoJsonLayer.addData(data);
      }

      tagElementIds();
    },
    clear() {
      geoJsonLayer?.clearLayers();
    },
    ensurePane() {
      getFeaturePane(paneName, zIndex);
    }
  };
}
