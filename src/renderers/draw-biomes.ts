import { createTerritoryLayer } from "@/renderers/leaflet/territory-layer";

const layer = createTerritoryLayer("biomes-leaflet", 100, "biome");

export function drawBiomes(): void {
  TIME && console.time("drawBiomes");
  layer.update(
    cellId => pack.cells.biome[cellId],
    index => pack.biomes[index].color
  );
  TIME && console.timeEnd("drawBiomes");
}

export function eraseBiomes(): void {
  layer.clear();
}

export function ensureBiomesPane(): void {
  layer.ensurePane();
}
