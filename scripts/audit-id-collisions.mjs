#!/usr/bin/env node
/**
 * Static id-collision audit between the map bundle and the wiki bundle's reachable source files.
 * De-risks Phase 1 of the map/wiki single-DOM-merge plan (see MAPWEAVE.md "Phase 6"): the plan's
 * light-DOM-first/shadow-fallback approach is only safe as long as the same literal id string
 * isn't used by both apps for two different elements. This approximates real bundler reachability
 * by following import specifiers from each Vite entry's own root module (src/main.ts for the map,
 * src/wiki-main.ts for the wiki), plus each entry HTML's own inline content and <script src="...">
 * references for classic (non-module) scripts the map still loads.
 *
 * Not a perfect bundler — doesn't resolve bare npm specifiers (only "@/..." and relative imports),
 * and id extraction is regex-based, not a real parser, so it can both over- and under-report. Good
 * enough to answer "is the collision risk actually near-guaranteed, or small and fixable" — the
 * question this audit exists to answer, not a guarantee of completeness.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function readFile(p) {
  return fs.readFileSync(p, "utf8");
}

/** Resolves an import specifier to an absolute file path within `srcRoot`, or null for a bare npm
 *  package specifier (out of scope — see module doc comment). `aliasRoot` is what "@/..." maps to. */
export function resolveImportSpecifier(spec, fromFile, aliasRoot) {
  let base;
  if (spec.startsWith("@/")) base = path.join(aliasRoot, spec.slice(2));
  else if (spec.startsWith(".")) base = path.join(path.dirname(fromFile), spec);
  else return null;

  const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const IMPORT_RE = /\bimport\s+(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/g;
const EXPORT_FROM_RE = /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+["']([^"']+)["']/g;

/** Follows import/re-export specifiers transitively from `entryFile`, returning the set of
 *  absolute file paths reachable from it (including itself). */
export function collectReachable(entryFile, aliasRoot) {
  const seen = new Set();
  const stack = [entryFile];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);

    let content;
    try {
      content = readFile(file);
    } catch {
      continue;
    }

    for (const re of [IMPORT_RE, EXPORT_FROM_RE]) {
      re.lastIndex = 0;
      let match = re.exec(content);
      while (match) {
        const resolved = resolveImportSpecifier(match[1], file, aliasRoot);
        if (resolved && !seen.has(resolved)) stack.push(resolved);
        match = re.exec(content);
      }
    }
  }
  return seen;
}

const ID_PATTERNS = [
  /\bid=["']([A-Za-z][\w-]*)["']/g, // HTML/template-string id="..."
  /\.id\s*=\s*["']([A-Za-z][\w-]*)["']/g, // el.id = "..."
  /\bgetElementById\(["']([A-Za-z][\w-]*)["']\)/g,
  /\bensureEl(?:<[^>]*>)?\(["']([A-Za-z][\w-]*)["']\)/g,
  /\bfindEl(?:<[^>]*>)?\(["']([A-Za-z][\w-]*)["']\)/g,
  /\bquerySelector(?:All)?\(["']#([A-Za-z][\w-]*)["']\)/g,
  /\$\(["']#([A-Za-z][\w-]*)["']\)/g // jQuery $("#id")
];

/** Every id-like string literal found in `content`, via a handful of known access patterns — not
 *  a real parser, see module doc comment. */
export function extractIds(content) {
  const ids = new Set();
  for (const re of ID_PATTERNS) {
    re.lastIndex = 0;
    let match = re.exec(content);
    while (match) {
      ids.add(match[1]);
      match = re.exec(content);
    }
  }
  return ids;
}

/** Maps each id found across `files` to the set of files (relative to `root`) it was found in. */
export function idsFromFiles(files, root) {
  const all = new Map();
  for (const file of files) {
    let content;
    try {
      content = readFile(file);
    } catch {
      continue;
    }
    for (const id of extractIds(content)) {
      if (!all.has(id)) all.set(id, new Set());
      all.get(id).add(path.relative(root, file));
    }
  }
  return all;
}

function classicScriptFilesFromHtml(html, publicDir) {
  const classicScriptRe = /<script(?![^>]*type=["']module["'])[^>]*\ssrc=["']([^"']+)["']/g;
  const files = [];
  let match = classicScriptRe.exec(html);
  while (match) {
    const src = match[1];
    if (!src.startsWith("http")) {
      const resolved = path.join(publicDir, src.replace(/^\.?\//, ""));
      if (fs.existsSync(resolved)) files.push(resolved);
    }
    match = classicScriptRe.exec(html);
  }
  return files;
}

/** Runs the full audit against a real project root. Returns { mapIds, wikiIds, collisions }
 *  (id -> Set(relative file paths) maps, plus the sorted list of colliding ids). */
export function runAudit(root) {
  const src = path.join(root, "src");
  const publicDir = path.join(root, "public");

  const mapReachable = collectReachable(path.join(src, "main.ts"), src);
  mapReachable.add(path.join(src, "map.html"));
  const mapHtml = readFile(path.join(src, "map.html"));
  const mapFiles = [...mapReachable, ...classicScriptFilesFromHtml(mapHtml, publicDir)];
  const mapIds = idsFromFiles(mapFiles, root);

  const wikiReachable = collectReachable(path.join(src, "wiki-main.ts"), src);
  wikiReachable.add(path.join(src, "index.html"));
  const wikiFiles = [...wikiReachable];
  const wikiIds = idsFromFiles(wikiFiles, root);

  const collisions = [...mapIds.keys()].filter(id => wikiIds.has(id)).sort();

  return { mapFiles, wikiFiles, mapIds, wikiIds, collisions };
}

function main() {
  const root = path.resolve(import.meta.dirname, "..");
  const { mapFiles, wikiFiles, mapIds, wikiIds, collisions } = runAudit(root);

  console.log(`Map-side reachable files: ${mapFiles.length}, distinct ids found: ${mapIds.size}`);
  console.log(`Wiki-side reachable files: ${wikiFiles.length}, distinct ids found: ${wikiIds.size}`);
  console.log(`\nExact literal id collisions: ${collisions.length}`);
  for (const id of collisions) {
    const mapSources = [...mapIds.get(id)].join(", ");
    const wikiSources = [...wikiIds.get(id)].join(", ");
    console.log(`  - "${id}"\n      map:  ${mapSources}\n      wiki: ${wikiSources}`);
  }

  if (process.argv.includes("--json")) {
    console.log(
      JSON.stringify(
        { mapIds: [...mapIds.keys()].sort(), wikiIds: [...wikiIds.keys()].sort(), collisions },
        null,
        2
      )
    );
  }

  process.exitCode = collisions.length > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
