// @vitest-environment jsdom
import { beforeAll, beforeEach, expect, test, vi } from "vitest";

const { riverOpen, routeOpen, markersOpen, burgOpen, labelsOpen } = vi.hoisted(() => ({
  riverOpen: vi.fn(),
  routeOpen: vi.fn(),
  markersOpen: vi.fn(),
  burgOpen: vi.fn(),
  labelsOpen: vi.fn()
}));

vi.mock("@/controllers", () => ({
  Controllers: {
    RiverEditor: { open: riverOpen },
    RouteEditor: { open: routeOpen },
    MarkersEditor: { open: markersOpen },
    BurgEditor: { open: burgOpen },
    LabelsEditor: { open: labelsOpen }
  }
}));

// map-placement.ts pulls in the real tooltip module (see test-setup.ts's comment on why the
// stubbed window.tip/clearMainTip don't cover direct imports); this test doesn't exercise tooltips
vi.mock("./tooltips", () => ({ tip: () => {}, clearMainTip: () => {} }));

import { getFeaturePane } from "@/components/leaflet-map";
import { stopMapPlacement, toggleMapPlacement } from "./map-placement";
import { applyDefaultViewboxEvents } from "./viewbox-events";

function click(el: Element): void {
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
}

beforeAll(() => {
  // the legacy tree a real loaded map would have — present before the first getLeafletMap() call,
  // which relocates #map into its own "legacyPane" pane (see leaflet-map.ts's mountLegacySvg)
  document.body.innerHTML = /* html */ `<svg id="map">
      <g id="viewbox">
        <g id="labels"><text data-label-type="burg" data-id="42">Town</text></g>
      </g>
    </svg>
    <div id="addFeature"><button id="addMarker"></button></div>`;
  applyDefaultViewboxEvents();
});

beforeEach(() => {
  riverOpen.mockClear();
  routeOpen.mockClear();
  markersOpen.mockClear();
  burgOpen.mockClear();
  labelsOpen.mockClear();
  document.getElementById("burgEditor")?.remove();
});

test("clicking a rendered river opens the river editor by its full element id", () => {
  const pane = getFeaturePane("rivers-leaflet", 105);
  pane.innerHTML = '<path id="river5"></path>';
  click(pane.querySelector("path")!);
  expect(riverOpen).toHaveBeenCalledWith("river5");
});

test("clicking a rendered route opens the route editor by its full element id", () => {
  const pane = getFeaturePane("routes-leaflet", 106);
  pane.innerHTML = '<path id="route7"></path>';
  click(pane.querySelector("path")!);
  expect(routeOpen).toHaveBeenCalledWith("route7");
});

test("clicking a rendered marker opens the marker editor by its numeric id", () => {
  const pane = getFeaturePane("markers-leaflet", 107);
  pane.innerHTML = '<div><svg id="marker3"><circle/></svg></div>';
  click(pane.querySelector("circle")!); // click bubbles up from inside the icon's own content
  expect(markersOpen).toHaveBeenCalledWith(3);
});

test("clicking a rendered burg icon opens the burg editor by its data-id", () => {
  const pane = getFeaturePane("burg-icons-leaflet", 108);
  pane.innerHTML = '<div><svg id="burg9" data-id="9"><use/></svg></div>';
  click(pane.querySelector("use")!);
  expect(burgOpen).toHaveBeenCalledWith(9);
});

test("clicking a territory-fill pane (no click behavior wired) does nothing", () => {
  const pane = getFeaturePane("biomes-leaflet", 100);
  pane.innerHTML = '<path id="biome2"></path>';
  click(pane.querySelector("path")!);
  expect(riverOpen).not.toHaveBeenCalled();
  expect(routeOpen).not.toHaveBeenCalled();
  expect(markersOpen).not.toHaveBeenCalled();
  expect(burgOpen).not.toHaveBeenCalled();
});

test("a click that never reaches a Leaflet pane still falls back to the legacy ancestor-walk", () => {
  click(document.querySelector("#labels text")!);
  expect(labelsOpen).not.toHaveBeenCalled(); // burg labels open the burg editor instead
  expect(burgOpen).toHaveBeenCalledWith(42);
});

test("while a placement tool is active, a click inside #viewbox only fires the placement callback, not the default click-to-edit handler", () => {
  // the placement listener binds to #viewbox specifically (see map-placement.ts) — the burg label is
  // real legacy content inside it, unlike a Leaflet-pane feature which #viewbox's subtree never sees
  const target = document.querySelector("#labels text")!;

  const placementClick = vi.fn();
  toggleMapPlacement("addMarker", placementClick, "Click on map");
  click(target);
  expect(placementClick).toHaveBeenCalledTimes(1);
  expect(burgOpen).not.toHaveBeenCalled(); // the double-fire bug this guards against

  stopMapPlacement();
  click(target);
  expect(burgOpen).toHaveBeenCalledWith(42); // default click-to-edit is restored once placement stops
  expect(placementClick).toHaveBeenCalledTimes(1); // not fired again
});
