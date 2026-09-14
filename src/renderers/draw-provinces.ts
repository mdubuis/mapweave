import { createTerritoryLayer } from "@/renderers/leaflet/territory-layer";

const layer = createTerritoryLayer("provinces-leaflet", 103, "province");

export function drawProvinces(): void {
  TIME && console.time("drawProvinces");
  const { cells, provinces } = pack;
  layer.update(
    cellId => cells.province[cellId],
    index => provinces[index].color!
  );
  TIME && console.timeEnd("drawProvinces");
}

export function eraseProvinces(): void {
  layer.clear();
}

export function ensureProvincesPane(): void {
  layer.ensurePane();
}

/** World-space bounds of one province's rendered territory — see TerritoryLayerHandle.getFeatureBounds */
export function getProvinceBounds(provinceId: number): DOMRect | undefined {
  return layer.getFeatureBounds(provinceId);
}

/** World-space SVG path `d` for one province's rendered territory — see TerritoryLayerHandle.getFeaturePath */
export function getProvincePath(provinceId: number): string | undefined {
  return layer.getFeaturePath(provinceId);
}
