import { pool, withTransaction } from "../db.mjs";
import { generateDetailMap } from "../generation/detail-map.ts";
import { generateMap } from "../generation/generate.ts";
import { importPack } from "../import.mjs";

// generateMap()/generateDetailMap() both mutate the same process-wide globals (pack/grid/options)
// — concurrent calls, of either kind, would corrupt each other's result, so every generation
// request shares this one promise chain instead of running in parallel. Fine for a local
// single-user server; would need a real queue for anything more.
let generationQueue = Promise.resolve();
function enqueueGeneration(task) {
  const result = generationQueue.then(task);
  generationQueue = result.catch(() => {}); // one failed generation must not wedge the queue
  return result;
}
function runGeneration(request) {
  return enqueueGeneration(() => generateMap(request));
}
function runDetailGeneration(request) {
  return enqueueGeneration(() => generateDetailMap(pool, request));
}

// Per-layer table/column config for the GeoJSON endpoint — the :layer path param is validated
// against these keys before use, so nothing here is built from unsanitized user input.
const LAYERS = {
  cells: { table: "map_cells", idColumn: "cell_id", properties: ["height", "biome_id", "state_id", "province_id", "culture_id", "religion_id", "burg_id", "population"] },
  states: { table: "map_states", idColumn: "state_id", properties: ["name", "color", "culture_id", "capital_burg_id", "form"] },
  provinces: { table: "map_provinces", idColumn: "province_id", properties: ["name", "color", "state_id"] },
  cultures: { table: "map_cultures", idColumn: "culture_id", properties: ["name", "color"] },
  religions: { table: "map_religions", idColumn: "religion_id", properties: ["name", "type", "color"] },
  burgs: { table: "map_burgs", idColumn: "burg_id", properties: ["name", "population", "type", "capital", "port", "state_id", "province_id"] },
  rivers: { table: "map_rivers", idColumn: "river_id", properties: ["name", "type", "discharge", "width"] },
  routes: { table: "map_routes", idColumn: "route_id", properties: ["group_name", "name"] },
  markers: { table: "map_markers", idColumn: "marker_id", properties: ["type", "name", "icon"] }
};

function propertiesExpr(idColumn, properties) {
  const pairs = [`'id', ${idColumn}`, ...properties.map(column => `'${column}', ${column}`)];
  return `json_build_object(${pairs.join(", ")})`;
}

