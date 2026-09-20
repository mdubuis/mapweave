// @vitest-environment jsdom

import * as L from "leaflet";
import { beforeEach, describe, expect, it } from "vitest";
import { getFeatureLayerGroup } from "@/components/leaflet-map";
import { buildIcon, updateIconSize } from "./burg-icon-layer";

function svgOf(marker: L.Marker): SVGSVGElement {
  return marker.getElement()!.firstElementChild as SVGSVGElement;
}

describe("updateIconSize", () => {
  beforeEach(() => {
    globalThis.options = { map: { graph: { width: 1000, height: 600 } } } as never;
  });

  it("produces the same DOM state as building the icon fresh at the new size", () => {
    const group = getFeatureLayerGroup("burg-icons-leaflet-test", 500);
    const attrs = { fill: "#fff" };

    const resized = L.marker([10, 10], { icon: buildIcon(1, "town", "#icon-circle", 5, attrs, false) });
    group.addLayer(resized);
    expect(updateIconSize(resized, 9)).toBe(true);

    const fresh = L.marker([10, 10], { icon: buildIcon(1, "town", "#icon-circle", 9, attrs, false) });
    group.addLayer(fresh);

    const resizedSvg = svgOf(resized);
    const freshSvg = svgOf(fresh);
    expect(resizedSvg.getAttribute("width")).toBe(freshSvg.getAttribute("width"));
    expect(resizedSvg.getAttribute("height")).toBe(freshSvg.getAttribute("height"));
    expect(resizedSvg.getAttribute("viewBox")).toBe(freshSvg.getAttribute("viewBox"));

    const resizedG = resizedSvg.firstElementChild!;
    const freshG = freshSvg.firstElementChild!;
    expect(resizedG.getAttribute("font-size")).toBe(freshG.getAttribute("font-size"));

    const resizedUse = resizedG.firstElementChild!;
    const freshUse = freshG.firstElementChild!;
    expect(resizedUse.getAttribute("x")).toBe(freshUse.getAttribute("x"));
    expect(resizedUse.getAttribute("y")).toBe(freshUse.getAttribute("y"));

    const resizedEl = resized.getElement()!;
    const freshEl = fresh.getElement()!;
    expect(resizedEl.style.width).toBe(freshEl.style.width);
    expect(resizedEl.style.height).toBe(freshEl.style.height);
    expect(resizedEl.style.marginLeft).toBe(freshEl.style.marginLeft);
    expect(resizedEl.style.marginTop).toBe(freshEl.style.marginTop);
  });

  it("works the same way for the anchor icon shape", () => {
    const group = getFeatureLayerGroup("burg-icons-leaflet-test-anchor", 501);

    const resized = L.marker([0, 0], { icon: buildIcon(2, "town", "#icon-anchor", 4, {}, true) });
    group.addLayer(resized);
    expect(updateIconSize(resized, 7)).toBe(true);

    const fresh = L.marker([0, 0], { icon: buildIcon(2, "town", "#icon-anchor", 7, {}, true) });
    group.addLayer(fresh);

    expect(svgOf(resized).getAttribute("viewBox")).toBe(svgOf(fresh).getAttribute("viewBox"));
  });

  it("returns false when the marker has no rendered element yet (never attached to the map)", () => {
    const marker = L.marker([0, 0], { icon: buildIcon(3, "town", "#icon-circle", 5, {}, false) });
    expect(updateIconSize(marker, 8)).toBe(false);
  });
});
