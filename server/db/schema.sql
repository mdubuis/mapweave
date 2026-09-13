-- Mapweave Postgres/PostGIS schema — see MIGRATION.md Phase 1.
--
-- All geometry columns use SRID 0 (undefined/Cartesian), matching Leaflet's L.CRS.Simple: FMG has
-- no real geographic projection, pack coordinates are flat [x,y] in options.map.graph.{width,height}
-- space. Do not use EPSG:4326 here — there is no lat/lng to project into.
--
-- Entity tables are keyed (map_id, id) where id reuses FMG's own generator-assigned integer id
-- (burg.i, state.i, ...), not a fresh serial — existing wiki map_ref frontmatter depends on this.
--
-- Territory polygons (states/provinces/cultures/religions) are NOT imported directly: they're
-- derived from map_cells via ST_Union once cell geometry is loaded (see scripts/import-map.mjs) —
-- PostGIS does the merging FMG's own connectVertices() hole-tracing logic would otherwise do.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS maps (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  seed TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  layers JSONB NOT NULL DEFAULT '{}'::jsonb,
  style JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS map_cells (
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  cell_id INTEGER NOT NULL,
  geom GEOMETRY(Polygon, 0) NOT NULL,
  height SMALLINT,
  biome_id SMALLINT,
  state_id INTEGER,
  province_id INTEGER,
  culture_id INTEGER,
  religion_id INTEGER,
  burg_id INTEGER,
  population REAL,
  neighbors INTEGER[],
  PRIMARY KEY (map_id, cell_id)
);
CREATE INDEX IF NOT EXISTS map_cells_geom_idx ON map_cells USING GIST (geom);
CREATE INDEX IF NOT EXISTS map_cells_state_idx ON map_cells (map_id, state_id);

CREATE TABLE IF NOT EXISTS map_states (
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  state_id INTEGER NOT NULL,
  name TEXT,
  color TEXT,
  culture_id INTEGER,
  capital_burg_id INTEGER,
  form TEXT,
  geom GEOMETRY(MultiPolygon, 0),
  PRIMARY KEY (map_id, state_id)
);
CREATE INDEX IF NOT EXISTS map_states_geom_idx ON map_states USING GIST (geom);

CREATE TABLE IF NOT EXISTS map_provinces (
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  province_id INTEGER NOT NULL,
  state_id INTEGER,
  name TEXT,
  color TEXT,
  geom GEOMETRY(MultiPolygon, 0),
  PRIMARY KEY (map_id, province_id)
);
CREATE INDEX IF NOT EXISTS map_provinces_geom_idx ON map_provinces USING GIST (geom);

CREATE TABLE IF NOT EXISTS map_cultures (
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  culture_id INTEGER NOT NULL,
  name TEXT,
  color TEXT,
  geom GEOMETRY(MultiPolygon, 0),
  PRIMARY KEY (map_id, culture_id)
);
CREATE INDEX IF NOT EXISTS map_cultures_geom_idx ON map_cultures USING GIST (geom);

CREATE TABLE IF NOT EXISTS map_religions (
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  religion_id INTEGER NOT NULL,
  name TEXT,
  type TEXT,
  color TEXT,
  geom GEOMETRY(MultiPolygon, 0),
  PRIMARY KEY (map_id, religion_id)
);
CREATE INDEX IF NOT EXISTS map_religions_geom_idx ON map_religions USING GIST (geom);

CREATE TABLE IF NOT EXISTS map_burgs (
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  burg_id INTEGER NOT NULL,
  name TEXT,
  cell_id INTEGER,
  state_id INTEGER,
  province_id INTEGER,
  culture_id INTEGER,
  religion_id INTEGER,
  population REAL,
  type TEXT,
  capital BOOLEAN NOT NULL DEFAULT false,
  port BOOLEAN NOT NULL DEFAULT false,
  geom GEOMETRY(Point, 0),
  PRIMARY KEY (map_id, burg_id)
);
CREATE INDEX IF NOT EXISTS map_burgs_geom_idx ON map_burgs USING GIST (geom);

CREATE TABLE IF NOT EXISTS map_rivers (
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  river_id INTEGER NOT NULL,
  name TEXT,
  type TEXT,
  discharge REAL,
  width REAL,
  geom GEOMETRY(LineString, 0),
  PRIMARY KEY (map_id, river_id)
);
CREATE INDEX IF NOT EXISTS map_rivers_geom_idx ON map_rivers USING GIST (geom);

CREATE TABLE IF NOT EXISTS map_routes (
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  route_id INTEGER NOT NULL,
  group_name TEXT,
  name TEXT,
  geom GEOMETRY(LineString, 0),
  PRIMARY KEY (map_id, route_id)
);
CREATE INDEX IF NOT EXISTS map_routes_geom_idx ON map_routes USING GIST (geom);

CREATE TABLE IF NOT EXISTS map_markers (
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  marker_id INTEGER NOT NULL,
  type TEXT,
  name TEXT,
  icon TEXT,
  geom GEOMETRY(Point, 0),
  PRIMARY KEY (map_id, marker_id)
);
CREATE INDEX IF NOT EXISTS map_markers_geom_idx ON map_markers USING GIST (geom);

CREATE TABLE IF NOT EXISTS map_zones (
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  zone_id INTEGER NOT NULL,
  type TEXT,
  geom GEOMETRY(MultiPolygon, 0),
  PRIMARY KEY (map_id, zone_id)
);
CREATE INDEX IF NOT EXISTS map_zones_geom_idx ON map_zones USING GIST (geom);

CREATE TABLE IF NOT EXISTS map_annotations (
  map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('note', 'ruler')),
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (map_id, id)
);

-- Raw per-cell/vertex adjacency data not otherwise captured by map_cells' geometry, kept for exact
-- fidelity — the heightmap editor's Keep/Risk/Resample paths mutate this outside the generation
-- pipeline (see MIGRATION.md Phase 3), so it is not assumed reproducible from seed+facts alone.
CREATE TABLE IF NOT EXISTS map_topology (
  map_id INTEGER PRIMARY KEY REFERENCES maps(id) ON DELETE CASCADE,
  grid JSONB NOT NULL DEFAULT '{}'::jsonb,
  pack JSONB NOT NULL DEFAULT '{}'::jsonb
);
