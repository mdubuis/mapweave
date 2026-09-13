export type MapRefKind = "burg" | "state" | "province" | "religion" | "culture" | "marker" | "river";

export interface MapRef {
  kind: MapRefKind;
  id: number;
  name: string;
}

export interface WikiFrontmatter {
  title: string;
  type: string;
  summary?: string;
  tags?: string[];
  aliases?: string[];
  relations?: Record<string, string>;
  map_ref?: MapRef;
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
