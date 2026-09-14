import { color as d3Color } from "d3";
import { createTerritoryLayer } from "@/renderers/leaflet/territory-layer";
import { ensureEl, getIsolines } from "@/utils";

// States render as a hybrid, unlike biomes/religions/cultures/provinces: the fill is a real
// Leaflet layer (createTerritoryLayer, same as the others), but the halo/border-glow effect
// (shapeRendering: geometricPrecision) stays on the old SVG path, inside #regions — that's why
// this layer keeps parent: "viewbox" in layers.ts rather than "leaflet": LayersRegistry's generic
// visibility/erase can only target one surface, and the halo still needs #regions/#statesHalo to
// exist as real SVG. See MIGRATION.md Phase 5.
const layer = createTerritoryLayer("states-leaflet", 104, "state");

export function drawStates(): void {
  TIME && console.time("drawStates");
  const { cells, states } = pack;

  layer.update(
    cellId => cells.state[cellId],
    index => states[index].color!
  );

  const renderHalo = ensureEl<HTMLSelectElement>("shapeRendering").value === "geometricPrecision";
  if (renderHalo) drawHalo();
  else {
    ensureEl("statePaths").innerHTML = "";
    ensureEl("statesHalo").innerHTML = "";
  }

  TIME && console.timeEnd("drawStates");
}

function drawHalo(): void {
  const { cells, states } = pack;
  const isolines = getIsolines(pack, cellId => cells.state[cellId], { fill: true, halo: true });

  const clipPaths: string[] = [];
  const haloPaths: string[] = [];
  for (const [index, { fill, halo }] of Object.entries(isolines)) {
    const haloColor = d3Color(states[+index].color!)?.darker().hex() || "#666666";
    // clip against a fresh path carrying the same fill geometry, not <use href="#state{index}">:
    // the fill now lives in a separate Leaflet-managed <svg>, so a cross-root <use> reference
    // would be relying on untested cross-SVG behavior — embedding the shape data directly avoids
    // that risk entirely, at the cost of computing the fill geometry twice (once here, once in
    // territory-geojson.ts) — negligible next to the cost of generation itself
    clipPaths.push(/* html */ `<clipPath id="state-clip${index}"><path d="${fill}"/></clipPath>`);
    haloPaths.push(
      /* html */ `<path id="state-border${index}" d="${halo}" clip-path="url(#state-clip${index})" stroke="${haloColor}"/>`
    );
  }

  ensureEl("statePaths").innerHTML = clipPaths.join("");
  ensureEl("statesHalo").innerHTML = haloPaths.join("");
}

export function eraseStates(): void {
  layer.clear();
  ensureEl("statePaths").innerHTML = "";
  ensureEl("statesHalo").innerHTML = "";
}

/** World-space bounds of one state's rendered territory — see TerritoryLayerHandle.getFeatureBounds */
export function getStateBounds(stateId: number): DOMRect | undefined {
  return layer.getFeatureBounds(stateId);
}

/** World-space SVG path `d` for one state's rendered territory — see TerritoryLayerHandle.getFeaturePath */
export function getStatePath(stateId: number): string | undefined {
  return layer.getFeaturePath(stateId);
}
