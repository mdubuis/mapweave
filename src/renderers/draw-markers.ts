import type { Marker } from "@/generators/markers-generator";
import * as markerLayer from "@/renderers/leaflet/marker-layer";

export function drawMarkers(): void {
  TIME && console.time("drawMarkers");
  markerLayer.update(pack.markers);
  TIME && console.timeEnd("drawMarkers");
}

export function eraseMarkers(): void {
  markerLayer.clear();
}

export function ensureMarkersPane(): void {
  markerLayer.ensurePane();
}

export const setMarkersFilter = (ids: number[] | null): void => {
  markerLayer.setMarkersFilter(ids);
};

/** The edited marker renders draggable; onDragEnd (world-space x, y) fires once a drag completes */
export function setEditedMarker(marker: Marker | null, onDragEnd?: (x: number, y: number) => void): void {
  markerLayer.setEditedMarker(marker ? marker.i : null, onDragEnd);
  drawMarkers();
}

/** Recompute rescale-enabled marker icon sizes for the current zoom — call once a zoom gesture settles */
export function refreshMarkersZoomSize(): void {
  markerLayer.refreshSizeForZoom();
}
