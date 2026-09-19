// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from "vitest";
import { getLeafletMap } from "@/components/leaflet-map";
import type { Marker } from "@/generators/markers-generator";

import { drawMarkers, eraseMarkers, refreshMarkersZoomSize, setEditedMarker, setMarkersFilter } from "./draw-markers";

function marker(i: number, x = 50, y = 50, overrides: Partial<Marker> = {}): Marker {
  return { i, x, y, icon: "🌋", type: "volcano", name: "Volcano", cell: 0, ...overrides };
}

beforeEach(() => {
  // deliberately not resetting the DOM: the Leaflet map/pane is a module-level singleton (see
  // leaflet-map.ts) that persists across tests in this file — drawMarkers()'s own full rebuild is
  // what each test relies on, not a clean slate
  globalThis.pack = { markers: [marker(1), marker(2, 500)] } as never;
  globalThis.styles = { markers: { options: { rescale: 1 } } } as never;
  setMarkersFilter(null);
  setEditedMarker(null);
});

afterEach(() => {
  getLeafletMap().setZoom(getLeafletMap().getMinZoom(), { animate: false });
});

test("draws every visible marker, tagged with its id", () => {
  drawMarkers();
  expect(document.getElementById("marker1")).not.toBeNull();
  expect(document.getElementById("marker2")).not.toBeNull();
});

test("hidden markers are not rendered", () => {
  pack.markers = [marker(1), marker(2, 500, 50, { hidden: true })];
  drawMarkers();
  expect(document.getElementById("marker1")).not.toBeNull();
  expect(document.getElementById("marker2")).toBeNull();
});

test("when any marker is pinned, only pinned markers render", () => {
  pack.markers = [marker(1), marker(2, 500, 50, { pinned: true })];
  drawMarkers();
  expect(document.getElementById("marker1")).toBeNull();
  expect(document.getElementById("marker2")).not.toBeNull();
});

test("setMarkersFilter restricts rendering to the given ids", () => {
  setMarkersFilter([1]);
  drawMarkers();
  expect(document.getElementById("marker1")).not.toBeNull();
  expect(document.getElementById("marker2")).toBeNull();

  setMarkersFilter(null);
  drawMarkers();
  expect(document.getElementById("marker2")).not.toBeNull();
});

test("a full redraw drops markers that no longer exist", () => {
  drawMarkers();
  pack.markers = [pack.markers[0]];
  drawMarkers();
  expect(document.getElementById("marker1")).not.toBeNull();
  expect(document.getElementById("marker2")).toBeNull();
});

test("erasing the layer removes every marker", () => {
  drawMarkers();
  eraseMarkers();
  expect(document.getElementById("marker1")).toBeNull();

  drawMarkers();
  expect(document.getElementById("marker1")).not.toBeNull();
});

test("the edited marker renders even when filtered out, and stops rendering once editing ends", () => {
  setMarkersFilter([1]);
  setEditedMarker(pack.markers[1]);
  expect(document.getElementById("marker2")).not.toBeNull();
  expect(document.getElementById("marker2")?.closest(".leaflet-marker-draggable")).not.toBeNull();

  setEditedMarker(null);
  expect(document.getElementById("marker2")).toBeNull();
});

test("marker icon size grows with zoom, more so with rescale off", () => {
  getLeafletMap().setZoom(4, { animate: false });
  drawMarkers();
  // size 30, rescale on: zoom*size/5 + 24, at zoom 4 = 24 + 24 = 48
  expect(document.getElementById("marker1")?.getAttribute("width")).toBe("48");

  styles.markers.options.rescale = 0;
  pack.markers[0].size = 60;
  drawMarkers();
  // rescale off: plain zoom*size, at zoom 4 = 240 — unbounded, unlike rescale on's floor+gentle slope
  expect(document.getElementById("marker1")?.getAttribute("width")).toBe("240");
});

test("a marker's world-space top-left corner is encoded on its rendered element", () => {
  drawMarkers();
  const el = document.getElementById("marker1")!;
  expect(el.getAttribute("x")).toBe("35"); // 50 - 30/2
  expect(el.getAttribute("y")).toBe("20"); // 50 - 30
});

test("refreshMarkersZoomSize updates icon size for the current zoom without a full redraw", () => {
  drawMarkers();
  expect(document.getElementById("marker1")?.getAttribute("width")).toBe("30");

  getLeafletMap().setZoom(4, { animate: false });
  refreshMarkersZoomSize();
  expect(document.getElementById("marker1")?.getAttribute("width")).toBe("48");
});

test("refreshMarkersZoomSize skips the rebuild when the zoom level hasn't actually changed", () => {
  drawMarkers();
  getLeafletMap().setZoom(4, { animate: false });
  refreshMarkersZoomSize(); // syncs its internal "last zoom sized" tracker to 4, whatever it was before
  const settled = document.getElementById("marker1");
  expect(settled).not.toBeNull();

  refreshMarkersZoomSize(); // zoom unchanged since the call above — no-op
  expect(document.getElementById("marker1")).toBe(settled);
});
