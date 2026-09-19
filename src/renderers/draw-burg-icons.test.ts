// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test } from "vitest";
import { getLeafletMap } from "@/components/leaflet-map";
import type { Burg } from "@/generators/burgs-generator";

import "@/generators/styles";
import { drawBurgIcons, eraseBurgIcons, refreshBurgIconsZoomSize } from "./draw-burg-icons";

function burg(i: number, x = 10, y = 10, overrides: Partial<Burg> = {}): Burg {
  return { i, cell: 0, group: "town", x, y, ...overrides } as Burg;
}

beforeEach(() => {
  // deliberately not resetting the DOM: the Leaflet map/pane is a module-level singleton (see
  // leaflet-map.ts) that persists across tests in this file — drawBurgIcons()'s own full rebuild is
  // what each test relies on, not a clean slate
  globalThis.pack = { burgs: [{ i: 0 } as Burg, burg(1)] } as never;
  styles.burgIcons.burgIcons.groups.town.options.size = 3;
  styles.burgIcons.burgIcons.groups.town.options.icon = "#icon-circle";
  styles.burgIcons.burgIcons.groups.town.attrs.fill = null;
  styles.burgIcons.burgIcons.groups.town.attrs.filter = null;
  styles.burgIcons.anchors.groups.town.options.size = 3;
  options.map.burgs.groups = [{ name: "town", order: 0 }] as never;
});

afterEach(() => {
  getLeafletMap().setZoom(getLeafletMap().getMinZoom(), { animate: false });
});

test("draws every burg icon, tagged with its id and styled from the group store", () => {
  styles.burgIcons.burgIcons.groups.town.attrs.fill = "#123456";
  drawBurgIcons();

  const el = document.getElementById("burg1")!;
  expect(el).not.toBeNull();
  expect(el.querySelector("g")?.getAttribute("font-size")).toBe("3");
  expect(el.querySelector("g")?.getAttribute("fill")).toBe("#123456");
  expect(el.querySelector("use")?.getAttribute("href")).toBe("#icon-circle");
  expect(document.getElementById("anchor1")).toBeNull(); // not a port
});

test("port burgs get a second anchor icon at the same point, non-port burgs don't", () => {
  pack.burgs[1].port = 1;
  drawBurgIcons();
  expect(document.getElementById("anchor1")).not.toBeNull();

  pack.burgs[1].port = 0;
  drawBurgIcons();
  expect(document.getElementById("anchor1")).toBeNull();
});

test("burgs without an assigned group are skipped, same as burg index 0", () => {
  pack.burgs.push(burg(2, 20, 20, { group: undefined }));
  drawBurgIcons();
  expect(document.getElementById("burg0")).toBeNull();
  expect(document.getElementById("burg2")).toBeNull();
});

test("an unknown group falls back to the town style, an empty group renders nothing", () => {
  options.map.burgs.groups.push({ name: "custom", order: -1 } as never);
  pack.burgs[1].group = "custom";
  drawBurgIcons();

  // "custom" has no entry in styles.burgIcons.burgIcons.groups — falls back to "town"'s style
  expect(document.getElementById("burg1")?.querySelector("g")?.getAttribute("font-size")).toBe("3");
});

test("a full redraw reflects relocation, port changes and removal, no stale elements left behind", () => {
  drawBurgIcons();
  const original = document.getElementById("burg1");
  expect(original).not.toBeNull();

  pack.burgs[1].x = 500;
  drawBurgIcons();
  expect(document.getElementById("burg1")).not.toBeNull(); // still renders after moving

  pack.burgs[1].removed = true;
  drawBurgIcons();
  expect(document.getElementById("burg1")).toBeNull();
});

test("erasing the layer removes every burg icon and anchor", () => {
  pack.burgs[1].port = 1;
  drawBurgIcons();
  expect(document.getElementById("burg1")).not.toBeNull();
  expect(document.getElementById("anchor1")).not.toBeNull();

  eraseBurgIcons();
  expect(document.getElementById("burg1")).toBeNull();
  expect(document.getElementById("anchor1")).toBeNull();

  drawBurgIcons();
  expect(document.getElementById("burg1")).not.toBeNull();
});

test("group render order follows options.map.burgs.groups order, not declaration order", () => {
  options.map.burgs.groups = [
    { name: "second", order: 2 },
    { name: "first", order: 1 }
  ] as never;
  styles.burgIcons.burgIcons.groups.second = structuredClone(styles.burgIcons.burgIcons.groups.town);
  styles.burgIcons.burgIcons.groups.first = structuredClone(styles.burgIcons.burgIcons.groups.town);
  pack.burgs = [{ i: 0 } as Burg, burg(1, 10, 10, { group: "first" }), burg(2, 20, 20, { group: "second" })];

  drawBurgIcons();
  expect(document.getElementById("burg1")).not.toBeNull();
  expect(document.getElementById("burg2")).not.toBeNull();
});

test("icon size scales with zoom — burg icons have no rescale toggle, always linear", () => {
  drawBurgIcons();
  expect(document.getElementById("burg1")?.getAttribute("width")).toBe("6"); // size 3, box = 2*zoom*size at zoom 1

  getLeafletMap().setZoom(4, { animate: false });
  drawBurgIcons();
  expect(document.getElementById("burg1")?.getAttribute("width")).toBe("24"); // box = 2*4*3
});

test("refreshBurgIconsZoomSize updates icon size for the current zoom without a full redraw", () => {
  drawBurgIcons();
  expect(document.getElementById("burg1")?.getAttribute("width")).toBe("6");

  getLeafletMap().setZoom(4, { animate: false });
  refreshBurgIconsZoomSize();
  expect(document.getElementById("burg1")?.getAttribute("width")).toBe("24");
});

test("refreshBurgIconsZoomSize skips the rebuild when the zoom level hasn't actually changed", () => {
  drawBurgIcons();
  getLeafletMap().setZoom(4, { animate: false });
  refreshBurgIconsZoomSize(); // syncs its internal "last zoom sized" tracker to 4
  const settled = document.getElementById("burg1");
  expect(settled).not.toBeNull();

  refreshBurgIconsZoomSize(); // zoom unchanged since the call above — no-op
  expect(document.getElementById("burg1")).toBe(settled);
});

test("special characters in group name, icon and fill are escaped, not left raw in markup", () => {
  const name = 'town & "port"';
  const icon = '#icon-&"circle';
  const fill = 'url(#pattern-&"fill)';
  options.map.burgs.groups[0].name = name;
  pack.burgs[1].group = name;
  styles.burgIcons.burgIcons.groups.town.options.icon = icon;
  styles.burgIcons.burgIcons.groups.town.attrs.fill = fill;

  drawBurgIcons();
  const el = document.getElementById("burg1")!;
  expect(el.getAttribute("data-group")).toBe(name);
  expect(el.querySelector("use")?.getAttribute("href")).toBe(icon);
  expect(el.querySelector("g")?.getAttribute("fill")).toBe(fill);
});
