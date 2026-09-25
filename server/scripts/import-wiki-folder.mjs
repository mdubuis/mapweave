#!/usr/bin/env node
/**
 * CLI wrapper around src/wiki-import.mjs — see that file for what this does and why.
 *
 * Usage:
 *   node scripts/import-wiki-folder.mjs --dir ./my-wiki-folder --mapId 3
 */
import { parseArgs } from "node:util";
import pg from "pg";
import { importWikiFolder } from "../src/wiki-import.mjs";

const { values: args } = parseArgs({
  options: {
    dir: { type: "string" },
    mapId: { type: "string" },
    database: { type: "string", default: process.env.DATABASE_URL ?? "postgres://mapweave:mapweave@localhost:5432/mapweave" }
  }
});

if (!args.dir || !args.mapId) {
  console.error("Usage: node scripts/import-wiki-folder.mjs --dir ./my-wiki-folder --mapId 3");
  process.exit(1);
}

const client = new pg.Client({ connectionString: args.database });
await client.connect();

try {
  await client.query("BEGIN");
  const result = await importWikiFolder(client, Number(args.mapId), args.dir);
  await client.query("COMMIT");
  console.log(`Imported ${result.pages} page(s) and ${result.templates} template(s) into maps.id=${args.mapId}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
