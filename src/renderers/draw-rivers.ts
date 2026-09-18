import type { River } from "@/generators/river-generator";
import * as riverLayer from "@/renderers/leaflet/river-layer";

let basinHighlightOn = false;

export function drawRivers(): void {
  TIME && console.time("drawRivers");
  riverLayer.update(pack.rivers);
  TIME && console.timeEnd("drawRivers");
}

export function eraseRivers(): void {
  riverLayer.clear();
}

export function ensureRiversPane(): void {
  riverLayer.ensurePane();
}

/** Re-render a single edited river, keeping its neighbors' layers untouched */
export function redrawRiver(river: River): void {
  riverLayer.updateOne(river);
}

/** No-op now that rivers aren't viewport-culled — kept so callers (river-editor.ts) don't need to
 *  change; every river always renders regardless of the current view */
export function setEditedRiver(_riverId: number | null): void {}

/** Bounding box of the rendered river, in world-space coordinates */
export function getRiverBox(riverId: number): DOMRect | null {
  return riverLayer.getBounds(riverId) ?? null;
}

export function toggleBasinHighlight(): boolean {
  basinHighlightOn = !basinHighlightOn;
  riverLayer.setBasinColors(basinHighlightOn ? getBasinColors() : null);
  return basinHighlightOn;
}

const BASIN_COLORS = [
  "#1f77b4",
  "#ff7f0e",
  "#2ca02c",
  "#d62728",
  "#9467bd",
  "#8c564b",
  "#e377c2",
  "#7f7f7f",
  "#bcbd22",
  "#17becf"
];

function getBasinColors(): Map<number, string> {
  const basins = [...new Set(pack.rivers.map(river => river.basin))];
  const colorByBasin = new Map(basins.map((basin, index) => [basin, BASIN_COLORS[index % BASIN_COLORS.length]]));
  return new Map(pack.rivers.map(river => [river.i, colorByBasin.get(river.basin)!]));
}
