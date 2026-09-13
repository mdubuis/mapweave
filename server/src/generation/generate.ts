/**
 * Thin server-side equivalent of src/components/lifecycle.ts's `generate()` — resolves a request
 * into the same graph-size/seed/randomize sequence, runs the real GenerationPipeline, and returns
 * the result in the shape Phase 1's importPack() already consumes. See MIGRATION.md Phase 3.
 *
 * Deliberately NOT ported from generate() directly: that function also does DOM/UI work (canvas
 * resizing, dispatching a `map:generated` window event, session bookkeeping) that has no server
 * meaning — this only does the data-generation half.
 *
 * Generation mutates process-wide globals (`pack`/`grid`/`options`), so it is not safe to run two
 * generations concurrently in the same process — callers (see ../routes/maps.mjs) must serialize.
 */
import { loadGenerationEngine } from "./browser-shim.ts";
import { packToJson } from "./pack-to-json.ts";

export interface GenerateMapRequest {
  seed?: string;
  width?: number;
  height?: number;
  /** graph-density.ts step: 0 = 1000 points ... 12 = 100000 points, default 4 = 10000 */
  density?: number;
}

let engineLoaded = false;

export async function generateMap(request: GenerateMapRequest = {}) {
  if (!engineLoaded) {
    await loadGenerationEngine();
    engineLoaded = true;
  }

  const { Options } = await import("@/components/options-model");
  const { setSeed } = await import("@/components/seed");
  const { generateSeed } = await import("@/utils/probabilityUtils");
  const { GenerationPipeline } = await import("@/generators/generation-pipeline");

  Options.setGraphSize(request.width ?? 1280, request.height ?? 800);
  setSeed(request.seed || generateSeed());
  Options.randomize();
  if (request.density !== undefined) globalThis.options.generation.graph.density = request.density;

  await GenerationPipeline.run({});
  return packToJson(globalThis.pack);
}
