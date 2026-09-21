/**
 * A ```board fenced JSON block convention for `type: board` entities — the frontmatter YAML-lite
 * parser (frontmatter.ts) can't represent an array of objects, so board contents live in the body
 * instead, in one fenced block, same "convention on the raw body text" approach as secrets.ts's
 * `:::secret` blocks. Board rendering never touches renderMarkdown (see board-canvas.ts).
 */
const BOARD_FENCE = /^```board\s*$/;
const FENCE_END = /^```\s*$/;

export interface BoardItem {
  id: string;
  kind: "image" | "text" | "page";
  x: number;
  y: number;
  width: number;
  height: number;
  /** data-URI for "image", plain text for "text", entity slug for "page" */
  content: string;
}

export interface BoardConnector {
  id: string;
  from: string;
  to: string;
}

export interface BoardData {
  items: BoardItem[];
  connectors: BoardConnector[];
}

function emptyBoard(): BoardData {
  return { items: [], connectors: [] };
}

/** Finds the ```board fenced block in a raw body and parses its JSON. No block, or malformed
 *  JSON inside one, both fall back to an empty board rather than throwing — a board page should
 *  always render, even if its data was hand-edited into something broken. */
export function extractBoardData(body: string): BoardData {
  const lines = body.split("\n");
  const start = lines.findIndex(line => BOARD_FENCE.test(line));
  if (start === -1) return emptyBoard();

  const end = lines.findIndex((line, i) => i > start && FENCE_END.test(line));
  if (end === -1) return emptyBoard();

  const json = lines.slice(start + 1, end).join("\n");
  try {
    const parsed = JSON.parse(json) as Partial<BoardData>;
    return {
      items: Array.isArray(parsed.items) ? parsed.items : [],
      connectors: Array.isArray(parsed.connectors) ? parsed.connectors : []
    };
  } catch {
    return emptyBoard();
  }
}

/** Replaces (or appends) the ```board block with `data`, leaving the rest of the body untouched —
 *  targeted text edit, not reparse+reserialize, matching every other frontmatter/body mutation in
 *  this codebase (see frontmatter-patch.ts, map-ref-patch.ts). */
export function replaceBoardBlock(body: string, data: BoardData): string {
  const block = `\`\`\`board\n${JSON.stringify(data)}\n\`\`\``;
  const lines = body.split("\n");
  const start = lines.findIndex(line => BOARD_FENCE.test(line));

  if (start === -1) {
    const trimmed = body.replace(/\s+$/, "");
    return trimmed.length ? `${trimmed}\n\n${block}\n` : `${block}\n`;
  }

  const end = lines.findIndex((line, i) => i > start && FENCE_END.test(line));
  const before = lines.slice(0, start);
  const after = end === -1 ? [] : lines.slice(end + 1);
  return [...before, block, ...after].join("\n");
}

/** Same as replaceBoardBlock, but takes the whole raw file (frontmatter + body) and only touches
 *  the body part — the save flow's entry point, since saveEntity always writes a whole file. Same
 *  verbatim frontmatter-block capture as frontmatter.ts's parseFrontmatter/map-ref-patch.ts. */
export function replaceBoardBlockInRaw(raw: string, data: BoardData): string {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") return replaceBoardBlock(raw, data);

  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end === -1) return replaceBoardBlock(raw, data);

  const header = lines.slice(0, end + 1).join("\n");
  const body = lines
    .slice(end + 1)
    .join("\n")
    .replace(/^\n+/, "");
  return `${header}\n${replaceBoardBlock(body, data)}`;
}
