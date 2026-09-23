/**
 * Burg-scoped detail map generation (Phase 6 "Phase 4" — see MAPWEAVE.md). Generates a new,
 * independent map whose terrain is inherited from a slice of an existing (parent) map's already-
 * persisted Postgres data, centered on one burg — a "zoom in" on that burg's surroundings.
 *
 * Flagged in the approved plan as the single highest-uncertainty piece of this whole phase: no
 * prior art in this codebase for reading a parent map's geometry back out of Postgres and feeding
 * it into a fresh client-side generation run. Kept deliberately simple for a first working version
 * — brute-force nearest-neighbor resampling, no smoothing/interpolation — since correctness here
 * matters far more than polish, and this is explicitly a prototyping spike per the plan.
 */
import { loadGenerationEngine } from "./browser-shim.ts";
import { packToJson } from "./pack-to-json.ts";

export interface GenerateDetailMapRequest {
  /** The parent map's id (already in Postgres) */
  parentMapId: number;
  /** The anchor burg's id within the parent map's own map_burgs rows */
  burgId: number;
  seed?: string;
  width?: number;
  height?: number;
  density?: number;
  /** How much of the parent's world one unit of the detail map's own space represents — 5 means
   *  the detail map's canvas covers a region 1/5 the width/height of what the same pixel count
   *  would cover on the parent map, i.e. a 5x zoom-in. */
  zoomFactor?: number;
  /** Explicit, small burg count for the detail map — deliberately NOT the normal "auto" formula
   *  (population/points-based), which scales UP per-point burg density on a smaller map, backwards
   *  from what a "one burg's neighborhood" detail map wants. See generateDetailMap's doc comment. */
  burgsLimit?: number;
}

interface ParentCell {
  x: number;
  y: number;
  height: number;
}

interface ParentSlice {
  burgName: string;
  burgX: number;
  burgY: number;
  /** The anchor burg's own state/culture/religion on the parent map — narrative inheritance
   *  target, see the "constrain to the anchor burg" generation options below. Absent (0/undefined)
   *  falls back to leaving the generated name as whatever the engine's own generator picked. */
  stateName?: string;
  stateColor?: string;
  cultureName?: string;
  cultureColor?: string;
  religionName?: string;
  cells: ParentCell[];
}

/** @param {import('pg').ClientBase} client */
export async function queryParentSlice(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: any[] }> },
  parentMapId: number,
  burgId: number,
  parentSliceWidth: number,
  parentSliceHeight: number
): Promise<ParentSlice | null> {
  const { rows: burgRows } = await client.query(
    "SELECT name, state_id, culture_id, religion_id, ST_X(geom) AS x, ST_Y(geom) AS y FROM map_burgs WHERE map_id = $1 AND burg_id = $2",
    [parentMapId, burgId]
  );
  if (!burgRows.length || burgRows[0].x === null) return null;
  const burg = burgRows[0];
  const burgX: number = burg.x;
  const burgY: number = burg.y;
  const burgName: string = burg.name ?? "";

  const [stateRows, cultureRows, religionRows] = await Promise.all([
    burg.state_id
      ? client.query("SELECT name, color FROM map_states WHERE map_id = $1 AND state_id = $2", [parentMapId, burg.state_id])
      : Promise.resolve({ rows: [] }),
    burg.culture_id
      ? client.query("SELECT name, color FROM map_cultures WHERE map_id = $1 AND culture_id = $2", [parentMapId, burg.culture_id])
      : Promise.resolve({ rows: [] }),
    burg.religion_id
      ? client.query("SELECT name FROM map_religions WHERE map_id = $1 AND religion_id = $2", [parentMapId, burg.religion_id])
      : Promise.resolve({ rows: [] })
  ]);

  const minX = burgX - parentSliceWidth / 2;
  const minY = burgY - parentSliceHeight / 2;
  const maxX = burgX + parentSliceWidth / 2;
  const maxY = burgY + parentSliceHeight / 2;

  const { rows: cellRows } = await client.query(
    `SELECT height, ST_X(ST_Centroid(geom)) AS x, ST_Y(ST_Centroid(geom)) AS y
     FROM map_cells
     WHERE map_id = $1 AND height IS NOT NULL
       AND ST_Intersects(geom, ST_MakeEnvelope($2, $3, $4, $5, 0))`,
    [parentMapId, minX, minY, maxX, maxY]
  );

  return {
    burgName,
    burgX,
    burgY,
    stateName: stateRows.rows[0]?.name,
    stateColor: stateRows.rows[0]?.color,
    cultureName: cultureRows.rows[0]?.name,
    cultureColor: cultureRows.rows[0]?.color,
    religionName: religionRows.rows[0]?.name,
    cells: cellRows.map(row => ({ x: row.x, y: row.y, height: row.height }))
  };
}

