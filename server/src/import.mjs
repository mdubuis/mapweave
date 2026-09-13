/**
 * Shared ETL core, used by both the CLI (scripts/import-map.mjs) and the API's upload endpoint
 * (src/routes/maps.mjs). See MIGRATION.md Phase 1 for the design rationale (why territory polygons
 * are derived via ST_Union instead of porting connectVertices, why this reads "Pack Cells" JSON
 * instead of the app's GeoJSON export, what's deliberately deferred).
 */

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
  return inserted;
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
  return burgs.length;
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
}

/**
 * @param {import('pg').ClientBase} client - a connected pg client, transaction managed by the caller
 * @param {{packExport: object, settingsExport?: object, name?: string}} input
 * @returns {Promise<{mapId: number, name: string, seed: string, counts: object}>}
 */
export async function importPack(client, { packExport, settingsExport, name }) {
  const info = packExport.info ?? {};
  const data = packExport.cells; // getPackDataJson() nests the real payload under "cells"
  if (!data?.cells || !data?.vertices) {
    throw new Error("Not a recognized PackCells.json export (expected .cells.cells and .cells.vertices)");
  }

  const mapName = name ?? settingsExport?.mapName ?? info.mapName ?? "Untitled";
  const seed = info.seed ?? settingsExport?.options?.map?.seed ?? "unknown";
  const facts = settingsExport?.options?.map ?? {};

  const { rows } = await client.query("INSERT INTO maps (name, seed, facts) VALUES ($1, $2, $3) RETURNING id", [
    mapName,
    seed,
    JSON.stringify(facts)
  ]);
  const mapId = rows[0].id;

  const cellCount = await importCells(client, mapId, data);
  await importTerritoryAttributes(client, mapId, data);
  await deriveTerritoryGeometry(client, mapId);
  const burgCount = await importBurgs(client, mapId, data);
  await importLinesAndPoints(client, mapId, data);

  await client.query("INSERT INTO map_topology (map_id, pack) VALUES ($1, $2)", [
    mapId,
    JSON.stringify({ cells: data.cells, vertices: data.vertices })
  ]);

  return {
    mapId,
    name: mapName,
    seed,
    counts: {
      cells: cellCount,
      states: (data.states ?? []).filter(s => s.i).length,
      provinces: (data.provinces ?? []).filter(p => p.i).length,
      cultures: (data.cultures ?? []).filter(c => c.i).length,
      religions: (data.religions ?? []).filter(r => r.i).length,
      burgs: burgCount,
      rivers: (data.rivers ?? []).length,
      routes: (data.routes ?? []).length,
      markers: (data.markers ?? []).length
    }
  };
}
