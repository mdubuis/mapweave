/**
 * Targeted line edits on raw entity file text, not a reparse+reserialize — see frontmatter.ts's
 * header comment on why this repo has no general YAML serializer.
 */

/** Replaces (or inserts) the top-level `type:` line inside the frontmatter block, leaving
 *  everything else — including any `type:`-like text in the body — untouched. */
export function patchFrontmatterType(raw: string, newType: string): string {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") return raw;
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end === -1) return raw;

  const typeLineIndex = lines.findIndex((line, i) => i > 0 && i < end && /^type:\s*/.test(line));
  if (typeLineIndex !== -1) lines[typeLineIndex] = `type: ${newType}`;
  else lines.splice(1, 0, `type: ${newType}`);

  return lines.join("\n");
}
