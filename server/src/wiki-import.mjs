/**
 * One-time safety net for anyone who used the old "Open wiki folder" (File System Access) editor
 * with real content in a folder outside this repo — imports it into wiki_pages/wiki_templates so
 * nothing is lost once that editing path is removed. Not needed for the bundled wiki/ demo content,
 * which stays as the no-world-connected fallback (src/wiki/entities.ts's loadEntities()).
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter } from "../../src/wiki/frontmatter.ts";

function titleCase(slug) {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

async function* walkMarkdownFiles(dir, prefix = "") {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name === "templates" && !prefix) continue;
    const filePath = path.join(dir, entry.name);
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* walkMarkdownFiles(filePath, relPath);
    else if (entry.name.endsWith(".md")) yield { relPath, filePath };
  }
}

export async function importWikiFolder(client, mapId, dirPath) {
  let pages = 0;
  for await (const { relPath, filePath } of walkMarkdownFiles(dirPath)) {
    const raw = await readFile(filePath, "utf8");
    const { data } = parseFrontmatter(raw);
    const slug = path.basename(relPath).replace(/\.md$/, "");
    const title = typeof data.title === "string" && data.title.trim() ? data.title : titleCase(slug);
    const type = typeof data.type === "string" && data.type.trim() ? data.type : "note";

    await client.query(
      `INSERT INTO wiki_pages (map_id, slug, type, title, raw)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (map_id, slug) DO UPDATE SET type = EXCLUDED.type, title = EXCLUDED.title, raw = EXCLUDED.raw, updated_at = now()`,
      [mapId, slug, type, title, raw]
    );
    pages++;
  }

  let templates = 0;
  const templatesDir = path.join(dirPath, "templates");
  try {
    for (const entry of await readdir(templatesDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const raw = await readFile(path.join(templatesDir, entry.name), "utf8");
      const { data } = parseFrontmatter(raw);
      const name = entry.name.replace(/\.md$/, "");
      const type = typeof data.type === "string" && data.type.trim() ? data.type : "note";

      await client.query(
        `INSERT INTO wiki_templates (name, type, raw)
         VALUES ($1, $2, $3)
         ON CONFLICT (name) DO UPDATE SET type = EXCLUDED.type, raw = EXCLUDED.raw, updated_at = now()`,
        [name, type, raw]
      );
      templates++;
    }
  } catch {
    // no templates/ folder — nothing to import
  }

  return { pages, templates };
}
