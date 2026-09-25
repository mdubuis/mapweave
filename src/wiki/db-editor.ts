/**
 * Lore-page storage, backed by Postgres (wiki_pages/wiki_templates — see server/db/schema.sql)
 * instead of the browser's local-folder File System Access API the old editor.ts used. Editing a
 * page now needs nothing but a connected world (see db-entities.ts's connectedMapId) — no folder
 * to pick, no permission to re-grant every reload, works in any browser.
 */
import { parseEntityFile } from "./entities";
import { parseFrontmatter } from "./frontmatter";
import { patchFrontmatterField } from "./frontmatter-patch";
import { buildMapRefBlockLines } from "./map-ref-patch";
import { DEFAULT_ERA, type MapRef, type WikiEntity } from "./types";

/** A page saved as a reusable starter (see saveWikiTemplate/loadWikiTemplates) — `raw` is the
 *  source page's complete text, captured verbatim; applying it just overwrites its `title:` line
 *  (createWikiPage's templateRaw param), never a reparse+reserialize. */
export interface PageTemplate {
  name: string;
  type: string;
  raw: string;
}

export function slugify(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "untitled";
}

/** Type-specific starter frontmatter for the scenario module — a fresh page already shows the
 *  expected shape instead of a bare title/type stub. See wiki/SCHEMA.md */
export function scenarioTemplateBlock(type: string): string {
  if (type === "quest") return "status: open\nobjectives:\n  - [ ] \n";
  if (type === "encounter-table") return "table:\n  - \n";
  if (type === "session-log") return "number: 1\ndate: \n";
  if (type === "event") return "order: \ndate: \ngroup: \n";
  return "";
}

interface WikiPageRow {
  slug: string;
  type: string;
  title: string;
  raw: string;
  updatedAt: string;
}

function toWikiEntity(mapId: number, row: WikiPageRow): WikiEntity {
  // parseEntityFile's slug comes from a basename-minus-extension split — a bare slug (no "/", no
  // ".md") passes through unchanged, so this reuses the exact same frontmatter-to-WikiFrontmatter
  // conversion the old file-based entities used, no separate copy to keep in sync.
  const entity = parseEntityFile(row.slug, row.raw);
  return { ...entity, filePath: `db://wiki-page/${mapId}/${row.slug}` };
}

export async function loadWikiPages(
  apiBase: string,
  mapId: number
): Promise<{ entities: WikiEntity[]; raw: Map<string, string> }> {
  const response = await fetch(`${apiBase}/api/maps/${mapId}/wiki/pages`);
  if (!response.ok) throw new Error(`GET /api/maps/${mapId}/wiki/pages failed: ${response.status}`);
  const rows: WikiPageRow[] = await response.json();

  const raw = new Map<string, string>();
  const entities = rows.map(row => {
    raw.set(row.slug, row.raw);
    return toWikiEntity(mapId, row);
  });
  entities.sort((a, b) => a.frontmatter.title.localeCompare(b.frontmatter.title));
  return { entities, raw };
}

async function putPage(apiBase: string, mapId: number, slug: string, raw: string): Promise<void> {
  const { data } = parseFrontmatter(raw);
  const title = typeof data.title === "string" && data.title.trim() ? data.title : slug;
  const type = typeof data.type === "string" && data.type.trim() ? data.type : "note";

  const response = await fetch(`${apiBase}/api/maps/${mapId}/wiki/pages/${encodeURIComponent(slug)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, type, raw })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `PUT wiki page failed: ${response.status}`);
  }
}

export async function saveWikiPage(apiBase: string, mapId: number, slug: string, raw: string): Promise<void> {
  await putPage(apiBase, mapId, slug, raw);
}

/**
 * `templateRaw`, when given, is a saved PageTemplate's complete text (see loadWikiTemplates below
 * and wiki-main.ts's renderNewEntityView) — captured verbatim when saved, so applying it is just
 * overwriting its `title:` line, not rebuilding frontmatter from scratch. Without one, builds the
 * usual bare stub (mapRef + the per-type scenario starter, unchanged).
 */
export async function createWikiPage(
  apiBase: string,
  mapId: number,
  title: string,
  type: string,
  mapRef?: MapRef,
  era?: string,
  templateRaw?: string
): Promise<{ slug: string }> {
  const slug = slugify(title);

  if (templateRaw) {
    await putPage(apiBase, mapId, slug, patchFrontmatterField(templateRaw, "title", title));
    return { slug };
  }

  const mapRefBlock = mapRef ? `${buildMapRefBlockLines(era ?? DEFAULT_ERA, mapRef).join("\n")}\n` : "";
  const raw = `---\ntitle: ${title}\ntype: ${type}\n${mapRefBlock}${scenarioTemplateBlock(type)}---\n\n`;
  await putPage(apiBase, mapId, slug, raw);
  return { slug };
}

export async function loadWikiTemplates(apiBase: string): Promise<PageTemplate[]> {
  const response = await fetch(`${apiBase}/api/wiki/templates`);
  if (!response.ok) throw new Error(`GET /api/wiki/templates failed: ${response.status}`);
  const rows: Array<{ name: string; type: string; raw: string }> = await response.json();
  return rows.map(({ name, type, raw }) => ({ name, type, raw }));
}

export async function saveWikiTemplate(apiBase: string, name: string, raw: string): Promise<void> {
  const { data } = parseFrontmatter(raw);
  const type = typeof data.type === "string" && data.type.trim() ? data.type : "note";

  const response = await fetch(`${apiBase}/api/wiki/templates/${encodeURIComponent(slugify(name))}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, raw })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error ?? `PUT wiki template failed: ${response.status}`);
  }
}

export async function deleteWikiTemplate(apiBase: string, name: string): Promise<void> {
  await fetch(`${apiBase}/api/wiki/templates/${encodeURIComponent(slugify(name))}`, { method: "DELETE" }).catch(
    () => {}
  );
}
