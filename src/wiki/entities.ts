import { parseFrontmatter } from "./frontmatter";
import type { EraOverride, MapRef, MapRefKind, MapRefsByEra, WikiEntity, WikiFrontmatter } from "./types";

const files = import.meta.glob("../../wiki/**/*.md", { eager: true, query: "?raw", import: "default" }) as Record<
  string,
  string
>;

function slugFromPath(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.md$/, "");
}

function titleCase(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function toStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map(String) : undefined;
}

const MAP_REF_KINDS: MapRefKind[] = ["burg", "state", "province", "religion", "culture", "marker", "river"];

function toMapRefEntry(value: unknown): MapRef | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { kind, id, name, cell } = value as Record<string, unknown>;
  if (typeof kind !== "string" || !MAP_REF_KINDS.includes(kind as MapRefKind)) return undefined;
  if (typeof id !== "number") return undefined;
  return {
    kind: kind as MapRefKind,
    id,
    name: typeof name === "string" ? name : "",
    cell: typeof cell === "number" ? cell : undefined
  };
}

/** map_ref is a map of era slug -> MapRef (see wiki/SCHEMA.md and DEFAULT_ERA) */
function toMapRefsByEra(value: unknown): MapRefsByEra | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result: MapRefsByEra = {};
  for (const [era, entry] of Object.entries(value as Record<string, unknown>)) {
    const parsed = toMapRefEntry(entry);
    if (parsed) result[era] = parsed;
  }
  return Object.keys(result).length ? result : undefined;
}

function toEraOverrides(value: unknown): Record<string, EraOverride> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result: Record<string, EraOverride> = {};
  for (const [era, override] of Object.entries(value as Record<string, unknown>)) {
    if (override && typeof override === "object") result[era] = override as EraOverride;
  }
  return Object.keys(result).length ? result : undefined;
}

function toRelations(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === "string") result[key] = val;
  }
  return result;
}

/** A stat block is a flat map of label -> string|number; anything else per key is dropped rather
 *  than rejecting the whole block (see wiki/SCHEMA.md's scenario module section) */
function toStats(value: unknown): Record<string, string | number> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result: Record<string, string | number> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === "string" || typeof val === "number") result[key] = val;
  }
  return Object.keys(result).length ? result : undefined;
}

function toFrontmatter(slug: string, data: Record<string, unknown>): WikiFrontmatter {
  return {
    ...data,
    title: typeof data.title === "string" && data.title.trim() ? data.title : titleCase(slug),
    type: typeof data.type === "string" && data.type.trim() ? data.type : "note",
    summary: typeof data.summary === "string" ? data.summary : undefined,
    tags: toStringArray(data.tags),
    aliases: toStringArray(data.aliases),
    relations: toRelations(data.relations),
    map_ref: toMapRefsByEra(data.map_ref),
    eras: toEraOverrides(data.eras),
    order: typeof data.order === "number" ? data.order : undefined,
    map_file: typeof data.map_file === "string" ? data.map_file : undefined,
    status: typeof data.status === "string" ? data.status : undefined,
    hook: typeof data.hook === "string" ? data.hook : undefined,
    objectives: toStringArray(data.objectives),
    resolution: typeof data.resolution === "string" ? data.resolution : undefined,
    stats: toStats(data.stats),
    statBlockSystem: typeof data.statBlockSystem === "string" ? data.statBlockSystem : undefined,
    table: toStringArray(data.table),
    number: typeof data.number === "number" ? data.number : undefined,
    date: typeof data.date === "string" ? data.date : undefined,
    secret: data.secret === true ? true : undefined
  };
}

export function parseEntityFile(filePath: string, raw: string): WikiEntity {
  const slug = slugFromPath(filePath);
  const { data, content } = parseFrontmatter(raw);
  return { slug, filePath, frontmatter: toFrontmatter(slug, data), body: content };
}

export function loadEntities(): WikiEntity[] {
  return Object.entries(files)
    .map(([filePath, raw]) => parseEntityFile(filePath, raw))
    .sort((a, b) => a.frontmatter.title.localeCompare(b.frontmatter.title));
}

/** Normalizes a name/slug/alias for case- and punctuation-insensitive wikilink matching */
export function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export function buildSlugIndex(entities: WikiEntity[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const entity of entities) {
    index.set(normalizeKey(entity.slug), entity.slug);
    index.set(normalizeKey(entity.frontmatter.title), entity.slug);
    for (const alias of entity.frontmatter.aliases ?? []) index.set(normalizeKey(alias), entity.slug);
  }
  return index;
}

export function resolveTarget(index: Map<string, string>, target: string): { slug: string } | undefined {
  const slug = index.get(normalizeKey(target));
  return slug ? { slug } : undefined;
}

export interface AutoLinkName {
  name: string;
  slug: string;
}

/** Below this length, a title/alias is excluded from auto-linking (see markdown.ts's renderInline)
 *  — a short, common word that happens to be an entity's name would otherwise auto-link every
 *  occurrence of that word across the whole wiki. Explicit [[wikilinks]] have no such limit. */
export const MIN_AUTO_LINK_LENGTH = 4;

/** Titles + aliases eligible for auto-linking, sorted longest name first so e.g. "Old Port"
 *  matches before a shorter "Port" when both exist as entity names. */
export function buildAutoLinkNames(entities: WikiEntity[]): AutoLinkName[] {
  const names: AutoLinkName[] = [];
  for (const entity of entities) {
    for (const name of [entity.frontmatter.title, ...(entity.frontmatter.aliases ?? [])]) {
      if (name.trim().length >= MIN_AUTO_LINK_LENGTH) names.push({ name, slug: entity.slug });
    }
  }
  return names.sort((a, b) => b.name.length - a.name.length);
}
