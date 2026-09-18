// @vitest-environment jsdom
import { beforeEach, expect, test, vi } from "vitest";
import type { Route } from "@/generators/routes-generator";

vi.mock("@/components/layers", () => ({ Layers: {} }));

import { drawRoutes, getRouteBox, redrawRoute, removeRoutes, setEditedRoute, setTempRoute } from "./draw-routes";

function route(i: number, x: number, group = "roads"): Route {
  return {
    i,
    group,
    feature: 1,
    points: [
      [x, 10, 1],
      [x + 40, 50, 2]
    ]
  } as unknown as Route;
}

beforeEach(() => {
  globalThis.pack = { routes: [route(1, 0), route(2, 500), route(3, 0, "trails")] } as never;
  globalThis.styles = {
    routes: {
      groups: {
        roads: { attrs: { opacity: 1, stroke: "#000000", "stroke-width": 0.5 } },
        trails: { attrs: { opacity: 1, stroke: "#666666", "stroke-width": 0.3, "stroke-dasharray": "1 1" } },
        searoutes: { attrs: { opacity: 0.8, stroke: "#4682b4", "stroke-width": 0.3, "stroke-dasharray": "0.8 0.8" } }
      }
    }
  } as never;
  setEditedRoute(null);
  setTempRoute(null);
});

test("draws every route, tagged with its id, styled per its group", () => {
  drawRoutes();
  expect(document.getElementById("route1")).not.toBeNull();
  expect(document.getElementById("route2")).not.toBeNull();
  expect(document.getElementById("route3")).not.toBeNull();

  expect(document.getElementById("route1")?.getAttribute("stroke")).toBe("#000000");
  expect(document.getElementById("route3")?.getAttribute("stroke")).toBe("#666666"); // route 3 is a trail
});

test("editing a visible route updates its geometry in place", () => {
  drawRoutes();
  const edited = document.getElementById("route1");
  pack.routes[0].points = [
    [0, 10, 1],
    [30, 30, 2]
  ];
  redrawRoute(pack.routes[0]);
  expect(document.getElementById("route1")).toBe(edited); // same node, not replaced
});

test("changing a route's group restyles it in place, same node", () => {
  drawRoutes();
  const edited = document.getElementById("route2");
  expect(edited?.getAttribute("stroke")).toBe("#000000"); // starts as a road

  pack.routes[1].group = "searoutes";
  redrawRoute(pack.routes[1]);

  expect(document.getElementById("route2")).toBe(edited); // same node — route-editor.ts's click
  // handler (bound directly to the rendered element while editing) must survive this
  expect(edited?.getAttribute("stroke")).toBe("#4682b4");
});

test("the creator's temporary route renders and clears without touching real routes", () => {
  drawRoutes();
  setTempRoute({
    group: "trails",
    points: [
      [0, 0, 1],
      [10, 10, 2]
    ]
  });
  const temp = document.getElementById("route-1");
  expect(temp).not.toBeNull();
  expect(temp?.getAttribute("stroke")).toBe("#666666"); // styled as a trail

  setTempRoute(null);
  expect(document.getElementById("route-1")).toBeNull();
  expect(document.getElementById("route1")).not.toBeNull(); // real routes untouched
});

test("a full redraw drops routes that no longer exist", () => {
  drawRoutes();
  pack.routes = [pack.routes[0]];
  drawRoutes();
  expect(document.getElementById("route1")).not.toBeNull();
  expect(document.getElementById("route2")).toBeNull();
  expect(document.getElementById("route3")).toBeNull();
  expect(getRouteBox(3)).toBeNull();
});

test("erasing the layer removes every route", () => {
  drawRoutes();
  removeRoutes();
  expect(document.getElementById("route1")).toBeNull();
  expect(document.getElementById("route2")).toBeNull();

  drawRoutes();
  expect(document.getElementById("route1")).not.toBeNull();
});

test("a route bounding box is available in world-space coordinates", () => {
  drawRoutes();
  const box = getRouteBox(1)!;
  expect(box.x).toBe(0);
  expect(box.width).toBe(40);
  expect(box.y).toBe(10);
  expect(box.height).toBe(40);
});