/** @param {import('fastify').FastifyInstance} app */
export default async function mapsRoutes(app) {
  app.get("/api/maps", async () => {
    const { rows } = await pool.query("SELECT id, name, seed, created_at AS \"createdAt\" FROM maps ORDER BY created_at DESC");
    return rows;
  });

  app.post("/api/maps/import", async (request, reply) => {
    const { pack, settings, name } = request.body ?? {};
    if (!pack) return reply.code(400).send({ error: "Body must include a `pack` field (a Pack Cells JSON export)" });

    const result = await withTransaction(client => importPack(client, { packExport: pack, settingsExport: settings, name }));
    return reply.code(201).send(result);
  });

  app.post("/api/maps/generate", async (request, reply) => {
    const { seed, width, height, density, name } = request.body ?? {};
    const packExport = await runGeneration({ seed, width, height, density });
    // importPack() only persists width/height/seed into `facts` from an explicit settingsExport —
    // the browser-import path gets that from an optional Minimal JSON export; this path has the
    // resolved values right here (packExport.info, see pack-to-json.ts), so pass them the same way
    // rather than leaving `facts` empty for every server-generated map.
    const settingsExport = { options: { map: { seed: packExport.info.seed, graph: { width: packExport.info.width, height: packExport.info.height } } } };
    const result = await withTransaction(client => importPack(client, { packExport, settingsExport, name }));
    return reply.code(201).send(result);
  });

  // Burg-scoped detail map (Phase 6 "Phase 4", see MAPWEAVE.md) — a new, independent map whose
  // terrain is inherited from a slice of this map around one burg. Known, flagged gap: cultures/
  // states/burgs are generated at full, unconstrained scale (not yet scoped down to the anchor
  // burg's own culture/state) — a separate, not-yet-built mechanism; only the terrain is real
  // inheritance right now.
  app.post("/api/maps/:id/burgs/:burgId/generate-detail", async (request, reply) => {
    const parentMapId = Number(request.params.id);
    const burgId = Number(request.params.burgId);
    const { seed, width, height, density, zoomFactor, name } = request.body ?? {};

    let packExport;
    try {
      ({ packExport } = await runDetailGeneration({ parentMapId, burgId, seed, width, height, density, zoomFactor }));
    } catch (error) {
      return reply.code(404).send({ error: error.message });
    }

    const settingsExport = { options: { map: { seed: packExport.info.seed, graph: { width: packExport.info.width, height: packExport.info.height } } } };
    const detailName = name ?? `${packExport.info.mapName ?? "Detail"} (detail)`;

    const result = await withTransaction(async client => {
      const imported = await importPack(client, { packExport, settingsExport, name: detailName });
      await client.query("UPDATE maps SET parent_map_id = $1, parent_burg_id = $2 WHERE id = $3", [
        parentMapId,
        burgId,
        imported.mapId
      ]);
      await client.query("UPDATE map_burgs SET child_map_id = $1 WHERE map_id = $2 AND burg_id = $3", [
        imported.mapId,
        parentMapId,
        burgId
      ]);
      return imported;
    });

    return reply.code(201).send(result);
  });

  app.get("/api/maps/:id", async (request, reply) => {
    const { rows } = await pool.query("SELECT id, name, seed, meta, facts, layers, style FROM maps WHERE id = $1", [request.params.id]);
    if (!rows.length) return reply.code(404).send({ error: "Map not found" });
    return rows[0];
  });

  app.delete("/api/maps/:id", async (request, reply) => {
    const { rowCount } = await pool.query("DELETE FROM maps WHERE id = $1", [request.params.id]);
    if (!rowCount) return reply.code(404).send({ error: "Map not found" });
    return reply.code(204).send();
  });

  app.get("/api/maps/:id/layers/:layer", async (request, reply) => {
    const layer = LAYERS[request.params.layer];
    if (!layer) return reply.code(400).send({ error: `Unknown layer "${request.params.layer}". Known layers: ${Object.keys(LAYERS).join(", ")}` });

    const { rows } = await pool.query(
      `SELECT json_build_object(
         'type', 'FeatureCollection',
         'features', COALESCE(json_agg(
           json_build_object(
             'type', 'Feature',
             'geometry', ST_AsGeoJSON(geom)::json,
             'properties', ${propertiesExpr(layer.idColumn, layer.properties)}
           )
         ) FILTER (WHERE geom IS NOT NULL), '[]'::json)
       ) AS geojson
       FROM ${layer.table} WHERE map_id = $1`,
      [request.params.id]
    );
    return rows[0].geojson;
  });

  app.get("/api/maps/:id/entities/tree", async (request, reply) => {
    const mapId = request.params.id;
    const { rows: mapRows } = await pool.query("SELECT id FROM maps WHERE id = $1", [mapId]);
    if (!mapRows.length) return reply.code(404).send({ error: "Map not found" });

    const [states, provinces, burgs, cultures, religions, rivers, markers] = await Promise.all([
      pool.query("SELECT state_id AS id, name FROM map_states WHERE map_id = $1 ORDER BY name", [mapId]),
      pool.query("SELECT province_id AS id, state_id, name FROM map_provinces WHERE map_id = $1 ORDER BY name", [mapId]),
      pool.query("SELECT burg_id AS id, state_id, province_id, name, population, capital FROM map_burgs WHERE map_id = $1 ORDER BY name", [mapId]),
      pool.query("SELECT culture_id AS id, name FROM map_cultures WHERE map_id = $1 ORDER BY name", [mapId]),
      pool.query("SELECT religion_id AS id, name FROM map_religions WHERE map_id = $1 ORDER BY name", [mapId]),
      pool.query("SELECT river_id AS id, name FROM map_rivers WHERE map_id = $1 ORDER BY name", [mapId]),
      pool.query("SELECT marker_id AS id, name FROM map_markers WHERE map_id = $1 ORDER BY name", [mapId])
    ]);

    const burgsByProvince = new Map();
    const burgsByState = new Map();
    for (const burg of burgs.rows) {
      // 0 is FMG's "no province" sentinel, not a real province id — such burgs group directly under their state
      const hasProvince = Boolean(burg.province_id);
      const bucket = hasProvince ? burgsByProvince : burgsByState;
      const key = hasProvince ? burg.province_id : burg.state_id;
      if (!bucket.has(key)) bucket.set(key, []);
      bucket.get(key).push({ kind: "burg", id: burg.id, name: burg.name, population: burg.population, capital: burg.capital });
    }

    const provincesByState = new Map();
    for (const province of provinces.rows) {
      if (!provincesByState.has(province.state_id)) provincesByState.set(province.state_id, []);
      provincesByState.get(province.state_id).push({
        kind: "province",
        id: province.id,
        name: province.name,
        children: burgsByProvince.get(province.id) ?? []
      });
    }

    return {
      states: states.rows.map(state => ({
        kind: "state",
        id: state.id,
        name: state.name,
        children: [...(provincesByState.get(state.id) ?? []), ...(burgsByState.get(state.id) ?? [])]
      })),
      cultures: cultures.rows.map(c => ({ kind: "culture", id: c.id, name: c.name })),
      religions: religions.rows.map(r => ({ kind: "religion", id: r.id, name: r.name })),
      rivers: rivers.rows.map(r => ({ kind: "river", id: r.id, name: r.name })),
      markers: markers.rows.map(m => ({ kind: "marker", id: m.id, name: m.name }))
    };
  });

  const ENTITY_TABLES = {
    state: { table: "map_states", idColumn: "state_id" },
    province: { table: "map_provinces", idColumn: "province_id" },
    culture: { table: "map_cultures", idColumn: "culture_id" },
    religion: { table: "map_religions", idColumn: "religion_id" },
    burg: { table: "map_burgs", idColumn: "burg_id" },
    river: { table: "map_rivers", idColumn: "river_id" },
    route: { table: "map_routes", idColumn: "route_id" },
    marker: { table: "map_markers", idColumn: "marker_id" }
  };

  app.get("/api/maps/:id/entities/:kind/:entityId", async (request, reply) => {
    const entity = ENTITY_TABLES[request.params.kind];
    if (!entity) return reply.code(400).send({ error: `Unknown entity kind "${request.params.kind}"` });

    const { rows } = await pool.query(
      `SELECT *, ST_AsGeoJSON(geom)::json AS geometry FROM ${entity.table} WHERE map_id = $1 AND ${entity.idColumn} = $2`,
      [request.params.id, request.params.entityId]
    );
    if (!rows.length) return reply.code(404).send({ error: "Entity not found" });

    const { geom, ...entityRow } = rows[0];
    return entityRow;
  });
}
