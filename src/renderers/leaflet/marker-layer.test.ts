// @vitest-environment jsdom

import * as L from "leaflet";
import { beforeEach, describe, expect, it } from "vitest";
import { getFeatureLayerGroup } from "@/components/leaflet-map";
import type { Marker } from "@/generators/markers-generator";
import { buildIcon, updateIconSize } from "./marker-layer";

function baseMarker(overrides: Partial<Marker> = {}): Marker {
  return { i: 1, type: "custom", icon: "❓", x: 100, y: 100, cell: 0, name: "Test", ...overrides };
}

describe("updateIconSize", () => {
  beforeEach(() => {
    globalThis.options = { map: { graph: { width: 1000, height: 600 } } } as never;
  });

  it("produces the same DOM state as building the icon fresh at the new size", () => {
    const group = getFeatureLayerGroup("markers-leaflet-test", 500);
    const marker = baseMarker();

    const resized = L.marker([marker.y, marker.x], { icon: buildIcon(marker, 30) });
    group.addLayer(resized);
    expect(updateIconSize(resized, 46)).toBe(true);

    const fresh = L.marker([marker.y, marker.x], { icon: buildIcon(marker, 46) });
    group.addLayer(fresh);

    const resizedSvg = resized.getElement()!.firstElementChild as SVGSVGElement;
    const freshSvg = fresh.getElement()!.firstElementChild as SVGSVGElement;
    expect(resizedSvg.getAttribute("width")).toBe(freshSvg.getAttribute("width"));
    expect(resizedSvg.getAttribute("height")).toBe(freshSvg.getAttribute("height"));
    // viewBox is a fixed "0 0 30 30" regardless of size, on both paths
    expect(resizedSvg.getAttribute("viewBox")).toBe(freshSvg.getAttribute("viewBox"));

    const resizedEl = resized.getElement()!;
    const freshEl = fresh.getElement()!;
    expect(resizedEl.style.width).toBe(freshEl.style.width);
    expect(resizedEl.style.height).toBe(freshEl.style.height);
    expect(resizedEl.style.marginLeft).toBe(freshEl.style.marginLeft);
    expect(resizedEl.style.marginTop).toBe(freshEl.style.marginTop);
  });

  it("returns false when the marker has no rendered element yet (never attached to the map)", () => {
    const marker = L.marker([0, 0], { icon: buildIcon(baseMarker(), 30) });
    expect(updateIconSize(marker, 40)).toBe(false);
  });
});
