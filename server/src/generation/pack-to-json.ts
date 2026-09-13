/**
 * Converts a freshly-generated live `pack`/`grid` into the same "Pack Cells JSON" shape Phase 1's
 * `importPack()` already consumes (i.e. what `getPackCellsData()` in src/services/io/export-json.ts
 * produces for the browser's Export menu) — reimplemented standalone rather than importing that
 * file directly, since it also imports browser-coupled modules (dialog-helpers, tooltips, platform)
 * for its *other* exports that this one function doesn't need.
 */
export function packToJson(pack: any): { info: Record<string, unknown>; cells: Record<string, unknown> } {
  const cells = Array.from(pack.cells.i as number[]).map((cellId: number) => ({
    i: cellId,
    v: pack.cells.v[cellId],
    c: pack.cells.c[cellId],
    p: pack.cells.p[cellId],
    g: pack.cells.g[cellId],
    h: pack.cells.h[cellId],
    area: pack.cells.area[cellId],
    f: pack.cells.f[cellId],
    t: pack.cells.t[cellId],
    haven: pack.cells.haven[cellId],
    harbor: pack.cells.harbor[cellId],
    fl: pack.cells.fl[cellId],
    r: pack.cells.r[cellId],
    conf: pack.cells.conf[cellId],
    biome: pack.cells.biome[cellId],
    s: pack.cells.s[cellId],
    pop: pack.cells.pop[cellId],
    culture: pack.cells.culture[cellId],
    burg: pack.cells.burg[cellId],
    routes: pack.cells.routes[cellId],
    state: pack.cells.state[cellId],
    religion: pack.cells.religion[cellId],
    province: pack.cells.province[cellId]
  }));

  const vertices = Array.from(pack.vertices.p as unknown[]).map((p, vertexId: number) => ({
    i: vertexId,
    p,
    v: pack.vertices.v[vertexId],
    c: pack.vertices.c[vertexId]
  }));

  return {
    info: { mapName: pack.info?.mapName, seed: options.map.seed, width: options.map.graph.width, height: options.map.graph.height },
    cells: {
      cells,
      vertices,
      features: pack.features,
      biomes: pack.biomes,
      cultures: pack.cultures,
      burgs: pack.burgs,
      states: pack.states,
      provinces: pack.provinces,
      religions: pack.religions,
      rivers: pack.rivers,
      goods: pack.goods,
      markers: pack.markers,
      markets: pack.markets,
      deals: pack.deals,
      routes: pack.routes,
      zones: pack.zones,
      measurers: pack.measurers,
      journeys: pack.journeys
    }
  };
}
