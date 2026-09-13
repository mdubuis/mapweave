import { pool, withTransaction } from "../db.mjs";
import { importPack } from "../import.mjs";

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
