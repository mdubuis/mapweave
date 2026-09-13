# Mapweave server (Phase 1: schema/ETL; Phase 2: read API; Phase 3: server-side generation)

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

## Server-side generation (Phase 3)

The real client generation engine (`src/generators/**`) runs unmodified under Node via a small
browser-API shim (`src/generation/browser-shim.ts`) — not a reimplementation. Confirmed by directly
running it: a full map (thousands of cells, hundreds of burgs, complete economy/production
simulation) generates correctly in ~2 seconds under Node with no changes to the generation logic
itself.

**The one real change to `src/` this phase required**: `heightmap-generator.ts`'s precreated-image
heightmap loader used `<canvas>`/`Image`, which don't exist in Node. Made the loader pluggable
(`setHeightmapImageLoader`, browser default unchanged) and added a `sharp`-based server
implementation (`src/generation/heightmap-image-loader.ts`). **Caveat**: sharp/libvips's resize
algorithm isn't guaranteed pixel-identical to the browser Canvas's scaling, so a *precreated*
(image-based) heightmap template could theoretically produce very slightly different terrain
between a browser and a server run of the same seed. *Procedural* templates (pure math, no image
resampling) are unaffected and will match exactly.

Two more real, non-obvious dependencies discovered only by actually running the code (not visible
from reading imports — see `browser-shim.ts` for both):
- `aleaPRNG` (the seeded RNG) isn't an ES module export anywhere — it's `window.aleaPRNG` from a
  vendored **classic `<script>` tag** (`public/libs/alea.min.js`), invisible to any import-based
  analysis. The shim uses the npm `alea` package instead (same algorithm, already a dependency
  several generators import directly).
- `FlatQueue` (used by culture/state territory expansion) is the same kind of vendored global
  (`public/libs/flatqueue.js`) — but that file happens to be UMD and detects CommonJS, so the exact
  file the browser uses loads here unmodified via a relative import, no substitute needed.

```bash
npm run generate -- --seed my-world --width 1280 --height 800 --density 4 --name "My World"
```

generates a map server-side and imports it in one step (reuses `src/import.mjs` from Phase 1/2 — no
duplicated logic). Same thing over HTTP: `POST /api/maps/generate` with body
`{seed?, width?, height?, density?, name?}`.

**Concurrency**: generation mutates process-wide globals (`pack`/`grid`/`options`), so two
generations can't run in the same process at once without corrupting each other. The API route
serializes requests through a promise queue (`server/src/routes/maps.mjs`) rather than actually
running them in parallel — fine for a local single-user server, would need a real job queue for
anything more.

**Verified**:
- **Determinism**: the same seed generated twice server-side produced byte-identical output
  (cell count, sampled heights, burg/state names) — a necessary precondition for trusting the port.
- **End-to-end real map**: `npm run generate` on a full-size map (8462 cells, 1117 burgs, 13 states)
  imported cleanly and was fully queryable via every Phase 2 endpoint, including valid merged
  territory polygons and valid route/river line geometry.
- **A second real bug**, caught only by testing with real (not synthetic-fixture) generated data:
  FMG's `river`/`route` `points` entries are `[x, y, cellId]` triples (a cell id riding along as a
  3rd element, not a Z coordinate) — GeoJSON reads a 3-element coordinate as XYZ, which the 2D
  PostGIS columns then rejected outright ("Geometry has Z dimension but column does not"). Fixed by
  truncating to `[x, y]` when building `LineString` geometry.
- **Concurrent requests**: two simultaneous `POST /api/maps/generate` calls with different seeds
  both completed with correct, independent results — the serialization queue works.

**What a full seed-to-seed *browser* comparison still needs** (this project never drives a real
browser automatically): `scripts/compare-with-browser.ts` — generate a map with a specific
seed/width/height/density in the actual running app, export **Pack Cells JSON**, then:

```bash
npx tsx scripts/compare-with-browser.ts --seed <same seed> --width <same> --height <same> --density <same> --pack ~/Downloads/PackCells.json
```

It diffs cell count, the first 50 cell heights, and every burg/state name, and exits non-zero on any
mismatch. This is the one verification step from `MIGRATION.md`'s Phase 3 checklist that has to be
run by a human in a browser — everything else above was verified directly.
