/**
 * Optional, progressive-enhancement editing via the File System Access API (Chromium only).
 * Without it the wiki is still fully browsable from the bundled `wiki/**\/*.md` snapshot — this
 * only adds the ability to read/write those same files live from a user-picked local folder.
 */
import { parseEntityFile } from "./entities";
import { parseFrontmatter } from "./frontmatter";
import { patchFrontmatterField } from "./frontmatter-patch";
import { buildMapRefBlockLines } from "./map-ref-patch";
import { DEFAULT_ERA, type MapRef, type WikiEntity } from "./types";

export interface LiveEntitySource {
  entities: WikiEntity[];
  /** slug -> file handle, for saving */
  handles: Map<string, FileSystemFileHandle>;
  /** slug -> raw original file text, so editing round-trips exactly instead of re-serializing frontmatter */
  raw: Map<string, string>;
}

/** A page saved as a reusable starter (see saveTemplate/loadTemplates) — `raw` is the source page's
 *  complete file text, captured verbatim; applying it just overwrites its `title:` line
 *  (createEntity's templateRaw param), never a reparse+reserialize. */
export interface PageTemplate {
  name: string;
  type: string;
  raw: string;
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window.showDirectoryPicker === "function";
}

export async function pickWikiDirectory(): Promise<FileSystemDirectoryHandle | undefined> {
  if (!isFileSystemAccessSupported()) return undefined;
  try {
    return await window.showDirectoryPicker!({ mode: "readwrite" });
  } catch {
    return undefined; // user cancelled the picker
  }
}

/** Top-level `templates/` is deliberately excluded from the entity walk — see loadTemplates. A
 *  nested folder that happens to be named "templates" further down the tree is untouched, only the
 *  one at the wiki root (where saveTemplate creates it) is special. */
async function* walkMarkdownFiles(
  dir: FileSystemDirectoryHandle,
  prefix = ""
): AsyncGenerator<{ path: string; handle: FileSystemFileHandle }> {
  for await (const entry of dir.values()) {
    if (entry.kind === "directory" && entry.name === "templates" && !prefix) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === "directory") yield* walkMarkdownFiles(entry, path);
    else if (entry.name.endsWith(".md")) yield { path, handle: entry };
  }
}

export async function loadFromDirectory(dir: FileSystemDirectoryHandle): Promise<LiveEntitySource> {
  const entities: WikiEntity[] = [];
  const handles = new Map<string, FileSystemFileHandle>();
  const raw = new Map<string, string>();

  for await (const { path, handle } of walkMarkdownFiles(dir)) {
    const text = await (await handle.getFile()).text();
    const entity = parseEntityFile(path, text);
    entities.push(entity);
    handles.set(entity.slug, handle);
    raw.set(entity.slug, text);
  }

  entities.sort((a, b) => a.frontmatter.title.localeCompare(b.frontmatter.title));
  return { entities, handles, raw };
}

export async function saveEntity(handle: FileSystemFileHandle, content: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(content);
  await writable.close();
}

function slugify(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return slug || "untitled";
}

async function getTemplatesFolder(
  dir: FileSystemDirectoryHandle,
  create: boolean
): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    return await dir.getDirectoryHandle("templates", { create });
  } catch {
    return undefined; // doesn't exist yet, and this call wasn't asked to create it
  }
}

/** Templates live in wiki/templates/ as normal entity-shaped files (frontmatter + body) —
 *  walkMarkdownFiles excludes that folder from the real entity list, so a template never shows up
 *  as a page. */
export async function loadTemplates(dir: FileSystemDirectoryHandle): Promise<PageTemplate[]> {
  const folder = await getTemplatesFolder(dir, false);
  if (!folder) return [];

  const templates: PageTemplate[] = [];
  for await (const entry of folder.values()) {
    if (entry.kind !== "file" || !entry.name.endsWith(".md")) continue;
    const raw = await (await entry.getFile()).text();
    const { data } = parseFrontmatter(raw);
    const type = typeof data.type === "string" && data.type.trim() ? data.type : "note";
    templates.push({ name: entry.name.replace(/\.md$/, ""), type, raw });
  }
  return templates.sort((a, b) => a.name.localeCompare(b.name));
}

export async function saveTemplate(dir: FileSystemDirectoryHandle, name: string, raw: string): Promise<void> {
  const folder = await getTemplatesFolder(dir, true);
  const handle = await folder!.getFileHandle(`${slugify(name)}.md`, { create: true });
  await saveEntity(handle, raw);
}

export async function deleteTemplate(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
  const folder = await getTemplatesFolder(dir, false);
  await folder?.removeEntry(`${slugify(name)}.md`).catch(() => {});
}

/** Type-specific starter frontmatter for the scenario module — a fresh page already shows the
 *  expected shape instead of a bare title/type stub. See wiki/SCHEMA.md */
function scenarioTemplateBlock(type: string): string {
  if (type === "quest") return "status: open\nobjectives:\n  - [ ] \n";
  if (type === "encounter-table") return "table:\n  - \n";
  if (type === "session-log") return "number: 1\ndate: \n";
  return "";
}

/**
 * `templateRaw`, when given, is a saved PageTemplate's complete file text (see loadTemplates above
 * and wiki-main.ts's renderNewEntityView) — captured verbatim when saved, so applying it is just
 * overwriting its `title:` line, not rebuilding frontmatter from scratch. Without one, builds the
 * usual bare stub (mapRef + the per-type scenario starter, unchanged).
 */
export async function createEntity(
  dir: FileSystemDirectoryHandle,
  title: string,
  type: string,
  mapRef?: MapRef,
  era?: string,
  templateRaw?: string
): Promise<{ slug: string }> {
  const slug = slugify(title);
  const folder = await dir.getDirectoryHandle(`${type}s`, { create: true });
  const handle = await folder.getFileHandle(`${slug}.md`, { create: true });

  if (templateRaw) {
    await saveEntity(handle, patchFrontmatterField(templateRaw, "title", title));
    return { slug };
  }

  const mapRefBlock = mapRef ? `${buildMapRefBlockLines(era ?? DEFAULT_ERA, mapRef).join("\n")}\n` : "";
  await saveEntity(handle, `---\ntitle: ${title}\ntype: ${type}\n${mapRefBlock}${scenarioTemplateBlock(type)}---\n\n`);
  return { slug };
}
