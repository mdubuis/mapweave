#!/usr/bin/env -S npx tsx
/**
 * Generate a map server-side (the real client pipeline, running under Node — see
 * src/generation/generate.ts) and persist it to Postgres via the same importPack() Phase 1/2 use.
 * See MIGRATION.md Phase 3.
 *
 * Usage:
 *   npx tsx scripts/generate-map.ts [--seed X] [--width 1280] [--height 800] [--density 4] [--name "My World"]
 */
import { parseArgs } from "node:util";
import pg from "pg";
import { generateMap } from "../src/generation/generate.ts";
import { importPack } from "../src/import.mjs";

const { values: args } = parseArgs({
  options: {
    seed: { type: "string" },
    width: { type: "string" },
    height: { type: "string" },
    density: { type: "string" },
    name: { type: "string" },
    database: { type: "string", default: process.env.DATABASE_URL ?? "postgres://mapweave:mapweave@localhost:5432/mapweave" }
  }
});

console.log("Generating...");
const packExport = await generateMap({
  seed: args.seed,
  width: args.width ? Number(args.width) : undefined,
  height: args.height ? Number(args.height) : undefined,
  density: args.density ? Number(args.density) : undefined
});
console.log(`Generated: ${packExport.cells.cells.length} cells, seed ${packExport.info.seed}`);

const client = new pg.Client({ connectionString: args.database });
await client.connect();

try {
  await client.query("BEGIN");
  const result = await importPack(client, { packExport, name: args.name });
  await client.query("COMMIT");

  console.log(`Created maps.id=${result.mapId} ("${result.name}", seed ${result.seed})`);
  for (const [kind, count] of Object.entries(result.counts)) console.log(`  ${kind}: ${count}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
