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
