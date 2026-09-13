/**
 * Hand-rolled YAML-lite parser, deliberately narrow: only the shapes wiki/SCHEMA.md actually uses
 * (scalars, inline `[a, b]` arrays, block `- item` arrays, one level of nested maps). Not general
 * YAML — CONTEXT.md forbids adding a production dependency (e.g. js-yaml) for this.
 */

function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) return value.slice(1, -1);
  }
  return value;
}

function parseScalar(raw: string): unknown {
  const value = raw.trim();
  if (value === "") return "";
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    return inner === "" ? [] : inner.split(",").map(part => stripQuotes(part.trim()));
  }
  return stripQuotes(value);
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function parseYamlLite(text: string): Record<string, unknown> {
  const lines = text.split("\n").filter(line => line.trim() !== "" && !line.trim().startsWith("#"));
  let pos = 0;

  function parseLevel(indent: number): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    while (pos < lines.length) {
      const lineIndent = indentOf(lines[pos]);
      if (lineIndent < indent) break;
      if (lineIndent > indent) {
        pos++; // orphaned/misindented line — skip rather than mis-nest
        continue;
      }

      const trimmed = lines[pos].slice(lineIndent);
      const kvMatch = trimmed.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if (!kvMatch) {
        pos++;
        continue;
      }

      const [, key, rest] = kvMatch;
      pos++;

      if (rest !== "") {
        result[key] = parseScalar(rest);
        continue;
      }

      const next = lines[pos];
      const nextIndent = next ? indentOf(next) : -1;
      const nextIsListItem = next?.slice(nextIndent).startsWith("- ");

      if (nextIndent > indent && nextIsListItem) {
        const items: string[] = [];
        while (
          pos < lines.length &&
          indentOf(lines[pos]) === nextIndent &&
          lines[pos].slice(nextIndent).startsWith("- ")
        ) {
          items.push(stripQuotes(lines[pos].slice(nextIndent + 2).trim()));
          pos++;
        }
        result[key] = items;
      } else if (nextIndent > indent) {
        result[key] = parseLevel(nextIndent);
      } else {
        result[key] = "";
      }
    }

    return result;
  }

  return parseLevel(0);
}

export interface ParsedFile {
  data: Record<string, unknown>;
  content: string;
}

/** Splits a `---`-delimited frontmatter block from the rest of a Markdown file */
export function parseFrontmatter(raw: string): ParsedFile {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") return { data: {}, content: raw };

  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end === -1) return { data: {}, content: raw };

  const block = lines.slice(1, end).join("\n");
  const content = lines
    .slice(end + 1)
    .join("\n")
    .replace(/^\n+/, "");

  return { data: parseYamlLite(block), content };
}
