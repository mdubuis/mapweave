import type { Layer } from "@/components/layers";
import { Coastline } from "@/generators/coastline-generator";
import { ensureEl } from "@/utils";

/**
 * The landmass is a plain rect shown through the land mask. The layer also owns the shared feature
 * geometry in defs: the coastline and lakes layers reference it, so it is drawn before both of them.
 *
 * Its own fill defaults to "none" (default-styles.json), not a real color — real bug found by
 * actually switching to the "biomes" layer preset in a browser: the legacy SVG paints on top of
 * Leaflet's territory panes by design (leaflet-map.ts's mountLegacySvg), so any opaque fill here,
 * even a pale one, sits directly over Leaflet-rendered biome/state colors and hides them completely.
 * Before the Leaflet migration this rect *was* the land's only color, painted over in the same SVG
 * document by the biome/heightmap groups that used to render there — now those render as separate
 * Leaflet panes underneath instead, so this rect having a visible fill of its own is what's obsolete,
 * not the rect itself (it still anchors the land mask geometry #coastline/#lakes depend on).
 */
export function drawLandmass(layer: Layer): void {
  TIME && console.time("drawLandmass");

  const paths: string[] = [];
  const landMask: string[] = [];
  const waterMask: string[] = ['<rect x="0" y="0" width="100%" height="100%" fill="white" />'];

  for (const feature of pack.features) {
    if (!feature || feature.type === "ocean") continue;
    const isLake = feature.type === "lake";

    paths.push(
      `<path d="${Coastline.getFeaturePath(feature)}" id="feature_${feature.i}" data-f="${feature.i}"></path>`
    );
    landMask.push(
      `<use href="#feature_${feature.i}" data-f="${feature.i}" fill="${isLake ? "black" : "white"}"></use>`
    );
    waterMask.push(
      `<use href="#feature_${feature.i}" data-f="${feature.i}" fill="${isLake ? "white" : "black"}"></use>`
    );
  }

  ensureEl("featurePaths").innerHTML = paths.join("");
  ensureEl("land").innerHTML = landMask.join("");
  ensureEl("water").innerHTML = waterMask.join("");

  layer.getEl().innerHTML = /* html */ `<rect x="0" y="0" width="${options.map.graph.width}" height="${options.map.graph.height}" />`;

  TIME && console.timeEnd("drawLandmass");
}
