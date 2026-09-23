/**
 * The other entity source the wiki can merge in, alongside the file-based one in entities.ts — see
 * MIGRATION.md Phase 4.2 and the design decision in that doc: with hundreds to thousands of
 * generated entities per map, they're shown live from Postgres rather than as generated .md files,
 * with an explicit "flesh out into a lore page" action (renderNewEntityView in wiki-main.ts) for
 * whichever ones a user wants to actually write about.
 *
 * Deliberately not wired to `map_ref`/eras yet — that field is about the classic client-side map's
 * own numbering, a separate mechanism from this Postgres-backed one; unifying them is Phase 5+.
 */
import type { WikiEntity, WikiFrontmatter } from "./types";

export interface MapSummary {
  id: number;
  name: string;
  seed: string;
  createdAt: string;
}

export interface TreeNode {
  kind: string;
  id: number;
  name: string;
  population?: number;
  capital?: boolean;
  children?: TreeNode[];
}

export interface EntityTree {
  states: TreeNode[];
  cultures: TreeNode[];
  religions: TreeNode[];
  rivers: TreeNode[];
  markers: TreeNode[];
}

/** Marks a WikiEntity as sourced live from the map database rather than a file — see canEditEntity() */
export interface DbEntityRef {
  mapId: number;
  kind: string;
  id: number;
}

export function dbRefOf(entity: WikiEntity): DbEntityRef | undefined {
  return entity.frontmatter.dbRef as DbEntityRef | undefined;
}

/** The one place this URL is written — everything that talks to the Postgres API server (the wiki
 *  shell and, via the exports below, the merged map engine's burg editor) imports it from here
 *  instead of hardcoding its own copy. */
export const API_BASE = "http://127.0.0.1:3001";

export async function fetchAvailableMaps(apiBase: string): Promise<MapSummary[]> {
  const response = await fetch(`${apiBase}/api/maps`);
  if (!response.ok) throw new Error(`GET /api/maps failed: ${response.status}`);
  return response.json();
}

/** Which Postgres map (if any) the shell is currently connected to — set by wiki-main.ts's
 *  loadDatabaseEntities, read by the merged map engine's burg editor to decide whether "Generate
 *  detail map" makes sense at all (it's a Postgres-backed feature — see requestDetailMap below —
 *  meaningless for a map with no database connection). Plain module state, not a global: this
 *  module is shared by both sides of the single-DOM merge (Phase 6 "Phase 3"), so an ordinary
 *  import gets the same live value either way. */
let connectedMapId: number | undefined;
export function setConnectedMapId(mapId: number | undefined): void {
  connectedMapId = mapId;
}
export function getConnectedMapId(): number | undefined {
  return connectedMapId;
}

export interface DetailMapResult {
  mapId: number;
  name: string;
}

/** Burg-scoped detail map generation (Phase 6 "Phase 4") — see
 *  server/src/generation/detail-map.ts and the POST /api/maps/:id/burgs/:burgId/generate-detail
 *  route for what this actually does. Simplification, not yet handled: calling this twice for the
 *  same burg creates two independent detail maps, the second silently replacing the first's
 *  child_map_id link rather than being blocked — acceptable for now (no data corruption, just an
 *  orphaned first map), not yet worth the extra round-trip to check for an existing link first. */
export async function requestDetailMap(apiBase: string, parentMapId: number, burgId: number): Promise<DetailMapResult> {
  const response = await fetch(`${apiBase}/api/maps/${parentMapId}/burgs/${burgId}/generate-detail`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `POST generate-detail failed: ${response.status}`);
  }
  const row = await response.json();
  return { mapId: row.mapId, name: row.name };
}

export interface ConnectedMapInfo {
  id: number;
  seed: string;
  /** From `facts.graph` — present when the map was imported with its settings JSON, or generated
   *  server-side (see server/src/routes/maps.mjs's /api/maps/generate). Absent otherwise: a bare
   *  Pack Cells-only browser import has no settings export to read these from. */
  width?: number;
  height?: number;
}

/** Just enough to point map.html's `?seed=&width=&height=` at the same map the wiki is showing —
 *  see requestPlacement/openMapPanel in wiki-main.ts. Not a full reconstruction of the stored map:
 *  regenerating from seed reproduces it only if it was never hand-edited after generation (see
 *  the fidelity caveat in server/db/schema.sql). */
export async function fetchConnectedMapInfo(apiBase: string, mapId: number): Promise<ConnectedMapInfo> {
  const response = await fetch(`${apiBase}/api/maps/${mapId}`);
  if (!response.ok) throw new Error(`GET /api/maps/${mapId} failed: ${response.status}`);
  const row = await response.json();
  const graph = row.facts?.graph as { width?: number; height?: number } | undefined;
  return { id: row.id, seed: row.seed, width: graph?.width, height: graph?.height };
}

function toWikiEntity(mapId: number, node: TreeNode, parentTitle?: string): WikiEntity {
  const slug = `db-${mapId}-${node.kind}-${node.id}`;
  const summaryParts = [
    parentTitle ? `Part of ${parentTitle}.` : undefined,
    node.population !== undefined ? `Population: ${node.population}.` : undefined,
    node.capital ? "Capital." : undefined
  ].filter(Boolean);

  const frontmatter: WikiFrontmatter = {
    title: node.name || `Unnamed ${node.kind} #${node.id}`,
    type: node.kind,
    summary: summaryParts.join(" ") || undefined,
    dbRef: { mapId, kind: node.kind, id: node.id } satisfies DbEntityRef
  };

  return {
    slug,
    filePath: `db://map/${mapId}/${node.kind}/${node.id}`,
    frontmatter,
    body: `*Generated from map #${mapId} — no lore written yet.*`
  };
}

export function flattenTree(mapId: number, tree: EntityTree): WikiEntity[] {
  const entities: WikiEntity[] = [];

  for (const state of tree.states) {
    entities.push(toWikiEntity(mapId, state));
    for (const child of state.children ?? []) {
      entities.push(toWikiEntity(mapId, child, state.name));
      if (child.kind === "province") {
        for (const burg of child.children ?? [])
          entities.push(toWikiEntity(mapId, burg, `${child.name}, ${state.name}`));
      }
    }
  }

  for (const kind of ["cultures", "religions", "rivers", "markers"] as const) {
    for (const node of tree[kind]) entities.push(toWikiEntity(mapId, node));
  }

  return entities;
}

export async function loadGeneratedEntities(apiBase: string, mapId: number): Promise<WikiEntity[]> {
  const response = await fetch(`${apiBase}/api/maps/${mapId}/entities/tree`);
  if (!response.ok) throw new Error(`GET /api/maps/${mapId}/entities/tree failed: ${response.status}`);
  const tree: EntityTree = await response.json();
  return flattenTree(mapId, tree);
}
