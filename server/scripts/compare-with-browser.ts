/**
 * The Phase 3 acceptance test from MIGRATION.md: generate the same seed server-side and compare
 * against a real browser-generated map, exported the same way Phase 1's import script consumes
 * (Options > Export > JSON > Pack Cells). This script can't drive a browser itself (this project
 * never runs Playwright automatically) — you generate the browser side by hand, this compares it.
 *
 * Usage:
 *   npx tsx scripts/compare-with-browser.ts --seed my-seed --width 1280 --height 800 --density 4 --pack ./PackCells.json
 *
 * `density` must match the step you had selected in the browser's map-size slider before
 * generating (see src/data/graph-density.ts — 0 = 1000 points ... 12 = 100000 points, default 4 =
 * 10000). Width/height must match too. If they don't, the two runs aren't comparable at all — the
 * grid itself would differ before a single generator step even runs.
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadGenerationEngine } from "../src/generation/browser-shim.ts";

const { values: args } = parseArgs({
  options: {
    seed: { type: "string" },
    width: { type: "string", default: "1280" },
    height: { type: "string", default: "800" },
    density: { type: "string", default: "4" },
    pack: { type: "string" }
  }
});

if (!args.seed || !args.pack) {
  console.error(
    "Usage: compare-with-browser.ts --seed <seed> --pack ./PackCells.json [--width 1280] [--height 800] [--density 4]"
  );
  process.exit(1);
}

await loadGenerationEngine();
const { Options } = await import("@/components/options-model");
const { setSeed } = await import("@/components/seed");
const { GenerationPipeline } = await import("@/generators/generation-pipeline");

Options.setGraphSize(Number(args.width), Number(args.height));
setSeed(args.seed);
Options.randomize();
globalThis.options.generation.graph.density = Number(args.density);

console.log(`Generating server-side: seed=${args.seed} ${args.width}x${args.height} density=${args.density}...`);
await GenerationPipeline.run({});

const serverPack = globalThis.pack;
const browserExport = JSON.parse(await readFile(args.pack, "utf8"));
const browserData = browserExport.cells;
if (!browserData?.cells) {
  console.error("Not a recognized PackCells.json export");
  process.exit(1);
}

function diffField(label: string, serverValue: unknown, browserValue: unknown): boolean {
  const a = JSON.stringify(serverValue);
  const b = JSON.stringify(browserValue);
  const match = a === b;
  console.log(`${match ? "OK  " : "DIFF"} ${label}${match ? "" : `\n  server:  ${a}\n  browser: ${b}`}`);
  return match;
}

const results = [
  diffField("cell count", serverPack.cells.i.length, browserData.cells.length),
  diffField(
    "cell heights (first 50)",
    Array.from(serverPack.cells.h.slice(0, 50)),
    browserData.cells.slice(0, 50).map((c: { h: number }) => c.h)
  ),
  diffField(
    "burg names",
    serverPack.burgs.filter((b: { i?: number }) => b?.i).map((b: { name: string }) => b.name),
    browserData.burgs.filter((b: { i?: number }) => b?.i).map((b: { name: string }) => b.name)
  ),
  diffField(
    "state names",
    serverPack.states.filter((s: { i?: number }) => s?.i).map((s: { name: string }) => s.name),
    browserData.states.filter((s: { i?: number }) => s?.i).map((s: { name: string }) => s.name)
  )
];

const allMatch = results.every(Boolean);
console.log(allMatch ? "\nPASS — server and browser generation match." : "\nFAIL — see DIFF lines above.");
process.exit(allMatch ? 0 : 1);
