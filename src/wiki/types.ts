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

/** One tab of a multi-tab page (Phase 6 "unified navigation" — see MAPWEAVE.md), minus its id — the
 *  id is the key in `PageTabs` below, not a field here. `mapId` is meaningful for `type: "map"` tabs
 *  only — which maps.id (Postgres) this tab shows. */
export interface PageTabMeta {
  type: "wiki" | "map" | "board";
  title?: string;
  mapId?: number;
}

/** `tabs` is keyed by a stable tab id (also referenced by the router's `?tab=` param and by
 *  wiki/tabs.ts's fenced-block storage, ```<type>:<id>) — the same "map keyed by string id, not an
 *  array of objects" shape `map_ref` already uses (`MapRefsByEra` above), because the hand-rolled
 *  YAML-lite parser (frontmatter.ts) can represent nested maps but not an array of objects. */
export type PageTabs = Record<string, PageTabMeta>;

export interface WikiFrontmatter {
  title: string;
  type: string;
  summary?: string;
  tags?: string[];
  aliases?: string[];
  relations?: Record<string, string>;
  map_ref?: MapRefsByEra;
  eras?: Record<string, EraOverride>;
  /** Sort position: for "era"-type entities, position in the era timeline; for "event"-type
   *  entities, position in the #/timeline view (wiki-main.ts's renderTimelineView) */
  order?: number;
  /** "era"-type entities only: filename under public/maps/ for this era's full map snapshot */
  map_file?: string;

  // Scenario module — usable on any entity, not gated to a specific `type`. See wiki/SCHEMA.md.
  /** Free-form convention (open/active/complete/abandoned are the documented ones); any other
   *  value is accepted and grouped under "other" rather than rejected */
  status?: string;
  /** Narrative hook, typically used on quest entities */
  hook?: string;
  /** Each entry optionally prefixed "[x] "/"[ ] " to mark done/pending — see scenario.ts's parseObjective */
  objectives?: string[];
  /** How a quest concluded, filled in once status is "complete"/"abandoned" */
  resolution?: string;
  /** Generic key/value stat block, usable on any entity (most often `character`) — the app never
   *  assumes a specific game system, see statBlockSystem */
  stats?: Record<string, string | number>;
  /** Free-form label for what `stats`' keys mean, e.g. "D&D 5e" or "maison" — display only */
  statBlockSystem?: string;
  /** Encounter/event table entries. Each entry optionally prefixed "Nx " to weight it (default 1)
   *  — see scenario.ts's parseWeightedEntry/rollEncounter */
  table?: string[];
  /** Session-log entities: sort order for the session log view */
  number?: number;
  /** Free-form date string (in-fiction or real-world), display only, never parsed — used by
   *  session-log entities and by "event"-type entities in the #/timeline view. Real calendar math
   *  (custom calendars, date arithmetic) is explicitly out of scope, see wiki/SCHEMA.md. */
  date?: string;
  /** "event"-type entities: a free-form category for the #/timeline view's grouping (e.g.
   *  "Adversaries", "Civics") — entities without one land in an "Other" group rather than being
   *  rejected. See wiki/SCHEMA.md. */
  group?: string;
  /** Hides this whole entity in player view (see wiki-main.ts's viewMode) — a local display filter
   *  for the GM to flip before sharing their screen, not real access control. A `:::secret` block
   *  in the body (see wiki/secrets.ts) hides part of an otherwise-visible page instead of all of it. */
  secret?: boolean;
  /** Slug of a parent entity, for the sidebar's nested tree (wiki-main.ts's buildGroupTree) — only
   *  nests when the parent is the same `type`; anything else (different type, unknown slug) falls
   *  back to a flat top-level entry rather than erroring. See wiki/SCHEMA.md. */
  parent?: string;
  /** Multi-tab pages (Phase 6): a page can bundle more than one wiki/map/board tab. Absent/empty
   *  means "one implicit wiki tab" (see entities.ts's toFrontmatter) — every entity created before
   *  this field existed keeps working with zero file changes. See wiki/tabs.ts for tab content
   *  storage and wiki/SCHEMA.md for the full convention. */
  tabs?: PageTabs;
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
