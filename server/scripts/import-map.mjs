#!/usr/bin/env node
/**
 * One-off ETL: import a "Pack Cells" JSON export (in the app: Options > Export > JSON > Pack Cells,
 * produces PackCells.json) — and optionally a "Minimal"/"Full" JSON export for map settings — into
 * Postgres/PostGIS. See MIGRATION.md Phase 1.
 *
 * Territory polygons (states/provinces/cultures/religions) are NOT computed here from cell rings —
 * they're derived afterwards via ST_Union over the imported cell geometry, letting PostGIS do the
 * merging FMG's own connectVertices() hole-tracing logic would otherwise do (see schema.sql).
 *
 * Deliberately deferred for this first validation pass (not needed to prove the schema works):
 * zones (hole-tracing), river meandering (Rivers.addMeandering — rivers import as straight segments
 * from raw `points` instead), and the `grid` half of map_topology (no grid export used here).
 *
 * Usage:
 *   node scripts/import-map.mjs --pack ./PackCells.json [--settings ./Minimal.json] [--name "My World"]
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import pg from "pg";

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

const info = packExport.info ?? {};
const data = packExport.cells; // getPackDataJson() nests the real payload under "cells"
if (!data?.cells || !data?.vertices) {
  console.error("Not a recognized PackCells.json export (expected .cells.cells and .cells.vertices)");
  process.exit(1);
}

const mapName = args.name ?? settingsExport?.mapName ?? info.mapName ?? "Untitled";
const seed = info.seed ?? settingsExport?.options?.map?.seed ?? "unknown";
const facts = settingsExport?.options?.map ?? {};

function cellPolygonGeoJSON(cell, vertices) {
  const ring = cell.v.map(vertexId => vertices[vertexId].p);
  ring.push(ring[0]);
  return JSON.stringify({ type: "Polygon", coordinates: [ring] });
}

function pointGeoJSON(x, y) {
  return JSON.stringify({ type: "Point", coordinates: [x, y] });
}

function lineStringGeoJSON(points) {
  return JSON.stringify({ type: "LineString", coordinates: points });
}

async function importTerritoryAttributes(client, mapId, data) {
  for (const state of data.states ?? []) {
    if (!state.i) continue; // 0 is "neutrals", not a real state
    await client.query(
      `INSERT INTO map_states (map_id, state_id, name, color, culture_id, capital_burg_id, form)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (map_id, state_id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color`,
      [mapId, state.i, state.name ?? null, state.color ?? null, state.culture ?? null, state.capital ?? null, state.form ?? null]
    );
  }
  for (const province of data.provinces ?? []) {
    if (!province.i) continue;
    await client.query(
      `INSERT INTO map_provinces (map_id, province_id, state_id, name, color)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (map_id, province_id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color`,
      [mapId, province.i, province.state ?? null, province.name ?? null, province.color ?? null]
    );
  }
  for (const culture of data.cultures ?? []) {
    if (!culture.i) continue;
    await client.query(
      `INSERT INTO map_cultures (map_id, culture_id, name, color)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (map_id, culture_id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color`,
      [mapId, culture.i, culture.name ?? null, culture.color ?? null]
    );
  }
  for (const religion of data.religions ?? []) {
    if (!religion.i) continue;
    await client.query(
      `INSERT INTO map_religions (map_id, religion_id, name, type, color)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (map_id, religion_id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color`,
      [mapId, religion.i, religion.name ?? null, religion.type ?? null, religion.color ?? null]
    );
  }
  console.log(
    `Imported ${data.states?.length ?? 0} states, ${data.provinces?.length ?? 0} provinces, ` +
      `${data.cultures?.length ?? 0} cultures, ${data.religions?.length ?? 0} religions (attributes only)`
  );
}

async function deriveTerritoryGeometry(client, mapId) {
  const dissolve = (table, column) =>
    client.query(
      `UPDATE ${table} t SET geom = merged.geom
       FROM (SELECT ${column}, ST_Multi(ST_UnaryUnion(ST_Collect(geom))) AS geom FROM map_cells
             WHERE map_id = $1 AND ${column} IS NOT NULL AND ${column} > 0 GROUP BY ${column}) merged
       WHERE t.map_id = $1 AND t.${column} = merged.${column}`,
      [mapId]
    );

  await dissolve("map_states", "state_id");
  await dissolve("map_provinces", "province_id");
  await dissolve("map_cultures", "culture_id");
  await dissolve("map_religions", "religion_id");
  console.log("Derived state/province/culture/religion territory polygons via ST_Union");
}

async function importCells(client, mapId, data) {
  const BATCH = 500;
  let inserted = 0;

  for (let offset = 0; offset < data.cells.length; offset += BATCH) {
    const batch = data.cells.slice(offset, offset + BATCH);
    const values = [];
    const placeholders = batch
      .map((cell, i) => {
        const base = i * 11;
        values.push(
          mapId,
          cell.i,
          cellPolygonGeoJSON(cell, data.vertices),
          cell.h ?? null,
          cell.biome ?? null,
          cell.state || null,
          cell.province || null,
          cell.culture || null,
          cell.religion || null,
          cell.burg || null,
          cell.pop ?? null
        );
        return (
          `($${base + 1}, $${base + 2}, ST_SetSRID(ST_GeomFromGeoJSON($${base + 3}), 0), $${base + 4}, ` +
          `$${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11})`
        );
      })
      .join(", ");

    await client.query(
      `INSERT INTO map_cells (map_id, cell_id, geom, height, biome_id, state_id, province_id, culture_id, religion_id, burg_id, population)
       VALUES ${placeholders}`,
      values
    );
    inserted += batch.length;
  }
  console.log(`Imported ${inserted} cells`);
}

async function importBurgs(client, mapId, data) {
  const burgs = (data.burgs ?? []).filter(burg => burg.i && !burg.removed);
  for (const burg of burgs) {
    await client.query(
      `INSERT INTO map_burgs (map_id, burg_id, name, cell_id, state_id, province_id, culture_id, religion_id, population, type, capital, port, geom)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, ST_SetSRID(ST_GeomFromGeoJSON($13), 0))
       ON CONFLICT (map_id, burg_id) DO NOTHING`,
      [
        mapId,
        burg.i,
        burg.name ?? null,
        burg.cell ?? null,
        burg.state ?? null,
        burg.province ?? null,
        burg.culture ?? null,
        burg.religion ?? null,
        burg.population ?? null,
        burg.type ?? null,
        Boolean(burg.capital),
        Boolean(burg.port),
        pointGeoJSON(burg.x, burg.y)
      ]
    );
  }
  console.log(`Imported ${burgs.length} burgs`);
}

async function importLinesAndPoints(client, mapId, data) {
  for (const river of data.rivers ?? []) {
    if (!river.points?.length) continue;
    await client.query(
      `INSERT INTO map_rivers (map_id, river_id, name, type, discharge, width, geom)
       VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_GeomFromGeoJSON($7), 0))
       ON CONFLICT (map_id, river_id) DO NOTHING`,
      [mapId, river.i, river.name ?? null, river.type ?? null, river.discharge ?? null, river.width ?? null, lineStringGeoJSON(river.points)]
    );
  }
  for (const route of data.routes ?? []) {
    if (!route.points?.length) continue;
    await client.query(
      `INSERT INTO map_routes (map_id, route_id, group_name, name, geom)
       VALUES ($1, $2, $3, $4, ST_SetSRID(ST_GeomFromGeoJSON($5), 0))
       ON CONFLICT (map_id, route_id) DO NOTHING`,
      [mapId, route.i, route.group ?? null, route.name ?? null, lineStringGeoJSON(route.points)]
    );
  }
  for (const marker of data.markers ?? []) {
    await client.query(
      `INSERT INTO map_markers (map_id, marker_id, type, name, icon, geom)
       VALUES ($1, $2, $3, $4, $5, ST_SetSRID(ST_GeomFromGeoJSON($6), 0))
       ON CONFLICT (map_id, marker_id) DO NOTHING`,
      [mapId, marker.i, marker.type ?? null, marker.name ?? null, marker.icon ?? null, pointGeoJSON(marker.x, marker.y)]
    );
  }
  console.log(`Imported ${(data.rivers ?? []).length} rivers, ${(data.routes ?? []).length} routes, ${(data.markers ?? []).length} markers`);
}

async function run() {
  const client = new pg.Client({ connectionString: args.database });
  await client.connect();

  try {
    await client.query("BEGIN");

    const { rows } = await client.query("INSERT INTO maps (name, seed, facts) VALUES ($1, $2, $3) RETURNING id", [
      mapName,
      seed,
      JSON.stringify(facts)
    ]);
    const mapId = rows[0].id;
    console.log(`Created maps.id=${mapId} ("${mapName}", seed ${seed})`);

    await importCells(client, mapId, data);
    await importTerritoryAttributes(client, mapId, data);
    await deriveTerritoryGeometry(client, mapId);
    await importBurgs(client, mapId, data);
    await importLinesAndPoints(client, mapId, data);

    await client.query("INSERT INTO map_topology (map_id, pack) VALUES ($1, $2)", [
      mapId,
      JSON.stringify({ cells: data.cells, vertices: data.vertices })
    ]);

    await client.query("COMMIT");
    console.log(`Done. maps.id = ${mapId}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

await run();
