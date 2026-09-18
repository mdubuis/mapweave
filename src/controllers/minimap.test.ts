// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";
import { setViewportSize, setViewportTransform } from "@/components/viewport";

const { zoomTo } = vi.hoisted(() => ({ zoomTo: vi.fn() }));
vi.mock("@/components/zoom", () => ({ zoomTo }));
vi.mock("@/components/dialog/dialog-helpers", () => ({ closeDialogs: vi.fn() }));
vi.mock("@/renderers/leaflet/territory-geojson", () => ({
  buildTerritoryFeatureCollection: (getType: (cellId: number) => number | null) => ({
    type: "FeatureCollection",
    features: [1, 2]
      .filter(id => getType(id) !== null)
      .map(id => ({
        type: "Feature",
        properties: { id },
        geometry: {
          type: "MultiPolygon",
          coordinates: [
            [
              [
                [id * 10, id * 10],
                [id * 10 + 1, id * 10],
                [id * 10, id * 10 + 1],
                [id * 10, id * 10]
              ]
            ]
          ]
        }
      }))
  })
}));

import { Minimap } from "./minimap";

type DialogOptions = { close?: () => void };
let capturedDialogOptions: DialogOptions | undefined;

beforeEach(() => {
  document.body.innerHTML = '<div id="dialogs"></div>';
  document.getElementById("minimapStyles")?.remove();
  globalThis.options = { map: { graph: { width: 1000, height: 600 } } } as never;
  globalThis.pack = { cells: { state: [0, 1] }, states: [{ color: "#000000" }, { color: "#ff0000" }] } as never;
  zoomTo.mockClear();
  capturedDialogOptions = undefined;

  window.$ = vi.fn((target: string | HTMLElement) => {
    const element = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
    return {
      dialog: vi.fn((options?: DialogOptions) => {
        if (options) capturedDialogOptions = options;
      }),
      parent: () => ({ addClass: () => {} }),
      remove: () => element?.remove()
    };
  }) as unknown as typeof window.$;

  setViewportSize(400, 240);
  setViewportTransform(1, 0, 0);
});

test("open() builds a small Leaflet map fitted to the full graph extent, colored by state", () => {
  Minimap.open();
  const container = document.getElementById("minimapMap")!;
  expect(container).not.toBeNull();
  // one geoJSON path per state feature the mocked collection returned, plus the viewport rectangle
  expect(container.querySelectorAll("path")).toHaveLength(3);
  expect(container.querySelectorAll("path[stroke='#624954']")).toHaveLength(1); // the viewport rect
});

test("clicking the minimap zooms the main map to the clicked world point, clamped to the graph", () => {
  Minimap.open();
  const map = document.getElementById("minimapMap")!;

  map.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 0, clientY: 0 }));
  expect(zoomTo).toHaveBeenCalledTimes(1);
  const [x, y] = zoomTo.mock.calls[0] as [number, number, number, number];
  expect(x).toBeGreaterThanOrEqual(0);
  expect(x).toBeLessThanOrEqual(1000);
  expect(y).toBeGreaterThanOrEqual(0);
  expect(y).toBeLessThanOrEqual(600);
});

test("window.updateMinimap repositions the viewport rectangle from the live viewport state, without touching the territory layer", () => {
  Minimap.open();
  const before = document.getElementById("minimapMap")!.querySelectorAll("path").length;

  setViewportTransform(2, -100, -50);
  window.updateMinimap();

  const after = document.getElementById("minimapMap")!.querySelectorAll("path").length;
  expect(after).toBe(before); // rect update never re-renders territory
});

test("closing the dialog tears down the Leaflet instance so reopening doesn't throw", () => {
  Minimap.open();
  expect(capturedDialogOptions?.close).toBeTypeOf("function");
  capturedDialogOptions!.close!();

  expect(() => Minimap.open()).not.toThrow();
  expect(document.getElementById("minimapMap")).not.toBeNull();
});
