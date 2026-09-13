export type MapRefKind = "burg" | "state" | "province" | "religion" | "culture" | "marker" | "river";

/** Era slug used when a project defines no "era" entities at all — see wiki/SCHEMA.md */
export const DEFAULT_ERA = "default";

export interface MapRef {
  kind: MapRefKind;
  id: number;
  name: string;
  /** Cell id to focus on for non-burg kinds (FMG's `?cell=` URL param); burgs resolve via `?burg=<id>` instead */
  cell?: number;
}

/** map_ref is keyed by era slug: an entity can point at a different (or no) map object per era */
export type MapRefsByEra = Record<string, MapRef>;

/** Shallow field overrides applied on top of the base frontmatter for one era — see resolveEntityForEra */
export type EraOverride = Record<string, unknown>;

export interface WikiFrontmatter {
  title: string;
  type: string;
  summary?: string;
  tags?: string[];
  aliases?: string[];
  relations?: Record<string, string>;
  map_ref?: MapRefsByEra;
  eras?: Record<string, EraOverride>;
  /** "era"-type entities only: sort order in the timeline */
  order?: number;
  /** "era"-type entities only: filename under public/maps/ for this era's full map snapshot */
  map_file?: string;
  [key: string]: unknown;
}

export interface WikiEntity {
  /** Filename without extension; permanent id used by wikilinks, URLs and graph nodes */
  slug: string;
  filePath: string;
  frontmatter: WikiFrontmatter;
  /** Markdown body, frontmatter block stripped */
  body: string;
}

export type EdgeKind = "link" | "relation";

export interface WikiEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** Relation name for kind "relation" (e.g. "located_in"); undefined for plain wikilinks */
  label?: string;
}

export interface WikiGraph {
  entities: WikiEntity[];
  edges: WikiEdge[];
  /** Wikilink targets that resolved to no known entity, per source slug */
  brokenLinks: Map<string, string[]>;
}
