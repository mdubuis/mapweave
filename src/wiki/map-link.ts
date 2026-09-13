/**
 * Bridges a clicked map entity (burg/state/marker) to its Mapweave wiki page. The map app (index.html)
 * and the wiki app (wiki.html) are separate bundles with no shared runtime, so this reads the same
 * bundled `wiki/**\/*.md` snapshot the wiki app browses (see src/wiki/entities.ts) — live edits made
 * through the wiki's "Open wiki folder" editor aren't visible here until the page is rebuilt/reloaded.
 */
import { loadEntities } from "./entities";
import type { MapRefKind } from "./types";

export interface MapEntityIdentity {
  kind: MapRefKind;
  id: number;
  name: string;
  /** Required for every kind except "burg" — see wiki/SCHEMA.md's map_ref.cell */
  cell?: number;
}

export function findWikiEntitySlug(identity: Pick<MapEntityIdentity, "kind" | "id">): string | undefined {
  const match = loadEntities().find(
    entity => entity.frontmatter.map_ref?.kind === identity.kind && entity.frontmatter.map_ref?.id === identity.id
  );
  return match?.slug;
}

/** Existing page if this entity is already linked, otherwise a prefilled "create page" flow */
export function wikiLinkHref(identity: MapEntityIdentity, wikiBase = "./wiki.html"): string {
  const slug = findWikiEntitySlug(identity);
  if (slug) return `${wikiBase}#/entity/${encodeURIComponent(slug)}`;

  const params = new URLSearchParams({ title: identity.name, mapKind: identity.kind, mapId: String(identity.id) });
  if (identity.cell !== undefined) params.set("mapCell", String(identity.cell));
  return `${wikiBase}#/new?${params.toString()}`;
}

export function wikiLinkTip(identity: MapEntityIdentity): string {
  return findWikiEntitySlug(identity) ? "Open wiki page for this entity" : "Create a wiki page for this entity";
}
