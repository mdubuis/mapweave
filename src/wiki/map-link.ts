/**
 * Bridges a clicked map entity (burg/state/marker) to its Mapweave wiki page. The map app (index.html)
 * and the wiki app (wiki.html) are separate bundles with no shared runtime, so this reads the same
 * bundled `wiki/**\/*.md` snapshot the wiki app browses (see src/wiki/entities.ts) — live edits made
 * through the wiki's "Open wiki folder" editor aren't visible here until the page is rebuilt/reloaded.
 *
 * Every lookup is era-scoped: the same burg id can point at a different (or no) wiki page from one
 * era's map to the next, since map_ref itself is keyed by era — see wiki/SCHEMA.md and src/wiki/eras.ts.
 */
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
  const entities = loadEntities();
  return currentEraSlug(loadEras(entities));
}

export function findWikiEntitySlug(era: string, identity: Pick<MapEntityIdentity, "kind" | "id">): string | undefined {
  const match = loadEntities().find(entity => {
    const ref = entity.frontmatter.map_ref?.[era];
    return ref?.kind === identity.kind && ref.id === identity.id;
  });
  return match?.slug;
}

/** Existing page if this entity is already linked in this era, otherwise a prefilled "create page" flow */
export function wikiLinkHref(era: string, identity: MapEntityIdentity, wikiBase = "./wiki.html"): string {
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
