/**
 * A ```board fenced JSON block convention for `type: board` entities — the frontmatter YAML-lite
 * parser (frontmatter.ts) can't represent an array of objects, so board contents live in the body
 * instead, in one fenced block, same "convention on the raw body text" approach as secrets.ts's
 * `:::secret` blocks. Board rendering never touches renderMarkdown (see board-canvas.ts).
 *
 * extractBoardDataForTab/replaceBoardBlockForTab (bottom of file) extend this same JSON-parsing
 * logic to a multi-tab page's board *tab* (see wiki/tabs.ts) — a distinct, additive convention
 * (```board:<tabId>) that never reads or writes the singular ```board fence below, so an existing
 * `type: board` entity's data is untouched by the tab machinery.
 */
import { extractTabBlockJson, replaceTabBlock } from "./tabs";

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

/** No block (`json === null`), or malformed JSON inside one, both fall back to an empty board
 *  rather than throwing — a board page/tab should always render, even if its data was hand-edited
 *  into something broken. Shared by extractBoardData and extractBoardDataForTab. */
function parseBoardJson(json: string | null): BoardData {
  if (json === null) return emptyBoard();
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

/** Finds the ```board fenced block in a raw body and parses its JSON. See parseBoardJson for the
 *  no-block/malformed-JSON fallback behavior. */
export function extractBoardData(body: string): BoardData {
  const lines = body.split("\n");
  const start = lines.findIndex(line => BOARD_FENCE.test(line));
  if (start === -1) return parseBoardJson(null);

  const end = lines.findIndex((line, i) => i > start && FENCE_END.test(line));
  if (end === -1) return parseBoardJson(null);

  return parseBoardJson(lines.slice(start + 1, end).join("\n"));
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

/** Splits `raw` into its verbatim frontmatter header and body, applies `transformBody` to the body
 *  only, and rejoins — the shared shape of "the save flow's entry point" for every body-mutation in
 *  this module (saveEntity always writes a whole file). Same verbatim frontmatter-block capture as
 *  frontmatter.ts's parseFrontmatter/map-ref-patch.ts. Falls back to running `transformBody` on the
 *  whole text when there's no `---` frontmatter block to preserve. */
function replaceInRaw(raw: string, transformBody: (body: string) => string): string {
  const lines = raw.split("\n");
  if (lines[0]?.trim() !== "---") return transformBody(raw);

  const end = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (end === -1) return transformBody(raw);

  const header = lines.slice(0, end + 1).join("\n");
  const body = lines
    .slice(end + 1)
    .join("\n")
    .replace(/^\n+/, "");
  return `${header}\n${transformBody(body)}`;
}

/** Same as replaceBoardBlock, but takes the whole raw file (frontmatter + body) and only touches
 *  the body part. */
export function replaceBoardBlockInRaw(raw: string, data: BoardData): string {
  return replaceInRaw(raw, body => replaceBoardBlock(body, data));
}

const BOARD_TAB_KIND = "board";

/** A multi-tab page's board *tab* content (see wiki/tabs.ts) — a ```board:<tabId> block, distinct
 *  from and never colliding with the singular ```board fence a `type: board` entity uses above. */
export function extractBoardDataForTab(body: string, tabId: string): BoardData {
  return parseBoardJson(extractTabBlockJson(body, BOARD_TAB_KIND, tabId));
}

export function replaceBoardBlockForTab(body: string, tabId: string, data: BoardData): string {
  return replaceTabBlock(body, BOARD_TAB_KIND, tabId, data);
}

/** Same as replaceBoardBlockForTab, but takes the whole raw file and only touches the body part —
 *  the tab equivalent of replaceBoardBlockInRaw. */
export function replaceBoardBlockForTabInRaw(raw: string, tabId: string, data: BoardData): string {
  return replaceInRaw(raw, body => replaceBoardBlockForTab(body, tabId, data));
}
