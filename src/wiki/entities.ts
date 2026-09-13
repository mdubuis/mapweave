import { parseFrontmatter } from "./frontmatter";
import type { MapRef, MapRefKind, WikiEntity, WikiFrontmatter } from "./types";

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

function toMapRef(value: unknown): MapRef | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { kind, id, name } = value as Record<string, unknown>;
  if (typeof kind !== "string" || !MAP_REF_KINDS.includes(kind as MapRefKind)) return undefined;
  if (typeof id !== "number") return undefined;
  return { kind: kind as MapRefKind, id, name: typeof name === "string" ? name : "" };
}

function toRelations(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const result: Record<string, string> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === "string") result[key] = val;
  }
  return result;
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
    map_ref: toMapRef(data.map_ref)
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