/** Nearest-neighbor resample: for each of the detail map's own grid points, find the closest
 *  parent cell (by centroid distance, in parent-space) and take its height directly — no
 *  smoothing/interpolation. Simple and correct; revisit only if the seam looks blocky in practice
 *  (a real visual judgment call the plan explicitly deferred to a prototyping check, not something
 *  to gold-plate speculatively here). */
export function resampleParentHeights(
  subMapPoints: readonly [number, number][],
  parentSlice: ParentSlice,
  subMapWidth: number,
  subMapHeight: number,
  parentSliceWidth: number,
  parentSliceHeight: number
): Uint8Array {
  const { burgX, burgY, cells } = parentSlice;
  const heights = new Uint8Array(subMapPoints.length);
  if (!cells.length) return heights; // no parent data in range — flat sea-level-ish fallback (0)

  const originX = burgX - parentSliceWidth / 2;
  const originY = burgY - parentSliceHeight / 2;

  for (let i = 0; i < subMapPoints.length; i++) {
    const [sx, sy] = subMapPoints[i];
    const px = originX + (sx / subMapWidth) * parentSliceWidth;
    const py = originY + (sy / subMapHeight) * parentSliceHeight;

    let nearest = cells[0];
    let nearestDist = (px - nearest.x) ** 2 + (py - nearest.y) ** 2;
    for (let c = 1; c < cells.length; c++) {
      const cell = cells[c];
      const dist = (px - cell.x) ** 2 + (py - cell.y) ** 2;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = cell;
      }
    }
    heights[i] = nearest.height;
  }

  return heights;
}

let engineLoaded = false;

