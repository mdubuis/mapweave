/**
 * Builds and splices `map_ref:` YAML-lite blocks — same targeted-text-edit approach as
 * frontmatter-patch.ts, not a reparse+reserialize. Shared by editor.ts's createEntity (brand-new
 * file, block goes straight into the template string) and insertMapRefBlock below (existing file,
 * spliced into its raw text).
 */
import type { MapRef } from "./types";

/** Lines for a `map_ref:` block scoped to one era, matching wiki/SCHEMA.md's shape. No trailing
 *  newline on the last line — join with "\n" and add one where the caller needs it. */
export function buildMapRefBlockLines(era: string, mapRef: MapRef): string[] {
  const lines = [
    `map_ref:`,
    `  ${era}:`,
    `    kind: ${mapRef.kind}`,
    `    id: ${mapRef.id}`,
    `    name: ${mapRef.name}`
  ];
  if (mapRef.cell !== undefined) lines.push(`    cell: ${mapRef.cell}`);
  return lines;
}

/** Inserts a brand-new `map_ref:` block into an entity's raw frontmatter text, just before the
 *  closing `---`. Precondition, enforced by callers (see wiki-main.ts's eraCount gate): the entity
 *  has no `map_ref` for any era yet — splicing a new era into an already-multi-era block is out of
 *  scope here (no general YAML serializer, see frontmatter.ts). */
export function insertMapRefBlock(raw: string, era: string, mapRef: MapRef): string {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") return raw;
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end === -1) return raw;

  lines.splice(end, 0, ...buildMapRefBlockLines(era, mapRef));
  return lines.join("\n");
}
