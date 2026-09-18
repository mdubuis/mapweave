// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";
import type { River } from "@/generators/river-generator";

// This exercises the real Leaflet map (a real DOM is needed to construct it), not a fake — unlike
// zoom.test.ts, nothing here needs the deterministic camera behavior that fake replaces
vi.mock("@/components/layers", () => ({ Layers: {} }));

import { drawRivers, getRiverBox, redrawRiver, toggleBasinHighlight } from "./draw-rivers";

function river(i: number, x: number, basin = i): River {
  const points: [number, number][] = [
    [x, 10],
    [x + 20, 30],
    [x + 40, 50]
  ];
  return { i, basin, points, cells: [1, 2, 3], widthFactor: 1, sourceWidth: 0.1 } as River;
}

const addMeandering = vi.fn(
  (cells: number[], points?: [number, number][]) =>
    (points ?? cells.map((cell): [number, number] => [cell, cell])).map(([x, y]) => [x, y, 0]) as [
      number,
      number,
      number
    ][]
);
// a simple square ring around the centerline, offset by a fixed "width" of 1 on each side — enough
// to exercise ring construction and bounds without needing the real curve/offset math
const getRiverPolygonRing = vi.fn((points: [number, number, number][]): [number, number][] => {
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const x0 = Math.min(...xs) - 1;
  const x1 = Math.max(...xs) + 1;
  const y0 = Math.min(...ys) - 1;
  const y1 = Math.max(...ys) + 1;
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
    [x0, y0]
  ];
});

beforeEach(() => {
  // deliberately not resetting the DOM: the Leaflet map/pane is a module-level singleton (see
  // leaflet-map.ts) that persists across tests in this file — drawRivers()'s own clearLayers() +
  // addData() reconciliation is what each test relies on, not a clean slate
  globalThis.pack = { rivers: [river(1, 0), river(2, 500)] } as never;
  globalThis.Rivers = { addMeandering, getRiverPolygonRing } as never;
  addMeandering.mockClear();
  getRiverPolygonRing.mockClear();
});

test("draws every river and tags each rendered path with its id", () => {
  drawRivers();
  expect(document.getElementById("river1")).not.toBeNull();
  expect(document.getElementById("river2")).not.toBeNull();
  expect(addMeandering).toHaveBeenCalledTimes(2);
});

test("redrawing one river leaves the others untouched", () => {
  drawRivers();
  const other = document.getElementById("river1");

  pack.rivers[1].cells = [1, 2];
  pack.rivers[1].points = [
    [500, 10],
    [560, 60]
  ];
  redrawRiver(pack.rivers[1]);

  expect(document.getElementById("river1")).toBe(other); // untouched, same node
  expect(document.getElementById("river2")).not.toBeNull();
});

test("a full redraw drops rivers that no longer exist", () => {
  drawRivers();
  pack.rivers = [pack.rivers[0]];
  drawRivers();
  expect(document.getElementById("river1")).not.toBeNull();
  expect(document.getElementById("river2")).toBeNull();
  expect(getRiverBox(2)).toBeNull();
});

test("a river bounding box is available in world-space coordinates", () => {
  drawRivers();
  const box = getRiverBox(1)!;
  // river(1, 0): points span x 0..40, y 10..50; the fake ring inflates by 1 on every side
  expect(box.x).toBe(-1);
  expect(box.width).toBe(42);
  expect(box.y).toBe(9);
  expect(box.height).toBe(42);
});

test("basin highlight paints every river distinctly and clears back to none", () => {
  drawRivers();
  expect(toggleBasinHighlight()).toBe(true);
  expect(document.getElementById("river1")?.getAttribute("fill")).toBe("#1f77b4");
  expect(document.getElementById("river2")?.getAttribute("fill")).toBe("#ff7f0e");

  expect(toggleBasinHighlight()).toBe(false);
  expect(document.getElementById("river1")?.hasAttribute("fill")).toBe(false);
  expect(document.getElementById("river2")?.hasAttribute("fill")).toBe(false);
});

test("rivers with mismatched points fall back to the cell course", () => {
  pack.rivers = [{ ...river(1, 0), points: [[0, 0]] } as River];
  drawRivers();
  expect(addMeandering).toHaveBeenCalledWith([1, 2, 3], undefined);
});
