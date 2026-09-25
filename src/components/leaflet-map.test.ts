// @vitest-environment jsdom

import * as L from "leaflet";
import { expect, test } from "vitest";
import { getLeafletMap } from "./leaflet-map";

// Regression test for a severe bug found and fixed after this whole migration had already shipped:
// CRS.Simple's default transformation flips the y axis (it assumes "y increases upward"), but this
// app's world data (pack.cells.p / grid.points) and #viewbox's own manual translate/scale transform
// for the still-legacy layers both use the opposite, ordinary y-down convention. Left unfixed, every
// Leaflet-rendered layer (GeoJSON paths, L.marker positions) rendered vertically mirrored relative
// to the legacy content sharing the same screen — see MIGRATION.md.
test("world y increases in the same screen direction Leaflet and #viewbox agree on (no CRS y-flip)", () => {
  globalThis.options = { map: { graph: { width: 1000, height: 600 } } } as never;
  const map = getLeafletMap();
  map.setView(L.latLng(0, 0), map.getMinZoom(), { animate: false });

  const top = map.latLngToContainerPoint(L.latLng(0, 0)); // world (x=0, y=0)
  const bottom = map.latLngToContainerPoint(L.latLng(100, 0)); // world (x=0, y=100) — further "down"

  // increasing world-y must move the screen point down (larger container-y), matching #viewbox's own
  // untouched translate(origin.x + k*x, origin.y + k*y) math for the legacy layers
  expect(bottom.y).toBeGreaterThan(top.y);
  // a pure y-axis fix shouldn't touch x
  expect(bottom.x).toBe(top.x);
});

test("Leaflet's own rendering agrees exactly with #viewbox's manual translate/scale for arbitrary points", () => {
  globalThis.options = { map: { graph: { width: 1000, height: 600 } } } as never;
  const map = getLeafletMap();

  const min = map.getMinZoom();
  const center = map.unproject(L.point(500, 300), min);
  map.setView(center, min, { animate: false });

  // mirrors zoom.ts's currentTransform(): the single reference point #viewbox's own transform is
  // built from (translate(origin.x origin.y) scale(k))
  const origin = map.latLngToContainerPoint(L.latLng(0, 0));
  const k = map.getZoom();

  for (const [x, y] of [
    [200, 100],
    [200, 500],
    [800, 500]
  ]) {
    const viewboxStyle = { x: origin.x + k * x, y: origin.y + k * y };
    const leafletStyle = map.latLngToContainerPoint(L.latLng(y, x));
    expect(leafletStyle.x).toBeCloseTo(viewboxStyle.x, 5);
    expect(leafletStyle.y).toBeCloseTo(viewboxStyle.y, 5);
  }
});

// Regression test for a severe bug found after this whole migration had already shipped: every
// burg icon and map marker was 100% invisible and unclickable, everywhere, always. Root cause:
// legacyPane and .leaflet-map-pane are siblings that both default to z-index 400 (Leaflet's own
// base `.leaflet-pane` CSS rule) — tied z-index falls back to DOM order, and legacyPane is
// appended after Leaflet's own map pane, so it (including #ocean's own opaque base rect) painted
// on top of every layer nested inside .leaflet-map-pane, no matter what z-index those layers set
// on themselves (states/biomes/rivers/routes/burg-icons/markers, z-index 100-108) — a descendant
// can never outrank its own ancestor's stacking context. Confirmed with a real browser via
// elementFromPoint() at a burg icon's own computed position: it returned #oceanPattern's <rect>,
// not the icon, even though the icon's own position/size were always correct.
test("the legacy SVG pane paints below Leaflet's own map pane, not above it", () => {
  const map = getLeafletMap();
  const legacyPane = document.getElementById("legacyPane");
  expect(legacyPane).not.toBeNull();
  // .leaflet-map-pane has no inline z-index of its own — it relies on `.leaflet-pane`'s base CSS
  // value of 400 (not loaded in jsdom), so this compares against that known constant directly
  // rather than a computed style jsdom wouldn't resolve the same way a real browser does.
  expect(Number(legacyPane!.style.zIndex)).toBeLessThan(400);
  expect(map.getPane("legacySvg")).toBe(legacyPane);
});
