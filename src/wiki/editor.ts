/**
 * Optional, progressive-enhancement editing via the File System Access API (Chromium only).
 * Without it the wiki is still fully browsable from the bundled `wiki/**\/*.md` snapshot — this
 * only adds the ability to read/write those same files live from a user-picked local folder.
 */
import { parseEntityFile } from "./entities";
import type { MapRef, WikiEntity } from "./types";

export interface LiveEntitySource {
  entities: WikiEntity[];
  /** slug -> file handle, for saving */
  handles: Map<string, FileSystemFileHandle>;
  /** slug -> raw original file text, so editing round-trips exactly instead of re-serializing frontmatter */
  raw: Map<string, string>;
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

async function* walkMarkdownFiles(
  dir: FileSystemDirectoryHandle,
  prefix = ""
): AsyncGenerator<{ path: string; handle: FileSystemFileHandle }> {
  for await (const entry of dir.values()) {
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

export async function createEntity(
  dir: FileSystemDirectoryHandle,
  title: string,
  type: string,
  mapRef?: MapRef
): Promise<{ slug: string }> {
  const slug = slugify(title);
  const folder = await dir.getDirectoryHandle(`${type}s`, { create: true });
  const handle = await folder.getFileHandle(`${slug}.md`, { create: true });
  const mapRefBlock = mapRef
    ? `map_ref:\n  kind: ${mapRef.kind}\n  id: ${mapRef.id}\n  name: ${mapRef.name}\n${
        mapRef.cell !== undefined ? `  cell: ${mapRef.cell}\n` : ""
      }`
    : "";
  await saveEntity(handle, `---\ntitle: ${title}\ntype: ${type}\n${mapRefBlock}---\n\n`);
  return { slug };
}
