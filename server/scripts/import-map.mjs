#!/usr/bin/env node
/**
 * CLI wrapper around src/import.mjs — see that file and MIGRATION.md Phase 1 for what this does
 * and deliberately doesn't do yet (zones, river meandering, grid topology).
 *
 * Usage:
 *   node scripts/import-map.mjs --pack ./PackCells.json [--settings ./Minimal.json] [--name "My World"]
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import pg from "pg";
import { importPack } from "../src/import.mjs";

const { values: args } = parseArgs({
  options: {
    pack: { type: "string" },
    settings: { type: "string" },
    name: { type: "string" },
    database: { type: "string", default: process.env.DATABASE_URL ?? "postgres://mapweave:mapweave@localhost:5432/mapweave" }
  }
});

if (!args.pack) {
  console.error('Usage: node scripts/import-map.mjs --pack ./PackCells.json [--settings ./Minimal.json] [--name "My World"]');
  process.exit(1);
}

const packExport = JSON.parse(await readFile(args.pack, "utf8"));
const settingsExport = args.settings ? JSON.parse(await readFile(args.settings, "utf8")) : undefined;

const client = new pg.Client({ connectionString: args.database });
await client.connect();

try {
  await client.query("BEGIN");
  const result = await importPack(client, { packExport, settingsExport, name: args.name });
  await client.query("COMMIT");

  console.log(`Created maps.id=${result.mapId} ("${result.name}", seed ${result.seed})`);
  for (const [kind, count] of Object.entries(result.counts)) console.log(`  ${kind}: ${count}`);
  console.log(`Done. maps.id = ${result.mapId}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
