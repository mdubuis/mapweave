/**
 * Bridges a clicked map entity (burg/state/marker) to its Mapweave wiki page. The map engine and
 * the wiki shell run in one merged DOM (Phase 6 — see MAPWEAVE.md), so this prefers wiki-main.ts's
 * live, merged entity list (db-entities.ts's getLiveEntities, kept current across DB-backed page
 * edits and world switches) and only falls back to the bundled `wiki/**\/*.md` snapshot
 * (src/wiki/entities.ts's loadEntities) for the case this runs before the wiki shell has rendered
 * once.
 *
 * Every lookup is era-scoped: the same burg id can point at a different (or no) wiki page from one
 * era's map to the next, since map_ref itself is keyed by era — see wiki/SCHEMA.md and src/wiki/eras.ts.
 */
import { getLiveEntities } from "./db-entities";
import { loadEntities } from "./entities";
import { currentEraSlug, loadEras } from "./eras";
import type { MapRefKind } from "./types";

export interface MapEntityIdentity {
  kind: MapRefKind;
  id: number;
  name: string;
  /** Required for every kind except "burg" — see wiki/SCHEMA.md's map_ref.cell */
  cell?: number;
}

/** The era the currently loaded map belongs to, inferred from the URL — see eras.currentEraSlug */
export function activeEra(): string {
  const entities = getLiveEntities() ?? loadEntities();
  return currentEraSlug(loadEras(entities));
}

export function findWikiEntitySlug(era: string, identity: Pick<MapEntityIdentity, "kind" | "id">): string | undefined {
  const match = (getLiveEntities() ?? loadEntities()).find(entity => {
    const ref = entity.frontmatter.map_ref?.[era];
    return ref?.kind === identity.kind && ref.id === identity.id;
  });
  return match?.slug;
}

/** Existing page if this entity is already linked in this era, otherwise a prefilled "create page" flow */
export function wikiLinkHref(era: string, identity: MapEntityIdentity, wikiBase = "./index.html"): string {
  const slug = findWikiEntitySlug(era, identity);
  if (slug) return `${wikiBase}#/entity/${encodeURIComponent(slug)}`;

  const params = new URLSearchParams({
    title: identity.name,
    mapKind: identity.kind,
    mapId: String(identity.id),
    mapEra: era
  });
  if (identity.cell !== undefined) params.set("mapCell", String(identity.cell));
  return `${wikiBase}#/new?${params.toString()}`;
}

export function wikiLinkTip(era: string, identity: Pick<MapEntityIdentity, "kind" | "id">): string {
  return findWikiEntitySlug(era, identity) ? "Open wiki page for this entity" : "Create a wiki page for this entity";
}
