/**
 * Targeted line edits on raw entity file text, not a reparse+reserialize — see frontmatter.ts's
 * header comment on why this repo has no general YAML serializer.
 */

/** Replaces (or inserts) a top-level `key: value` line inside the frontmatter block, leaving
 *  everything else — including any `key:`-like text in the body — untouched. Only for a plain
 *  scalar value (a string with no special YAML characters); it's written unquoted, same as every
 *  other frontmatter writer in this codebase (createEntity, map-ref-patch.ts). */
export function patchFrontmatterField(raw: string, key: string, value: string): string {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") return raw;
  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end === -1) return raw;

  const pattern = new RegExp(`^${key}:\\s*`);
  const keyLineIndex = lines.findIndex((line, i) => i > 0 && i < end && pattern.test(line));
  if (keyLineIndex !== -1) lines[keyLineIndex] = `${key}: ${value}`;
  else lines.splice(1, 0, `${key}: ${value}`);

  return lines.join("\n");
}

/** Replaces (or inserts) the top-level `type:` line — see patchFrontmatterField. */
export function patchFrontmatterType(raw: string, newType: string): string {
  return patchFrontmatterField(raw, "type", newType);
}
