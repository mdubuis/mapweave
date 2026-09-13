# Mapweave server (Phase 1: Postgres/PostGIS schema + ETL; Phase 2: read API)

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

## API server (Phase 2)

Read-only against Postgres, plus one write endpoint (`/api/maps/import`) that wraps the same import
logic the CLI uses (`src/import.mjs`, shared by both). Fastify, no auth (local-only, per the plan).

```bash
npm run start   # listens on http://127.0.0.1:3001 (PORT env var to override)
```

| Endpoint | Notes |
|---|---|
| `GET /api/maps` | id/name/seed/createdAt for each map |
| `POST /api/maps/import` | body `{pack, settings?, name?}` — same shape as the CLI's `--pack`/`--settings`/`--name`, but as JSON values instead of file paths |
| `GET /api/maps/:id` | `meta`/`facts`/`layers`/`style` |
| `GET /api/maps/:id/layers/:layer` | one GeoJSON `FeatureCollection`; `:layer` ∈ `cells, states, provinces, cultures, religions, burgs, rivers, routes, markers` |
| `GET /api/maps/:id/entities/tree` | states → provinces → burgs, plus flat cultures/religions/rivers/markers lists |
| `GET /api/maps/:id/entities/:kind/:entityId` | one entity's row + GeoJSON geometry |
| `DELETE /api/maps/:id` | cascades to every child table |

All verified manually against the sample fixture (list/get/layers/tree/entity-detail/import/delete,
plus an unknown-layer 400 and an unknown-map 404). One real bug caught during this: the entities
tree bucketed a burg by `province_id ?? state_id` (nullish coalescing) while *choosing* the bucket
with a truthy check (`province_id ? ... : ...`) — since FMG uses `0` as its "no province" sentinel
(not `null`), a burg with `province_id: 0` picked the state bucket but was then keyed by `0` instead
of its actual state id, silently vanishing from the tree. Fixed to use one consistent truthy check
for both the bucket and the key.
