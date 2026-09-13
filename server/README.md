# Mapweave server (Phase 1: Postgres/PostGIS schema + ETL)

Local-only Postgres/PostGIS, no auth beyond the default local credentials — see `MIGRATION.md` at
the repo root for the full migration plan this is part of. Nothing here is wired into the running
app yet; this phase only proves the schema and import mechanics work.

## Setup

```bash
# from the repo root
docker compose up -d       # starts Postgres+PostGIS, applies server/db/schema.sql on first run
cd server
npm install
```

If you change `server/db/schema.sql` after the first run, Postgres won't re-apply it automatically
(init scripts only run against an empty data volume) — reset with:

```bash
docker compose down -v && docker compose up -d
```

**Podman/SELinux note**: the schema volume mount uses the `:Z` flag (`docker-compose.yml`) so
rootless podman can actually read the mounted file — without it you'll see `Permission denied`
reading `schema.sql` in `docker logs mapweave-postgres`, not a SQL error.

## Importing a map

1. In the running app, generate/load a map, then **Options → Export → JSON → Pack Cells** (produces
   `PackCells.json` — raw, unprojected cell/vertex/entity data, not the GeoJSON export menu, which
   projects to a synthetic lon/lat unrelated to this schema's Cartesian/SRID-0 design).
2. Optionally also export **Minimal** JSON for the map's settings (`options.map`) — without it,
   `maps.facts` is left empty for this map.
3. Run the import:

```bash
node scripts/import-map.mjs --pack ~/Downloads/PackCells.json --settings ~/Downloads/Minimal.json --name "My World"
```

A synthetic fixture (`scripts/fixtures/PackCells.sample.json` — three cells, one state boundary
crossing two of them, a burg/river/route/marker) is included for smoke-testing the script itself
without a real export; it's a hand-built minimal shape, not real FMG output.

## What the import does (and doesn't) do

- Cell polygons import directly from `cell.v` (vertex-index ring) + `vertices[i].p` (raw `[x,y]`).
- **State/province/culture/religion territory polygons are not built from FMG's own boundary-tracing
  logic** (`connectVertices`, used by the app's own GeoJSON export) — they're derived afterwards
  with `ST_Multi(ST_UnaryUnion(ST_Collect(geom)))` grouped by cell attribute, letting PostGIS dissolve
  adjacent cells into clean territory outlines. Verified against the sample fixture: two adjacent
  cells assigned to the same state merge into one polygon with the shared internal edge dissolved.
- Rivers/routes import as straight segments from the raw `points` array — not
  `Rivers.addMeandering`'s smoothed curve (that helper lives deep in the app's renderer graph;
  porting it is a follow-up polish, not required to validate the schema).
- Zones are not imported yet (their hole-tracing is the most complex case and isn't needed to prove
  the rest of the schema works).
- `map_topology.grid` is left empty — no grid-shaped export is used by this script yet; only
  `pack` (cells+vertices) is stored, for fidelity beyond what the geometry columns capture.

## Verifying an import

```bash
docker exec mapweave-postgres psql -U mapweave -d mapweave -c "SELECT id, name, seed FROM maps;"
docker exec mapweave-postgres psql -U mapweave -d mapweave -c "SELECT state_id, name, ST_Area(geom) FROM map_states WHERE map_id = 1;"
```

Or fetch a layer as GeoJSON directly (this is exactly what Phase 2's read API will wrap in an HTTP
endpoint):

```sql
SELECT json_build_object('type','FeatureCollection','features', json_agg(
  json_build_object('type','Feature','geometry', ST_AsGeoJSON(geom)::json, 'properties', json_build_object('id', state_id, 'name', name))
)) FROM map_states WHERE map_id = 1;
```
