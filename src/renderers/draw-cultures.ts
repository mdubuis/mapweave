import { createTerritoryLayer } from "@/renderers/leaflet/territory-layer";

const layer = createTerritoryLayer("cultures-leaflet", 102, "culture");

export function drawCultures(): void {
  TIME && console.time("drawCultures");
  const { cells, cultures } = pack;
  layer.update(
    cellId => cells.culture[cellId],
    index => cultures[index].color!
  );
  TIME && console.timeEnd("drawCultures");
}

export function eraseCultures(): void {
  layer.clear();
}

export function ensureCulturesPane(): void {
  layer.ensurePane();
}

/** World-space bounds of one culture's rendered territory — see TerritoryLayerHandle.getFeatureBounds */
export function getCultureBounds(cultureId: number): DOMRect | undefined {
  return layer.getFeatureBounds(cultureId);
}