/** @param {import('pg').ClientBase} client */
export async function generateDetailMap(
  client: { query: (sql: string, params: unknown[]) => Promise<{ rows: any[] }> },
  request: GenerateDetailMapRequest
) {
  if (!engineLoaded) {
    await loadGenerationEngine();
    engineLoaded = true;
  }

  const { Options } = await import("@/components/options-model");
  const { setSeed } = await import("@/components/seed");
  const { generateSeed } = await import("@/utils/probabilityUtils");
  const { GenerationPipeline } = await import("@/generators/generation-pipeline");

  const width = request.width ?? 1280;
  const height = request.height ?? 800;
  const zoomFactor = request.zoomFactor ?? 5;
  const parentSliceWidth = width / zoomFactor;
  const parentSliceHeight = height / zoomFactor;

  const parentSlice = await queryParentSlice(client, request.parentMapId, request.burgId, parentSliceWidth, parentSliceHeight);
  if (!parentSlice) {
    throw new Error(`Burg ${request.burgId} not found on map ${request.parentMapId}, or has no position`);
  }

  Options.setGraphSize(width, height);
  setSeed(request.seed || generateSeed());
  Options.randomize();
  if (request.density !== undefined) globalThis.options.generation.graph.density = request.density;

  // Constrain to the anchor burg's own state/culture/religion (user-confirmed design choice, see
  // MAPWEAVE.md's Phase 6 "Phase 4" entry) — WITHOUT touching Cultures.generate()/States.generate()
  // /Religions.generate()'s own organic-growth algorithms at all: those already take a "how many to
  // generate" limit as input, so asking for exactly 1 makes the existing, unmodified algorithm fill
  // the whole populated area with a single culture/state/religion on its own. Must be set AFTER
  // Options.randomize() (called above), which would otherwise overwrite these with its own random
  // picks — confirmed by reading randomize()'s own body, not assumed. burgs.limit is deliberately
  // an explicit small number, not the "auto" AUTO_BURG_LIMIT randomize() would otherwise select:
  // that formula scales UP per-point burg density on a smaller map, backwards from what a single
  // burg's own neighborhood should look like.
  const { generation } = globalThis.options;
  generation.cultures.limit = 1;
  generation.states.limit = 1;
  generation.religions.limit = 1;
  // NOT 0: provinces-generator.ts's growth-bound formula is `gauss(20,5,5,100) * ratio ** 0.5` —
  // ratio=0 collapses that to exactly 0, which stops the province flood-fill from expanding past
  // its two seed cells at all, but the state's cells still all need *some* province assignment —
  // this edge case (never hit by the real UI, whose slider bottoms out above 0) produced 5220
  // provinces on a 5631-cell detail map in a real test run, confirmed via the live database, not
  // guessed. 20 is the engine's own default ratio (see options-model.ts) — small non-zero keeps
  // provinces.generate()'s well-tested normal path, not an edge case it was never tuned for.
  generation.provinces.ratio = 20;
  generation.burgs.limit = request.burgsLimit ?? 12;

  // Resampling needs real grid points, which don't exist until Grid.prepare() has run — so build
  // the grid first (Grid.prepare() with no graph generates a fresh one from the seed/width/height
  // just set, exactly like any normal generation), resample using its points, then hand the whole
  // thing to the full pipeline: passing the already-built grid back as `graph` makes its own "grid"
  // step reuse it (Grid.prepare(graph) skips regenerating when given one — see grid-generator.ts),
  // and `parentHeights` makes the "heightmap" step use fromParentSlice instead of a fresh template.
  // Grid, like HeightmapGenerator, is a legacy global (window.Grid), not a named export —
  // already registered by loadGenerationEngine()'s "@/generators" side-effect import above.
  globalThis.Grid.prepare();
  const parentHeights = resampleParentHeights(
    globalThis.grid.points,
    parentSlice,
    width,
    height,
    parentSliceWidth,
    parentSliceHeight
  );

  await GenerationPipeline.run({ graph: globalThis.grid, parentHeights });
  relabelToParent(globalThis.pack, parentSlice);
  const packExport = packToJson(globalThis.pack);
  return { packExport, parentSlice };
}

/** With cultures/states/religions.limit forced to 1 above, index 0 of each is always the engine's
 *  own "neutral/no culture" placeholder (confirmed by reading states-generator.ts: `pack.states =
 *  [{ i: 0, name: "Neutrals", ... }, ...]`) and index 1 is the one real entry generated — renamed
 *  here to the parent's actual name/color so the detail map reads as "this burg's own state/
 *  culture/religion", not an arbitrarily-generated one. Purely a label change on the already-
 *  generated output; does not touch how it was generated. */
function relabelToParent(pack: any, parentSlice: ParentSlice): void {
  const state = pack.states?.find((s: any) => s.i !== 0);
  if (state && parentSlice.stateName) {
    state.name = parentSlice.stateName;
    if (parentSlice.stateColor) state.color = parentSlice.stateColor;
  }

  const culture = pack.cultures?.find((c: any) => c.i !== 0);
  if (culture && parentSlice.cultureName) {
    culture.name = parentSlice.cultureName;
    if (parentSlice.cultureColor) culture.color = parentSlice.cultureColor;
  }

  const religion = pack.religions?.find((r: any) => r.i !== 0);
  if (religion && parentSlice.religionName) {
    religion.name = parentSlice.religionName;
  }
}
