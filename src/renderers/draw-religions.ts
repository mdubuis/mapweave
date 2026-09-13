import { createTerritoryLayer } from "@/renderers/leaflet/territory-layer";

const layer = createTerritoryLayer("religions-leaflet", 101, "religion");

export function drawReligions(): void {
  TIME && console.time("drawReligions");
  const { cells, religions } = pack;
  layer.update(
    cellId => cells.religion[cellId],
    index => religions[index].color!
  );
  TIME && console.timeEnd("drawReligions");
}

export function eraseReligions(): void {
  layer.clear();
}

export function ensureReligionsPane(): void {
  layer.ensurePane();
}

/** World-space bounds of one religion's rendered territory — see TerritoryLayerHandle.getFeatureBounds */
export function getReligionBounds(religionId: number): DOMRect | undefined {
  return layer.getFeatureBounds(religionId);
}
