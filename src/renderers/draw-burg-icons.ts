import * as burgIconLayer from "@/renderers/leaflet/burg-icon-layer";

export function drawBurgIcons(): void {
  TIME && console.time("drawBurgIcons");
  burgIconLayer.update(pack.burgs);
  TIME && console.timeEnd("drawBurgIcons");
}

export function eraseBurgIcons(): void {
  burgIconLayer.clear();
}

export function ensureBurgIconsPane(): void {
  burgIconLayer.ensurePane();
}

/** Recompute burg/anchor icon sizes for the current zoom — call once a zoom gesture settles */
export function refreshBurgIconsZoomSize(): void {
  burgIconLayer.refreshSizeForZoom();
}
