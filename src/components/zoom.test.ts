// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/layers", () => ({ Layers: { draw: vi.fn() } }));
vi.mock("@/renderers/viewport/viewport-renderer", () => ({
  ViewportLayers: { schedule: vi.fn(), renderNow: vi.fn() }
}));

// The real Leaflet map needs real browser layout (container size, animation timing) that jsdom
// doesn't provide — this fake reproduces just the L.Map surface zoom.ts calls, deterministically,
// against the same linear (non power-of-two) zoom-to-scale mapping components/leaflet-map.ts sets up
vi.mock("@/components/leaflet-map", () => {
  let center = { lat: 0, lng: 0 };
  let zoom = 1;
  let minZoom = 1;
  let maxZoom = 20;
  let initialized = false;
  const handlers: Record<string, Array<() => void>> = {};

  const fire = (events: string) => {
    for (const name of events.split(" ")) for (const handler of handlers[name] ?? []) handler();
  };

  const map = {
    getZoom: () => zoom,
    getMinZoom: () => minZoom,
    getMaxZoom: () => maxZoom,
    setMinZoom: (value: number) => {
      minZoom = value;
    },
    setMaxZoom: (value: number) => {
      maxZoom = value;
    },
    setZoom: (value: number) => {
      zoom = value;
      fire("move zoom moveend zoomend");
    },
    setView: (latlng: { lat: number; lng: number }, z: number) => {
      center = latlng;
      zoom = z;
      fire("move zoom moveend zoomend");
    },
    flyTo(latlng: { lat: number; lng: number }, z: number) {
      this.setView(latlng, z);
    },
    panBy: ([dx, dy]: [number, number]) => {
      center = { lat: center.lat + dy / zoom, lng: center.lng + dx / zoom };
      fire("move zoom moveend zoomend");
    },
    setMaxBounds: () => undefined, // not exercised by these tests
    unproject: (point: { x: number; y: number }, z: number) => ({ lat: point.y / z, lng: point.x / z }),
    latLngToContainerPoint: (latlng: { lat: number; lng: number }) => ({
      x: (latlng.lng - center.lng) * zoom + viewport.width / 2,
      y: (latlng.lat - center.lat) * zoom + viewport.height / 2
    }),
    on: (events: string, handler: () => void) => {
      for (const name of events.split(" ")) {
        handlers[name] ??= [];
        handlers[name].push(handler);
      }
    },
    dragging: { enable: () => {} },
    scrollWheelZoom: { enable: () => {} },
    doubleClickZoom: { enable: () => {} },
    touchZoom: { enable: () => {} },
    boxZoom: { enable: () => {} },
    keyboard: { enable: () => {} }
  };

  // seed the fake's center/zoom from whatever transform `viewport` currently has, so the next
  // zoom call keeps that same world point centered — matching the real getLeafletMap()'s one-time
  // setup running after the app has already picked a view
  const seedFromViewport = () => {
    center = {
      lat: (viewport.height / 2 - viewport.y) / viewport.scale,
      lng: (viewport.width / 2 - viewport.x) / viewport.scale
    };
    zoom = viewport.scale;
  };

  return {
    isLeafletMapReady: () => initialized,
    getLeafletMap: () => {
      if (!initialized) {
        seedFromViewport();
        initialized = true;
      }
      return map;
    },
    // test-only: re-sync the fake's camera to `viewport` between tests, without dropping the
    // singleton or its bound listeners — a real Leaflet map is never re-created mid-session either
    __resetView: seedFromViewport
  };
});

import "@/generators/styles";
import * as leafletMapMock from "@/components/leaflet-map";
import { setViewportSize, setViewportTransform, viewport } from "@/components/viewport";
import { ViewportLayers } from "@/renderers/viewport/viewport-renderer";
import { rn } from "@/utils/numberUtils";
import { applyZoomBehavior, setMapZoom } from "./zoom";

const resetFakeLeafletView = () => (leafletMapMock as unknown as { __resetView: () => void }).__resetView();

beforeEach(() => {
  document.body.innerHTML = /* html */ `
    <svg id="map">
      <g id="viewbox"></g>
      <g id="labels"></g>
      <g id="emblems" style="display: none"></g>
      <g id="statesHalo"></g>
    </svg>
    <select id="shapeRendering"><option value="optimizeSpeed" selected></option></select>
  `;

  const map = document.getElementById("map")!;
  Object.defineProperties(map, {
    width: { value: { baseVal: { value: 1000 } } },
    height: { value: { baseVal: { value: 600 } } }
  });

  Object.assign(globalThis, {
    customization: 0,
    options: { map: { labels: { resizeOnZoom: false } }, app: { viewportRedraw: "continuous" } }
  });
  setViewportSize(1000, 600);
  setViewportTransform(1, 0, 0);
  resetFakeLeafletView();

  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1)
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.mocked(ViewportLayers.schedule).mockClear();
  vi.mocked(ViewportLayers.renderNow).mockClear();
  applyZoomBehavior();
});

describe("programmatic zoom", () => {
  it("updates the viewport when a hotkey sets the scale", () => {
    setMapZoom(4);

    expect(viewport.scale).toBe(4);
    expect(document.getElementById("viewbox")!.getAttribute("transform")).toBe("translate(-1500 -900) scale(4)");
  });
});

describe("viewport redraw during zoom", () => {
  it("redraws viewport layers per frame and again when the gesture settles", () => {
    setMapZoom(4);

    expect(ViewportLayers.schedule).toHaveBeenCalledTimes(1);
    expect(ViewportLayers.renderNow).toHaveBeenCalledTimes(1);
  });

  it("skips the per-frame redraw when set to redraw after the zoom only", () => {
    options.app.viewportRedraw = "settled";
    setMapZoom(4);

    expect(ViewportLayers.schedule).not.toHaveBeenCalled();
    expect(ViewportLayers.renderNow).toHaveBeenCalledTimes(1);
  });
});

describe("invokeActiveZooming", () => {
  beforeEach(() => {
    (document.getElementById("shapeRendering") as HTMLSelectElement).value = "auto";
  });

  it("derives statesHalo stroke-width from the store width", () => {
    styles.states.statesHalo.options.width = 8;
    setViewportTransform(2, viewport.x, viewport.y);
    invokeActiveZooming();
    const halo = document.getElementById("statesHalo")!;
    expect(halo.getAttribute("stroke-width")).toBe(String(rn(8 / 2 ** 0.8, 2)));
  });
});
